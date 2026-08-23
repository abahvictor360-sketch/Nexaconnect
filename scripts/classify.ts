import './load-env';
import { MODEL } from '../lib/claude';
import { classifyEnquiry } from '../lib/triage';

/**
 * Phase 2 harness: run retrieval plus the classification call against one
 * message. Usage: npx tsx scripts/classify.ts "my parcel is 3 days late"
 */
const message = process.argv.slice(2).join(' ').trim();
if (!message) {
  console.error('Usage: npx tsx scripts/classify.ts "<customer message>"');
  process.exit(1);
}

async function main() {
  const result = await classifyEnquiry(message);
  const c = result.classification;

  console.log(`\nmodel      ${MODEL}`);
  console.log(`retrieved  ${result.chunks.map((k) => `${k.id}(${k.score})`).join(' ')}`);
  console.log(`signal     ${result.hasRetrievalSignal}`);
  console.log(`latency    ${result.latencyMs}ms in ${result.attempts} attempt(s)`);
  if (result.hallucinatedSources.length) {
    console.log(`DROPPED    uncited-source ids: ${result.hallucinatedSources.join(', ')}`);
  }
  console.log(`\ncategory   ${c.category} / ${c.intent}`);
  console.log(`sentiment  ${c.sentiment}   urgency ${c.urgency}   confidence ${c.confidence}`);
  console.log(`cited      ${c.kbSources.join(', ') || '(none — not grounded)'}`);
  console.log(`entities   ${JSON.stringify(c.entities)}`);
  console.log(`lookup     ${c.needsOrderLookup}`);
  console.log(`summary    ${c.summary}`);
  console.log(`\nreply\n${c.reply}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
