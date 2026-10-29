/**
 * What the tools read through — the existing services, behind one interface.
 * Tools read through existing services and provider boundaries, never a
 * provider API called from agent code.
 *
 * The interface is the seam: `runtime.server.ts` binds every reader to the
 * real service (the Spot catalogue, the stock universe, the evidence layer
 * with its budgets and rights, the plan store, the history ledger, the
 * monitoring surface, the holdings route), and the stand and the tests bind
 * fixtures. A tool never knows which.
 */

import type { DexPair } from "../../assistant/data/dexscreener.ts";
import type { DigestRead } from "../../assistant/news/store.ts";
import type { RugCheckReport } from "../../assistant/data/rugcheck.ts";
import type { MarketEvidenceRead } from "../../evidence/snapshot.ts";
import type { PlanAssetRead, PlanMemoryFact, PlanResult, PlanReview, PlanSync, TradingPlan } from "../../api/v1/contract.ts";
import type { EvidenceProvider, EvidenceWindow } from "../../evidence/metrics.ts";
import type { MonitoringSurface } from "../../monitoring/service.server.ts";
import type { InboxRecord } from "../../monitoring/store.ts";
import type { SolanaWalletAction } from "../../solana/action-ledger.ts";
import type { SpotMarket, SpotMarketListRow } from "../../spot/markets.ts";
import { retiredTokenFor } from "../../stocks/retired.ts";
import type { StockRow, StockUniverse } from "../../stocks/universe.server.ts";

export type SpotMarketRead = Readonly<{ ok: true; market: SpotMarket | null; observedAt: string; stale: boolean }> | Readonly<{ ok: false; reason: string }>;
export type SpotSearchRead = Readonly<{ ok: true; rows: readonly SpotMarketListRow[]; observedAt: string; stale: boolean }> | Readonly<{ ok: false; reason: string }>;
export type StockRowRead = Readonly<{ ok: true; row: StockRow | null; universe: StockUniverse }> | Readonly<{ ok: false; code: string; reason: string }>;

/** The holdings route's answer, as the surfaces read it (`/api/solana/holdings`). */
export type HoldingsRow = Readonly<{
  kind: "NATIVE" | "TOKEN";
  mint: string;
  /** Raw units, the chain's figure; the tool prints the decimal text and never sums. */
  amountRaw: string;
  decimals: number | null;
  symbol: string | null;
  name: string | null;
  catalog: Readonly<{ symbol?: string | null; name?: string | null; usdPrice?: string | null; isVerified?: boolean; category?: string | null }> | null;
}>;
export type HoldingsRead =
  | Readonly<{ ok: true; owner: string; holdings: readonly HoldingsRow[]; tokenRead: "COMPLETE" | "PARTIAL" | "UNAVAILABLE"; observedAt: string; sourceHost: string | null }>
  | Readonly<{ ok: false; reason: string }>;

/* AI-03: the market's public sources, projected to what the tools say — never the providers' own shapes. */

/** A token's DEX pairs (DexScreener). */
export type DexPairsRead = Readonly<{ ok: true; pairs: readonly DexPair[]; observedAt: string; stale: boolean }> | Readonly<{ ok: false; reason: string }>;
/** A token's risk report (RugCheck); `report` null when the service has none for the mint. */
export type TokenReportRead = Readonly<{ ok: true; report: RugCheckReport | null; observedAt: string; stale: boolean }> | Readonly<{ ok: false; reason: string }>;

export type CandleBar = Readonly<{ time: number; open: number; high: number; low: number; close: number }>;
/** A token's candles (GeckoTerminal, the pool the chart picks). */
export type CandlesRead =
  | Readonly<{ ok: true; timeframe: "1h" | "4h" | "1d"; candles: readonly CandleBar[]; pool: Readonly<{ name: string; dex: string; reserveUsd: number | null }>; observedAt: string; stale: boolean }>
  | Readonly<{ ok: false; code: string; reason: string }>;

export type MoverRow = Readonly<{ mint: string; symbol: string; changePct: number | null; volumeUsd: number | null; liquidityUsd: number | null; verified: boolean }>;
/** The market's movers over a window (Pulse: Jupiter's lists). */
export type MoversRead = Readonly<{ ok: true; window: "h1" | "h24"; up: readonly MoverRow[]; down: readonly MoverRow[]; observedAt: string; stale: boolean }> | Readonly<{ ok: false; reason: string }>;

export type PoolRow = Readonly<{ kind: "dlmm" | "damm-v2"; name: string; address: string; tvlUsd: number | null; volume24hUsd: number | null; fees24hUsd: number | null }>;
/** A token's Meteora pools (DLMM and DAMM v2). */
export type PoolsRead =
  | Readonly<{ ok: true; state: "current" | "stale" | "partial" | "unavailable"; pools: readonly PoolRow[]; meaningful: number; totals: Readonly<{ tvlUsd: number | null; volume24hUsd: number | null; fees24hUsd: number | null }>; observedAt: string | null }>
  | Readonly<{ ok: false; reason: string }>;

/** A market launched on Ryntra, by fixed definitions (Market Health); `health` null when the mint is no Ryntra launch. */
export type LaunchHealthRead =
  | Readonly<{
      ok: true;
      health: Readonly<{
        state: string;
        venue: "curve" | "pool";
        holders: number | null;
        holdersAtLeast: boolean;
        top10Pct: number | null;
        top10AtLeast: boolean;
        traded24h: boolean | null;
        daysSinceDex: number | null;
        priceVsDexPct: number | null;
        creatorSold: boolean | null;
        observedAt: string;
      }> | null;
    }>
  | Readonly<{ ok: false; reason: string }>;

export type PlanRecordRead =Readonly<{ ok: true; plan: TradingPlan; reviews: readonly PlanReview[]; sync: PlanSync }> | Readonly<{ ok: false; code: string; message: string }>;
export type PlanAssetResolved = Readonly<{ ok: true; read: PlanAssetRead }> | Readonly<{ ok: false; code: string; message: string; issues?: readonly Readonly<{ path: string; message: string; code?: string }>[] }>;

export type AgentReaders = Readonly<{
  spotMarket(mint: string): Promise<SpotMarketRead>;
  spotSearch(query: string, limit: number): Promise<SpotSearchRead>;
  /** The stock universe's row for a ticker or a mint, when the mint is a confirmed representation. */
  stockRow(tickerOrMint: string): Promise<StockRowRead>;
  evidence(input: Readonly<{ mint: string; window: EvidenceWindow; provider?: EvidenceProvider }>): Promise<MarketEvidenceRead>;
  holdings(owner: string): Promise<HoldingsRead>;
  plans(owner: string): Promise<Readonly<{ plans: readonly TradingPlan[]; total: number; sync: PlanSync }>>;
  plan(owner: string, planId: string): Promise<PlanRecordRead>;
  planResults(owner: string, planId: string): Promise<Readonly<{ ok: true; results: readonly PlanResult[]; sync: PlanSync }> | Readonly<{ ok: false; code: string; message: string }>>;
  /** 1.9.0: the wallet's strategy memory — facts derived from its own records, each carrying the record it stands on. Read only; there is no writer on this seam. */
  planMemory(owner: string): Promise<Readonly<{ facts: readonly PlanMemoryFact[]; sync: PlanSync }>>;
  planAsset(mint: string): Promise<PlanAssetResolved>;
  activity(owner: string): Promise<readonly SolanaWalletAction[]>;
  watchlist(owner: string): Promise<readonly string[]>;
  monitoring(owner: string, locale: "en" | "uk"): Promise<MonitoringSurface>;
  inboxNote(owner: string, inboxId: string): Promise<InboxRecord | null>;
  /* AI-03: public market sources — keyless, nothing of anyone's own. */
  dexPairs(mint: string): Promise<DexPairsRead>;
  tokenReport(mint: string): Promise<TokenReportRead>;
  candles(mint: string, timeframe: "1h" | "4h" | "1d"): Promise<CandlesRead>;
  movers(window: "h1" | "h24"): Promise<MoversRead>;
  pools(mint: string): Promise<PoolsRead>;
  launchHealth(mint: string): Promise<LaunchHealthRead>;
  /** AI-09: the news Ryntra collected about a token (a mint) or the market (null) — the digest only; a question never starts a collection. */
  news(mint: string | null): Promise<NewsRead>;
}>;

/** AI-09: a token's or the market's news digest, as the collector last built it. */
export type NewsRead = DigestRead;

/** What a symbol or a mint turned out to be: a confirmed stock representation, a catalogue token, or nothing. */
export type ResolvedAsset =
  | Readonly<{ kind: "stock"; row: StockRow; mint: string; symbol: string }>
  | Readonly<{ kind: "token"; market: SpotMarket; observedAt: string; stale: boolean; mint: string; symbol: string }>
  | Readonly<{ kind: "none"; query: string; reason: string }>;

const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/*
 * AI-06c, found on production 20.10: «Яка ціна BTC?» read «Big Titty Coin» at $0.0004 and «Bitcoin» a memecoin named
 * BITCOIN — the catalogue's first exact symbol. Bitcoin and Ether by any of their names are the assets people mean:
 * on Solana, Coinbase's cbBTC (else Wrapped BTC by Portal) and Ether by Portal — read by mint, never by a look-alike
 * that borrowed the ticker. The first mint the catalogue lists answers.
 */
const CBBTC = "cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij";
const WBTC_PORTAL = "3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh";
const ETH_PORTAL = "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs";
export const MAJOR_ALIASES: Readonly<Record<string, readonly string[]>> = {
  BTC: [CBBTC, WBTC_PORTAL],
  BITCOIN: [CBBTC, WBTC_PORTAL],
  XBT: [CBBTC, WBTC_PORTAL],
  ETH: [ETH_PORTAL],
  ETHEREUM: [ETH_PORTAL],
  ETHER: [ETH_PORTAL],
};

/**
 * A symbol or a mint resolved the way the product resolves it: a confirmed
 * stock first (the universe, by ticker or by mint), else the catalogue
 * (exact symbol, the verified row first). A word the catalogue does not know
 * is `none` with the reason — never a guess at what the person meant. A token
 * Ryntra no longer supports is `none` with the reason `retired`: never a
 * look-alike that borrowed its symbol.
 */
export async function resolveAsset(readers: AgentReaders, query: string): Promise<ResolvedAsset> {
  const text = query.trim().replace(/^\$/, "");
  if (text.length === 0) return { kind: "none", query, reason: "empty" };
  if (retiredTokenFor(text) !== null) return { kind: "none", query, reason: "retired" };
  const aliased = MAJOR_ALIASES[text.toUpperCase()];
  if (aliased) {
    for (const mint of aliased) {
      const read = await readers.spotMarket(mint);
      if (read.ok && read.market) return { kind: "token", market: read.market, observedAt: read.observedAt, stale: read.stale, mint: read.market.mint, symbol: read.market.symbol };
    }
    return { kind: "none", query, reason: "not-listed" };
  }
  const stock = await readers.stockRow(text);
  if (stock.ok && stock.row) return { kind: "stock", row: stock.row, mint: stock.row.representation.mint, symbol: stock.row.representation.symbol };
  if (MINT.test(text)) {
    const read = await readers.spotMarket(text);
    if (!read.ok) return { kind: "none", query, reason: read.reason };
    if (!read.market) return { kind: "none", query, reason: "not-listed" };
    return { kind: "token", market: read.market, observedAt: read.observedAt, stale: read.stale, mint: read.market.mint, symbol: read.market.symbol };
  }
  const search = await readers.spotSearch(text, 12);
  if (!search.ok) return { kind: "none", query, reason: search.reason };
  /* AI-06a: a catalogue symbol may carry its own «$» (dogwifhat is «$WIF»): «WIF» is that token, not «not listed». */
  const exact = search.rows.filter((row) => row.symbol.replace(/^\$/, "").toLowerCase() === text.toLowerCase());
  const pick = exact.find((row) => row.verified) ?? exact[0] ?? null;
  if (!pick) return { kind: "none", query, reason: "not-listed" };
  const read = await readers.spotMarket(pick.mint);
  if (!read.ok) return { kind: "none", query, reason: read.reason };
  if (!read.market) return { kind: "none", query, reason: "not-listed" };
  return { kind: "token", market: read.market, observedAt: read.observedAt, stale: read.stale, mint: read.market.mint, symbol: read.market.symbol };
}
