import { createClient } from '@supabase/supabase-js';

export interface AgentAccount {
  email: string;
  password: string;
}

export interface CreateAgentResult {
  email: string;
  userId: string;
  /** True when the account already existed and was promoted rather than made. */
  promoted: boolean;
}

/** Weak passwords on a console that shows every customer's case are not a demo detail. */
export const MIN_PASSWORD = 12;

export function validate(account: Partial<AgentAccount>): AgentAccount {
  const email = account.email?.trim().toLowerCase() ?? '';
  const password = account.password ?? '';

  if (!/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email)) {
    throw new Error(`"${email || '(empty)'}" is not an email address.`);
  }
  if (password.length < MIN_PASSWORD) {
    throw new Error(`The password must be at least ${MIN_PASSWORD} characters.`);
  }
  return { email, password };
}

/**
 * Create — or promote — an agent account.
 *
 * The role goes in `app_metadata`, never `user_metadata`. Only the service role
 * can write app_metadata, whereas a signed-in user can edit their own
 * user_metadata at will: a permission stored there could be granted by the
 * person it restricts. `lib/auth.ts` reads `app_metadata.role` for the same
 * reason.
 *
 * Idempotent, because the realistic failure is running it twice and being told
 * the address is taken while still having no way in. An existing account is
 * promoted to agent and its password reset, so the outcome is the same either
 * way: these credentials sign in, with agent access.
 */
export async function createAgent(
  account: Partial<AgentAccount>,
  deps?: { client?: ReturnType<typeof createClient> },
): Promise<CreateAgentResult> {
  const { email, password } = validate(account);

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!deps?.client && (!url || !serviceKey)) {
    throw new Error(
      'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set. The service role key is ' +
        'required to write app_metadata, and must never be exposed to the browser.',
    );
  }

  const client =
    deps?.client ??
    createClient(url!, serviceKey!, { auth: { persistSession: false, autoRefreshToken: false } });

  const created = await client.auth.admin.createUser({
    email,
    password,
    // No inbox to check on a demo account, and an unconfirmed user cannot sign
    // in with a password.
    email_confirm: true,
    app_metadata: { role: 'agent' },
  });

  if (!created.error && created.data.user) {
    return { email, userId: created.data.user.id, promoted: false };
  }

  const alreadyExists =
    created.error &&
    /already (been )?registered|already exists|email_exists/i.test(created.error.message);
  if (!alreadyExists) {
    throw new Error(`Could not create the account: ${created.error?.message ?? 'unknown error'}`);
  }

  // Find the existing account and promote it. There is no lookup-by-email in
  // the admin API, so the user list is paged through.
  let userId: string | null = null;
  for (let page = 1; page <= 20 && !userId; page++) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`Could not look up the existing account: ${error.message}`);
    userId = data.users.find((u) => u.email?.toLowerCase() === email)?.id ?? null;
    if (data.users.length < 200) break;
  }
  if (!userId) {
    throw new Error(`${email} is registered but could not be found in the user list.`);
  }

  const updated = await client.auth.admin.updateUserById(userId, {
    password,
    email_confirm: true,
    app_metadata: { role: 'agent' },
  });
  if (updated.error) {
    throw new Error(`Could not promote the existing account: ${updated.error.message}`);
  }

  return { email, userId, promoted: true };
}
