import './load-env';
import { seedDemoData } from '../lib/seed';

const { total, escalated } = seedDemoData();
console.log(`Seeded ${total} cases: ${escalated} escalated, ${total - escalated} auto-answered.`);
