import { NextResponse } from 'next/server';
import { getTicket, updateTicket } from '@/lib/db';
import { TicketPatchSchema } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  const ticket = getTicket(id);
  if (!ticket) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
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

  const ticket = updateTicket(id, parsed.data);
  if (!ticket) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
  return NextResponse.json({ ticket });
}
