import { NextRequest, NextResponse } from "next/server";
import { isAddress } from "@solana/kit";
import { z } from "zod";

import { accountByWallet, accountWalletLink, accountResolveSolana, sessionOpen, sessionResolve, sessionRevoke } from "@/lib/account/rpc";
import { CUSTOMER_SESSION_TTL_S, WALLET_PROOF_TTL_S, WALLET_SIGNIN_TTL_S, cookieBase } from "@/lib/auth/account-session";
import { LINKED_WALLET_COOKIE, linkProvesFor } from "@/lib/account/wallet-session";
import { buildSiwsInput, siwsMessageText, verifySiws, type SiwsAction } from "@/lib/auth/siws";
import { issueWalletNonce, walletNonceIssuedHere } from "@/lib/auth/wallet-nonce";
import { consumeLoginNonce } from "@/lib/beta/rpc";
import { issueSessionRefToken, verifySession } from "@/lib/beta/token";
import { recordAccountLogin } from "@/lib/admin/activity";
import { recordWalletVerified } from "@/lib/admin/wallet-presence";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { FixedWindowLimiter, clientIp, privateNoStoreHeaders, rateLimitHeaders } from "@/lib/http-control";
import { mutationOriginAllowed } from "@/lib/security";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Proof of ownership for a Solana wallet.
 *
 * `GET`  builds the exact sign-in input for an address. The server builds it,
 *        never the client: a client that supplies its own message picks its
 *        own domain, expiry and statement, and every check in `verifySiws`
 *        becomes a formality it can satisfy.
 * `POST` verifies the signed message and then does one of two things —
 *        `prove` opens a wallet-proof session (the `rw` cookie: private server
 *        history for that address, nothing more), `link` binds the proven
 *        address to the account signed in right now. A linked wallet is the
 *        proof for that account's session for as long as both last (decision
 *        62, SOL-W3: `readWalletProof`), so `link` opens no `rw` of its own —
 *        a separate 24-hour proof beside it would outlive an unlink.
 *
 * `signin` is a separate, purpose-bound SIWS action that resolves an account
 * and issues a recorded customer session. That session names the address it
 * signed with and is itself the proof of that address on every page
 * (`readWalletProof`), so a person signs once per visit, not once per page;
 * it lives as long as an email sign-in and is renewed while in use.
 * `prove` still creates no account: the web no longer asks for it — a person
 * signed in by another door links the wallet once instead (SOL-W3), and a
 * person with no account signs in. A connected wallet in the browser proves
 * nothing until it signs; a signature over anything but this server's message
 * for this nonce is refused. Nothing here touches a transaction.
 *
 * THE NONCE IS CHECKED TWICE, FOR TWO DIFFERENT PROPERTIES — see
 * `app/api/auth/wallet/route.ts`: issuance (HMAC tag) first, then single use
 * (database), and it is spent before the signature is verified.
 */

const LIMITER = new FixedWindowLimiter({ windowMs: 60_000, limit: 20, maxKeys: 5_000 });
const MAX_BODY_BYTES = 8_192;

const BodySchema = z.object({
  action: z.enum(["prove", "link", "signin"]),
  locale: z.enum(["en", "uk"]).default("en"),
  address: z.string().min(32).max(44),
  /** base64 of the bytes the wallet signed */
  signedMessage: z.string().min(16).max(8_192),
  /** base64 of the 64-byte Ed25519 signature */
  signature: z.string().min(80).max(96),
});

function fail(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: privateNoStoreHeaders() });
}

function siteFor(req: NextRequest): { domain: string; uri: string } {
  const url = new URL(req.url);
  return { domain: url.host, uri: url.origin };
}

function limited(req: NextRequest) {
  const decision = LIMITER.consume(`siws:${clientIp(req.headers)}`);
  if (decision.allowed) return null;
  return NextResponse.json({ error: "rate limited" }, { status: 429, headers: { ...privateNoStoreHeaders(), ...rateLimitHeaders(decision) } });
}

function nonceContext(action: SiwsAction, locale: "en" | "uk", session: Awaited<ReturnType<typeof getSession>>): string | undefined {
  if (action === "prove") return undefined;
  return JSON.stringify(["solana", action, locale, action === "link" ? session?.accountId : null, action === "link" ? session?.sessionId : null]);
}

/* The Guard store is where presence lives, and this route never needed it
   before. A deployment whose store refuses to construct must still sign people
   in, so the store is reached for here and a refusal is a null, not a 500. */
function presenceStore(): ReturnType<typeof getGuardRuntime>["store"] | null {
  try {
    return getGuardRuntime().store;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const capped = limited(req);
  if (capped) return capped;
  const params = new URL(req.url).searchParams;
  const address = params.get("address") ?? "";
  const action = params.get("action") ?? "prove";
  if (action !== "prove" && action !== "link" && action !== "signin") return fail("bad action", 400);
  const locale = params.get("locale") === "uk" ? "uk" : "en";
  const session = action === "link" ? await getSession() : null;
  if (action === "link" && !session?.accountId) return fail("unauthorized", 401);
  if (!isAddress(address)) return fail("bad address", 400);
  const nonce = issueWalletNonce(nonceContext(action, locale, session));
  if (!nonce) return fail("unavailable", 503);
  const { domain, uri } = siteFor(req);
  const input = buildSiwsInput({ domain, uri, address, nonce, now: Date.now(), action, locale });
  return NextResponse.json({ input, message: siwsMessageText(input) }, { headers: privateNoStoreHeaders() });
}

export async function POST(req: NextRequest) {
  if (!mutationOriginAllowed(req.url, req.headers.get("origin"), req.headers.get("sec-fetch-site"))) {
    return fail("forbidden", 403);
  }
  const capped = limited(req);
  if (capped) return capped;

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return fail("payload too large", 413);
  let body: z.infer<typeof BodySchema>;
  try {
    const parsed = BodySchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return fail("bad request", 400);
    body = parsed.data;
  } catch {
    return fail("bad request", 400);
  }
  if (!isAddress(body.address)) return fail("bad address", 400);

  let signedMessage: Uint8Array;
  let signature: Uint8Array;
  try {
    signedMessage = new Uint8Array(Buffer.from(body.signedMessage, "base64"));
    signature = new Uint8Array(Buffer.from(body.signature, "base64"));
  } catch {
    return fail("bad request", 400);
  }
  if (signature.length !== 64 || signedMessage.length === 0) return fail("bad request", 400);

  /* The nonce is read out of the unverified message on purpose — it is the one
     field that has to be checked before the expensive work, and reading it
     grants nothing: an attacker-chosen value fails the issuance tag below. */
  const text = new TextDecoder().decode(signedMessage);
  const nonce = /^Nonce: ([0-9A-Za-z]+)$/m.exec(text)?.[1] ?? "";
  const session = body.action === "link" ? await getSession() : null;
  if (body.action === "link" && !session?.accountId) return fail("unauthorized", 401);
  if (!walletNonceIssuedHere(nonce, nonceContext(body.action, body.locale, session))) return fail("bad nonce", 400);
  const spent = await consumeLoginNonce(nonce, Date.now() + 8 * 60_000);
  if (!spent) return fail("bad nonce", 400);

  const { domain, uri } = siteFor(req);
  const verified = await verifySiws({ signedMessage, signature, expected: { domain, uri, nonce, address: body.address, action: body.action, locale: body.locale }, now: Date.now() });
  /* The specific reason stays server-side. */
  if (!verified.ok) return fail("verification failed", 401);
  const address = verified.address;

  /* A recorded session of a door that proves its links (email, Google,
     Telegram OpenID — `linkProvesFor`) proves the wallet from here on. Any
     other session that links — a bot link, a wallet sign-in linking a second
     wallet, a legacy stateless token — reads no proof from the link, so it
     keeps the short `rw` proof beside it, as before (SOL-W3). */
  const linkProves = body.action === "link" && Boolean(session?.sessionId) && Boolean(session?.method && linkProvesFor(session.method));
  if (body.action === "link") {
    if (!session?.accountId) return fail("unauthorized", 401);
    /* One owner per wallet: a wallet another account holds is refused here
       and proves nothing for this one (`wallet_taken`). */
    const linked = await accountWalletLink(session.accountId, "solana", address);
    if (!linked.ok) {
      return fail(linked.error, linked.error === "wallet_taken" ? 409 : linked.error === "unavailable" ? 503 : 400);
    }
    /* The account's session is the proof from here on. A `rw` this browser
       still holds (an older `prove`) is read before it and could name another
       address, so it is closed — after the link, so a refused link costs
       nobody their proof; the cookie goes either way below, and a row the
       store could not close ends on its own within a day. */
    const previous = linkProves ? verifySession(req.cookies.get("rw")?.value ?? "") : null;
    if (previous && !previous.admin && previous.subject.kind === "session") {
      const outcome = await sessionResolve(previous.subject.sessionId, false);
      if (outcome.status === "ok" && outcome.session.kind === "wallet") await sessionRevoke(outcome.session.id, "replaced");
    }
  }

  let customer: { id: string; expiresAt: string } | null = null;
  let customerToken: string | null = null;
  let confirmedAccount: string | null = null;
  if (body.action === "signin") {
    const account = await accountResolveSolana(address, body.locale);
    if (!account.ok) return fail(account.error, 503);
    customer = await sessionOpen({ kind: "customer", method: "solana_siws", accountId: account.accountId,
      walletChain: "solana", walletAddress: address, ttlSeconds: WALLET_SIGNIN_TTL_S });
    if (!customer) return fail("unavailable", 503);
    customerToken = issueSessionRefToken(customer.id, Date.parse(customer.expiresAt));
    if (!customerToken) { await sessionRevoke(customer.id, "replaced"); return fail("unavailable", 503); }
    // An unavailable lookup is not an absent session. Check each signed
    // reference directly before accepting replacement credentials.
    for (const name of ["rt", "rw"] as const) {
      const previous = verifySession(req.cookies.get(name)?.value ?? "");
      if (!previous || previous.admin || previous.subject.kind !== "session") continue;
      const outcome = await sessionResolve(previous.subject.sessionId, false);
      const expectedKind = name === "rt" ? "customer" : "wallet";
      if (outcome.status === "unavailable" || (outcome.status === "ok" && outcome.session.kind === expectedKind && !(await sessionRevoke(outcome.session.id, "replaced")))) {
        await sessionRevoke(customer.id, "replaced");
        return fail("unavailable", 503);
      }
    }
    confirmedAccount = account.accountId;
  }

  /* A sign-in is its own proof: the customer session names the address it
     signed with, and «sign out everywhere» closes it with the account. A
     separate `rw` beside it would be a second, account-less credential that
     outlives that sign-out, so a sign-in issues none (and the replaced one
     above is gone); a link issues none either — the account's session proves
     a linked wallet. Only `prove` opens the short `rw` proof. */
  let proof: { id: string; expiresAt: string } | null = null;
  let token: string | null = null;
  if (body.action === "prove" || (body.action === "link" && !linkProves)) {
    proof = await sessionOpen({
      kind: "wallet",
      method: "solana_siws",
      walletChain: "solana",
      walletAddress: address,
      ttlSeconds: WALLET_PROOF_TTL_S,
    });
    if (!proof) return fail("unavailable", 503);
    token = issueSessionRefToken(proof.id, Date.parse(proof.expiresAt));
    if (!token) {
      await sessionRevoke(proof.id, "replaced");
      return fail("unavailable", 503);
    }
  }

  /* A proven wallet that belongs to an account is that account's login by
     signature; a proof for a wallet nobody linked is wallet activity, not a
     login, and is not recorded as one. Linking itself is not a login either. */
  /* The admin's "wallet verified" fact, for every proof — prove, sign-in or
     link — and whether or not an account owns the address: a signature over
     the server's own message is proof of ownership either way. Bounded and
     non-fatal like the login row beside it. */
  const store = presenceStore();
  const verifiedPresence = store
    ? recordWalletVerified(store, { wallet: address, now: new Date().toISOString() })
    : Promise.resolve("unavailable" as const);
  if (body.action !== "link") {
    const owner = confirmedAccount ?? await accountByWallet("solana", address);
    if (owner) {
      await recordAccountLogin({ accountId: owner, kind: "solana_siws", admin: false, target: "app", nonce: customer ? `sess-${customer.id}` : `siws-${nonce}` }, { timeoutMs: 2_500 });
    }
  }
  await verifiedPresence;

  const res = NextResponse.json({ ok: true, address, expiresAt: customer?.expiresAt ?? proof?.expiresAt ?? (linkProves ? session?.expiresAt ?? null : null), linked: body.action === "link", signedIn: body.action === "signin" }, { headers: privateNoStoreHeaders() });
  if (linkProves) {
    res.cookies.delete("rw");
    res.cookies.set(LINKED_WALLET_COOKIE, address, { ...cookieBase(req.url), maxAge: CUSTOMER_SESSION_TTL_S });
  }
  if (customerToken) {
    res.cookies.set("rt", customerToken, { ...cookieBase(req.url), maxAge: WALLET_SIGNIN_TTL_S });
    res.cookies.delete("rw");
    res.cookies.delete(LINKED_WALLET_COOKIE);
  }
  if (token) res.cookies.set("rw", token, { ...cookieBase(req.url), maxAge: WALLET_PROOF_TTL_S });
  return res;
}
