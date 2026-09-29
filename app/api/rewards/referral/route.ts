import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { consumeSolanaReadRequest, readAgentControlJson } from "@/lib/agent-control/http";
import { secureCookies } from "@/lib/auth/cookie-policy";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { privateNoStoreHeaders } from "@/lib/http-control";
import { bindReferrer, readRewardAccount, walletForCode } from "@/lib/rewards/ledger";
import {
  maskCode,
  maskWallet,
  normalizeReferralCode,
  REFERRAL_COOKIE,
} from "@/lib/rewards/referral";
import { mutationOriginAllowed } from "@/lib/security";
import { getWalletProof } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `/api/rewards/referral` — who invited you, before it is decided.
 *
 * ## Why binding stopped happening on its own
 *
 * The first version wrote the attribution during the ordinary read of
 * `/api/rewards`, the moment a code and a proven wallet first existed together.
 * It worked, it was idempotent, and it was too quiet: a person never saw who
 * they were being attached to, and somebody who opened the wrong link — a
 * friend sent two, an old one was still in the browser — had no moment at which
 * to notice or correct it. An attribution that decides where money goes for the
 * life of an account should not happen as a side effect of loading a page.
 *
 * So a link now creates a **pending** referral and nothing else, and binding is
 * this route's own action, taken deliberately.
 *
 * ## What each verb does, and what it deliberately does not
 *
 * `GET` reads the pending code from the browser's cookie, or previews a code
 * given in the query, and answers with the inviter **masked**. It needs no
 * wallet: the whole point is that somebody arriving from a link can see who
 * invited them before they connect anything. It writes nothing.
 *
 * `POST` carries one of three actions. `pending` replaces the code being
 * considered — that is *Change code*, and it still binds nothing. `dismiss`
 * throws the invitation away. `confirm` is the only one that writes an
 * attribution, and it is the only one that requires a proven wallet.
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

  /* What this browser is currently carrying, if anything. */
  const carried = req.cookies.get(REFERRAL_COOKIE)?.value ?? null;
  const normalized = carried ? normalizeReferralCode(carried) : null;
  const pending = normalized ? await inviterFor(normalized) : null;

  /* A wallet that already has an inviter can never take another, so a pending
     code sitting in its browser is noise. It is reported as settled and the
     cookie is cleared rather than left to be offered again on every visit. */
  const proof = await getWalletProof();
  if (proof && proof.chain === "solana" && proof.address === req.nextUrl.searchParams.get("address")) {
    const account = await readRewardAccount(getGuardRuntime().store, proof.address);
    if (account?.referrer) {
      const response = json({
        ok: true,
        pending: null,
        confirmed: { inviterMasked: maskWallet(account.referrer), codeMasked: null },
      });
      if (carried) response.cookies.delete(REFERRAL_COOKIE);
      return response;
    }
  }
  return json({ ok: true, pending, confirmed: null });
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
  const decision = await bindReferrer(store, { wallet: proof.address, code, now });
  if (!decision.ok) {
    /* Self-referral, a cycle, an inviter already settled, a wallet already
       earning. Every one of them is fail-closed and the code is the whole of
       what the surface needs to word it. */
    return json({ ok: false, reason: decision.code }, 409);
  }
  const response = json({
    ok: true,
    pending: null,
    confirmed: { inviterMasked: preview.inviterMasked, codeMasked: preview.codeMasked },
  });
  response.cookies.delete(REFERRAL_COOKIE);
  return response;
}
