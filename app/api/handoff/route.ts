import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getViewer } from '@/lib/auth';
import { SchemaOutOfDateError } from '@/lib/db/supabase';
import { requestHuman } from '@/lib/triage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HandoffRequestSchema = z.object({
  conversationId: z.string().min(1).max(120),
  /** Anything the customer chose to add. Optional by design — KB-09 says they
   *  must not be made to explain the problem again to reach a person. */
  reason: z.string().max(2000).optional(),
});

/**
 * Transfer the conversation to a human.
 *
 * Separate from /api/enquiry and free of any model call: this is the escape
 * hatch, so it must stay fast and must keep working when the model is
 * unreachable, rate limited or unconfigured — the moments a customer is most
 * likely to press it.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON' }, { status: 400 });
  }

  const parsed = HandoffRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join('; ') },
      { status: 400 },
    );
  }

  try {
    const viewer = await getViewer();
    const result = await requestHuman({
      conversationId: parsed.data.conversationId,
      reason: parsed.data.reason ?? null,
      requester: { userId: viewer.id, email: viewer.email },
    });
    return NextResponse.json({
      ticket: result.ticket,
      notice: result.notice,
      desk: result.desk,
      slaHours: result.slaHours,
      alreadyQueued: result.alreadyQueued,
    });
  } catch (error) {
    if (error instanceof SchemaOutOfDateError) {
      console.error(`[handoff] ${error.message}`);
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    const detail = error instanceof Error ? error.message : String(error);
    console.error('[handoff] unexpected failure', error);
    return NextResponse.json(
      { error: `Could not put you through to a person: ${detail}` },
      { status: 500 },
    );
  }
}
