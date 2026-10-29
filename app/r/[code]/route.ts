import { after, NextRequest, NextResponse } from "next/server";

import { secureCookies } from "@/lib/auth/cookie-policy";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { isLinkPreview, openCountAllowed, recordLinkOpen } from "@/lib/growth/link-opens";
import { keepTouch } from "@/lib/growth/touch-http";
import { clientIp } from "@/lib/http-control";
import { referralDestination } from "@/lib/growth/referral-destination";
import { walletForCode } from "@/lib/rewards/ledger";
import { carriedCodeHolds, normalizeReferralCode, REFERRAL_COOKIE, REFERRAL_COOKIE_AT } from "@/lib/rewards/referral";
import { getWalletProofFrom } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `/r/<code>` — a referral link that asks nothing of whoever opens it.
 *
 * ## What opening a link does, and what it deliberately does not
 *
 * It remembers the code in this browser and sends the person to the product.
 * That is all. No account is created, no wallet prompt appears, no wallet
 * address is read, and nothing about the person is written anywhere — a referral link
 * must not put a registration wall or a signature request in front of
 * somebody who has just clicked a link from a friend.
 *
 * One thing is counted: that the link was opened — a number per code per day,
 * for its owner's funnel (`lib/growth/link-opens`), with no address, IP or
 * browser id stored beside it. Only a person's first open in a browser counts
 * (a reload is not a second), never a link preview, never the code's own owner,
 * a few a minute from one network address at most (that address is held in
 * this instance's memory for a minute, never stored), a capped number a day,
 * and never a code nobody owns. It is
 * written after the redirect is sent: a store that does not answer loses the
 * count, never the visit.
 *
 * The attribution is written when the person proves a wallet through the
 * sign-in this product already has, and never before. Until then it is a
 * thirty-day cookie and nothing else, which also means an unclaimed code costs
 * nobody anything and expires on its own.
 *
 * ## First touch
 *
 * A code carried for less than a day is not replaced by a later link. The
 * invitation binds on its own the moment the browser proves a wallet, so a
 * link that overwrote a fresh one would let anybody who gets a person to open
 * one — a redirect, a shortened URL — take the binding. After a day the newer
 * link wins: a stale code from a month ago must not beat the friend who just
 * sent theirs. A different code is always chosen deliberately with «Change
 * code» on «Винагороди», or, after binding, the one change.
 *
 * ## Why an unknown code still redirects
 *
 * A mistyped or expired link lands a person in the product rather than on an
 * error page. Telling a stranger "that code does not exist" is both unhelpful
 * and an oracle for probing which codes do; the cookie is simply not set, and
 * the person carries on as somebody who arrived without one.
 */
const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;
async function countOpen(code: string, headers: Headers, proven: boolean): Promise<void> {
  const store = getGuardRuntime().store;
  const owner = await walletForCode(store, code);
  if (!owner) return;
  /* The owner of the code opening their own link is not a visitor. */
  if (proven && (await getWalletProofFrom(headers).catch(() => null))?.address === owner) return;
  await recordLinkOpen(store, code, new Date().toISOString());
}

export async function GET(req: NextRequest, context: { params: Promise<{ code: string }> }) {
  const { code } = await context.params;
  const normalized = normalizeReferralCode(code ?? "");
  /* «Винагороди», or the product page the link names (`?to=`, this site's `/app` only). */
  const destination = referralDestination(new URL(req.url).searchParams.get("to"), req.url);
  const response = NextResponse.redirect(destination, 302);
  const carried = normalizeReferralCode(req.cookies.get(REFERRAL_COOKIE)?.value ?? "");
  const holds = carried !== null && carriedCodeHolds(req.cookies.get(REFERRAL_COOKIE_AT)?.value, Date.now());
  /* One look at the address's minute for both counts below: the link's open and the growth panel's visit. */
  const counted = normalized !== null && !isLinkPreview(req.headers.get("user-agent")) && openCountAllowed(clientIp(req.headers));
  if (normalized) {
    /* The growth panel's first touch and visit (Ріст 7): «a friend», never who — the owner opening it is no visitor. */
    const headers = new Headers(req.headers);
    const proven = req.cookies.has("rw") || headers.has("authorization");
    keepTouch(req, response, { channel: "friend", source: "friend" }, {
      ipChecked: counted,
      /* A code nobody owns is no friend's visit; the owner opening their own link is no visitor. */
      countUnless: async () => {
        const owner = await walletForCode(getGuardRuntime().store, normalized);
        if (owner === null) return true;
        return proven && (await getWalletProofFrom(headers).catch(() => null))?.address === owner;
      },
    });
  }
  if (normalized && !holds) {
    if (counted) {
      const headers = new Headers(req.headers);
      const proven = req.cookies.has("rw") || headers.has("authorization");
      after(() => countOpen(normalized, headers, proven).catch(() => undefined));
    }
    response.cookies.set({
      name: REFERRAL_COOKIE,
      value: normalized,
      httpOnly: true,
      sameSite: "lax",
      secure: secureCookies(),
      path: "/",
      maxAge: THIRTY_DAYS_SECONDS,
    });
    response.cookies.set({
      name: REFERRAL_COOKIE_AT,
      value: String(Date.now()),
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
