import { NextRequest, NextResponse } from "next/server";

import { secureCookies } from "@/lib/auth/cookie-policy";
import { normalizeReferralCode, REFERRAL_COOKIE } from "@/lib/rewards/referral";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `/r/<code>` — a referral link that asks nothing of whoever opens it.
 *
 * ## What opening a link does, and what it deliberately does not
 *
 * It remembers the code in this browser and sends the person to the product.
 * That is all. No account is created, no wallet prompt appears, no address is
 * read, and nothing is written to any store — the owner's instruction is
 * explicit that a referral link must not put a registration wall or a signature
 * request in front of somebody who has just clicked a link from a friend.
 *
 * The attribution is written when the person proves a wallet through the
 * sign-in this product already has, and never before. Until then it is a
 * thirty-day cookie and nothing else, which also means an unclaimed code costs
 * nobody anything and expires on its own.
 *
 * ## Why an unknown code still redirects
 *
 * A mistyped or expired link lands a person in the product rather than on an
 * error page. Telling a stranger "that code does not exist" is both unhelpful
 * and an oracle for probing which codes do; the cookie is simply not set, and
 * the person carries on as somebody who arrived without one.
 */
const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;

export async function GET(req: NextRequest, context: { params: Promise<{ code: string }> }) {
  const { code } = await context.params;
  const normalized = normalizeReferralCode(code ?? "");
  const destination = new URL("/app/rewards", req.url);
  const response = NextResponse.redirect(destination, 302);
  if (normalized) {
    response.cookies.set({
      name: REFERRAL_COOKIE,
      value: normalized,
      httpOnly: true,
      sameSite: "lax",
      secure: secureCookies(),
      path: "/",
      maxAge: THIRTY_DAYS_SECONDS,
    });
  }
  /* Never cached: the whole point of this route is a `Set-Cookie` that belongs
     to one person, and a shared cache would hand it to the next reader. */
  response.headers.set("cache-control", "no-store, no-cache, must-revalidate, private");
  return response;
}
