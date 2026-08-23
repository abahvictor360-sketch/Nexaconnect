import { NextResponse } from 'next/server';
import { ClaudeConfigError, ClaudeSchemaError } from '@/lib/claude';
import { runTriage } from '@/lib/triage';
import { EnquiryRequestSchema } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The triage pipeline. The API key lives only in this process — the browser
 * never sees it and never talks to Anthropic directly.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON' }, { status: 400 });
  }

  const parsed = EnquiryRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join('; ') },
      { status: 400 },
    );
  }

  try {
    const result = await runTriage(parsed.data.message, parsed.data.conversationId);
    return NextResponse.json({
      ticket: result.ticket,
      answer: result.answer,
      notice: result.notice,
      mode: result.mode,
      chunks: result.chunks,
      lookup: {
        requestedRef: result.lookup.requestedRef,
        found: result.lookup.found,
        rewritten: result.lookup.rewritten,
      },
    });
  } catch (error) {
    if (error instanceof ClaudeConfigError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    if (error instanceof ClaudeSchemaError) {
      // Deliberate: we would rather fail loudly than store a half-trusted answer.
      return NextResponse.json(
        {
          error:
            'The assistant could not produce a valid answer for this message. Please route it to a human.',
        },
        { status: 502 },
      );
    }
    console.error('[enquiry] unexpected failure', error);
    return NextResponse.json({ error: 'Unexpected server error' }, { status: 500 });
  }
}
