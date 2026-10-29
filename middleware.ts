import { NextResponse, type NextRequest } from "next/server";

import { refParamRedirect } from "./lib/growth/ref-param.ts";
import { LANGUAGE_COOKIE, ukAddressRoute, withLanguageCookie } from "./lib/site/localized.ts";

/**
 * The Ukrainian addresses of the site.
 *
 * `/uk/docs/invest/buy` is the page `/docs/invest/buy` in Ukrainian: the
 * request goes on to that page with the language cookie set to `uk` — every
 * server component reads the language from that one cookie, so the page, its
 * `<html lang>`, its canonical and its `hreflang` all say Ukrainian — and the
 * answer writes the same cookie, so the pages beyond it keep the language.
 * `/uk` itself is the landing's own route and is only told its language here.
 *
 * On app.ryntra.io the app's pages read `/solana/…`, so their Ukrainian
 * addresses are `/uk/solana/…`: the same page, served from its `/app/…` route
 * (`lib/product/app-address.ts`). Only on that host — ryntra.io has no
 * `/uk/solana` address.
 *
 * Nothing else is touched: an address under `/uk` whose page has no Ukrainian
 * twin (the app's own pages, the legal texts) passes on and is not found, and
 * the Ukrainian landing's share card answers at its own route.
 */
export function middleware(request: NextRequest) {
  /* `?ref=CODE` on any page leads to the friend's page `/r/<code>` (Ріст 3), `?utm_source=…` through `/r/t` to the
     same page without the tag (Ріст 7) — both in `lib/growth/ref-param.ts`. */
  const invited = refParamRedirect(new URL(request.url));
  if (invited) return NextResponse.redirect(invited, 302);
  const { pathname } = request.nextUrl;
  const landing = pathname === "/uk";
  const path = landing ? null : ukAddressRoute(pathname, request.headers.get("host"));
  if (!landing && !path) return NextResponse.next();

  const headers = new Headers(request.headers);
  headers.set("cookie", withLanguageCookie(request.headers.get("cookie"), "uk"));
  let response: NextResponse;
  if (landing || !path) {
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
  matcher: [
    "/uk",
    "/uk/:path*",
    /* Only the Solana product and its site, and only an address that carries `ref` — every other request (another
       product's payment link among them, whose `ref` is an invoice number) never reaches this function. */
    { source: "/", has: [{ type: "query", key: "ref" }] },
    { source: "/app/:path*", has: [{ type: "query", key: "ref" }] },
    { source: "/solana/:path*", has: [{ type: "query", key: "ref" }] },
    /* The same pages with a UTM source (Ріст 7): the growth panel counts the visit and keeps the source. */
    { source: "/", has: [{ type: "query", key: "utm_source" }] },
    { source: "/app/:path*", has: [{ type: "query", key: "utm_source" }] },
    { source: "/solana/:path*", has: [{ type: "query", key: "utm_source" }] },
  ],
};
