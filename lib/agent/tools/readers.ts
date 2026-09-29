/**
 * What the tools read through — the existing services, behind one interface
 * (`RYN-AGENT-TEXT-001`; the Owner's rule of 2026-09-22 §2: tools read through
 * existing services and provider boundaries, never a provider API called from
 * agent code).
 *
 * The interface is the seam: `runtime.server.ts` binds every reader to the
 * real service (the Spot catalogue, the stock universe, the evidence layer
 * with its budgets and rights, the plan store, the history ledger, the
 * monitoring surface, the holdings route), and the stand and the tests bind
 * fixtures. A tool never knows which.
 */

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

export type PlanRecordRead = Readonly<{ ok: true; plan: TradingPlan; reviews: readonly PlanReview[]; sync: PlanSync }> | Readonly<{ ok: false; code: string; message: string }>;
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
}>;

/** What a symbol or a mint turned out to be: a confirmed stock representation, a catalogue token, or nothing. */
export type ResolvedAsset =
  | Readonly<{ kind: "stock"; row: StockRow; mint: string; symbol: string }>
  | Readonly<{ kind: "token"; market: SpotMarket; observedAt: string; stale: boolean; mint: string; symbol: string }>
  | Readonly<{ kind: "none"; query: string; reason: string }>;

const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * A symbol or a mint resolved the way the product resolves it: a confirmed
 * stock first (the universe, by ticker or by mint), else the catalogue
 * (exact symbol, the verified row first). A word the catalogue does not know
 * is `none` with the reason — never a guess at what the person meant. A token
 * Ryntra no longer supports is `none` with the reason `retired` (canon v5.2
 * В26): never a look-alike that borrowed its symbol.
 */
export async function resolveAsset(readers: AgentReaders, query: string): Promise<ResolvedAsset> {
  const text = query.trim().replace(/^\$/, "");
  if (text.length === 0) return { kind: "none", query, reason: "empty" };
  if (retiredTokenFor(text) !== null) return { kind: "none", query, reason: "retired" };
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
  const exact = search.rows.filter((row) => row.symbol.toLowerCase() === text.toLowerCase());
  const pick = exact.find((row) => row.verified) ?? exact[0] ?? null;
  if (!pick) return { kind: "none", query, reason: "not-listed" };
  const read = await readers.spotMarket(pick.mint);
  if (!read.ok) return { kind: "none", query, reason: read.reason };
  if (!read.market) return { kind: "none", query, reason: "not-listed" };
  return { kind: "token", market: read.market, observedAt: read.observedAt, stale: read.stale, mint: read.market.mint, symbol: read.market.symbol };
}
