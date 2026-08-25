import { NextResponse } from 'next/server';
import { getViewer } from '@/lib/auth';
import { listTickets } from '@/lib/db';
import { TicketQuerySchema } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  // Every case in the system, so this is for agents. A signed-in customer uses
  // /api/my-cases, which is scoped to their own id.
  const viewer = await getViewer();
  if (viewer.authEnabled && viewer.role !== 'agent') {
    return NextResponse.json({ error: 'Agent access required' }, { status: 403 });
  }

  const params = new URL(request.url).searchParams;

  const parsed = TicketQuerySchema.safeParse({
    urgency: params.get('urgency') ?? undefined,
    category: params.get('category') ?? undefined,
    route: params.get('route') ?? undefined,
    q: params.get('q') ?? undefined,
    escalatedOnly: params.get('escalatedOnly') === 'true' ? true : undefined,
    unresolvedOnly: params.get('unresolvedOnly') === 'true' ? true : undefined,
    limit: params.get('limit') ? Number(params.get('limit')) : undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') },
      { status: 400 },
    );
  }

  const tickets = await listTickets(parsed.data);
  return NextResponse.json({ tickets, count: tickets.length });
}
