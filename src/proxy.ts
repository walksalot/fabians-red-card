/**
 * Signed-out gate for league pages, mirroring loadLeagueContext's
 * `/login?next=/league/<slug>/today` redirect — but here the full request URL
 * is still visible, so a calendar deep link's ?day= survives the login round
 * trip. The league layout's redirect (which renders ahead of the page and
 * cannot see search params) would otherwise drop the day.
 *
 * Sessions that are present but invalid/expired still fall through to
 * loadLeagueContext's own redirect, which is the real (signature-verified)
 * authority — this is a URL-preserving fast path, not the auth boundary.
 */
import { NextResponse, type NextRequest } from 'next/server';

// Must match COOKIE_NAME in src/lib/session.ts. Duplicated by design: the
// proxy bundles separately and must not pull in the session module's db/jwt
// dependency graph (see the proxy docs on shared modules).
const SESSION_COOKIE = 'wc_session';

export function proxy(request: NextRequest) {
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();

  const { pathname, searchParams } = request.nextUrl;
  const slug = pathname.split('/')[2];
  if (!slug) return NextResponse.next(); // bare /league — not a league page

  // Untrusted input: only a well-formed ?day= on the today page rides along;
  // the page re-validates it against the schedule after login anyway.
  const day = searchParams.get('day');
  const next =
    pathname === `/league/${slug}/today` &&
    day !== null &&
    /^\d{4}-\d{2}-\d{2}$/.test(day)
      ? `/league/${slug}/today?day=${day}`
      : `/league/${slug}/today`;

  return NextResponse.redirect(
    new URL(`/login?next=${encodeURIComponent(next)}`, request.nextUrl),
  );
}

export const config = { matcher: '/league/:path*' };
