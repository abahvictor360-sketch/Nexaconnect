import { NextResponse } from 'next/server';
import { authConfigured, createSupabaseServerClient } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Where magic links and email confirmations land, to trade the code for a session. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const nextParam = url.searchParams.get('next');
  // Only ever redirect within this app.
  const next = nextParam && nextParam.startsWith('/') ? nextParam : '/';

  if (!authConfigured() || !code) {
    return NextResponse.redirect(new URL('/login', url.origin));
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    const login = new URL('/login', url.origin);
    login.searchParams.set('next', next);
    return NextResponse.redirect(login);
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
