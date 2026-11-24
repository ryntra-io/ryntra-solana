import { NextRequest, NextResponse } from "next/server";

import { getGuardRuntime } from "@/lib/guard/runtime";
import { clientIp, FixedWindowLimiter, privateNoStoreHeaders, rateLimitHeaders } from "@/lib/http-control";
import { heldNow, portfolioPnl, type PnlMarket } from "@/lib/portfolio/pnl";
import { productionChain, productionFacts } from "@/lib/wallet-watch/chain.server";
import { refreshActivity } from "@/lib/wallet-watch/read";
import { claimChainRead, isAddress, readActivity } from "@/lib/wallet-watch/store";
import { WRAPPED_SOL } from "@/lib/wallet-watch/trades";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `GET /api/portfolio/pnl?owner=` — the Portfolio's result: the wallet's trades on Solana, any venue, by the
 * honest standard (DSC-2) — 7 · 30 · 90 days, each coin's entry price, the calendar's days, and what the read does not
 * know (`lib/portfolio/pnl.ts`). Public, no wallet needed: a wallet's trades are on the chain for anyone, as the wallet's
 * page reads them (`/api/wallet-watch/wallet`) — the same record, read once for everyone, only what is new asked again.
 * Reads only: nothing here builds, signs or sends a transaction.
 */

const LIMITER = new FixedWindowLimiter({ limit: 20, windowMs: 60_000, maxKeys: 5_000 });
/** A record younger than this is served as it is. */
const FRESH_MS = 30_000;
/** The most transactions one read takes: deeper than the wallet's page, so a first read reaches further back. */
const MAX_NEW = 60;

function json(body: Record<string, unknown>, status = 200, extra: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...privateNoStoreHeaders(), ...extra } });
}

export async function GET(req: NextRequest) {
  const owner = (new URL(req.url).searchParams.get("owner") ?? "").trim();
  if (!isAddress(owner)) return json({ error: "bad request", code: "NOT_AN_ADDRESS" }, 400);
  const limit = LIMITER.consume(clientIp(req.headers));
  if (!limit.allowed) return json({ error: "rate limited", code: "RATE_LIMITED" }, 429, rateLimitHeaders(limit));

  /* A read from the chain is counted across every instance; past the minute's share the kept record is served as it is. */
  const store = getGuardRuntime().store;
  const nowMs = Date.now();
  const kept = await readActivity(store, owner).catch(() => null);
  const stale = !kept || nowMs - Date.parse(kept.readAt) >= FRESH_MS;
  const allowed = !stale || (await claimChainRead(store, nowMs, kept ? "refresh" : "first").catch(() => false));
  if (!allowed && !kept) return json({ error: "busy", code: "RATE_LIMITED" }, 429, { "Retry-After": "30" });
  const activity = await refreshActivity(store, productionChain(), owner, { nowMs, freshMs: allowed ? FRESH_MS : Number.POSITIVE_INFINITY, maxNew: MAX_NEW, concurrency: 3 }).catch(() => null);
  if (!activity) return json({ error: "unavailable", code: "CHAIN_UNREAD" }, 503);

  /* Prices, depth and names of the coins traded, and SOL's price: a catalogue that does not answer leaves them unknown. */
  const mints = [...new Set(activity.trades.map((trade) => trade.mint))];
  const facts = await productionFacts([WRAPPED_SOL, ...mints].slice(0, 100)).catch(() => null);
  const market = new Map<string, PnlMarket>();
  for (const [mint, fact] of facts ?? []) market.set(mint, { priceUsd: fact.priceUsd, liquidityUsd: fact.liquidityUsd ?? null, symbol: fact.symbol, name: fact.name, icon: fact.icon });
  const pnl = portfolioPnl({
    read: {
      trades: activity.trades,
      held: heldNow(activity.held, activity.heldAt, activity.trades),
      oldestAt: activity.oldestAt,
      complete: activity.complete,
      gap: activity.gap ?? false,
      skipped: activity.skipped,
    },
    solUsd: facts?.get(WRAPPED_SOL)?.priceUsd ?? null,
    market,
    nowS: Math.floor(nowMs / 1000),
  });
  return json({ ok: true, owner, readAt: activity.readAt, pricesRead: facts !== null, pnl });
}
