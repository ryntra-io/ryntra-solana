import { NextRequest, NextResponse } from "next/server";

import { accountWalletLink, sessionOpen } from "@/lib/account/rpc";
import { WALLET_PROOF_TTL_S } from "@/lib/auth/account-session";
import { buildSiweMessage, verifySiwe } from "@/lib/auth/siwe";
import { issueWalletNonce, walletNonceIssuedHere } from "@/lib/auth/wallet-nonce";
import { consumeLoginNonce, linkVerifiedWallet, userByWallet } from "@/lib/beta/rpc";
import { issueSessionRefToken } from "@/lib/beta/token";
import { FixedWindowLimiter, clientIp, privateNoStoreHeaders, rateLimitHeaders } from "@/lib/http-control";
import { mutationOriginAllowed } from "@/lib/security";
import { getSession } from "@/lib/session";
import { recordAccountLogin } from "@/lib/admin/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * EVM wallet proof (Sign-In with Ethereum).
 *
 * `GET`  builds the exact message to sign. The server builds it, never the
 *        client: a client that supplies its own message picks its own domain,
 *        expiry and statement, and every check in `verifySiwe` becomes a
 *        formality it can satisfy.
 * `POST` verifies the signature and then does one of two things — `link` binds
 *        the proven address to the account already in the session, `signin`
 *        opens a WALLET-PROOF session for the address.
 *
 * WHAT CHANGED WITH RYN-ACCESS-002, AND WHY
 *   A wallet is not a Ryntra account. Under `RYN-ACCESS-001` a signature could
 *   open the account that had linked the address; under the access model the
 *   founder approved on 2026-09-06 exactly three methods open an account —
 *   email + password, Google, Telegram — and a signature proves ownership of
 *   an address, which unlocks that address's own private server history and
 *   the right to link it. So `signin` now mints the `rw` proof cookie, never
 *   the `rt` account cookie, and no account is created from a signature. The
 *   unapplied `beta_create_wallet_user` migration is superseded by this.
 *
 * THE NONCE IS CHECKED TWICE, FOR TWO DIFFERENT PROPERTIES
 *   `walletNonceIssuedHere` answers "did this server mint it" from an HMAC tag
 *   carried inside the nonce, with no stored state. `consumeLoginNonce` answers
 *   "has it been spent" atomically in the database. Neither is sufficient: the
 *   database happily accepts a nonce an attacker invented, because it records
 *   consumption and not issuance, and the tag alone would let one nonce be
 *   replayed forever. Both are asked, issuance first because it is free.
 *
 * ORDER MATTERS: the nonce is spent *before* the signature is verified. A
 * captured signature therefore finds its nonce already gone, and two concurrent
 * requests carrying the same one cannot both proceed. Burning nonces on garbage
 * input is harmless — they are free to mint and bound to a two-minute message.
 */

/* One address is one login attempt at a time; the per-IP window is what stops a
   crawler from turning signature verification into a CPU faucet. */
const LIMITER = new FixedWindowLimiter({ windowMs: 60_000, limit: 20, maxKeys: 5_000 });

/**
 * Chains a login signature is accepted on.
 *
 * Domain binding already stops cross-site replay, so this is defence in depth
 * rather than the primary control — but a short allowlist costs nothing and a
 * signature scoped to one chain should not be honoured as another. Ethereum
 * mainnet is the wallet default; the second is a public testnet.
 */
const ALLOWED_CHAIN_IDS = [1, 5042002] as const;

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const MAX_BODY_BYTES = 8_192;

function fail(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: privateNoStoreHeaders() });
}

/** The origin this request was actually served on. Never read from the body. */
function siteFor(req: NextRequest): { domain: string; uri: string } {
  const url = new URL(req.url);
  return { domain: url.host, uri: url.origin };
}

function limited(req: NextRequest) {
  const decision = LIMITER.consume(`siwe:${clientIp(req.headers)}`);
  if (decision.allowed) return null;
  return NextResponse.json(
    { error: "rate limited" },
    { status: 429, headers: { ...privateNoStoreHeaders(), ...rateLimitHeaders(decision) } },
  );
}

export async function GET(req: NextRequest) {
  const capped = limited(req);
  if (capped) return capped;

  const params = new URL(req.url).searchParams;
  const address = params.get("address") ?? "";
  const chainId = Number(params.get("chainId"));

  if (!ADDRESS.test(address)) return fail("bad address", 400);
  if (!ALLOWED_CHAIN_IDS.includes(chainId as (typeof ALLOWED_CHAIN_IDS)[number])) {
    return fail("chain not supported", 400);
  }

  const nonce = issueWalletNonce();
  /* No secret means no verifiable nonce. Handing out an unverifiable one would
     reopen exactly the hole the nonce exists to close, so this fails closed. */
  if (!nonce) return fail("unavailable", 503);

  const { domain, uri } = siteFor(req);
  const message = buildSiweMessage({
    domain,
    uri,
    address: address as `0x${string}`,
    chainId,
    nonce,
    now: Date.now(),
  });

  return NextResponse.json({ message }, { headers: privateNoStoreHeaders() });
}

export async function POST(req: NextRequest) {
  /* Same-origin only. A wallet signature is a bearer credential once it exists,
     and this is the endpoint that turns one into a cookie. */
  if (!mutationOriginAllowed(req.url, req.headers.get("origin"), req.headers.get("sec-fetch-site"))) {
    return fail("forbidden", 403);
  }

  const capped = limited(req);
  if (capped) return capped;

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return fail("payload too large", 413);

  let body: { message?: unknown; signature?: unknown; action?: unknown };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    return fail("bad request", 400);
  }

  const message = typeof body.message === "string" ? body.message : "";
  const signature = typeof body.signature === "string" ? body.signature : "";
  const action = body.action === "link" ? "link" : body.action === "signin" ? "signin" : null;
  if (!message || !/^0x[0-9a-fA-F]+$/.test(signature) || !action) return fail("bad request", 400);

  /* The nonce is read out of the unverified message on purpose — it is the one
     field that has to be checked before the expensive work, and reading it
     grants nothing: an attacker-chosen value fails the issuance tag below. */
  const nonce = /^Nonce: ([0-9A-Za-z]+)$/m.exec(message)?.[1] ?? "";
  if (!walletNonceIssuedHere(nonce)) return fail("bad nonce", 400);

  /* Spend it before verifying. A captured signature then finds its nonce gone,
     and two concurrent requests with the same one cannot both pass. */
  const spent = await consumeLoginNonce(nonce, Date.now() + 8 * 60_000);
  if (!spent) return fail("bad nonce", 400);

  const { domain, uri } = siteFor(req);
  const verified = await verifySiwe({
    message,
    signature: signature as `0x${string}`,
    expectedDomain: domain,
    expectedUri: uri,
    expectedNonce: nonce,
    allowedChainIds: ALLOWED_CHAIN_IDS,
    now: Date.now(),
  });
  /* The specific reason stays server-side. A caller learns that it failed, not
     which bound it tripped — the reasons are for our logs, not for tuning an
     attack against. */
  if (!verified.ok) return fail("verification failed", 401);

  const wallet = verified.address.toLowerCase();

  if (action === "link") {
    const session = await getSession();
    if (!session) return fail("unauthorized", 401);
    if (session.accountId) {
      const linked = await accountWalletLink(session.accountId, "evm", wallet);
      if (!linked.ok) {
        /* `wallet_taken` is a real conflict — another account proved this same
           address first, and the database refuses to move it because moving it
           on a fresh signature is account takeover with extra steps. */
        return fail(linked.error, linked.error === "wallet_taken" ? 409 : linked.error === "unavailable" ? 503 : 400);
      }
      return NextResponse.json({ ok: true, wallet }, { headers: privateNoStoreHeaders() });
    }
    /* A legacy session that does not know its account yet keeps the old link
       path, which needs the Telegram-verified row. */
    if (!session.verified) return fail("unauthorized", 401);
    const linked = await linkVerifiedWallet(session.telegramId, wallet);
    if (!linked.ok) return fail(linked.error, linked.error === "wallet_taken" ? 409 : 400);
    return NextResponse.json({ ok: true, wallet }, { headers: privateNoStoreHeaders() });
  }

  /* Proof of ownership, recorded as a wallet session. Whether an account has
     linked this address is a fact the proof does not change; when one has,
     the proof is that account's login by signature and is counted as such. */
  const proof = await sessionOpen({
    kind: "wallet",
    method: "wallet_siwe",
    walletChain: "evm",
    walletAddress: wallet,
    ttlSeconds: WALLET_PROOF_TTL_S,
  });
  if (!proof) return fail("unavailable", 503);
  const token = issueSessionRefToken(proof.id, Date.parse(proof.expiresAt));
  if (!token) return fail("unavailable", 503);

  const account = await userByWallet(wallet);
  if (account.ok) {
    await recordAccountLogin({ wallet, kind: "wallet_siwe", admin: false, target: "app", nonce }, { timeoutMs: 2_500 });
  }
  return proofResponse(req, token, wallet, proof.expiresAt);
}

/** The one place the proof cookie is written. */
function proofResponse(req: NextRequest, token: string, wallet: string, expiresAt: string): NextResponse {
  const res = NextResponse.json({ ok: true, wallet, expiresAt }, { headers: privateNoStoreHeaders() });
  res.cookies.set("rw", token, {
    httpOnly: true,
    secure: new URL(req.url).protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: WALLET_PROOF_TTL_S,
  });
  return res;
}
