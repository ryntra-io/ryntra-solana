import { NextResponse, type NextRequest } from "next/server";

import { MAX_CONDITIONS, decodeConditions, encodeConditions } from "@/lib/markets/screen";

/**
 * Append one condition to a screen and send the person back to it.
 *
 * The Screener's form is plain HTML with no JavaScript, so adding a condition
 * has to happen somewhere. It happens here: the existing conditions arrive as
 * `c` params, the new one as three fields, and the result is a redirect to the
 * screen's own URL — which is the only place a screen has ever lived.
 *
 * **Nothing is trusted and nothing is coerced.** The candidate condition is
 * assembled as a string and handed straight to `decodeConditions`, the same
 * defensive reader the page uses for a hand-edited link. If it does not
 * survive that, it is dropped and the person lands back on the screen they
 * had — never on a screen that quietly answers a different question.
 */
export const dynamic = "force-dynamic";

export function GET(request: NextRequest): NextResponse {
  const params = request.nextUrl.searchParams;

  const existing = decodeConditions(params.getAll("c"));
  const field = params.get("field") ?? "";
  const op = params.get("op") ?? "";
  const value = (params.get("value") ?? "").trim();

  /* Round-tripped through the same reader a URL goes through, so this route
     can add nothing the address bar could not. */
  const candidate = decodeConditions([`${field}.${op}.${value}`]);
  const next = [...existing, ...candidate].slice(0, MAX_CONDITIONS);

  const encoded = encodeConditions(next);
  const target = encoded.length
    ? `/robinhood/workspace/screener?${encoded.map((c) => `c=${encodeURIComponent(c)}`).join("&")}`
    : "/robinhood/workspace/screener";

  return NextResponse.redirect(new URL(target, request.nextUrl.origin), { status: 303 });
}
