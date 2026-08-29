import fs from 'node:fs';
import path from 'node:path';
import type { KbChunk, RetrievedChunk } from './types';

/* ------------------------------------------------------------------ */
/* Chunking                                                           */
/* ------------------------------------------------------------------ */

const KB_PATH = path.join(process.cwd(), 'data', 'knowledge-base.md');

/**
 * The knowledge base is authored so that every "## KB-0N — Title" section is a
 * self-contained, citable chunk. One section = one chunk = one source id.
 */
export function chunkKnowledgeBase(markdown: string): KbChunk[] {
  const chunks: KbChunk[] = [];
  // Accepts a hyphen or an em dash as the separator: the knowledge base is
  // customer-facing copy and its punctuation has changed once already.
  const pattern = /^##\s+(KB-\d{2})\s+[-—–]\s+(.+)$/gm;
  const headings: { id: string; title: string; start: number; end: number }[] = [];

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(markdown)) !== null) {
    headings.push({
      id: match[1],
      title: match[2].trim(),
      start: match.index + match[0].length,
      end: markdown.length,
    });
    if (headings.length > 1) headings[headings.length - 2].end = match.index;
  }

  for (const h of headings) {
    chunks.push({ id: h.id, title: h.title, text: markdown.slice(h.start, h.end).trim() });
  }
  return chunks;
}

let cachedChunks: KbChunk[] | null = null;

export function loadKnowledgeBase(): KbChunk[] {
  if (cachedChunks) return cachedChunks;
  cachedChunks = chunkKnowledgeBase(fs.readFileSync(KB_PATH, 'utf8'));
  if (cachedChunks.length === 0) {
    throw new Error(`No KB sections parsed from ${KB_PATH}. Expected "## KB-0N - Title" headings.`);
  }
  return cachedChunks;
}

/* ------------------------------------------------------------------ */
/* Tokenisation                                                       */
/* ------------------------------------------------------------------ */

const STOPWORDS = new Set([
  'a','about','after','all','also','am','an','and','any','are','as','at','be','been','being','but','by',
  'can','could','did','do','does','for','from','get','got','had','has','have','he','her','him','his','how',
  'i','if','in','into','is','it','its','just','me','more','my','no','not','now','of','on','one','only','or',
  'other','our','out','over','own','said','same','she','should','so','some','such','than','that','the',
  'their','them','then','there','these','they','this','those','to','too','up','us','very','was','we','were',
  'what','when','where','which','while','who','why','will','with','would','you','your',
]);

/** Nigerian Pidgin and colloquial phrasing mapped onto knowledge-base vocabulary. */
const SYNONYMS: Record<string, string[]> = {
  // Pidgin
  abeg: ['please'],
  wetin: ['what'],
  wahala: ['problem'],
  vex: ['angry'],
  vexing: ['angry'],
  sabi: ['know'],
  comot: ['remove', 'cancel'],
  don: [],
  dey: [],
  una: ['you'],
  oga: [],
  shebi: [],
  fashi: ['cancel'],
  yawa: ['problem'],
  kolo: [],
  // Money and refunds
  kobo: ['naira', 'money', 'refund'],
  naira: ['naira'],
  cash: ['payment', 'refund'],
  money: ['refund', 'payment'],
  reimburse: ['refund'],
  reimbursement: ['refund'],
  chargeback: ['refund', 'unauthorised', 'payment'],
  reverse: ['refund', 'reversal'],
  reversal: ['refund'],
  // Delivery
  parcel: ['delivery', 'order'],
  package: ['delivery', 'order'],
  courier: ['delivery', 'dispatch'],
  rider: ['delivery'],
  shipment: ['delivery', 'dispatch'],
  shipping: ['delivery'],
  track: ['tracking'],
  late: ['delayed', 'delay'],
  slow: ['delayed'],
  // Products and faults
  broken: ['faulty', 'damaged'],
  spoil: ['faulty', 'damaged'],
  spoilt: ['faulty', 'damaged'],
  bad: ['faulty'],
  fault: ['faulty'],
  smoking: ['smoke'],
  burnt: ['burning'],
  shocked: ['shock'],
  // Accounts
  login: ['sign', 'account'],
  signin: ['sign', 'account'],
  password: ['password', 'account'],
  // Payments
  debited: ['debit', 'payment', 'charge'],
  debit: ['payment', 'charge'],
  charged: ['charge', 'payment'],
  pod: ['pay', 'delivery'],
  ussd: ['ussd'],
  transfer: ['transfer'],
  // Escalation
  lawyer: ['legal', 'court'],
  sue: ['legal', 'court'],
  court: ['legal'],
  regulator: ['ndpc', 'fccpc'],
  human: ['human', 'person'],
  agent: ['person', 'human'],
  manager: ['escalations', 'person'],
  voucher: ['voucher', 'promotional'],
  coupon: ['voucher', 'promotional'],
  discount: ['promotional', 'voucher'],
  promo: ['promotional'],
  guarantee: ['warranty'],
  invoice: ['invoice', 'vat'],
};

/** Order references (NX-123456) never appear in the KB, so they add only noise. */
export const ORDER_REF_PATTERN = /\bNX[-\s]?(\d{6})\b/i;

/**
 * An attempt at a reference that is not one: "NX-90113" (five digits),
 * "NX-1234567" (seven). Worth catching rather than ignoring — a customer who
 * mistypes their order number was still telling us about an order, and
 * silently dropping it produces a case with no reference at all and an
 * assistant that never mentions the mismatch.
 */
const MALFORMED_ORDER_REF = /\bNX[-\s]?(\d{1,5}|\d{7,})\b/i;

/** The near-miss the customer typed, or null. Only when no valid ref exists. */
export function extractMalformedOrderRef(message: string): string | null {
  if (ORDER_REF_PATTERN.test(message)) return null;
  const match = message.match(MALFORMED_ORDER_REF);
  return match ? match[0].toUpperCase().replace(/\s+/, '-') : null;
}

/**
 * Deliberately conservative. "charged" stems to "charg" while "charge" stays
 * whole, so the pair does not match — but also dropping a trailing "e" to fix
 * that measured *worse*: it merges charge/charged/charges/charging into one
 * term across the whole knowledge base, and the resulting drop in inverse
 * document frequency cost more than the alignment gained (top-1 retrieval fell
 * from 11/14 to 10/14 on the probe set). The charge/charged case is handled by
 * query-side synonym expansion instead.
 */
function stem(word: string): string {
  if (word.length > 5 && word.endsWith('ing')) return word.slice(0, -3);
  if (word.length > 5 && word.endsWith('ed')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith('es')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s')) return word.slice(0, -1);
  return word;
}

export function tokenize(input: string): string[] {
  const normalised = input
    .toLowerCase()
    .replace(/(\d),(\d)/g, '$1$2') // 500,000 -> 500000
    .replace(/₦/g, ' naira ')
    .replace(/\bnx[-\s]?\d{6}\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ');

  const out: string[] = [];
  for (const raw of normalised.split(' ')) {
    if (!raw || raw.length < 2 || STOPWORDS.has(raw)) continue;
    out.push(stem(raw));
  }
  return out;
}

/** Query-side only: expand colloquial terms onto knowledge-base vocabulary. */
function expandQuery(tokens: string[], raw: string): string[] {
  const expanded = [...tokens];
  const lower = raw.toLowerCase();
  for (const token of tokens) {
    const extra = SYNONYMS[token];
    if (extra) expanded.push(...extra.map(stem));
  }
  // Multi-word colloquialisms the token loop cannot see.
  if (/\bmy money\b|\bgive me back\b|\bsend my money\b/.test(lower)) expanded.push('refund');
  if (/\bwhere is\b|\bwhere my\b|\bhow far\b/.test(lower)) expanded.push('delivery', 'tracking');
  if (/\bspeak to\b|\btalk to\b|\breal person\b|\bcall me\b/.test(lower)) expanded.push('person', 'human');
  if (/\bdouble charge\b|\btwice\b|\btwo times\b/.test(lower)) expanded.push('duplicate', 'charge');
  if (/\bwetin dey\b|\bwhat is happening\b|\bany update\b|\bstill waiting\b/.test(lower)) {
    expanded.push('delivery', 'tracking', 'order');
  }
  // A parcel word plus an elapsed-time word is a delivery-status question,
  // however it is phrased. This is what rescues Pidgin and terse messages.
  const parcelWord = /\border\b|\bparcel\b|\bpackage\b|\bdelivery\b|\bitem\b|\bgoods\b/.test(lower);
  const timeWord = /\b(day|days|week|weeks|month|months)\b|\bsince\b|\bstill\b|\byet\b/.test(lower);
  if (parcelWord && timeWord) expanded.push('delivery', 'delayed', 'tracking', 'dispatch');
  return expanded;
}

/* ------------------------------------------------------------------ */
/* BM25                                                              */
/* ------------------------------------------------------------------ */

const K1 = 1.5;
const B = 0.75;
const TITLE_BOOST = 3; // a hit in the section title counts three times

interface Bm25Index {
  chunks: KbChunk[];
  docs: { id: string; tf: Map<string, number>; length: number }[];
  df: Map<string, number>;
  avgLength: number;
}

export function buildIndex(chunks: KbChunk[]): Bm25Index {
  const docs = chunks.map((chunk) => {
    const tokens = [
      ...tokenize(chunk.text),
      ...Array.from({ length: TITLE_BOOST }, () => tokenize(chunk.title)).flat(),
    ];
    const tf = new Map<string, number>();
    for (const token of tokens) tf.set(token, (tf.get(token) ?? 0) + 1);
    return { id: chunk.id, tf, length: tokens.length };
  });

  const df = new Map<string, number>();
  for (const doc of docs) {
    for (const term of doc.tf.keys()) df.set(term, (df.get(term) ?? 0) + 1);
  }

  const avgLength = docs.reduce((sum, d) => sum + d.length, 0) / (docs.length || 1);
  return { chunks, docs, df, avgLength };
}

let cachedIndex: Bm25Index | null = null;

function getIndex(): Bm25Index {
  if (!cachedIndex) cachedIndex = buildIndex(loadKnowledgeBase());
  return cachedIndex;
}

export interface RetrievalResult {
  chunks: RetrievedChunk[];
  /** False when nothing in the knowledge base matched — a grounding failure. */
  hasSignal: boolean;
  queryTokens: string[];
}

export function retrieve(message: string, topK = 4, index: Bm25Index = getIndex()): RetrievalResult {
  const queryTokens = expandQuery(tokenize(message), message);
  const n = index.docs.length;

  const scored = index.docs.map((doc) => {
    let score = 0;
    for (const term of new Set(queryTokens)) {
      const tf = doc.tf.get(term);
      if (!tf) continue;
      const df = index.df.get(term) ?? 0;
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
      const norm = tf * (K1 + 1);
      const denom = tf + K1 * (1 - B + B * (doc.length / index.avgLength));
      score += idf * (norm / denom);
    }
    return { id: doc.id, score };
  });

  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  const byId = new Map(index.chunks.map((c) => [c.id, c]));
  const top = scored.slice(0, topK).map(({ id, score }) => {
    const chunk = byId.get(id)!;
    return { ...chunk, score: Number(score.toFixed(4)) };
  });

  return {
    chunks: top,
    hasSignal: top.length > 0 && top[0].score > 0,
    queryTokens,
  };
}

/** Renders retrieved chunks for the prompt, ids included so the model can cite. */
export function formatChunksForPrompt(chunks: RetrievedChunk[]): string {
  return chunks
    .map((c) => `<source id="${c.id}" title="${c.title}">\n${c.text}\n</source>`)
    .join('\n\n');
}

export function extractOrderRef(message: string): string | null {
  const match = message.match(ORDER_REF_PATTERN);
  return match ? `NX-${match[1]}` : null;
}
