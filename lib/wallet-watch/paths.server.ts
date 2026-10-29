/**
 * «Реальність послідовника» (SOL-R3) — the pools' bars around a wallet's trades, read from GeckoTerminal through the
 * Spot chart's own minute budget (`getJson`, the page's share: a chart a person has open keeps its reserve), and what
 * Jupiter says of each token now. One pools read (shared with the chart for five minutes) and one bars read per token;
 * the four tokens bought last, the rest «not measured» with the reason. The bars are kept per token and width for
 * five minutes, whatever the trades, and cut to the trades on each read; a read that runs past its deadline leaves the
 * rest «not read now» — never a page waiting on a slow source.
 *
 * Reads only.
 */

import { GECKO_SOLANA_BASE, getJson, readTokenPoolsBody } from "../spot/candles.server.ts";
import { readSpotFactsByMint } from "../spot/markets.server.ts";
import { normalizeCandles } from "../spot/candles.ts";
import { barsNear, pathPool, pathWidth, PATH_BARS, PATH_REACH_S } from "./paths.ts";
import { INDEX_LAG_S, type PricePath, type TokenNow, type UnmeasuredReason } from "./reality.ts";
import { WRAPPED_SOL, type WalletTrade } from "./trades.ts";

/** Tokens measured per wallet, the ones bought last: two of the source's reads each, of the page's sixteen a minute. */
export const PATH_TOKENS = 4;
/** No new read starts after this: a token's two reads of up to 8 s each still end inside the route's 30 s. */
const DEADLINE_MS = 8_000;
const PATH_TTL_MS = 5 * 60_000;
type Bars = Readonly<{ body: unknown | null; pool: { name: string; dex: string | null } | null; at: number }>;
const kept = new Map<string, Bars>();

async function pathOf(mint: string, times: readonly number[], nowMs: number): Promise<{ path: PricePath | null; reason: UnmeasuredReason | null }> {
  const width = pathWidth(times);
  /* The read ends past the last leg's reach, rounded to ten minutes: a page polling reads the same bars. */
  const before = Math.ceil((Math.max(...times) + PATH_REACH_S + 2 * width.seconds) / 600) * 600;
  const key = `${mint}:${width.seconds}:${before}`;
  let hit = kept.get(key);
  if (!hit || nowMs - hit.at >= PATH_TTL_MS) {
    const pools = await readTokenPoolsBody(mint, "page");
    /* The source's minute budget spent or the source silent: said as «not read now», never kept as «no path». */
    if (!pools.ok) return { path: null, reason: "NOT_READ" };
    const pool = pathPool(pools.body, mint);
    if (!pool) {
      hit = { body: null, pool: null, at: nowMs };
    } else {
      const url = `${GECKO_SOLANA_BASE}/pools/${encodeURIComponent(pool.address)}/ohlcv/${width.path}?aggregate=${width.aggregate}&limit=${PATH_BARS}&currency=usd&token=${pool.side}&before_timestamp=${before}`;
      const read = await getJson(url, "page");
      if (!read.ok) return { path: null, reason: "NOT_READ" };
      hit = { body: read.body, pool: { name: pool.name, dex: pool.dex }, at: nowMs };
    }
    kept.set(key, hit);
    if (kept.size > 2_000) for (const [name, entry] of kept) if (nowMs - entry.at >= PATH_TTL_MS) kept.delete(name);
  }
  if (!hit.pool || hit.body === null) return { path: null, reason: "NO_PATH" };
  /* Cut to these trades on every read: a trade the record got late is priced by its own bars, not a gap. */
  const bars = barsNear(hit.body, times, width.seconds);
  if (bars.length === 0 || normalizeCandles(hit.body).length === 0) return { path: null, reason: "NO_PATH" };
  return { path: { barSeconds: width.seconds, bars, pool: hit.pool.name, dex: hit.pool.dex, readAt: Math.floor(hit.at / 1000) }, reason: null };
}

export type RealityInputs = Readonly<{
  paths: Record<string, PricePath>;
  now: Record<string, TokenNow>;
  symbols: Record<string, string | null>;
  solUsd: number | null;
  unmeasured: readonly Readonly<{ mint: string; reason: UnmeasuredReason }>[];
}>;

/** The bars and the prices now a wallet's reality is figured from: the six tokens traded last; the others said. */
export async function readRealityInputs(trades: readonly WalletTrade[], nowMs: number): Promise<RealityInputs> {
  const priced = trades.filter((trade) => trade.quote !== null && trade.at !== null && trade.paidBy === null);
  /* Only a token with a priced buy old enough to be measured takes a slot: a token only sold here was bought before the
     record, and one bought in the last minutes is measured next time — neither spends the source's reads. */
  const ripe = Math.floor(nowMs / 1000) - PATH_REACH_S - INDEX_LAG_S;
  const bought = new Set(priced.filter((trade) => trade.side === "buy" && trade.at! <= ripe).map((trade) => trade.mint));
  const lastAt = new Map<string, number>();
  for (const trade of priced) if (bought.has(trade.mint) && trade.side === "buy" && trade.at! <= ripe) lastAt.set(trade.mint, Math.max(lastAt.get(trade.mint) ?? 0, trade.at!));
  const order = [...lastAt.entries()].sort((a, b) => b[1] - a[1]).map(([mint]) => mint);
  const chosen = order.slice(0, PATH_TOKENS);
  const unmeasured: { mint: string; reason: UnmeasuredReason }[] = order.slice(PATH_TOKENS).map((mint) => ({ mint, reason: "BEYOND_FOUR" }));
  const facts = await readSpotFactsByMint([...chosen, WRAPPED_SOL]).catch(() => null);
  const now: Record<string, TokenNow> = {};
  const symbols: Record<string, string | null> = {};
  for (const mint of order) {
    const market = facts?.ok ? facts.byMint.get(mint) : undefined;
    symbols[mint] = market?.symbol ?? null;
    if (chosen.includes(mint)) now[mint] = { priceUsd: market?.price ?? null, liquidityUsd: market?.liquidityUsd ?? null };
  }
  const solUsd = facts?.ok ? (facts.byMint.get(WRAPPED_SOL)?.price ?? null) : null;
  const paths: Record<string, PricePath> = {};
  /* One token after another: the source's minute budget is shared with every chart open. */
  for (const mint of chosen) {
    if (Date.now() - nowMs > DEADLINE_MS) {
      unmeasured.push({ mint, reason: "NOT_READ" });
      continue;
    }
    const times = priced.filter((trade) => trade.mint === mint).map((trade) => trade.at!);
    const read = await pathOf(mint, times, nowMs).catch(() => ({ path: null, reason: "NOT_READ" as const }));
    if (read.path) paths[mint] = read.path;
    else unmeasured.push({ mint, reason: read.reason ?? "NO_PATH" });
  }
  return { paths, now, symbols, solUsd, unmeasured };
}
