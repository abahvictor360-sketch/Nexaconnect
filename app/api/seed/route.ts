import { NextResponse } from 'next/server';
import { seedDemoData } from '@/lib/seed';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Loads the labelled demo cases so the console and the dashboard have
 * something to show on a fresh clone. Replaces any existing tickets, which is
 * why it is a POST and why the button that calls it says so.
 */
export async function POST() {
  try {
    const { total, escalated } = seedDemoData();
    return NextResponse.json({ total, escalated });
  } catch (error) {
    console.error('[seed] failed', error);
    return NextResponse.json({ error: 'Could not load the demo data' }, { status: 500 });
  }
}
