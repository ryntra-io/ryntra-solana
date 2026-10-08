import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { consumeSolanaReadRequest, readAgentControlJson } from "@/lib/agent-control/http";
import { secureCookies } from "@/lib/auth/cookie-policy";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { privateNoStoreHeaders } from "@/lib/http-control";
import { bindReferrer, changeReferrer, readReferralChangeWindow, readRewardAccount, walletForCode } from "@/lib/rewards/ledger";
import { readReferralState } from "@/lib/rewards/referral-state.server";
import {
  maskCode,
  maskWallet,
  normalizeReferralCode,
  REFERRAL_COOKIE,
  REFERRAL_COOKIE_AT,
} from "@/lib/rewards/referral";
import { mutationOriginAllowed } from "@/lib/security";
import { getWalletProof } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `/api/rewards/referral` — who invited you, before it is decided.
 *
 * ## How binding happens
 *
 * The first version wrote the attribution silently while `/api/rewards` loaded;
 * the second waited for a «Confirm» button that most people never saw — the
 * case of 08.10: friends who opened a link and traded were never bound. Now
 * a link leaves a pending code in the browser (first touch: a later link does
 * not replace it), and the browser's proven wallet binds it on its own, on its
 * first read here, while the window is open — before the first trade and seven
 * days after it (`readReferralState`).
 *
 * ## What each verb does
 *
 * `GET` reports the carried code (or previews `?code=`) with the inviter
 * **masked**, needs no wallet, and for the proven wallet's own read makes the
 * one write described above and says what can still change (`binding`,
 * `change`).
 *
 * `POST` carries one of four actions. `pending` replaces the code being
 * considered (Change code) and binds nothing by itself; `dismiss` throws the
 * invitation away; `confirm` binds explicitly (for a wallet whose own read did
 * not); `change` makes the one change of inviter inside the window. The last
 * two need a proven wallet.
 *
 * ## Enumeration, and why a preview is safe without a session
 *
 * A code is 128 random bits over a 30-character alphabet. Guessing one is not a
 * thing that happens, and a code that *is* known was given to the holder on
 * purpose. What comes back is four characters from each end of an address that
 * is public on any explorer anyway. The read limiter applies regardless.
 */
function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: privateNoStoreHeaders() });
}

const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;

const ActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("pending"), code: z.string().min(1).max(40) }),
  z.object({ action: z.literal("dismiss") }),
  z.object({ action: z.literal("confirm"), code: z.string().min(1).max(40), address: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/) }),
  z.object({ action: z.literal("change"), code: z.string().min(1).max(40), address: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/) }),
]);

/** The inviter behind a code, masked, or null when the code belongs to nobody. */
async function inviterFor(
  code: string,
): Promise<Readonly<{ code: string; inviterMasked: string; codeMasked: string }> | null> {
  const store = getGuardRuntime().store;
  const wallet = await walletForCode(store, code);
  if (!wallet) return null;
  return { code, inviterMasked: maskWallet(wallet), codeMasked: maskCode(code) };
}

export async function GET(req: NextRequest) {
  const rate = consumeSolanaReadRequest(req.headers);
  if (!rate.allowed) return json({ error: "rate limited" }, 429);

  const asked = req.nextUrl.searchParams.get("code");
  if (asked !== null) {
    /* A preview of a code somebody typed or pasted. The cookie is untouched:
       looking is not choosing, and Change code is a separate deliberate step. */
    const normalized = normalizeReferralCode(asked);
    if (!normalized) return json({ ok: true, found: false, preview: null });
    const preview = await inviterFor(normalized);
    return json({ ok: true, found: preview !== null, preview });
  }

  /* What this browser carries, and — for its proven wallet only — the binding:
     `readReferralState` decides, including the one write a GET makes. */
  const carried = req.cookies.get(REFERRAL_COOKIE)?.value ?? null;
  const normalized = carried ? normalizeReferralCode(carried) : null;
  const proof = await getWalletProof();
  const own = proof && proof.chain === "solana" && proof.address === req.nextUrl.searchParams.get("address") ? proof.address : null;
  const read = await readReferralState(getGuardRuntime().store, { wallet: own, carried: normalized, now: new Date().toISOString() });
  const response = json(read.body);
  if (carried && read.clearCookie) {
    response.cookies.delete(REFERRAL_COOKIE);
    response.cookies.delete(REFERRAL_COOKIE_AT);
  }
  return response;
}

export async function POST(req: NextRequest) {
  const rate = consumeSolanaReadRequest(req.headers);
  if (!rate.allowed) return json({ error: "rate limited" }, 429);
  if (!mutationOriginAllowed(req.url, req.headers.get("origin"), req.headers.get("sec-fetch-site"))) {
    return json({ error: "forbidden origin" }, 403);
  }
  const body = await readAgentControlJson(req);
  if (!body.ok) return json({ error: "bad request" }, body.status);
  const parsed = ActionSchema.safeParse(body.value);
  if (!parsed.success) return json({ error: "bad request" }, 400);

  if (parsed.data.action === "dismiss") {
    const response = json({ ok: true, pending: null, confirmed: null });
    response.cookies.delete(REFERRAL_COOKIE);
    response.cookies.delete(REFERRAL_COOKIE_AT);
    return response;
  }

  const code = normalizeReferralCode(parsed.data.code);
  if (!code) return json({ ok: false, found: false, reason: "REFERRAL_CODE_NOT_FOUND" }, 404);
  const preview = await inviterFor(code);
  if (!preview) return json({ ok: false, found: false, reason: "REFERRAL_CODE_NOT_FOUND" }, 404);

  if (parsed.data.action === "pending") {
    /* Change code: what is being considered moves, and nothing is decided. */
    const response = json({ ok: true, pending: preview, confirmed: null });
    response.cookies.set({
      name: REFERRAL_COOKIE,
      value: code,
      httpOnly: true,
      sameSite: "lax",
      secure: secureCookies(),
      path: "/",
      maxAge: THIRTY_DAYS_SECONDS,
    });
    /* Chosen on purpose, so it holds as a first touch from now. */
    response.cookies.set({
      name: REFERRAL_COOKIE_AT,
      value: String(Date.now()),
      httpOnly: true,
      sameSite: "lax",
      secure: secureCookies(),
      path: "/",
      maxAge: THIRTY_DAYS_SECONDS,
    });
    return response;
  }

  /* Confirm. The only action here that writes anything, and the only one that
     needs to know whose account it is writing to. */
  const proof = await getWalletProof();
  if (!proof || proof.chain !== "solana" || proof.address !== parsed.data.address) {
    return json({ ok: false, reason: "PROOF_REQUIRED", proof: false }, 401);
  }
  const store = getGuardRuntime().store;
  const now = new Date().toISOString();
  /* `change`: the one change of inviter, inside the window; with no inviter
     yet it is a plain binding. */
  const decision = parsed.data.action === "change"
    ? await changeReferrer(store, { wallet: proof.address, code, now })
    : await bindReferrer(store, { wallet: proof.address, code, now });
  if (!decision.ok) {
    /* Self-referral, a cycle, an inviter already settled, a wallet whose
       seven days after its first trade are over. Every one of them is
       fail-closed and the code is the whole of what the surface needs to word
       it. */
    return json({ ok: false, reason: decision.code }, 409);
  }
  const account = await readRewardAccount(store, proof.address);
  const change = account ? await readReferralChangeWindow(store, account, now) : { open: false, until: null };
  const response = json({
    ok: true,
    pending: null,
    confirmed: { inviterMasked: preview.inviterMasked, codeMasked: preview.codeMasked },
    change,
  });
  response.cookies.delete(REFERRAL_COOKIE);
  response.cookies.delete(REFERRAL_COOKIE_AT);
  return response;
}
