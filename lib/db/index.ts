import { sqliteStore } from './sqlite';
import { supabaseConfigured, supabaseStore } from './supabase';
import type { NewTicket, TicketStore } from './types';

export type { NewTicket, TicketStore };
export { closeDb, useMemoryDb } from './sqlite';

/**
 * Driver selection, by environment and nothing else:
 *   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY set  -> the hosted Postgres
 *   otherwise                                     -> the local SQLite file
 *
 * That ordering matters. Local development and the offline demo need no
 * configuration at all, while a deployment that cannot keep a file on disk
 * (Vercel, any serverless host) picks up the hosted database purely from its
 * environment variables. Nothing in the calling code changes either way.
 */
function selectStore(): TicketStore {
  return supabaseConfigured() ? supabaseStore : sqliteStore;
}

/** Which driver a given request will use — surfaced in the UI and the logs. */
export function activeDriver(): TicketStore['driver'] {
  return selectStore().driver;
}

/**
 * Test seam: force a driver for the duration of a test. Passing null restores
 * environment-based selection.
 */
let override: TicketStore | null = null;
export function setStore(store: TicketStore | null): void {
  override = store;
}

function store(): TicketStore {
  return override ?? selectStore();
}

export const insertTicket: TicketStore['insertTicket'] = (input) => store().insertTicket(input);
export const getTicket: TicketStore['getTicket'] = (id) => store().getTicket(id);
export const listTickets: TicketStore['listTickets'] = (query) => store().listTickets(query);
export const updateTicket: TicketStore['updateTicket'] = (id, patch) =>
  store().updateTicket(id, patch);
export const contactCountForOrder: TicketStore['contactCountForOrder'] = (orderRef) =>
  store().contactCountForOrder(orderRef);
export const conversationHistory: TicketStore['conversationHistory'] = (conversationId, limit) =>
  store().conversationHistory(conversationId, limit);
export const clearTickets: TicketStore['clearTickets'] = () => store().clearTickets();
