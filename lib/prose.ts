/**
 * Reply text tidying that must hold whatever the model does.
 *
 * A prompt rule alone is a request; models drift, and an em dash is the single
 * most recognisable tell that a support reply was machine-written. So the rule
 * is in the prompt AND enforced here, on the way out.
 */

/**
 * Replace em and en dashes with a spaced hyphen.
 *
 * A hyphen rather than a comma because it is the only substitution that is
 * always grammatical: "delivery is free — no minimum" becomes a clean aside,
 * whereas a comma there would make a splice. Ranges keep their own punctuation:
 * "5-10 business days" is already a hyphen and is untouched.
 */
export function withoutDashes(text: string): string {
  return text
    .replace(/\s*[—–]\s*/g, ' - ')
    .replace(/ {2,}/g, ' ')
    .replace(/ +([,.;:!?])/g, '$1')
    .trim();
}
