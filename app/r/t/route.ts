import { NextRequest, NextResponse } from "next/server";

import { keepTouch } from "@/lib/growth/touch-http";
import { touchLanding, utmTagOf, utmKey, withoutUtm } from "@/lib/growth/touch-param";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `/r/t?utm_source=…&to=/…` — a visit tagged with UTM parameters (Ріст 7).
 *
 * A link somebody made with UTM (`ryntra.io/?utm_source=x&utm_medium=social&utm_campaign=…`, MEDIA §12) reaches
 * this route through the address layer (`middleware.ts` → `lib/growth/ref-param.ts`); a link may also point here
 * directly. The source is remembered in this browser, the visit counted, and the person lands on the page they
 * asked for — `to`, a page of the Solana product or its site on this host, without the UTM parameters; anything
 * else lands on the site. Nothing about the person is written.
 */
export async function GET(req: NextRequest) {
  const params = new URL(req.url).searchParams;
  const tag = utmTagOf(params);
  const to = touchLanding(params.get("to")) ?? "/";
  const target = new URL(to, req.url);
  const rest = withoutUtm(target.searchParams);
  target.search = rest.toString();
  const response = NextResponse.redirect(target, 302);
  if (tag) keepTouch(req, response, { channel: "utm", source: utmKey(tag) });
  response.headers.set("cache-control", "no-store, no-cache, must-revalidate, private");
  return response;
}
