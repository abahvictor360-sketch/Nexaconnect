import { describe, expect, it, vi } from 'vitest';
import { MIN_PASSWORD, createAgent, validate } from '../lib/create-agent';

type Admin = Parameters<typeof createAgent>[1];

function fakeClient(overrides: {
  createUser?: unknown;
  listUsers?: unknown;
  updateUserById?: unknown;
}) {
  const calls: Record<string, unknown[]> = { createUser: [], updateUserById: [] };
  const client = {
    auth: {
      admin: {
        createUser: vi.fn(async (args: unknown) => {
          calls.createUser.push(args);
          return overrides.createUser ?? { data: { user: { id: 'user-1' } }, error: null };
        }),
        listUsers: vi.fn(async () => overrides.listUsers ?? { data: { users: [] }, error: null }),
        updateUserById: vi.fn(async (id: string, args: unknown) => {
          calls.updateUserById.push({ id, args });
          return overrides.updateUserById ?? { data: { user: { id } }, error: null };
        }),
      },
    },
  };
  return { client: client as unknown as NonNullable<Admin>['client'], calls };
}

describe('creating an agent account', () => {
  it('puts the role in app_metadata, never user_metadata', async () => {
    const { client, calls } = fakeClient({});
    await createAgent({ email: 'agent@nexaconnect.ng', password: 'a-long-passphrase' }, { client });

    const args = calls.createUser[0] as Record<string, unknown>;
    /*
     * The whole security of the agent gate rests on this. A signed-in user can
     * edit their own user_metadata, so a role stored there could be granted by
     * the very person it is meant to restrict. app_metadata is writable only by
     * the service role, which is why lib/auth.ts reads the role from it.
     */
    expect(args.app_metadata).toEqual({ role: 'agent' });
    expect(args).not.toHaveProperty('user_metadata');
  });

  it('confirms the address, since a demo account has no inbox to check', async () => {
    const { client, calls } = fakeClient({});
    await createAgent({ email: 'agent@nexaconnect.ng', password: 'a-long-passphrase' }, { client });
    // An unconfirmed user cannot sign in with a password at all.
    expect((calls.createUser[0] as Record<string, unknown>).email_confirm).toBe(true);
  });

  it('promotes an account that already exists instead of failing', async () => {
    // The realistic mistake is running it twice and being told the address is
    // taken while still having no way in.
    const { client, calls } = fakeClient({
      createUser: { data: { user: null }, error: { message: 'A user with this email address has already been registered' } },
      listUsers: { data: { users: [{ id: 'user-9', email: 'Agent@NexaConnect.ng' }] }, error: null },
    });

    const result = await createAgent(
      { email: 'agent@nexaconnect.ng', password: 'a-long-passphrase' },
      { client },
    );

    expect(result.promoted).toBe(true);
    expect(result.userId).toBe('user-9');
    const update = calls.updateUserById[0] as { id: string; args: Record<string, unknown> };
    expect(update.id).toBe('user-9');
    expect(update.args.app_metadata).toEqual({ role: 'agent' });
    expect(update.args.password).toBe('a-long-passphrase');
  });

  it('matches an existing address case-insensitively', async () => {
    const { client, calls } = fakeClient({
      createUser: { data: { user: null }, error: { message: 'email_exists' } },
      listUsers: { data: { users: [{ id: 'user-3', email: 'AGENT@NEXACONNECT.NG' }] }, error: null },
    });
    await createAgent({ email: '  Agent@NexaConnect.NG ', password: 'a-long-passphrase' }, { client });
    expect((calls.updateUserById[0] as { id: string }).id).toBe('user-3');
  });

  it('reports a real creation failure rather than hunting for a user that is not there', async () => {
    const { client } = fakeClient({
      createUser: { data: { user: null }, error: { message: 'Database connection failed' } },
    });
    await expect(
      createAgent({ email: 'agent@nexaconnect.ng', password: 'a-long-passphrase' }, { client }),
    ).rejects.toThrow(/Database connection failed/);
  });

  it('rejects a weak password: the console shows every customer case', () => {
    expect(() => validate({ email: 'a@b.co', password: 'short' })).toThrow(
      new RegExp(String(MIN_PASSWORD)),
    );
    expect(() => validate({ email: 'a@b.co', password: 'x'.repeat(MIN_PASSWORD) })).not.toThrow();
  });

  it('rejects an address that is not one', () => {
    for (const email of ['', 'agent', 'agent@localhost', 'a b@c.co']) {
      expect(() => validate({ email, password: 'a-long-passphrase' })).toThrow();
    }
  });

  it('normalises the address, so the login page and the record agree', () => {
    expect(validate({ email: '  Agent@NexaConnect.NG ', password: 'a-long-passphrase' }).email).toBe(
      'agent@nexaconnect.ng',
    );
  });
});
