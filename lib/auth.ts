import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Role, Viewer } from './viewer';

/* ------------------------------------------------------------------ */
/* Configuration                                                      */
/* ------------------------------------------------------------------ */

/**
 * Sign-in needs the two public Supabase values, because the browser has to
 * talk to the auth endpoint itself. Without them the app runs open, the way it
 * did before: anyone can chat as a guest and the console is unguarded. That is
 * fine on a laptop and stated plainly in the interface — but a deployment
 * should always set these.
 */
export function authConfigured(): boolean {
  return Boolean(publicUrl() && publicKey());
}

function publicUrl(): string | undefined {
  return process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
}

function publicKey(): string | undefined {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  );
}

export function publicAuthConfig(): { url: string; key: string } {
  const url = publicUrl();
  const key = publicKey();
  if (!url || !key) throw new Error('Supabase auth is not configured');
  return { url, key };
}

/* ------------------------------------------------------------------ */
/* Viewer                                                            */
/* ------------------------------------------------------------------ */

export type { Role, Viewer } from './viewer';
export { initialsOf } from './viewer';

const GUEST: Viewer = {
  authEnabled: false,
  signedIn: false,
  id: null,
  email: null,
  // With no auth configured there is nobody to check, so the console stays
  // open. This is the local-development shape, never the deployed one.
  role: 'agent',
  displayName: 'Guest',
};

/** A server-side Supabase client bound to the request's cookies. */
export async function createSupabaseServerClient() {
  const { url, key } = publicAuthConfig();
  const cookieStore = await cookies();

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, where cookies are read-only. The
          // middleware refreshes the session instead, so this is safe to skip.
        }
      },
    },
  });
}

/**
 * Who is making this request. Reads the user from the auth server rather than
 * trusting the cookie's contents, so a tampered cookie cannot claim a role.
 */
export async function getViewer(): Promise<Viewer> {
  if (!authConfigured()) return GUEST;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    return { ...GUEST, authEnabled: true, role: 'customer' };
  }

  const user = data.user;
  // The role lives in app_metadata, which only the service role can write.
  // user_metadata is user-writable and must never be trusted for this.
  const role: Role = user.app_metadata?.role === 'agent' ? 'agent' : 'customer';

  return {
    authEnabled: true,
    signedIn: true,
    id: user.id,
    email: user.email ?? null,
    role,
    displayName: (user.email ?? 'Signed in').split('@')[0],
  };
}

/** Server-side gate for the agent surfaces. */
export async function requireAgent(returnTo: string): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer.authEnabled) return viewer;
  if (!viewer.signedIn) redirect(`/login?next=${encodeURIComponent(returnTo)}`);
  if (viewer.role !== 'agent') redirect('/no-access');
  return viewer;
}

