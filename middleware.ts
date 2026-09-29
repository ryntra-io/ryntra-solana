import { NextResponse, type NextRequest } from "next/server";

import { hasUkAddress, LANGUAGE_COOKIE, splitUkPrefix, withLanguageCookie } from "./lib/site/localized.ts";

/**
 * The Ukrainian addresses of the site (the plan of `RYN-SITE-V5-001` §4).
 *
 * `/uk/docs/invest/buy` is the page `/docs/invest/buy` in Ukrainian: the
 * request goes on to that page with the language cookie set to `uk` — every
 * server component reads the language from that one cookie, so the page, its
 * `<html lang>`, its canonical and its `hreflang` all say Ukrainian — and the
 * answer writes the same cookie, so the pages beyond it keep the language.
 * `/uk` itself is the landing's own route and is only told its language here.
 *
 * Nothing else is touched: an address under `/uk` whose page has no Ukrainian
 * twin (the app's own pages, the legal texts) passes on and is not found, and
 * the Ukrainian landing's share card answers at its own route.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const { path } = splitUkPrefix(pathname);
  const landing = pathname === "/uk";
  if (!landing && !hasUkAddress(path)) return NextResponse.next();

  const headers = new Headers(request.headers);
  headers.set("cookie", withLanguageCookie(request.headers.get("cookie"), "uk"));
  let response: NextResponse;
  if (landing) {
    response = NextResponse.next({ request: { headers } });
  } else {
    const url = request.nextUrl.clone();
    url.pathname = path;
    response = NextResponse.rewrite(url, { request: { headers } });
  }
  response.cookies.set(LANGUAGE_COOKIE, "uk", { path: "/", maxAge: 31_536_000, sameSite: "lax" });
  return response;
}

export const config = {
  matcher: ["/uk", "/uk/:path*"],
};
