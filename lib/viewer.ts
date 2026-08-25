/**
 * Client-safe half of the auth model. Kept separate from lib/auth.ts, which
 * imports next/headers and must never reach the browser bundle.
 */
export type Role = 'customer' | 'agent';

export interface Viewer {
  /** False when sign-in is not configured at all. */
  authEnabled: boolean;
  signedIn: boolean;
  id: string | null;
  email: string | null;
  /** Agents reach the console and every case; customers only their own. */
  role: Role;
  displayName: string;
}

export function initialsOf(viewer: Viewer): string {
  const source = viewer.email ?? viewer.displayName;
  const parts = source
    .replace(/@.*/, '')
    .split(/[.\-_\s]+/)
    .filter(Boolean);
  return (parts[0]?.[0] ?? 'G').concat(parts[1]?.[0] ?? '').toUpperCase();
}
