import { firstNameOf } from './identity';
import { findOrder } from './orders';
import { loadKnowledgeBase, tokenize } from './retrieval';
import type { Category, Classification, RetrievedChunk, Sentiment, Urgency } from './types';

/**
 * A deterministic responder used only when no ANTHROPIC_API_KEY is configured,
 * so the demo is usable out of the box.
 *
 * It cannot invent anything: the reply is assembled from knowledge base lines
 * quoted verbatim, and order facts are copied straight off the record. It is
 * strictly less capable than the model — no paraphrasing, no synthesis, blunt
 * category and sentiment heuristics — and it says so, both in the interface
 * and in the ticket's grounding note. It is a fallback, never the product.
 */

const CATEGORY_HINTS: [Category, RegExp][] = [
  ['Payment', /\b(charge|charged|debit|debited|payment|pay|card|transfer|ussd|wallet|invoice|vat|promo|voucher|code|installment)\b/i],
  ['Refund', /\b(refund|return|returning|money back|reimburse|reversal|restock)\b/i],
  ['Delivery', /\b(deliver|delivery|dispatch|shipping|ship|track|tracking|parcel|package|courier|rider|late|delayed|arrive|arrived)\b/i],
  ['Account', /\b(account|password|sign ?in|login|log ?in|email|data|ndpr|ndpa|delete my|privacy|marketing)\b/i],
  ['Complaint', /\b(useless|rubbish|terrible|awful|disgraceful|unacceptable|complain|complaint|lawyer|sue|court|fire|smoke|burn|shock|injur)\b/i],
  ['Product Enquiry', /\b(warranty|guarantee|spec|specification|stock|available|colour|color|size|model|do you sell|trade.?in)\b/i],
];

const ANGRY = /\b(useless|rubbish|thieves|thief|scam|fraudsters|nonsense|disgrace|stupid|idiot|fed up|had enough|never again|worst)\b/i;
const FRUSTRATED = /\b(still|again|third time|second time|no one|nobody|waiting|delayed|late|disappoint|frustrat|vex|wahala)\b/i;
const HIGH_STAKES = /\b(fire|smoke|burn|shock|injur|charged twice|double charge|unauthoris|unauthoriz|fraud|lawyer|sue|court|ndpc|fccpc)\b/i;

function pickCategory(message: string): Category {
  for (const [category, pattern] of CATEGORY_HINTS) {
    if (pattern.test(message)) return category;
  }
  return 'Other';
}

function pickSentiment(message: string): Sentiment {
  if (ANGRY.test(message)) return 'Angry';
  if (FRUSTRATED.test(message)) return 'Frustrated';
  return 'Neutral';
}

function pickUrgency(message: string, sentiment: Sentiment): Urgency {
  if (HIGH_STAKES.test(message)) return 'High';
  if (sentiment === 'Angry') return 'High';
  if (/\bNX[-\s]?\d{6}\b/i.test(message)) return 'Medium';
  return 'Low';
}

interface ScoredLine {
  line: string;
  chunkId: string;
  score: number;
}

interface LineIndex {
  lines: { line: string; chunkId: string; tokens: Set<string> }[];
  idf: Map<string, number>;
}

let lineIndex: LineIndex | null = null;

/**
 * Every bullet in the knowledge base, indexed with inverse document frequency
 * across bullets. Rare words ("perfume", "warranty", "promotional") therefore
 * count for far more than common ones ("order", "delivery", "the").
 */
function getLineIndex(): LineIndex {
  if (lineIndex) return lineIndex;

  const lines: LineIndex['lines'] = [];
  for (const chunk of loadKnowledgeBase()) {
    for (const raw of chunk.text.split('\n')) {
      const trimmed = raw.trim();
      if (!trimmed.startsWith('- ')) continue;
      const line = trimmed.slice(2).trim();
      lines.push({ line, chunkId: chunk.id, tokens: new Set(tokenize(line)) });
    }
  }

  const df = new Map<string, number>();
  for (const entry of lines) {
    for (const token of entry.tokens) df.set(token, (df.get(token) ?? 0) + 1);
  }

  const idf = new Map<string, number>();
  for (const [token, count] of df) {
    idf.set(token, Math.log(1 + lines.length / count));
  }

  lineIndex = { lines, idf };
  return lineIndex;
}

/** Unseen query words are the most informative of all, so they score highest. */
function weightOf(index: LineIndex, token: string): number {
  return index.idf.get(token) ?? Math.log(1 + index.lines.length);
}

/**
 * How much of the question this line actually covers, weighted by how
 * informative each matched word is. 0 means nothing in common, 1 means the line
 * accounts for every meaningful word in the question.
 */
function coverage(index: LineIndex, queryTokens: string[], lineTokens: Set<string>): number {
  let matched = 0;
  let total = 0;
  for (const token of new Set(queryTokens)) {
    const weight = weightOf(index, token);
    total += weight;
    if (lineTokens.has(token)) matched += weight;
  }
  return total === 0 ? 0 : matched / total;
}

/**
 * Below this, the line does not answer the question and saying so is better
 * than quoting it — a question about goats must not be answered with the line
 * about not selling customer data.
 */
const MIN_COVERAGE = 0.3;

/** At or above this the answer reads as found; below it a human is needed. */
const CONFIDENT_COVERAGE = 0.4;

/**
 * The best-matching lines across every retrieved chunk, not just the top one.
 * BM25 ranks whole sections, and the section that mentions a place most often
 * is not always the one that answers the question about it.
 */
function bestLines(chunks: RetrievedChunk[], message: string, limit: number): ScoredLine[] {
  const index = getLineIndex();
  const queryTokens = tokenize(message);

  // Line matching alone picks up coincidences: "charged twice" matches the
  // delivery line "a delivery is attempted twice", because "twice" is rarer
  // than "charge". BM25 already knows the question is about payments, so a
  // line is weighted by how well its own section scored.
  const top = Math.max(...chunks.map((chunk) => chunk.score), 0);
  const sectionWeight = new Map(
    chunks
      .filter((chunk) => chunk.score > 0)
      .map((chunk) => [chunk.id, 0.4 + 0.6 * (top > 0 ? chunk.score / top : 0)] as const),
  );

  const scored: ScoredLine[] = index.lines
    .filter((entry) => sectionWeight.has(entry.chunkId))
    .map((entry) => {
      const own = coverage(index, queryTokens, entry.tokens);
      return {
        line: entry.line,
        chunkId: entry.chunkId,
        score: own * sectionWeight.get(entry.chunkId)!,
        rawCoverage: own,
      };
    })
    .filter((entry) => entry.rawCoverage >= MIN_COVERAGE)
    .map(({ rawCoverage: _rawCoverage, ...entry }) => entry);

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

function slug(message: string): string {
  return (
    tokenize(message).slice(0, 3).join('_') || 'general_enquiry'
  );
}

export interface OfflineAnswer {
  classification: Classification;
  /** Appended to the ticket's grounding note so the mode is never hidden. */
  note: string;
}

/**
 * Lowercase the opening word so a name can be prefixed to it, unless the word
 * must keep its capital.
 *
 * "I could not find..." became "Victor, i could not find...", which is the kind
 * of small wrongness that makes a reply feel machine-made. The guard skips the
 * pronoun "I" and anything with an interior capital, which covers proper nouns
 * like NexaConnect and acronyms like NDPR.
 */
function lowerFirst(text: string): string {
  const firstWord = text.split(/\s/)[0] ?? '';
  const mustKeepCapital = /^I$|^I['’]/.test(firstWord) || /[A-Z]/.test(firstWord.slice(1));
  return mustKeepCapital ? text : text.charAt(0).toLowerCase() + text.slice(1);
}

export function answerOffline(
  message: string,
  chunks: RetrievedChunk[],
  hasAttachment = false,
  customerName?: string | null,
): OfflineAnswer {
  const top = chunks[0];
  const hasSignal = Boolean(top && top.score > 0);
  const orderRef = message.match(/\bNX[-\s]?(\d{6})\b/i);
  const amount = message.match(/₦\s?[\d,]+(?:\.\d+)?|\bN\d[\d,]*\b|\b\d[\d,]*\s?naira\b/i);

  const category = pickCategory(message);
  const sentiment = pickSentiment(message);
  const urgency = pickUrgency(message, sentiment);

  const quoted = hasSignal ? bestLines(chunks, message, 2) : [];
  const bestScore = quoted[0]?.score ?? 0;
  const citedIds = [...new Set(quoted.map((entry) => entry.chunkId))];

  const titles = new Map(chunks.map((chunk) => [chunk.id, chunk.title]));

  let reply: string;
  if (quoted.length > 0) {
    // Each line is attributed to the section it came from. A keyword match can
    // surface a line that only partly fits, and naming the section makes that
    // visible to the customer instead of passing it off as the answer.
    const lines = quoted
      .map((entry) => `• ${entry.line}\n   - ${titles.get(entry.chunkId) ?? entry.chunkId}`)
      .join('\n');
    reply = `These are the lines from our published policies that look relevant:\n\n${lines}`;
  } else if (hasSignal) {
    reply =
      'I could not find a line in our published policies that answers that, so I would rather not guess. A colleague will pick this up.';
  } else {
    reply =
      'That is not covered by our published policies, so I will not guess at an answer. A colleague will pick this up.';
  }

  if (orderRef) {
    const order = findOrder(`NX-${orderRef[1]}`);
    reply += order
      ? `\n\nOn order ${order.orderRef}: ${order.statusDetail}`
      : `\n\nI could not find an order with the reference NX-${orderRef[1]}. Please check it in the app under My Orders - I will not guess at a status for a reference I cannot see.`;
  }

  if (hasAttachment) {
    reply +=
      '\n\nI can see that you attached an image, but I cannot look at it without our AI model configured, so I am passing this to a person who can.';
  }

  // Address them by the name they gave. Deterministic, so offline mode cannot
  // produce a name the customer never supplied.
  const firstName = customerName ? firstNameOf(customerName) : '';
  if (firstName) reply = `${firstName}, ${lowerFirst(reply)}`;

  return {
    classification: {
      reply,
      category,
      intent: slug(message),
      sentiment,
      urgency,
      // Derived from how well the quoted line actually matches the question,
      // not from how many lines were found. Capped well below the model's
      // range: this is keyword matching, not comprehension. A weak match stays
      // under 60 so LOW_CONFIDENCE fires and a human picks the case up.
      // Kept low on purpose. Quoting a policy line is not the same as
      // answering a question, so offline mode escalates far more readily than
      // the model does — which is the right failure direction.
      // An unreadable attachment is an ungrounded answer by definition, so it
      // must reach a human whatever the text matched.
      confidence: hasAttachment ? 25 : quoted.length === 0 ? 25 : bestScore >= CONFIDENT_COVERAGE ? 65 : 50,
      kbSources: citedIds,
      entities: {
        ...(orderRef ? { orderRef: `NX-${orderRef[1]}` } : {}),
        ...(amount ? { amount: amount[0].trim() } : {}),
        ...(customerName ? { customerName } : {}),
      },
      needsOrderLookup: Boolean(orderRef),
      summary: `Offline demo answer for a ${category.toLowerCase()} enquiry${
        orderRef ? ` about NX-${orderRef[1]}` : ''
      }${hasAttachment ? ', with an image the assistant could not read' : ''}.`,
      attachmentSummary: null,
    },
    note: 'Answered in offline demo mode: no ANTHROPIC_API_KEY is configured, so knowledge base lines were quoted verbatim instead of an AI-written reply.',
  };
}
