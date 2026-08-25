import { NextResponse } from 'next/server';
import { getViewer } from '@/lib/auth';
import { getTicket, updateTicket } from '@/lib/db';
import { TicketPatchSchema } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  const viewer = await getViewer();
  const ticket = await getTicket(id);
  if (!ticket) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });

  // A customer may read their own case; anything else needs an agent.
  const own = viewer.signedIn && ticket.userId === viewer.id;
  if (viewer.authEnabled && viewer.role !== 'agent' && !own) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({ ticket });
}

/** Agent actions: resolve, add a resolution note, assign, or reroute. */
export async function PATCH(request: Request, { params }: Context) {
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON' }, { status: 400 });
  }

  const parsed = TicketPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join('; ') },
      { status: 400 },
    );
  }

  const viewer = await getViewer();
  if (viewer.authEnabled && viewer.role !== 'agent') {
    const existing = await getTicket(id);
    const own = viewer.signedIn && existing?.userId === viewer.id;
    // A customer rates their own case and nothing else. Resolving, assigning
    // and rerouting are agent decisions.
    const onlyRating = Object.keys(parsed.data).every(
      (key) => key === 'satisfaction' || key === 'satisfactionReason',
    );
    if (!own || !onlyRating) {
      return NextResponse.json({ error: 'Agent access required' }, { status: 403 });
    }
  }

  const ticket = await updateTicket(id, parsed.data);
  if (!ticket) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
  return NextResponse.json({ ticket });
}
