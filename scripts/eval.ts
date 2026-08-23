import './load-env';
import fs from 'node:fs';
import path from 'node:path';
import { MODEL } from '../lib/claude';
import { clearTickets, insertTicket, useMemoryDb } from '../lib/db';
import { renderReport, renderTable, scoreOutcomes, type CaseOutcome } from '../lib/eval';
import { runTriage } from '../lib/triage';
import { TestCaseSchema, type TestCase } from '../lib/types';

/**
 * Runs the labelled set through the real pipeline and reports predicted
 * against expected. Escalation recall is the headline: a missed escalation is
 * a customer left without a human, which is far worse than a false one.
 *
 * The run uses a throwaway in-memory database so it neither pollutes the demo
 * data nor inherits contact counts from it — REPEAT_CONTACT is set up
 * explicitly per case instead.
 */
function loadCases(): TestCase[] {
  const file = path.join(process.cwd(), 'data', 'test-cases.json');
  return TestCaseSchema.array().parse(JSON.parse(fs.readFileSync(file, 'utf8')));
}

/** Pre-seed prior contacts on an order so REPEAT_CONTACT can be tested. */
async function seedPriorContacts(testCase: TestCase): Promise<void> {
  const count = testCase.priorContacts ?? 0;
  if (count === 0) return;

  const orderRef = testCase.message.match(/\bNX[-\s]?(\d{6})\b/i);
  if (!orderRef) {
    throw new Error(`${testCase.id} sets priorContacts but its message has no order reference`);
  }

  for (let index = 0; index < count; index++) {
    await insertTicket({
      conversationId: `eval-${testCase.id}`,
      message: `(earlier contact ${index + 1} about NX-${orderRef[1]})`,
      reply: '(seeded for the repeat-contact rule)',
      category: 'Delivery',
      intent: 'prior_contact',
      sentiment: 'Neutral',
      urgency: 'Medium',
      confidence: 80,
      summary: 'Seeded prior contact.',
      kbSources: ['KB-01'],
      retrievedChunks: ['KB-01'],
      entities: { orderRef: `NX-${orderRef[1]}` },
      orderRef: `NX-${orderRef[1]}`,
      orderFound: true,
      orderStatus: null,
      orderValue: null,
      contactCount: index + 1,
      escalated: false,
      firedRules: [],
      route: 'AI Assistant',
      slaHours: 0,
      groundingNote: null,
      resolved: false,
      resolutionNote: null,
      assignedTo: null,
      latencyMs: 0,
    });
  }
}

async function main() {
  const cases = loadCases();

  // Fail before the first case rather than reporting the same missing-key
  // error twenty times and printing an empty table.
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(
      '\nANTHROPIC_API_KEY is not set, and the evaluation runs the real pipeline.\n' +
        'Copy .env.example to .env.local, add your key, then run npm run eval again.\n',
    );
    process.exit(1);
  }

  useMemoryDb();

  console.log(`\nNexaConnect triage evaluation — ${cases.length} labelled cases, model ${MODEL}\n`);

  const outcomes: CaseOutcome[] = [];

  // Sequential on purpose: contact counts must be deterministic, and the
  // printed table should come out in the order of the labelled set.
  for (const testCase of cases) {
    process.stdout.write(`  ${testCase.id} … `);
    await clearTickets();

    try {
      await seedPriorContacts(testCase);
      const { ticket } = await runTriage(testCase.message, `eval-${testCase.id}`);
      outcomes.push({ testCase, ticket });

      const escalationOk = ticket.escalated === testCase.shouldEscalate;
      const categoryOk = ticket.category === testCase.expectedCategory;
      console.log(
        `${escalationOk ? 'ok' : 'ESCALATION MISMATCH'}${categoryOk ? '' : ' (category mismatch)'} ` +
          `${ticket.latencyMs}ms`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      outcomes.push({ testCase, ticket: null, error: message });
      console.log(`FAILED — ${message}`);
    }
  }

  const report = scoreOutcomes(outcomes);
  console.log(`\n${renderTable(outcomes)}`);
  console.log(renderReport(report));

  process.exit(report.passed ? 0 : 1);
}

main().catch((error) => {
  console.error(`\n${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
});
