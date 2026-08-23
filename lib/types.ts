import { z } from 'zod';

/* ------------------------------------------------------------------ */
/* Enumerations shared by the LLM contract, the database and the UI    */
/* ------------------------------------------------------------------ */

export const CATEGORIES = [
  'Delivery',
  'Payment',
  'Refund',
  'Complaint',
  'Product Enquiry',
  'Account',
  'Other',
] as const;

export const SENTIMENTS = ['Positive', 'Neutral', 'Frustrated', 'Angry'] as const;

export const URGENCIES = ['Low', 'Medium', 'High', 'Critical'] as const;

export const DESKS = [
  'Payments & Fraud Desk',
  'Escalations Manager',
  'Delivery Operations',
  'Refunds & Billing',
  'Customer Care',
  'AI Assistant',
] as const;

export const CategorySchema = z.enum(CATEGORIES);
export const SentimentSchema = z.enum(SENTIMENTS);
export const UrgencySchema = z.enum(URGENCIES);
export const DeskSchema = z.enum(DESKS);

export type Category = z.infer<typeof CategorySchema>;
export type Sentiment = z.infer<typeof SentimentSchema>;
export type Urgency = z.infer<typeof UrgencySchema>;
export type Desk = z.infer<typeof DeskSchema>;

/* ------------------------------------------------------------------ */
/* Knowledge base retrieval                                           */
/* ------------------------------------------------------------------ */

export const KbChunkSchema = z.object({
  id: z.string(), // "KB-01" … "KB-09"
  title: z.string(),
  text: z.string(),
});
export type KbChunk = z.infer<typeof KbChunkSchema>;

export const RetrievedChunkSchema = KbChunkSchema.extend({
  score: z.number(),
});
export type RetrievedChunk = z.infer<typeof RetrievedChunkSchema>;

/* ------------------------------------------------------------------ */
/* Mock order records                                                  */
/* ------------------------------------------------------------------ */

export const OrderItemSchema = z.object({
  name: z.string(),
  qty: z.number(),
  unitPrice: z.number(),
});

export const OrderSchema = z.object({
  orderRef: z.string(),
  customerName: z.string(),
  email: z.string(),
  phone: z.string(),
  city: z.string(),
  state: z.string(),
  status: z.string(),
  statusDetail: z.string(),
  items: z.array(OrderItemSchema),
  merchandiseValue: z.number(),
  deliveryFee: z.number(),
  totalValue: z.number(),
  paymentMethod: z.string(),
  paymentStatus: z.string(),
  placedAt: z.string(),
  dispatchedAt: z.string().nullable(),
  promisedBy: z.string().nullable(),
  deliveredAt: z.string().nullable(),
  trackingId: z.string().nullable(),
  refund: z
    .object({
      amount: z.number(),
      method: z.string(),
      approvedAt: z.string(),
      status: z.string(),
    })
    .nullable(),
});
export type Order = z.infer<typeof OrderSchema>;

/* ------------------------------------------------------------------ */
/* LLM contract — the classification call                              */
/* ------------------------------------------------------------------ */

export const EntitiesSchema = z.object({
  orderRef: z.string().optional(),
  amount: z.string().optional(),
  email: z.string().optional(),
});
export type Entities = z.infer<typeof EntitiesSchema>;

/**
 * Exact shape the classification call must return. Anything else is a
 * validation failure and is repaired or retried — never trusted.
 */
export const ClassificationSchema = z.object({
  reply: z.string().min(1),
  category: CategorySchema,
  intent: z.string().min(1),
  sentiment: SentimentSchema,
  urgency: UrgencySchema,
  confidence: z.number().min(0).max(100),
  kbSources: z.array(z.string()),
  entities: EntitiesSchema,
  needsOrderLookup: z.boolean(),
  summary: z.string().min(1),
});
export type Classification = z.infer<typeof ClassificationSchema>;

/** Second Claude call: rewrite the reply with real order data. */
export const ReplyRewriteSchema = z.object({
  reply: z.string().min(1),
  summary: z.string().min(1),
});
export type ReplyRewrite = z.infer<typeof ReplyRewriteSchema>;

/* ------------------------------------------------------------------ */
/* Escalation rule engine                                             */
/* ------------------------------------------------------------------ */

export const RULE_IDS = [
  'FRAUD',
  'LEGAL',
  'SAFETY',
  'HIGH_VALUE',
  'HUMAN_REQUESTED',
  'LOW_CONFIDENCE',
  'REPEAT_CONTACT',
  'HOSTILE',
] as const;

export const RuleIdSchema = z.enum(RULE_IDS);
export type RuleId = z.infer<typeof RuleIdSchema>;

export const FiredRuleSchema = z.object({
  id: RuleIdSchema,
  description: z.string(),
  evidence: z.string(),
  desk: DeskSchema,
});
export type FiredRule = z.infer<typeof FiredRuleSchema>;

export const EscalationDecisionSchema = z.object({
  escalated: z.boolean(),
  firedRules: z.array(FiredRuleSchema),
  route: DeskSchema,
  urgency: UrgencySchema,
  slaHours: z.number(),
});
export type EscalationDecision = z.infer<typeof EscalationDecisionSchema>;

/* ------------------------------------------------------------------ */
/* Tickets                                                            */
/* ------------------------------------------------------------------ */

export const TicketSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  message: z.string(),
  reply: z.string(),
  category: CategorySchema,
  intent: z.string(),
  sentiment: SentimentSchema,
  urgency: UrgencySchema,
  confidence: z.number(),
  summary: z.string(),
  kbSources: z.array(z.string()),
  retrievedChunks: z.array(z.string()),
  entities: EntitiesSchema,
  orderRef: z.string().nullable(),
  orderFound: z.boolean().nullable(),
  orderStatus: z.string().nullable(),
  orderValue: z.number().nullable(),
  contactCount: z.number(),
  escalated: z.boolean(),
  firedRules: z.array(FiredRuleSchema),
  route: DeskSchema,
  slaHours: z.number(),
  groundingNote: z.string().nullable(),
  resolved: z.boolean(),
  resolutionNote: z.string().nullable(),
  assignedTo: z.string().nullable(),
  latencyMs: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Ticket = z.infer<typeof TicketSchema>;

/* ------------------------------------------------------------------ */
/* API contracts                                                      */
/* ------------------------------------------------------------------ */

export const EnquiryRequestSchema = z.object({
  message: z.string().trim().min(1, 'A message is required').max(4000),
  conversationId: z.string().trim().min(1).max(120).optional(),
});
export type EnquiryRequest = z.infer<typeof EnquiryRequestSchema>;

export const TicketPatchSchema = z
  .object({
    resolved: z.boolean().optional(),
    resolutionNote: z.string().max(2000).optional(),
    assignedTo: z.string().max(120).optional(),
    route: DeskSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });
export type TicketPatch = z.infer<typeof TicketPatchSchema>;

export const TicketQuerySchema = z.object({
  urgency: UrgencySchema.optional(),
  category: CategorySchema.optional(),
  route: DeskSchema.optional(),
  escalatedOnly: z.boolean().optional(),
  unresolvedOnly: z.boolean().optional(),
  limit: z.number().int().min(1).max(500).optional(),
});
export type TicketQuery = z.infer<typeof TicketQuerySchema>;

/* ------------------------------------------------------------------ */
/* Labelled evaluation set                                            */
/* ------------------------------------------------------------------ */

export const TestCaseSchema = z.object({
  id: z.string(),
  message: z.string(),
  note: z.string(),
  expectedCategory: CategorySchema,
  shouldEscalate: z.boolean(),
  expectedRules: z.array(RuleIdSchema),
});
export type TestCase = z.infer<typeof TestCaseSchema>;
