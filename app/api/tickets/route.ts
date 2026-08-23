import { NextResponse } from 'next/server';
import { listTickets } from '@/lib/db';
import { TicketQuerySchema } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  const parsed = TicketQuerySchema.safeParse({
    urgency: params.get('urgency') ?? undefined,
    category: params.get('category') ?? undefined,
    route: params.get('route') ?? undefined,
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

  const tickets = listTickets(parsed.data);
  return NextResponse.json({ tickets, count: tickets.length });
}
