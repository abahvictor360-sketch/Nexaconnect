/**
 * "...in the New Living Translation."
 *
 * A preacher who wants a particular wording says so out loud, usually right
 * after the reference and almost always in words rather than letters: "the
 * Message", "King James", "New International". The version picker then has
 * to be reached for by hand, which is the one thing auto-follow exists to
 * avoid.
 *
 * Kept apart from the reference parser because the two are independent - a
 * version can be named without a reference ("read that again in the
 * Amplified") and a reference without a version, which is the usual case.
 */

/**
 * Spoken forms, per version id. Longest match wins, so "new international
 * readers version" is not read as "new international version".
 *
 * Only versions that actually ship are listed, and the caller filters again
 * against what is installed and enabled - naming a version the operator has
 * switched off should do nothing rather than fail silently somewhere later.
 */
const ALIASES: Record<string, string[]> = {
  kjv: ["king james", "king james version", "authorized version", "authorised version", "kjv"],
  nkjv: ["new king james", "new king james version", "nkjv"],
  niv: ["new international version", "new international", "niv"],
  nirv: ["new international readers version", "new international reader's version", "nirv"],
  esv: ["english standard version", "english standard", "esv"],
  nlt: ["new living translation", "new living", "nlt"],
  nasb: ["new american standard bible", "new american standard", "nasb"],
  nasu: ["new american standard 1995", "nasb 1995", "nasu"],
  csb: ["christian standard bible", "christian standard", "csb"],
  hcsb: ["holman christian standard", "holman", "hcsb"],
  amp: ["amplified", "amplified bible", "amp"],
  ampc: ["amplified classic", "classic amplified", "ampc"],
  msg: ["the message", "message translation", "msg"],
  tpt: ["the passion translation", "passion translation", "passion", "tpt"],
  tlb: ["the living bible", "living bible", "tlb"],
  gnt: ["good news translation", "good news bible", "good news", "gnt"],
  gw: ["gods word translation", "god's word translation", "gods word", "god's word", "gw"],
  net: ["new english translation", "net bible", "net"],
  nrsv: ["new revised standard version", "new revised standard", "nrsv"],
  rsv: ["revised standard version", "revised standard", "rsv"],
  bsb: ["berean standard bible", "berean study bible", "berean", "bsb"],
  erv: ["easy to read version", "easy to read", "erv"],
  easy: ["easy english", "easyenglish", "easy english bible"],
  mev: ["modern english version", "mev"],
  lsb: ["legacy standard bible", "legacy standard", "lsb"],
  darby: ["darby", "darby translation", "darby bible"],
  ylt: ["youngs literal", "young's literal", "youngs literal translation", "ylt"],
  web: ["world english bible", "web bible"],
  asv: ["american standard version", "american standard", "asv"],
  bbe: ["bible in basic english", "basic english", "bbe"],
  tyn: ["tyndale", "tyndale bible", "tyndale 1537"],
  yor: ["yoruba", "yoruba bible"],
  hau: ["hausa", "hausa bible"],
  ibo: ["igbo", "igbo bible"],
  twi: ["twi", "asante twi", "akan"],
  swa: ["swahili", "swahili bible", "suv"],
};

/**
 * Letter-by-letter, which is how a transcriber hears "N I V" when it is
 * spelled out and how Deepgram sometimes writes a well-known abbreviation.
 * Separate from the aliases because these need the dots and spaces stripped
 * before they can be recognised at all.
 */
const SPELLED = /\b([a-z])[\s.]+([a-z])[\s.]+([a-z])(?:[\s.]+([a-z]))?\b/g;

/**
 * Said right before a version name, and the reason a bare "message" is
 * ignored.
 *
 * "The" is deliberately NOT one of them. It leads into a version name often
 * enough - "the Message" - but it leads into ordinary speech far more
 * often, and "the message of the cross" is a sermon, not a request to
 * change translation.
 */
const LEAD_IN = /\b(in|from|using|version|translation|reads?|says?|rendering|according to)\b/;

/**
 * Forms that are ordinary English before they are a version.
 *
 * Length alone does not sort these: "the message" and "good news" are long
 * and completely ambiguous, "darby" is short and could be nothing else. So
 * they are listed, and each one needs a lead-in word before it counts.
 */
const WEAK = new Set([
  "the message", "message", "passion", "the passion", "good news",
  "living bible", "the living bible", "basic english", "easy english",
  "berean", "web bible", "net bible", "amplified",
]);

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The version named in `text`, or null.
 *
 * `available` are the ids actually installed and switched on. Anything else
 * is ignored: hearing "the Message" in a church that has Message turned off
 * should leave the screen where it is, not fail halfway through loading.
 */
export function parseSpokenVersion(text: string, available: string[]): string | null {
  const flat = normalise(text);
  if (!flat) return null;
  const allowed = new Set(available.map((v) => v.toLowerCase()));

  let best: { id: string; at: number; len: number } | null = null;
  for (const [id, forms] of Object.entries(ALIASES)) {
    if (!allowed.has(id)) continue;
    for (const form of forms) {
      /*
       * A bare three-letter id ("msg", "net", "web", "easy") is a word
       * before it is a version, and "the message of the cross" is a sermon,
       * not a request. Short forms therefore need a lead-in word; the full
       * spoken names stand on their own.
       */
      const needsLeadIn = form.length <= 4 || WEAK.has(form);
      const at = flat.indexOf(form);
      if (at < 0) continue;
      // Whole words only: "web" must not match inside "website".
      const before = at === 0 ? " " : flat[at - 1]!;
      const afterAt = at + form.length;
      const after = afterAt >= flat.length ? " " : flat[afterAt]!;
      if (before !== " " || after !== " ") continue;
      if (needsLeadIn && !LEAD_IN.test(flat.slice(Math.max(0, at - 24), at))) continue;
      // Longest form wins, then the latest one said.
      if (!best || form.length > best.len || (form.length === best.len && at > best.at)) {
        best = { id, at, len: form.length };
      }
    }
  }
  if (best) return best.id;

  // "N I V", "e s v", "N.K.J.V."
  SPELLED.lastIndex = 0;
  let m: RegExpExecArray | null;
  let spelled: string | null = null;
  while ((m = SPELLED.exec(flat)) !== null) {
    const id = [m[1], m[2], m[3], m[4]].filter(Boolean).join("");
    if (allowed.has(id)) spelled = id;
  }
  return spelled;
}
