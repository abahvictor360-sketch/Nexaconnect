import type { Ticket, TicketPatch, TicketQuery } from '../types';

/**
 * Fields the caller must supply, plus the ones that start empty: a rating
 * arrives later, and identity is absent for a guest.
 */
export type NewTicket = Omit<
  Ticket,
  | 'id'
  | 'createdAt'
  | 'updatedAt'
  | 'satisfaction'
  | 'satisfactionReason'
  | 'userId'
  | 'customerEmail'
  | 'hasAttachment'
  | 'attachmentNote'
> &
  Partial<
    Pick<
      Ticket,
      | 'satisfaction'
      | 'satisfactionReason'
      | 'userId'
      | 'customerEmail'
      | 'hasAttachment'
      | 'attachmentNote'
    >
  >;

/**
 * The whole persistence surface, so a driver can be swapped without touching a
 * caller. Every method is async: SQLite is synchronous underneath, but the
 * hosted database is not, and a shared shape is worth one await.
 */
export interface TicketStore {
  readonly driver: 'sqlite' | 'supabase';
  insertTicket(input: NewTicket): Promise<Ticket>;
  getTicket(id: string): Promise<Ticket | null>;
  listTickets(query?: TicketQuery): Promise<Ticket[]>;
  updateTicket(id: string, patch: TicketPatch): Promise<Ticket | null>;
  /** Contacts on this order including the one about to be logged. */
  contactCountForOrder(orderRef: string | null | undefined): Promise<number>;
  conversationHistory(conversationId: string, limit?: number): Promise<Ticket[]>;
  clearTickets(): Promise<void>;
}

/** Ranking used by the triage sort, shared so both drivers agree. */
export const URGENCY_RANK: Record<string, number> = {
  Critical: 0,
  High: 1,
  Medium: 2,
  Low: 3,
};
