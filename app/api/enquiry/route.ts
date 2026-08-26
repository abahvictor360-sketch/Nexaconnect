import { NextResponse } from 'next/server';
import { getViewer } from '@/lib/auth';
import { ClaudeApiError, ClaudeConfigError, ClaudeSchemaError } from '@/lib/claude';
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
    // Identity comes from the session cookie, never from the request body: a
    // client that could name its own user id could raise cases as anyone.
    const viewer = await getViewer();
    const result = await runTriage(
      parsed.data.message,
      parsed.data.conversationId,
      { userId: viewer.id, email: viewer.email },
      parsed.data.attachment,
    );
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
    if (error instanceof ClaudeApiError) {
      // Log the full detail once, server-side, where the operator can see it.
      console.error(
        `[enquiry] Anthropic API ${error.status ?? 'error'} on model ${error.model}` +
          `${error.requestId ? ` (request ${error.requestId})` : ''}: ${error.message}`,
      );
      return NextResponse.json(
        { error: error.userMessage, retryable: error.retryable },
        { status: error.retryable ? 503 : 502 },
      );
    }
    if (error instanceof ClaudeSchemaError) {
      // Deliberate: we would rather fail loudly than store a half-trusted answer.
      // The raw output goes to the server log — it is the only way to tell a
      // prompt problem from a schema problem after the fact.
      console.error(
        `[enquiry] schema validation failed after ${error.attempts} attempts: ${error.message}\n` +
          `last raw output: ${error.lastRaw.slice(0, 2000)}`,
      );
      return NextResponse.json(
        {
          error:
            'The assistant could not produce a valid answer for this message. Please route it to a human.',
        },
        { status: 502 },
      );
    }
    // Anything left is genuinely unexpected, so say what it was rather than
    // hiding it behind a generic string the user cannot act on.
    const detail = error instanceof Error ? error.message : String(error);
    console.error('[enquiry] unexpected failure', error);
    return NextResponse.json(
      { error: `The assistant failed to handle that message: ${detail}` },
      { status: 500 },
    );
  }
}
