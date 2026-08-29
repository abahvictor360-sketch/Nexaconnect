/**
 * Does this customer write in Nigerian Pidgin?
 *
 * Not a language classifier. A scored marker test, deliberately conservative:
 * a false positive makes the assistant answer a formal English complaint in
 * Pidgin, which reads as mockery, while a false negative just means a Pidgin
 * speaker gets a clear English answer. The costs are not symmetric, so the bar
 * is set where the errors are cheap.
 *
 * The model does the actual understanding. This only tells it which language
 * the customer chose, so the choice is consistent turn to turn rather than
 * re-guessed from each message in isolation.
 */

/**
 * Words and phrases that appear in Pidgin and essentially nowhere in English
 * support text. Multi-word entries are matched literally after whitespace is
 * collapsed, so "i wan" catches "I wan talk" without catching "I want".
 */
const STRONG = [
  'abeg',
  'wetin',
  'dey',
  'sabi',
  'wahala',
  'oyibo',
  'comot',
  'waka',
  'kuku',
  'shebi',
  'shey',
  'abi',
  'biko',
  'nawa',
  'wey',
  'una',
  'dem',
  'sef',
  'jare',
  'oga',
  'ehn',
  'chai',
  'tey',
  // Subject pronoun "e" plus a verb: unmistakable, and impossible in English.
  'e don',
  'e dey',
  'e go',
  'e be',
  'e reach',
  'i wan',
  'i no',
];

/**
 * "How far" is a Pidgin greeting and an English question about distance. The
 * greeting stands alone or leads a clause; the English use is followed by a
 * preposition or a verb, and a delivery chat is exactly where someone might
 * ask "how far is it from Lagos?".
 */
function isPidginHowFar(text: string): boolean {
  return / how far /.test(text) && !/ how far (is|to|from|away|does|will|can)\b/.test(text);
}

/** Also Pidgin, but common or ambiguous enough to need corroboration. */
/*
 * "i fit" is Pidgin for "I can", and English for fitting a thing into another
 * thing: "I fit my order into one box" was a false positive when it counted as
 * strong. Demoted rather than patched, because the costs are asymmetric and a
 * Pidgin message carrying only "i fit" and nothing else is rare.
 */
const WEAK = [
  'na',
  'wan',
  'don',
  'no be',
  'make i',
  'small small',
  'gan',
  'o',
  'never',
  'i fit',
  'you fit',
  'we fit',
];

export interface PidginSignal {
  isPidgin: boolean;
  /** The markers found, so a decision can be explained rather than asserted. */
  markers: string[];
}

export function detectPidgin(message: string): PidginSignal {
  const text = ` ${message.toLowerCase().replace(/[^\p{L}\s]/gu, ' ').replace(/\s+/g, ' ')} `;

  const strong = STRONG.filter((word) => text.includes(` ${word} `));
  if (isPidginHowFar(text)) strong.push('how far');
  const weak = WEAK.filter((phrase) => text.includes(` ${phrase} `));

  // One unmistakable word is enough ("abeg", "wetin"). Otherwise two markers,
  // so a single ambiguous "na" or "don" cannot flip an English message.
  const isPidgin = strong.length >= 1 || strong.length + weak.length >= 2;
  return { isPidgin, markers: [...strong, ...weak] };
}
