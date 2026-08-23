import './load-env';
import { activeDriver } from '../lib/db';
import { seedDemoData } from '../lib/seed';

async function main() {
  const { total, escalated } = await seedDemoData();
  console.log(
    `Seeded ${total} cases into the ${activeDriver()} store: ` +
      `${escalated} escalated, ${total - escalated} auto-answered.`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
