import type {
  Category,
  Classification,
  Desk,
  EscalationDecision,
  FiredRule,
  RuleId,
  Urgency,
} from './types';

/* ------------------------------------------------------------------ */
/* Desks                                                              */
/* ------------------------------------------------------------------ */

/** KB-09 first-human-response targets, in hours. */
export const DESK_SLA_HOURS: Record<Desk, number> = {
  'Escalations Manager': 1,
  'Payments & Fraud Desk': 2,
  'Delivery Operations': 4,
  'Refunds & Billing': 4,
  'Customer Care': 6,
  'AI Assistant': 0,
};

/** The "matching desk" for rules that route by subject rather than severity. */
export function deskForCategory(category: Category): Desk {
  switch (category) {
    case 'Delivery':
      return 'Delivery Operations';
    case 'Payment':
      return 'Payments & Fraud Desk';
    case 'Refund':
      return 'Refunds & Billing';
    case 'Complaint':
    case 'Product Enquiry':
    case 'Account':
    case 'Other':
      return 'Customer Care';
  }
}

/* ------------------------------------------------------------------ */
/* Inputs                                                             */
/* ------------------------------------------------------------------ */

export interface EscalationInput {
  message: string;
  classification: Classification;
  /** This contact included: 1 is a first contact, 3 trips REPEAT_CONTACT. */
  contactCount: number;
  orderRef: string | null;
  /** Total order value in Naira, when an order was actually found. */
  orderValue: number | null;
}

/* ------------------------------------------------------------------ */
/* Matching helpers                                                   */
/* ------------------------------------------------------------------ */

/**
 * Returns the text that matched, so the ticket can record *why* a rule fired
 * rather than just that it did. A boolean is not an explanation.
 */
function firstMatch(haystack: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const found = haystack.match(pattern);
    if (found) return found[0].trim();
  }
  return null;
}

export const HIGH_VALUE_THRESHOLD = 500_000;

/** "₦750,000", "N750000", "750k", "1.2m" -> Naira as a number. */
export function parseNaira(raw: string | undefined): number | null {
  if (!raw) return null;
  const text = raw.toLowerCase().replace(/[₦,\s]/g, '').replace(/^n(?=\d)/, '');
  const match = text.match(/^(\d+(?:\.\d+)?)(k|m)?$/);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  if (match[2] === 'k') return value * 1_000;
  if (match[2] === 'm') return value * 1_000_000;
  return value;
}

const FRAUD_PATTERNS = [
  /\bunauthoris?z?ed\b[^.!?]*\b(transaction|payment|charge|debit|purchase|order)\b/i,
  /\b(transaction|payment|charge|debit|purchase)\b[^.!?]*\bunauthoris?z?ed\b/i,
  /\bi (did ?n[o']t|never) (authoris|authoriz|approve|make|place|order)\w*\b/i,
  /\b(charged|debited|deducted|billed|debit)\b[^.!?]{0,30}\b(twice|two times|2 times|double|twice over)\b/i,
  /\b(double|duplicate)\s+(charge|charged|debit|debited|payment|billing|transaction)\b/i,
  /\bcharge[ds]?\s+me\s+(twice|two times)\b/i,
  /\btwo\s+(debits|charges|payments)\b/i,
  /\bsomeone\s+(else\s+)?(used|has used|is using)\b[^.!?]*\b(my|the)\s+(card|account|wallet)\b/i,
  /\b(card|account|wallet)\b[^.!?]{0,25}\b(hacked|compromised|stolen|cloned|hijacked)\b/i,
  /\b(hacked|compromised|cloned)\b[^.!?]{0,15}\b(my|the)\s+(card|account|wallet)\b/i,
  /\bfraud(ulent)?\b/i,
  /\bscam(med)?\b/i,
  /\bchargeback\b/i,
  /\bmoney\s+(was\s+)?(taken|removed)\b[^.!?]{0,30}\bwithout\b/i,
];

const LEGAL_PATTERNS = [
  /\b(lawyer|attorney|solicitor|barrister|counsel)\b/i,
  /\b(sue|suing|sued)\b/i,
  /\blegal\s+(action|proceedings|steps|redress|advice)\b/i,
  /\btake\s+you\s+to\s+court\b/i,
  /\b(court|litigation|lawsuit|tribunal|small claims)\b/i,
  /\bndpc\b/i,
  /\bfccpc\b/i,
  /\b(data protection commission|consumer protection|federal competition)\b/i,
  /\bregulator[sy]?\b/i,
  /\bombudsman\b/i,
  /\b(petition|report you)\b[^.!?]{0,30}\b(commission|authority|agency|regulator)\b/i,
  /\b(the press|the media|newspaper|journalist|blogger|punch|channels tv)\b/i,
  /\bgo (public|viral)\b/i,
  /\b(expose|exposing) (you|this company|nexaconnect)\b/i,
  /\bdefamation\b/i,
];

const SAFETY_PATTERNS = [
  /\bcaught fire\b/i,
  /\bon fire\b/i,
  // Bare "fire" is kept deliberately broad - a missed safety report is far
  // worse than a false one - but excludes fire-safety goods being shopped for.
  /\bfire\b(?!\s*(extinguisher|alarm|blanket|proof|retardant|safety\s+(kit|equipment)))/i,
  /\bsmok(e|ing|ed)\b/i,
  /\bburn(ing|t|ed)?\b/i,
  /\bmelt(ed|ing)?\b/i,
  /\bspark(s|ed|ing)\b/i,
  /\bexplod(ed|ing)\b|\bexplosion\b/i,
  /\belectric(al)?\s+shock\b/i,
  /\bshocked?\s+(me|my|him|her|them|the)\b/i,
  /\belectrocut(ed|ion)\b/i,
  /\binjur(y|ed|ies)\b/i,
  /\bburnt?\s+(my|his|her|the)\b/i,
  /\b(hospital|emergency room)\b/i,
  /\bwounded\b/i,
];

/** Who a customer means when they ask for a person. */
const PERSON = 'human|person|someone|somebody|agent|representative|rep|manager|supervisor|staff|customer care';

/*
 * Measured against realistic phrasings rather than guessed at. The first draft
 * missed five ways customers actually ask — "put me through to a person",
 * "I would rather talk to your staff", "give me person", "na person I wan talk
 * to", "abeg send me to your customer care". None of them was stranded, because
 * LOW_CONFIDENCE caught them all, but the case then recorded the wrong reason:
 * "the assistant was unsure" instead of "the customer asked for a person". The
 * audit trail is the product's claim, so a right outcome for a wrong recorded
 * reason still counts as a defect.
 *
 * Nigerian English and Pidgin are in scope, not an afterthought: the knowledge
 * base is written for this market and the labelled eval set already contains a
 * Pidgin enquiry.
 */
const HUMAN_PATTERNS = [
  // "speak to a person", "talk with your staff", "chat to customer care"
  new RegExp(`\\b(speak|talk|spoke|chat)\\s+(to|with)\\s+(a|an|the|your|ur|one)?\\s*(${PERSON}|real \\w+)\\b`, 'i'),
  // "put me through to a person", "abeg send me to your customer care"
  new RegExp(`\\b(put|send|pass)\\s+me\\b[^.!?]{0,20}\\b(${PERSON})\\b`, 'i'),
  // "give me person", "get me a manager"
  new RegExp(`\\b(give|get)\\s+me\\b[^.!?]{0,15}\\b(${PERSON})\\b`, 'i'),
  // "na person I wan talk to" — the noun leads, the verb follows.
  new RegExp(`\\b(${PERSON})\\b[^.!?]{0,15}\\b(wan|wanna|want|need)\\s+(to\\s+)?(talk|speak|chat)\\b`, 'i'),
  new RegExp(`\\bi\\s+(want|need)\\s+(a|an|one)?\\s*(${PERSON})\\b`, 'i'),
  /\b(human|real person|live agent|actual person)\b/i,
  /\b(transfer|connect|escalate|forward)\s+me\b/i,
  // "I no want bot", "I don't want a chatbot"
  /\b(no|not|don'?t|do not|dont)\s+want\b[^.!?]{0,15}\b(bot|robot|chatbot|machine|ai)\b/i,
  /\b(stop|done|tired of|fed up with)\b[^.!?]{0,25}\b(bot|robot|chatbot|machine|ai|automated)\b/i,
  /\b(bot|robot|chatbot|machine)\b[^.!?]{0,20}\b(useless|not helping|cannot help|can'?t help)\b/i,
  /\bcall me\b/i,
  /\bphone\s+me\b/i,
];

/**
 * The phrasing that asked for a person, or null.
 *
 * Exported because the pipeline needs the same answer the rule engine will
 * reach, before it decides whether to call the model at all.
 */
export function matchHumanRequest(message: string): string | null {
  return firstMatch(message, HUMAN_PATTERNS);
}

/* ------------------------------------------------------------------ */
/* Rules                                                              */
/* ------------------------------------------------------------------ */

type DeskTarget = Desk | 'MATCHING';

interface Rule {
  id: RuleId;
  description: string;
  target: DeskTarget;
  /** Lower number wins when several rules fire and disagree about the desk. */
  precedence: number;
  /** The urgency this rule forces the ticket up to, if any. */
  urgencyFloor?: Urgency;
  test(input: EscalationInput): string | null;
}

/**
 * Every rule is plain TypeScript. The model classifies; it never decides
 * routing, so a jailbreak in the customer message cannot talk its way past
 * an escalation.
 */
export const RULES: Rule[] = [
  {
    id: 'SAFETY',
    description: 'Product safety incident: fire, smoke, burning, shock or injury',
    target: 'Escalations Manager',
    precedence: 1,
    urgencyFloor: 'Critical',
    test: (input) => firstMatch(input.message, SAFETY_PATTERNS),
  },
  {
    id: 'LEGAL',
    description: 'Threat of legal action, a regulator (NDPC/FCCPC) or the media',
    target: 'Escalations Manager',
    precedence: 2,
    urgencyFloor: 'High',
    test: (input) => firstMatch(input.message, LEGAL_PATTERNS),
  },
  {
    id: 'FRAUD',
    description: 'Alleged unauthorised transaction, double charge or account takeover',
    target: 'Payments & Fraud Desk',
    precedence: 3,
    urgencyFloor: 'High',
    test: (input) => firstMatch(input.message, FRAUD_PATTERNS),
  },
  {
    id: 'HIGH_VALUE',
    description: `Order value above ₦${HIGH_VALUE_THRESHOLD.toLocaleString('en-NG')}`,
    target: 'Escalations Manager',
    precedence: 4,
    urgencyFloor: 'High',
    test: (input) => {
      if (input.orderValue !== null && input.orderValue > HIGH_VALUE_THRESHOLD) {
        return `order value ₦${input.orderValue.toLocaleString('en-NG')} exceeds ₦${HIGH_VALUE_THRESHOLD.toLocaleString('en-NG')}`;
      }
      const stated = parseNaira(input.classification.entities.amount);
      if (stated !== null && stated > HIGH_VALUE_THRESHOLD) {
        return `customer stated ₦${stated.toLocaleString('en-NG')}, above ₦${HIGH_VALUE_THRESHOLD.toLocaleString('en-NG')}`;
      }
      return null;
    },
  },
  {
    id: 'HUMAN_REQUESTED',
    description: 'Customer explicitly asked for a person',
    target: 'MATCHING',
    precedence: 5,
    test: (input) => firstMatch(input.message, HUMAN_PATTERNS),
  },
  {
    id: 'REPEAT_CONTACT',
    description: 'Third or later contact about the same order reference',
    target: 'MATCHING',
    precedence: 6,
    test: (input) =>
      input.orderRef && input.contactCount >= 3
        ? `contact ${input.contactCount} about ${input.orderRef}`
        : null,
  },
  {
    id: 'HOSTILE',
    description: 'Angry customer at high or critical urgency',
    target: 'MATCHING',
    precedence: 7,
    test: (input) =>
      input.classification.sentiment === 'Angry' &&
      (input.classification.urgency === 'High' || input.classification.urgency === 'Critical')
        ? `sentiment Angry at ${input.classification.urgency} urgency`
        : null,
  },
  {
    id: 'LOW_CONFIDENCE',
    description: 'Answer is not grounded: confidence below 60 or no knowledge base source',
    target: 'MATCHING',
    precedence: 8,
    test: (input) => {
      const { confidence, kbSources } = input.classification;
      if (kbSources.length === 0) return 'no knowledge base section supports the answer';
      if (confidence < 60) return `confidence ${confidence} is below 60`;
      return null;
    },
  },
];

export const RULE_DESCRIPTIONS: Record<RuleId, string> = RULES.reduce(
  (acc, rule) => ({ ...acc, [rule.id]: rule.description }),
  {} as Record<RuleId, string>,
);

const URGENCY_RANK: Record<Urgency, number> = { Low: 0, Medium: 1, High: 2, Critical: 3 };

function maxUrgency(a: Urgency, b: Urgency): Urgency {
  return URGENCY_RANK[b] > URGENCY_RANK[a] ? b : a;
}

/* ------------------------------------------------------------------ */
/* Engine                                                             */
/* ------------------------------------------------------------------ */

/**
 * Deterministic: the same input always produces the same decision, and every
 * fired rule carries the evidence that fired it.
 */
export function evaluateEscalation(input: EscalationInput): EscalationDecision {
  const matchingDesk = deskForCategory(input.classification.category);

  const fired: (FiredRule & { precedence: number })[] = [];
  let urgency = input.classification.urgency;

  for (const rule of RULES) {
    const evidence = rule.test(input);
    if (evidence === null) continue;
    fired.push({
      id: rule.id,
      description: rule.description,
      evidence,
      desk: rule.target === 'MATCHING' ? matchingDesk : rule.target,
      precedence: rule.precedence,
    });
    if (rule.urgencyFloor) urgency = maxUrgency(urgency, rule.urgencyFloor);
  }

  if (fired.length === 0) {
    return {
      escalated: false,
      firedRules: [],
      route: 'AI Assistant',
      urgency,
      slaHours: DESK_SLA_HOURS['AI Assistant'],
    };
  }

  fired.sort((a, b) => a.precedence - b.precedence);
  const route = fired[0].desk;

  return {
    escalated: true,
    firedRules: fired.map(({ precedence: _precedence, ...rule }) => rule),
    route,
    urgency,
    slaHours: DESK_SLA_HOURS[route],
  };
}
