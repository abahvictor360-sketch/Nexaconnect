import { NextResponse } from 'next/server';
import { getViewer } from '@/lib/auth';
import { ClaudeApiError, ClaudeConfigError, ClaudeSchemaError } from '@/lib/claude';
import { SchemaOutOfDateError } from '@/lib/db/supabase';
import { parseIdentity } from '@/lib/identity';
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

    // The declared name and email are contact details the customer typed, and
    // are validated again here rather than trusted from the client. They never
    // become identity: userId always comes from the session, and a signed-in
    // viewer's own email wins over anything the body claims, so a request
    // cannot file a case under someone else's account.
    const declared = parsed.data.customer ? parseIdentity(parsed.data.customer) : null;
    if (declared && !declared.ok) {
      return NextResponse.json({ error: declared.error }, { status: 400 });
    }

    const result = await runTriage(
      parsed.data.message,
      parsed.data.conversationId,
      {
        userId: viewer.id,
        email: viewer.email ?? declared?.identity.email ?? null,
        name: declared?.identity.name ?? null,
      },
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
    if (error instanceof SchemaOutOfDateError) {
      // The operator needs the column name and the remedy. The customer needs
      // neither, and must not be shown either: "PostgREST said: could not find
      // the 'attachment_note' column of 'tickets' in the schema cache" is an
      // internal detail rendered inside a support chat. The detail goes to the
      // log; the customer gets a sentence and a way forward.
      console.error(`[enquiry] ${error.message}`);
      return NextResponse.json(
        {
          error:
            'Something went wrong on our side, so I could not log that. Please try again in a moment, or ask for a person and a colleague will pick it up.',
          code: 'DB_SCHEMA',
        },
        { status: 503 },
      );
    }
    if (error instanceof ClaudeConfigError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    if (error instanceof ClaudeApiError) {
      // Log the full detail once, server-side, where the operator can see it.
      console.error(
        `[enquiry] Anthropic API ${error.status ?? 'error'} on model ${error.model}` +
          `${error.requestId ? ` (request ${error.requestId})` : ''}: ${error.message}`,
      );
      // Same rule: the log names the key, the model and the request id; the
      // customer is told only whether waiting will help.
      return NextResponse.json(
        {
          error: error.retryable
            ? 'I could not reach the assistant just now. Please try again in a moment.'
            : 'I could not answer that just now. Please try again, or ask for a person and a colleague will pick it up.',
          retryable: error.retryable,
          code: `ANTHROPIC_${error.status ?? 'ERROR'}`,
        },
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
    console.error(`[enquiry] unexpected failure: ${detail}`, error);
    return NextResponse.json(
      {
        error:
          'Something went wrong on our side. Please try again, or ask for a person and a colleague will pick it up.',
        code: 'UNEXPECTED',
      },
      { status: 500 },
    );
  }
}
