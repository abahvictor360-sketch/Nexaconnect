/**
 * Who the customer says they are.
 *
 * Client-safe on purpose — the chat validates before sending and the route
 * validates again on arrival, from this one definition, so the two can never
 * disagree about what counts as a name.
 *
 * This is self-declared contact information, exactly like the name box on a
 * paper support form. It is NOT authentication and must never be treated as
 * any: a signed-in viewer's identity still comes from the session cookie, and
 * nothing here may grant a role, claim a user id, or widen what a caller can
 * see.
 */

export const MAX_NAME = 60;
export const MAX_EMAIL = 254;

export interface CustomerIdentity {
  name: string;
  email: string;
}

/**
 * Collapse whitespace and strip the characters that would let a name act as
 * markup or as a prompt boundary once it reaches the model. The name is
 * interpolated into a prompt, so "</customer_message>" in a name field is a
 * real attack surface, not a hypothetical one.
 */
export function cleanName(raw: string): string {
  return raw
    .replace(/[<>{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME);
}

export function nameError(raw: string): string | null {
  const name = cleanName(raw);
  if (name.length === 0) return 'Please tell me your name.';
  if (name.length < 2) return 'That looks too short. What should I call you?';
  // At least one letter, so "..." or "123" is not accepted. Deliberately
  // permissive beyond that: Unicode letters, marks, apostrophes, hyphens and
  // full stops all appear in real Nigerian and international names, and a
  // stricter rule rejects real people.
  if (!/\p{L}/u.test(name)) return 'That does not look like a name.';
  return null;
}

export function emailError(raw: string): string | null {
  const email = raw.trim();
  if (email.length === 0) return 'Please add your email so we can reply.';
  if (email.length > MAX_EMAIL) return 'That email is too long.';
  // Not RFC 5322 — a validator strict enough to be correct rejects addresses
  // that work. This catches the typos that matter: no @, no dot, no domain.
  if (!/^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$/.test(email)) {
    return 'That does not look like an email address.';
  }
  return null;
}

/** The first name, for addressing someone naturally. */
export function firstNameOf(name: string): string {
  return cleanName(name).split(' ')[0] ?? '';
}

/** Validated identity, or the first problem with it. */
export function parseIdentity(input: {
  name?: string;
  email?: string;
}): { ok: true; identity: CustomerIdentity } | { ok: false; error: string } {
  const name = input.name ?? '';
  const email = input.email ?? '';
  const problem = nameError(name) ?? emailError(email);
  if (problem) return { ok: false, error: problem };
  return { ok: true, identity: { name: cleanName(name), email: email.trim().toLowerCase() } };
}
