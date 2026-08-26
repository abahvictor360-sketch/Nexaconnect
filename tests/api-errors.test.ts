import Anthropic from '@anthropic-ai/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClaudeApiError, MODEL, callStructured, setClient } from '../lib/claude';
import { ClassificationWireSchema, type ClassificationWire } from '../lib/types';

const VALID: ClassificationWire = {
  reply: 'Delivery to Port Harcourt is ₦3,500.',
  category: 'Delivery',
  intent: 'check_delivery_fee',
  sentiment: 'Neutral',
  urgency: 'Low',
  confidence: 92,
  kbSources: ['KB-01'],
  entities: { orderRef: null, amount: null, email: null },
  needsOrderLookup: false,
  summary: 's',
  attachmentSummary: null,
};

/** Builds a real SDK error of the given status, as the transport would throw. */
function apiError(status: number, message: string) {
  return Anthropic.APIError.generate(
    status,
    { type: 'error', error: { type: 'invalid_request_error', message } },
    message,
    new Headers(),
  );
}

function throwingClient(errors: unknown[], thenReturn?: unknown) {
  let call = 0;
  const stub = {
    messages: {
      parse: async () => {
        if (call < errors.length) throw errors[call++];
        call++;
        return {
          content: [],
          usage: { input_tokens: 10, output_tokens: 10 },
          parsed_output: thenReturn ?? VALID,
        };
      },
    },
  };
  setClient(stub as unknown as Anthropic);
  return () => call;
}

const call = () =>
  callStructured({ schema: ClassificationWireSchema, system: 's', user: 'u', maxAttempts: 1 });

afterEach(() => {
  setClient(null);
  vi.restoreAllMocks();
});

describe('API failures reach the caller as something actionable', () => {
  it('turns a rejected key into an instruction, not a generic error', async () => {
    throwingClient([apiError(401, 'invalid x-api-key')]);
    const error = await call().catch((caught) => caught);
    expect(error).toBeInstanceOf(ClaudeApiError);
    expect(error.status).toBe(401);
    expect(error.userMessage).toContain('ANTHROPIC_API_KEY');
    expect(error.retryable).toBe(false);
  });

  it('names the model when the model id is wrong, which is the likeliest misconfiguration', async () => {
    throwingClient([apiError(404, 'model: nope')]);
    const error = await call().catch((caught) => caught);
    expect(error.status).toBe(404);
    expect(error.userMessage).toContain(MODEL);
    expect(error.userMessage).toContain('ANTHROPIC_MODEL');
  });

  it('marks rate limits and outages retryable, and client errors not', async () => {
    throwingClient([apiError(429, 'slow down')]);
    expect((await call().catch((e) => e)).retryable).toBe(true);

    throwingClient([apiError(503, 'overloaded')]);
    expect((await call().catch((e) => e)).retryable).toBe(true);

    throwingClient([apiError(400, 'bad shape')]);
    expect((await call().catch((e) => e)).retryable).toBe(false);
  });

  it('never puts key material in the message it shows a user', async () => {
    throwingClient([apiError(401, 'invalid x-api-key: sk-ant-secret-value')]);
    const error = await call().catch((caught) => caught);
    expect(error.userMessage).not.toContain('sk-ant-secret-value');
  });

  it('keeps a connection failure distinguishable from a rejection', async () => {
    throwingClient([new Anthropic.APIConnectionError({ message: 'socket hang up' })]);
    const error = await call().catch((caught) => caught);
    expect(error).toBeInstanceOf(ClaudeApiError);
    expect(error.retryable).toBe(false);
  });
});

describe('the effort parameter heals itself', () => {
  it('retries once without effort when the API rejects it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const calls = throwingClient([apiError(400, 'output_config.effort: unsupported')]);

    const result = await callStructured({
      schema: ClassificationWireSchema,
      system: 's',
      user: 'u',
      effort: 'low',
      maxAttempts: 1,
    });

    expect(result.value.category).toBe('Delivery');
    expect(calls()).toBe(2); // rejected once, then succeeded without effort
    expect(warn).toHaveBeenCalled();
  });

  it('does not retry a 400 that has nothing to do with effort', async () => {
    const calls = throwingClient([apiError(400, 'messages: must not be empty')]);
    await expect(
      callStructured({ schema: ClassificationWireSchema, system: 's', user: 'u', effort: 'low', maxAttempts: 1 }),
    ).rejects.toBeInstanceOf(ClaudeApiError);
    expect(calls()).toBe(1);
  });

  it('does not attempt the retry when effort was already off', async () => {
    const calls = throwingClient([apiError(400, 'output_config.effort: unsupported')]);
    await expect(
      callStructured({ schema: ClassificationWireSchema, system: 's', user: 'u', effort: 'off', maxAttempts: 1 }),
    ).rejects.toBeInstanceOf(ClaudeApiError);
    expect(calls()).toBe(1);
  });
});
