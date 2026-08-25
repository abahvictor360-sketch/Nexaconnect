import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Two jobs, both of which have to happen before a page renders:
 *
 *  1. Refresh the Supabase session and write the rotated cookies onto the
 *     response. Server Components cannot set cookies, so without this a
 *     session would silently expire mid-visit.
 *  2. Keep signed-out visitors out of the agent surfaces, so protection does
 *     not depend on every page remembering to check.
 */
const AGENT_PATHS = ['/agent', '/analytics'];

function authConfigured(): boolean {
  return Boolean(
    (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL) &&
      (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
  );
}

export async function middleware(request: NextRequest) {
  // With sign-in unconfigured the app runs open, as it did before auth existed.
  if (!authConfigured()) return NextResponse.next();

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL)!,
    (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const needsAgent = AGENT_PATHS.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));

  if (needsAgent && !user) {
    const login = new URL('/login', request.url);
    login.searchParams.set('next', path);
    return NextResponse.redirect(login);
  }

  if (needsAgent && user?.app_metadata?.role !== 'agent') {
    return NextResponse.redirect(new URL('/no-access', request.url));
  }

  return response;
}

export const config = {
  // Everything except static assets and the auth endpoints themselves.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|auth/).*)'],
};
