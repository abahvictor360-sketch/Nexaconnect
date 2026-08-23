import './load-env';
import { activeDriver, clearTickets, contactCountForOrder, getTicket, insertTicket, listTickets, updateTicket } from '../lib/db';
import type { NewTicket } from '../lib/db';

/**
 * Exercises whichever driver the environment selects, end to end, against a
 * handful of throwaway rows. Run it after pointing the app at a new database:
 *     npm run db:check
 *
 * It writes and then deletes its own rows, so never point it at a database
 * holding tickets you care about.
 */
const fixture = (overrides: Partial<NewTicket> = {}): NewTicket => ({
  conversationId: 'db-check',
  message: 'Where is my washing machine NX-905117?',
  reply: 'It was delivered on 21 August 2026.',
  category: 'Delivery',
  intent: 'track_order',
  sentiment: 'Neutral',
  urgency: 'Medium',
  confidence: 88,
  summary: 'Tracking NX-905117.',
  kbSources: ['KB-01'],
  retrievedChunks: ['KB-01', 'KB-02', 'KB-09', 'KB-04'],
  entities: { orderRef: 'NX-905117', amount: '₦754,000' },
  orderRef: 'NX-905117',
  orderFound: true,
  orderStatus: 'Delivered',
  orderValue: 754_000,
  contactCount: 1,
  escalated: true,
  firedRules: [
    {
      id: 'HIGH_VALUE',
      description: 'Order value above ₦500,000',
      evidence: 'order value ₦754,000 exceeds ₦500,000',
      desk: 'Escalations Manager',
    },
  ],
  route: 'Escalations Manager',
  slaHours: 1,
  groundingNote: null,
  resolved: false,
  resolutionNote: null,
  assignedTo: null,
  latencyMs: 2410,
  ...overrides,
});

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `  expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
}

async function main() {
  console.log(`\nDriver selected from the environment: ${activeDriver()}\n`);
  await clearTickets();

  const created = await insertTicket(fixture());
  check('insert returns a ticket id', /^NXC-/.test(created.id), true);
  check('jsonb array survives the round trip', created.kbSources, ['KB-01']);
  check('jsonb object survives the round trip', created.entities.orderRef, 'NX-905117');
  check('fired rules keep their evidence', created.firedRules[0]?.evidence?.includes('754,000'), true);
  check('numeric column comes back as a number', typeof created.orderValue, 'number');
  check('order value is exact', created.orderValue, 754_000);

  check('getTicket finds it', (await getTicket(created.id))?.id, created.id);
  check('getTicket on a missing id is null', await getTicket('NXC-NOPE'), null);

  await insertTicket(fixture({ urgency: 'Low', escalated: false, route: 'AI Assistant', slaHours: 0, firedRules: [], orderRef: null, entities: {}, category: 'Payment', message: 'How much is delivery to Abuja?' }));
  await insertTicket(fixture({ urgency: 'Critical', category: 'Complaint', message: 'The generator caught fire' }));
  await insertTicket(fixture({ urgency: 'High', resolved: true, message: 'an already closed case' }));

  const triage = await listTickets({ sort: 'triage' });
  check('triage sort puts the worst unresolved case first', triage[0]?.urgency, 'Critical');
  check('triage sort sinks resolved cases to the bottom', triage.at(-1)?.resolved, true);

  check('filter by urgency', (await listTickets({ urgency: 'Critical' })).length, 1);
  check('filter by category', (await listTickets({ category: 'Payment' })).length, 1);
  check('filter escalated only', (await listTickets({ escalatedOnly: true })).length, 3);
  check('filter unresolved only', (await listTickets({ unresolvedOnly: true })).length, 3);
  check('search matches the message', (await listTickets({ q: 'generator' })).length, 1);
  check('search matches the order reference', (await listTickets({ q: 'NX-905117' })).length, 3);
  check('search with query syntax characters does not throw', Array.isArray(await listTickets({ q: 'a,b(c)%*' })), true);
  check('contact count counts prior contacts', await contactCountForOrder('NX-905117'), 4);
  check('contact count with no order reference', await contactCountForOrder(null), 1);

  const patched = await updateTicket(created.id, {
    resolved: true,
    resolutionNote: 'Confirmed delivered',
    assignedTo: 'escalations.bayo',
    satisfaction: 4,
  });
  check('patch sets resolved', patched?.resolved, true);
  check('patch sets the assignee', patched?.assignedTo, 'escalations.bayo');
  check('patch stores the rating', patched?.satisfaction, 4);
  check('patch on a missing id is null', await updateTicket('NXC-NOPE', { resolved: true }), null);

  await clearTickets();
  check('clear removes everything', (await listTickets()).length, 0);

  console.log(
    failures === 0
      ? `\nAll checks passed against the ${activeDriver()} driver.\n`
      : `\n${failures} check(s) FAILED against the ${activeDriver()} driver.\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`\nCould not reach the database: ${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
});
