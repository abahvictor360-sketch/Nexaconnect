import { NextResponse } from 'next/server';
import { getViewer } from '@/lib/auth';
import { listTickets } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * A customer's own case history. Scoped by the session's user id, so it cannot
 * be widened by a query parameter — the agent-facing /api/tickets is a
 * separate, role-gated endpoint.
 */
export async function GET() {
  const viewer = await getViewer();

  if (!viewer.signedIn || !viewer.id) {
    return NextResponse.json({ tickets: [], count: 0, signedIn: false });
  }

  const tickets = await listTickets({ userId: viewer.id, limit: 20 });
  return NextResponse.json({ tickets, count: tickets.length, signedIn: true });
}
