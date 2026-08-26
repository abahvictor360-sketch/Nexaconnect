import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { z } from 'zod';

/* ------------------------------------------------------------------ */
/* Configuration                                                      */
/* ------------------------------------------------------------------ */

/**
 * Model is pinned by the brief and overridable for a demo machine. The key is
 * read from the server environment only — it is never sent to the client, and
 * every call in this file runs inside a route handler or a CLI script.
 */
export const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';

const EFFORT = process.env.ANTHROPIC_EFFORT ?? 'low';

export type Effort = 'low' | 'medium' | 'high' | 'max';

export class ClaudeConfigError extends Error {}

/**
 * The API rejected or could not serve the request. Carries the detail needed to
 * act on it, because "unexpected server error" tells nobody anything: an
 * invalid model id, an expired key and a rate limit all need different fixes.
 */
export class ClaudeApiError extends Error {
  constructor(
    message: string,
    readonly status: number | undefined,
    readonly model: string,
    readonly requestId: string | null | undefined,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'ClaudeApiError';
  }

  /** Safe to show a user: names the cause, leaks no key material. */
  get userMessage(): string {
    switch (this.status) {
      case 401:
        return 'The Anthropic API key was rejected. Check ANTHROPIC_API_KEY and restart.';
      case 403:
        return 'The Anthropic API key does not have permission for this model.';
      case 404:
        return `The model "${this.model}" was not found for this key. Set ANTHROPIC_MODEL to one your account can use.`;
      case 400:
        return `The request was rejected: ${this.message}`;
      case 429:
        return 'Rate limited by the Anthropic API. Please try again shortly.';
      default:
        return this.status && this.status >= 500
          ? 'The Anthropic API is temporarily unavailable. Please try again shortly.'
          : `The assistant could not reach the model: ${this.message}`;
    }
  }
}
export class ClaudeSchemaError extends Error {
  constructor(
    message: string,
    readonly attempts: number,
    readonly lastRaw: string,
  ) {
    super(message);
  }
}

let client: Anthropic | null = null;

/** Whether a real model call is possible. A stub client counts as configured. */
export function hasApiKey(): boolean {
  return client !== null || Boolean(process.env.ANTHROPIC_API_KEY);
}

export function getClient(): Anthropic {
  if (client) return client;
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new ClaudeConfigError(
      'ANTHROPIC_API_KEY is not set. Copy .env.example to .env.local and add your key.',
    );
  }
  client = new Anthropic({
    // The SDK already retries 408/409/429/5xx and connection errors.
    maxRetries: 3,
    timeout: 60_000,
  });
  return client;
}

/** Test seam: inject a stub client so validation and repair can be exercised offline. */
export function setClient(stub: Anthropic | null): void {
  client = stub;
}

/* ------------------------------------------------------------------ */
/* JSON repair                                                        */
/* ------------------------------------------------------------------ */

/**
 * Last-resort local repair for a response that is nearly JSON: fenced code
 * blocks, a leading apology, or trailing prose around the object. Returns null
 * when nothing object-shaped can be recovered.
 */
export function repairJson(raw: string): unknown | null {
  if (!raw) return null;

  const candidates: string[] = [];
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) candidates.push(fenced[1]);

  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first !== -1 && last > first) candidates.push(raw.slice(first, last + 1));
  candidates.push(raw);

  for (const candidate of candidates) {
    const cleaned = candidate
      .trim()
      .replace(/,\s*([}\]])/g, '$1') // trailing commas
      .replace(/^﻿/, '');
    try {
      const parsed = JSON.parse(cleaned);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Structured call                                                    */
/* ------------------------------------------------------------------ */

export interface StructuredCallOptions<S extends z.ZodType> {
  schema: S;
  system: string;
  /** Plain text, or content blocks when an image is attached. */
  user: string | Anthropic.ContentBlockParam[];
  maxTokens?: number;
  effort?: Effort | 'off';
  /** Attempts including the first. Extra attempts feed the schema error back. */
  maxAttempts?: number;
}

export interface StructuredCallResult<T> {
  value: T;
  latencyMs: number;
  attempts: number;
  inputTokens: number;
  outputTokens: number;
}

/**
 * One API call, with the errors translated and one self-healing retry.
 *
 * `output_config.effort` is dropped and retried once if the API rejects it. It
 * is the only parameter here that varies by model and account, and losing a
 * cost hint is far better than failing the customer's message over it.
 */
async function requestOnce<S extends z.ZodType>(args: {
  schema: S;
  system: string;
  messages: Anthropic.MessageParam[];
  maxTokens: number;
  effort: Effort | 'off';
}) {
  const { schema, system, messages, maxTokens, effort } = args;

  const send = (withEffort: boolean) =>
    getClient().messages.parse({
      model: MODEL,
      max_tokens: maxTokens,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages,
      output_config: {
        format: zodOutputFormat(schema),
        ...(withEffort && effort !== 'off' ? { effort } : {}),
      },
    });

  try {
    return await send(effort !== 'off');
  } catch (error) {
    if (
      effort !== 'off' &&
      error instanceof Anthropic.APIError &&
      error.status === 400 &&
      /effort/i.test(error.message)
    ) {
      console.warn(
        `[claude] the API rejected output_config.effort ("${effort}"); retrying without it. ` +
          'Set ANTHROPIC_EFFORT=off to skip this on every request.',
      );
      return await send(false);
    }
    throw translate(error);
  }
}

function translate(error: unknown): unknown {
  if (!(error instanceof Anthropic.APIError)) return error;
  const status = error.status;
  return new ClaudeApiError(
    error.message,
    status,
    MODEL,
    error.requestID,
    status === 429 || (typeof status === 'number' && status >= 500),
  );
}

function textOf(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
}

/**
 * One Claude call constrained to a Zod schema, with a repair loop.
 *
 * Order of defence:
 *   1. Structured outputs — the API constrains generation to the schema.
 *   2. Local JSON repair — recover an object from fences or surrounding prose.
 *   3. A further attempt that shows Claude its own invalid output and the
 *      validation error.
 *
 * An unparseable response after every attempt throws rather than returning a
 * half-trusted object: the caller escalates to a human instead of guessing.
 */
export async function callStructured<S extends z.ZodType>(
  options: StructuredCallOptions<S>,
): Promise<StructuredCallResult<z.infer<S>>> {
  const { schema, system, user, maxTokens = 2048, maxAttempts = 3 } = options;
  const effort = options.effort ?? (EFFORT as Effort | 'off');

  const started = Date.now();
  let inputTokens = 0;
  let outputTokens = 0;
  let lastRaw = '';
  let lastError = 'unknown validation failure';

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: user }];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await requestOnce({
      schema,
      system,
      messages,
      maxTokens,
      effort,
    });

    inputTokens += response.usage.input_tokens ?? 0;
    outputTokens += response.usage.output_tokens ?? 0;
    lastRaw = textOf(response.content as Anthropic.ContentBlock[]);

    // 1. The happy path: the API already validated against the schema.
    if (response.parsed_output != null) {
      const direct = schema.safeParse(response.parsed_output);
      if (direct.success) {
        return {
          value: direct.data,
          latencyMs: Date.now() - started,
          attempts: attempt,
          inputTokens,
          outputTokens,
        };
      }
      lastError = direct.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    }

    // 2. Local repair.
    const repaired = repairJson(lastRaw);
    if (repaired !== null) {
      const result = schema.safeParse(repaired);
      if (result.success) {
        return {
          value: result.data,
          latencyMs: Date.now() - started,
          attempts: attempt,
          inputTokens,
          outputTokens,
        };
      }
      lastError = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    }

    // 3. Show Claude the failure and ask again.
    if (attempt < maxAttempts) {
      messages.push(
        { role: 'assistant', content: lastRaw || '(empty response)' },
        {
          role: 'user',
          content:
            `That response did not satisfy the required schema. Validation errors: ${lastError}. ` +
            'Return only a single JSON object matching the schema exactly, with no commentary.',
        },
      );
    }
  }

  throw new ClaudeSchemaError(
    `Claude output failed schema validation after ${maxAttempts} attempts (${lastError})`,
    maxAttempts,
    lastRaw,
  );
}
