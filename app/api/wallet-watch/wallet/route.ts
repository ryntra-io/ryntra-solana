import { NextRequest, NextResponse } from "next/server";

import { getGuardRuntime } from "@/lib/guard/runtime";
import { clientIp, FixedWindowLimiter, privateNoStoreHeaders, rateLimitHeaders } from "@/lib/http-control";
import { readSpotTokenFacts } from "@/lib/spot/markets.server";
import { isMintAccount, productionChain, productionFacts } from "@/lib/wallet-watch/chain.server";
import { walletView } from "@/lib/wallet-watch/read";
import { claimChainRead, isAddress, readActivity } from "@/lib/wallet-watch/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * One wallet as «Стеження за гаманцями» (SOL-R4) shows it: its trades read from the chain, what it made or lost on each
 * token, the labels it earned — public, no wallet needed: a wallet's trades are on the chain for anyone. A token's
 * address answers with its creator's wallet. Each address is read once for everyone and only what is new is asked;
 * a person may ask twenty times a minute. Reads only.
 */

const LIMITER = new FixedWindowLimiter({ limit: 20, windowMs: 60_000, maxKeys: 5_000 });
/* What an address is — a token (with its creator) or not — kept five minutes, a miss as well as a hit: a wallet's page polls. */
const KIND_TTL_MS = 5 * 60_000;
const kinds = new Map<string, { token: { mint: string; symbol: string; creator: string | null } | null; at: number }>();
const FRESH_MS = 30_000;

function json(body: Record<string, unknown>, status = 200, extra: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...privateNoStoreHeaders(), ...extra } });
}

export async function GET(req: NextRequest) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (!isAddress(q)) return json({ error: "bad request", code: "NOT_AN_ADDRESS" }, 400);
  const limit = LIMITER.consume(clientIp(req.headers));
  if (!limit.allowed) return json({ error: "rate limited", code: "RATE_LIMITED" }, 429, rateLimitHeaders(limit));

  /* A token's address: the wallet that matters is its creator's. */
  let wallet = q;
  let token = kinds.get(q) && Date.now() - kinds.get(q)!.at < KIND_TTL_MS ? kinds.get(q)!.token : undefined;
  if (token === undefined) {
    const facts = await readSpotTokenFacts(q).catch(() => null);
    if (facts?.ok && facts.market) {
      const creator = facts.facts?.dev ?? null;
      token = { mint: facts.market.mint, symbol: facts.market.symbol, creator: creator && isAddress(creator) ? creator : null };
    } else if (facts?.ok) {
      /* Jupiter does not know it: a token minted a minute ago is still a token — the chain says, before it is kept as a wallet. */
      const mint = await isMintAccount(q);
      if (mint !== false) return json({ ok: true, token: { mint: q, symbol: q.slice(0, 4), creator: null }, view: null });
      token = null;
    } else {
      /* Jupiter silent: a token's address is never read as a wallet with «no trades» — the chain says which it is. */
      const mint = await isMintAccount(q);
      if (mint !== false) return json({ error: "unavailable", code: "TOKEN_UNREAD" }, 503);
      token = null;
    }
    kinds.set(q, { token, at: Date.now() });
    if (kinds.size > 5_000) for (const [key, kept] of kinds) if (Date.now() - kept.at > KIND_TTL_MS) kinds.delete(key);
  }
  if (token) {
    if (!token.creator) return json({ ok: true, token, view: null });
    wallet = token.creator;
  }

  /* A read from the chain is counted across every instance; past the minute's share the kept record is served as it is. */
  const store = getGuardRuntime().store;
  const kept = await readActivity(store, wallet).catch(() => null);
  const stale = !kept || Date.now() - Date.parse(kept.readAt) >= FRESH_MS;
  const allowed = !stale || (await claimChainRead(store, Date.now(), kept ? "refresh" : "first").catch(() => false));
  if (!allowed && !kept) return json({ error: "busy", code: "RATE_LIMITED" }, 429, { "Retry-After": "30" });
  const view = await walletView(store, productionChain(), productionFacts, wallet, { nowMs: Date.now(), freshMs: allowed ? FRESH_MS : Number.POSITIVE_INFINITY, maxNew: 30, concurrency: 2 }).catch(() => null);
  if (!view) return json({ error: "unavailable", code: "CHAIN_UNREAD", token }, 503);
  return json({ ok: true, token, view });
}
