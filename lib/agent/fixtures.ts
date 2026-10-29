/**
 * A fixture world for the agent — the stand and the tests.
 *
 * Nothing here reaches the network: the Spot catalogue is three rows (SOL a
 * verified major, BONK a verified meme priced in fractions of a cent, COPY an
 * unverified copy), the stock universe three representations (NVDAx by
 * xStocks with a current reference, NVDAon by Ondo without one, OPENAI by
 * PreStocks — a pre-IPO token), the evidence layer answers a snapshot for
 * SOL and BONK and *unknown* for the rest, the holdings are the wallet's
 * three assets, History holds two operations, Monitoring one note. The plans
 * are real: written by the plan engine's own `createPlan` into the memory
 * store, so a fixture plan is exactly what production stores.
 */

import type { MarketEvidenceRead, MarketEvidenceSnapshot } from "../evidence/snapshot.ts";
import type { EvidenceMetricId, EvidenceProvider, EvidenceWindow } from "../evidence/metrics.ts";
import { NANSEN_RIGHTS, providerRights } from "../evidence/rights.ts";
import { createHash } from "node:crypto";

import { createMemoryGuardStore, type GuardStore } from "../guard/store.ts";
import type { MonitoringSurface } from "../monitoring/service.server.ts";
import type { MonitorNote } from "../monitoring/store.ts";
import { PlanRulesSchema, type PlanRules } from "../api/v1/contract.ts";
import { createPlan, getPlan, getPlanResults, listPlans, recordPlanReview } from "../plans/service.ts";
import { readTradingPlan } from "../plans/store.ts";
import type { SolanaWalletAction } from "../solana/action-ledger.ts";
import type { SpotMarket, SpotMarketListRow } from "../spot/markets.ts";
import { ISSUER_INSTRUMENT, STOCK_ISSUERS } from "../stocks/representations.ts";
import { REFERENCE_UNAVAILABLE, UNKNOWN_SESSION } from "../stocks/session.ts";
import type { StockRow, StockUniverse } from "../stocks/universe.server.ts";
import type { DexPair } from "../assistant/data/dexscreener.ts";
import type { RugCheckReport } from "../assistant/data/rugcheck.ts";
import type { NewsDigest } from "../assistant/news/store.ts";
import type { AgentReaders, CandleBar, HoldingsRead, MoverRow, NewsRead } from "./tools/readers.ts";

export const FIXTURE_NOW = "2026-09-22T10:00:00.000Z";
export const FIXTURE_NOW_MS = Date.parse(FIXTURE_NOW);
export const FIXTURE_OWNER = "F9pV233uBksW4U1BKiK7u9qShgXkwoR6F8MzU4FZYPUv";
export const OWNER = FIXTURE_OWNER;
export const OTHER_WALLET = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
export const SOL = "So11111111111111111111111111111111111111112";
export const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
export const COPY = "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr";
export const NVDAX = "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";
export const NVDAON = "Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyTBaGjzTJq";
export const OPENAI_PRESTOCKS = "8Yv9Jz4qPy3G6zQ3o2mZ7Xk1rL5bN9cT2wD4eF6gH8iJ";
const OBSERVED = "2026-09-22T09:58:30.000Z";

/* ------------------------------------------------------------ the catalogue */

function marketOf(mint: string, patch: Partial<SpotMarket>): SpotMarket {
  return {
    mint,
    symbol: "X",
    name: "X",
    icon: null,
    decimals: 9,
    tokenProgram: null,
    price: null,
    change24hPct: null,
    change1hPct: null,
    volume24hUsd: null,
    liquidityUsd: null,
    marketCapUsd: null,
    fdvUsd: null,
    holders: null,
    organicScore: null,
    organicScoreLabel: null,
    verified: true,
    tags: ["verified"],
    category: "crypto",
    issuer: null,
    firstPoolAt: null,
    audit: { mintAuthorityDisabled: true, freezeAuthorityDisabled: true, topHoldersPct: null, devBalancePct: null, suspicious: false },
    links: { website: null, twitter: null, telegram: null },
    stats: { h1: { priceChangePct: null, volumeUsd: null, buys: null, sells: null, traders: null }, h24: { priceChangePct: null, volumeUsd: null, buys: null, sells: null, traders: null } },
    updatedAt: OBSERVED,
    ...patch,
  } as SpotMarket;
}

export const MARKETS: Readonly<Record<string, SpotMarket>> = {
  [SOL]: marketOf(SOL, { symbol: "SOL", name: "Wrapped SOL", decimals: 9, price: 212.5, change24hPct: 3.4, volume24hUsd: 1_250_000_000, liquidityUsd: 50_000_000, marketCapUsd: 115_000_000_000, holders: 2_400_000, tags: ["verified", "community", "strict"], category: "crypto" }),
  [BONK]: marketOf(BONK, { symbol: "Bonk", name: "Bonk", decimals: 5, price: 0.00001234, change24hPct: -6.2, volume24hUsd: 42_000_000, liquidityUsd: 3_000_000, marketCapUsd: 900_000_000, holders: 880_000, tags: ["verified", "meme"], category: "meme", audit: { mintAuthorityDisabled: true, freezeAuthorityDisabled: true, topHoldersPct: 31, devBalancePct: 0.4, suspicious: false } }),
  [COPY]: marketOf(COPY, { symbol: "COPY", name: "A copy", decimals: 6, price: 0.5, liquidityUsd: 1_000, verified: false, tags: [], category: null, audit: { mintAuthorityDisabled: false, freezeAuthorityDisabled: null, topHoldersPct: 92, devBalancePct: 40, suspicious: true } }),
};

function listRow(market: SpotMarket): SpotMarketListRow {
  return { mint: market.mint, symbol: market.symbol, name: market.name, icon: market.icon, decimals: market.decimals, tokenProgram: market.tokenProgram, price: market.price, change24hPct: market.change24hPct, volume24hUsd: market.volume24hUsd, liquidityUsd: market.liquidityUsd, verified: market.verified, suspicious: market.audit.suspicious, category: market.category, issuer: market.issuer };
}

/* ------------------------------------------------------------ the stock universe */

function stockRow(input: Readonly<{ mint: string; symbol: string; name: string; issuer: keyof typeof STOCK_ISSUERS; klass: "listed-equity" | "pre-ipo"; price: number; reference: number | null; liquidity: number; underlying: { symbol: string; name: string }; note: string | null }>): StockRow {
  const share = input.klass === "listed-equity";
  return {
    representation: {
      mint: input.mint,
      symbol: input.symbol,
      name: input.name,
      issuer: STOCK_ISSUERS[input.issuer],
      issuerConfirmation: "issuer-catalogue",
      /* The issuer's own instrument (`ISSUER_INSTRUMENT`): a PreStocks token is economic exposure, never a loan participation. */
      instrument: { class: input.klass, unitBasis: share ? "share" : "token", rights: ISSUER_INSTRUMENT[input.issuer].rights },
      underlying: { symbol: input.underlying.symbol, isin: share ? "US67066G1040" : null, listingCountry: share ? "US" : null, name: input.underlying.name },
      companyKey: input.underlying.name.toLowerCase().replace(/[^a-z0-9]+/g, ""),
      exchange: share ? { mic: "XNAS", name: "Nasdaq", timezone: "America/New_York" } : null,
      tokenProgram: null,
      decimals: 8,
      tradingHalted: false,
      issuerUrl: null,
      issuerNote: input.note,
      sources: ["jupiter-verified", `${input.issuer}-catalogue`],
    },
    market: { priceUsd: input.price, change24hPct: 0.8, volume24hUsd: 2_400_000, liquidityUsd: input.liquidity, verified: true, observedAt: OBSERVED, icon: null },
    tokenPerShareUsd: share ? input.price : null,
    multiplier: share ? { current: 1, pending: null, effectiveAt: null } : null,
    multiplierState: share ? "active" : null,
    reference: input.reference === null ? { ...REFERENCE_UNAVAILABLE } : { state: "current", perShare: input.reference, currency: "USD", source: { id: "issuer-xstocks", label: "xStocks reference" }, observedAt: OBSERVED, fetchedAt: OBSERVED, note: null },
    session: share ? { period: "market", exchangeOpen: true, nextChangeAt: "2026-09-22T20:00:00.000Z", exchange: { mic: "XNAS", name: "Nasdaq", timezone: "America/New_York" }, source: "issuer" } : UNKNOWN_SESSION,
    deviationPct: input.reference === null ? null : Number((((input.price - input.reference) / input.reference) * 100).toFixed(2)),
    issuerMark: share ? null : { source: { id: "issuer-prestocks", label: "PreStocks" }, perUnit: 41, valuationUsd: 300_000_000_000, impliedValuationUsd: 310_000_000_000, supply: 1_000_000, holders: null, fetchedAt: OBSERVED },
    markPremiumPct: share ? null : 2.4,
    companyIndex: null,
    transferFee: null,
    lifecycle: { state: "active", tradable: true, source: "issuer-catalogue", observedAt: OBSERVED, url: null, recheckBy: null, deadlineAt: null },
  } as unknown as StockRow;
}

export const STOCK_ROWS: readonly StockRow[] = [
  stockRow({ mint: NVDAX, symbol: "NVDAx", name: "NVIDIA xStock", issuer: "xstocks", klass: "listed-equity", price: 212, reference: 211.4, liquidity: 1_000_000, underlying: { symbol: "NVDA", name: "NVIDIA" }, note: "Backed 1:1 by the share held with a custodian; dividends reinvested into the token; redemption through the issuer." }),
  stockRow({ mint: NVDAON, symbol: "NVDAon", name: "NVIDIA Ondo", issuer: "ondo", klass: "listed-equity", price: 213.1, reference: null, liquidity: 240_000, underlying: { symbol: "NVDA", name: "NVIDIA" }, note: null }),
  stockRow({ mint: OPENAI_PRESTOCKS, symbol: "OPENAI", name: "OpenAI PreStocks", issuer: "prestocks", klass: "pre-ipo", price: 42, reference: null, liquidity: 180_000, underlying: { symbol: "OPENAI", name: "OpenAI" }, note: "Economic exposure to the company through a holding entity: not a share, no shareholder rights; convertible into the tokenized public stock after an IPO, as the issuer's terms state." }),
];

export const UNIVERSE: StockUniverse = { rows: STOCK_ROWS, marketsObservedAt: OBSERVED, issuerCatalogue: { ok: true, reason: null }, issuerCatalogues: { xstocks: { ok: true, stale: false, fetchedAt: OBSERVED, reason: null }, prestocks: { ok: true, stale: false, fetchedAt: OBSERVED, reason: null } }, fetchedAt: OBSERVED };

export async function findRowFixture(tickerOrMint: string): Promise<{ ok: true; row: StockRow | null; universe: StockUniverse }> {
  const row = STOCK_ROWS.find((entry) => entry.representation.mint === tickerOrMint || entry.representation.symbol.toLowerCase() === tickerOrMint.toLowerCase()) ?? null;
  return { ok: true, row, universe: UNIVERSE };
}

export async function readMarketFixture(mint: string): Promise<{ ok: true; market: SpotMarket; observedAt: string; stale: boolean } | { ok: true; market: null; observedAt: string; stale: false }> {
  const market = MARKETS[mint];
  return market ? { ok: true, market, observedAt: FIXTURE_NOW, stale: false } : { ok: true, market: null, observedAt: FIXTURE_NOW, stale: false };
}

/* ------------------------------------------------------------ the evidence */

function snapshot(mint: string, symbol: string, provider: EvidenceProvider, window: EvidenceWindow, values: Partial<Record<EvidenceMetricId, number | null>>): MarketEvidenceSnapshot {
  const unitOf = (id: EvidenceMetricId) => (id.endsWith("_usd") ? "usd" : id.endsWith("_pct") ? "percent" : id === "holder_count" || id === "whale_wallet_count" ? "count" : "flag");
  return {
    provider,
    subject: { network: "solana:mainnet", mint, symbol },
    window,
    fetchedAt: "2026-09-22T09:50:00.000Z",
    observedAt: "2026-09-22T09:45:00.000Z",
    providerLagSeconds: 300,
    expiresAt: "2026-09-22T10:20:00.000Z",
    metrics: (Object.entries(values) as [EvidenceMetricId, number | null][]).map(([id, value]) => ({ id, value, unit: unitOf(id), window, coverage: "full", note: null })),
    warnings: [],
    attribution: providerRights(provider).attribution,
    rightsPolicy: `${provider}-v1`,
    families: ["fixture"],
  } as MarketEvidenceSnapshot;
}

const EVIDENCE: Readonly<Record<string, Partial<Record<EvidenceWindow, MarketEvidenceSnapshot>>>> = {
  [SOL]: {
    "24h": snapshot(SOL, "SOL", "nansen", "24h", { dex_volume_usd: 1_250_000_000, dex_net_volume_usd: 42_000_000, whale_net_flow_usd: 8_500_000, whale_wallet_count: 1_240, exchange_net_flow_usd: -3_200_000 }),
    "7d": snapshot(SOL, "SOL", "nansen", "7d", { dex_volume_usd: 8_100_000_000, dex_net_volume_usd: -12_000_000, whale_net_flow_usd: -22_000_000, whale_wallet_count: 1_180 }),
    now: snapshot(SOL, "SOL", "ddxyz", "now", { top10_holder_share_pct: 18.2, holder_count: 2_400_000, mint_authority: 0, freeze_authority: 0, transfer_tax_pct: 0 }),
  },
  [BONK]: {
    "24h": snapshot(BONK, "Bonk", "nansen", "24h", { dex_volume_usd: 42_000_000, dex_net_volume_usd: -6_000_000, whale_net_flow_usd: -1_900_000, whale_wallet_count: 96 }),
    now: snapshot(BONK, "Bonk", "ddxyz", "now", { top10_holder_share_pct: 31, holder_count: 880_000, mint_authority: 0, freeze_authority: 0, transfer_tax_pct: 0, sniper_holding_pct: 12.5, bundler_holding_pct: 3.1, dev_holding_pct: 0.4 }),
  },
};

export async function evidenceFixture(input: Readonly<{ mint: string; window: EvidenceWindow; provider?: EvidenceProvider }>): Promise<MarketEvidenceRead> {
  const found = EVIDENCE[input.mint]?.[input.window];
  if (found) return { state: "FRESH", snapshot: found, reason: null, served: "cache" };
  if (input.mint === COPY) return { state: "UNAVAILABLE", snapshot: null, reason: "The provider key is not configured.", served: "none" };
  return { state: "UNKNOWN", snapshot: null, reason: `${NANSEN_RIGHTS.attribution.text} covers no such token.`, served: "provider" };
}

/* ------------------------------------------------------------ the wallet */

export const FIXTURE_HOLDINGS: HoldingsRead = {
  ok: true,
  owner: FIXTURE_OWNER,
  observedAt: "2026-09-22T09:59:40.000Z",
  tokenRead: "COMPLETE",
  sourceHost: "rpc.fixture",
  holdings: [
    { kind: "NATIVE", mint: SOL, amountRaw: "3250000000", decimals: 9, symbol: "SOL", name: "Solana", catalog: { symbol: "SOL", name: "Wrapped SOL", usdPrice: "212.5", isVerified: true, category: "crypto" } },
    { kind: "TOKEN", mint: BONK, amountRaw: "12500000000000", decimals: 5, symbol: "Bonk", name: "Bonk", catalog: { symbol: "Bonk", name: "Bonk", usdPrice: "0.00001234", isVerified: true, category: "meme" } },
    { kind: "TOKEN", mint: NVDAX, amountRaw: "150000000", decimals: 8, symbol: "NVDAx", name: "NVIDIA xStock", catalog: { symbol: "NVDAx", name: "NVIDIA xStock", usdPrice: "212", isVerified: true, category: "stock" } },
    { kind: "TOKEN", mint: COPY, amountRaw: "999000000", decimals: 6, symbol: null, name: null, catalog: null },
  ],
};

export const FIXTURE_ACTIVITY: readonly SolanaWalletAction[] = [
  {
    schema: "ryntra.solana.wallet-action",
    schemaVersion: "1.0.0",
    version: 1,
    network: "mainnet",
    wallet: FIXTURE_OWNER,
    actionId: "swap_fixture_0001",
    lane: "SWAP",
    outcome: "DONE",
    out: { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", amountRaw: "25000000", decimals: 6, symbol: "USDC" },
    in: { mint: NVDAX, amountRaw: "11792452", decimals: 8, symbol: "NVDAx" },
    destination: "SOLANA",
    signature: "5".repeat(88),
    receiptHash: "a".repeat(64),
    sourceTx: null,
    destinationTx: null,
    fee: null,
    origin: null,
    providerRef: null,
    statedUsd: 25,
    startedAt: "2026-09-21T15:00:00.000Z",
    updatedAt: "2026-09-21T15:00:40.000Z",
  } as unknown as SolanaWalletAction,
  {
    schema: "ryntra.solana.wallet-action",
    schemaVersion: "1.0.0",
    version: 1,
    network: "mainnet",
    wallet: FIXTURE_OWNER,
    actionId: "send_fixture_0002",
    lane: "SEND",
    outcome: "IN_FLIGHT",
    out: { mint: SOL, amountRaw: "100000000", decimals: 9, symbol: "SOL" },
    in: null,
    destination: "SOLANA",
    signature: null,
    receiptHash: null,
    sourceTx: null,
    destinationTx: null,
    fee: null,
    origin: null,
    providerRef: null,
    statedUsd: null,
    startedAt: "2026-09-22T09:30:00.000Z",
    updatedAt: "2026-09-22T09:30:05.000Z",
  } as unknown as SolanaWalletAction,
];

/* ------------------------------------------------------------ the plans and the notes */

/** The example rules: NVDAx at $180, invalidated at $160, $100 of risk in a $1,000 budget; a token plan drops the reference rules. */
export function fixtureRules(overrides: Partial<PlanRules> = {}, token = false): PlanRules {
  return PlanRulesSchema.parse({
    thesis: { text: "Data-centre demand keeps the next two quarters above guidance.", whyNow: "Earnings in three weeks.", horizon: { unit: "weeks", value: 8 }, sources: [], assumptions: [] },
    entry: { pricePerShare: 180, maxPricePerShare: 185, validUntil: "2026-10-15T00:00:00.000Z" },
    capital: { budgetUsd: 1000, reserveForCostsUsd: 20 },
    risk: { invalidationPerShare: 160, plannedRiskUsd: 100, costBufferBps: 100 },
    exit: { targetPerShare: 230, timeExitAt: null, invalidationIsOrder: false },
    execution: { maxSlippageBps: 50, maxQuoteAgeSeconds: 60, maxReferenceDeviationPct: token ? null : 1.5, referenceRequired: !token, minLiquidityUsd: null },
    evidenceConditions: [],
    ...overrides,
  });
}

/* ------------------------------------------------------------ the public sources (AI-03) */

const READ_AT = "2026-09-22T09:59:00.000Z";

function pair(input: Readonly<{ base: string; quote: string; dex: string; address: string; price: number | null; liquidity: number; volume: [number, number, number, number]; change: [number, number, number, number]; buys: number; sells: number; side?: "base" | "quote" }>): DexPair {
  return {
    dex: input.dex,
    pairAddress: input.address,
    baseSymbol: input.base,
    quoteSymbol: input.quote,
    side: input.side ?? "base",
    major: true,
    priceUsd: input.price,
    liquidityUsd: input.liquidity,
    volumeUsd: { m5: input.volume[0], h1: input.volume[1], h6: input.volume[2], h24: input.volume[3] },
    changePct: input.side === "quote" ? { m5: null, h1: null, h6: null, h24: null } : { m5: input.change[0], h1: input.change[1], h6: input.change[2], h24: input.change[3] },
    txns: { h1: { buys: Math.round(input.buys / 24), sells: Math.round(input.sells / 24) }, h24: { buys: input.buys, sells: input.sells } },
    createdAt: "2023-06-30T06:20:58.000Z",
  };
}

export const FIXTURE_DEX_PAIRS: Readonly<Record<string, readonly DexPair[]>> = {
  [SOL]: [
    pair({ base: "SOL", quote: "USDC", dex: "orca", address: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE", price: 212.4, liquidity: 28_560_000, volume: [131_700, 6_200_000, 21_000_000, 59_200_000], change: [0.09, 1.1, 2.6, 3.3], buys: 41_200, sells: 33_000 }),
    pair({ base: "SOL", quote: "USDT", dex: "raydium", address: "3nMFwZXwY1s1M5s8vYAHqd4wGs4iSxXE4LRoUMMYqEgF", price: 212.6, liquidity: 9_100_000, volume: [40_000, 1_900_000, 7_000_000, 18_400_000], change: [0.1, 1.0, 2.5, 3.2], buys: 12_000, sells: 10_500 }),
  ],
  [BONK]: [pair({ base: "Bonk", quote: "SOL", dex: "raydium", address: "6oFWm7KPLfxnwMb3z5xwBoXNSPP3JJyirAPqPSiVcnsp", price: 0.00001234, liquidity: 1_790_000, volume: [2_000, 18_000, 120_000, 425_000], change: [-0.2, -0.8, -3.1, -6.1], buys: 2_100, sells: 2_600 })],
  /* AI-09: the market beside SOL in «what moved the price?». */
  ["cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij"]: [pair({ base: "cbBTC", quote: "USDC", dex: "orca", address: "HxA6SKW5qA4o12fjVgTpXdq2YnZ5Zv1s7SB4FFomsyLM", price: 61_250, liquidity: 12_400_000, volume: [20_000, 900_000, 3_100_000, 9_800_000], change: [0.05, 0.4, 1.0, 1.4], buys: 3_100, sells: 2_900 })],
  [COPY]: [pair({ base: "COPY", quote: "SOL", dex: "pumpswap", address: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin", price: 0.5, liquidity: 1_000, volume: [0, 50, 300, 1_200], change: [0, -2, -10, -40], buys: 12, sells: 30 })],
};

export const FIXTURE_REPORTS: Readonly<Record<string, RugCheckReport | null>> = {
  [SOL]: { risks: [], score: 1, lpLockedPct: null },
  [BONK]: { risks: [{ name: "Mutable metadata", level: "warn" }], score: 7, lpLockedPct: 16.1 },
  [COPY]: { risks: [{ name: "Mint Authority still enabled", level: "danger" }, { name: "Top 10 holders high ownership", level: "danger" }, { name: "Low Liquidity", level: "warn" }], score: 84, lpLockedPct: 0 },
};

/** Eight days of hourly SOL candles: a slow climb to $212.50 at the close of the fixture's hour. */
export function fixtureSolCandles(): readonly CandleBar[] {
  const last = Math.floor(Date.parse("2026-09-22T09:00:00.000Z") / 1000);
  const bars: CandleBar[] = [];
  for (let i = 191; i >= 0; i -= 1) {
    const close = Number((212.5 - i * 0.06 + (i % 5 === 0 ? -0.4 : 0.2)).toFixed(2));
    const open = Number((close - 0.05).toFixed(2));
    bars.push({ time: last - i * 3600, open, high: Number((close + 0.6).toFixed(2)), low: Number((open - 0.6).toFixed(2)), close: i === 0 ? 212.5 : close });
  }
  return bars;
}

export const FIXTURE_MOVERS: readonly MoverRow[] = [
  { mint: BONK, symbol: "Bonk", changePct: 18.4, volumeUsd: 42_000_000, liquidityUsd: 3_000_000, verified: true },
  { mint: COPY, symbol: "COPY", changePct: 240, volumeUsd: 9_000, liquidityUsd: 1_000, verified: false },
];

export function fixtureMarketDataReaders(): Pick<AgentReaders, "dexPairs" | "tokenReport" | "candles" | "movers" | "pools" | "launchHealth"> {
  return {
    async dexPairs(mint) {
      return { ok: true, pairs: FIXTURE_DEX_PAIRS[mint] ?? [], observedAt: READ_AT, stale: false };
    },
    async tokenReport(mint) {
      return { ok: true, report: mint in FIXTURE_REPORTS ? FIXTURE_REPORTS[mint] : null, observedAt: READ_AT, stale: false };
    },
    async candles(mint, timeframe) {
      if (mint !== SOL) return { ok: false, code: "THIN", reason: "No pool deep enough." };
      return { ok: true, timeframe, candles: fixtureSolCandles(), pool: { name: "SOL / USDC", dex: "Orca", reserveUsd: 28_560_000 }, observedAt: READ_AT, stale: false };
    },
    async movers(window) {
      return { ok: true, window, up: FIXTURE_MOVERS, down: [{ mint: SOL, symbol: "SOL", changePct: -1.2, volumeUsd: 1_250_000_000, liquidityUsd: 50_000_000, verified: true }], observedAt: READ_AT, stale: false };
    },
    async pools(mint) {
      if (mint !== SOL && mint !== BONK) return { ok: true, state: "current", pools: [], meaningful: 0, totals: { tvlUsd: null, volume24hUsd: null, fees24hUsd: null }, observedAt: READ_AT };
      return {
        ok: true,
        state: "current",
        pools: [{ kind: "dlmm", name: mint === SOL ? "SOL-USDC" : "BONK-SOL", address: "5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6", tvlUsd: mint === SOL ? 14_200_000 : 640_000, volume24hUsd: mint === SOL ? 88_000_000 : 1_900_000, fees24hUsd: mint === SOL ? 31_000 : 4_100 }],
        meaningful: mint === SOL ? 34 : 6,
        totals: { tvlUsd: mint === SOL ? 41_000_000 : 1_100_000, volume24hUsd: mint === SOL ? 160_000_000 : 3_200_000, fees24hUsd: mint === SOL ? 58_000 : 7_400 },
        observedAt: READ_AT,
      };
    },
    async launchHealth() {
      return { ok: true, health: null };
    },
  };
}

/* ------------------------------------------------------------ AI-09: the news */

export const FIXTURE_NEWS_COLLECTED = "2026-09-22T09:55:00.000Z";

const story = (id: string, title: string, source: string, publishedAt: string, topic: NewsDigest["stories"][number]["topic"], also = 0): NewsDigest["stories"][number] => ({ id, story: id, title, source, feedId: source.toLowerCase().replace(/\s+/g, ""), url: `https://www.theblock.co/news/${id}`, publishedAt, topic, also });

export const FIXTURE_NEWS: Readonly<Record<string, NewsDigest>> = {
  [SOL]: {
    schema: "ryntra.assistant.news-digest",
    schemaVersion: "1.0.0",
    mint: SOL,
    builtAt: FIXTURE_NEWS_COLLECTED,
    day: { stories: 2, sources: 2, topics: [{ topic: "upgrade", stories: 1 }, { topic: "etf", stories: 1 }] },
    stories: [
      story("nw_000000000000000000000001", "Solana sets a date for its next major upgrade", "The Block", "2026-09-22T07:40:00.000Z", "upgrade", 1),
      story("nw_000000000000000000000002", "Asset manager files for a staked SOL ETF", "CoinDesk", "2026-09-21T18:10:00.000Z", "etf"),
    ],
  },
  market: {
    schema: "ryntra.assistant.news-digest",
    schemaVersion: "1.0.0",
    mint: null,
    builtAt: FIXTURE_NEWS_COLLECTED,
    day: { stories: 1, sources: 1, topics: [{ topic: "macro", stories: 1 }] },
    stories: [story("nw_000000000000000000000003", "Bitcoin slides as rate cut hopes fade", "Decrypt", "2026-09-22T06:05:00.000Z", "macro")],
  },
};

/** The fixture news reader: a digest for SOL and the market, none for the rest; `stale` marks the collector late. */
export function fixtureNews(mint: string | null, options: Readonly<{ stale?: boolean; digests?: Readonly<Record<string, NewsDigest>>; tracked?: boolean; feeds?: Readonly<{ ok: number; total: number }> }> = {}): Promise<NewsRead> {
  const digests = options.digests ?? FIXTURE_NEWS;
  /* SOL, BONK and the market are tracked in the fixture world; anything else is not looked for. */
  const tracked = options.tracked ?? (mint === null || mint === SOL || mint === BONK);
  return Promise.resolve({ ok: true, digest: digests[mint ?? "market"] ?? null, stale: options.stale ?? false, collectedAt: FIXTURE_NEWS_COLLECTED, tracked, feeds: options.feeds ?? { ok: 8, total: 8 } });
}

export type FixtureWorld = Readonly<{ store: GuardStore; readers: AgentReaders; plans: Readonly<{ nvdax: string; sol: string }>; note: MonitorNote }>;

/**
 * The world: a memory store with two real plans of the wallet (NVDAx active
 * with a blocked Review kept; SOL active), one monitoring note about the
 * NVDAx plan, and readers over the fixtures above. Another wallet sees none
 * of it: the readers are keyed by the owner they are asked for.
 */
export async function createFixtureWorld(options: Readonly<{ store?: GuardStore; nowMs?: number; owner?: string }> = {}): Promise<FixtureWorld> {
  const store = options.store ?? createMemoryGuardStore();
  const nowMs = options.nowMs ?? FIXTURE_NOW_MS;
  const OWNER = options.owner ?? FIXTURE_OWNER;
  const HOLDINGS: HoldingsRead = FIXTURE_HOLDINGS.ok ? { ...FIXTURE_HOLDINGS, owner: OWNER } : FIXTURE_HOLDINGS;
  const ACTIVITY = FIXTURE_ACTIVITY.map((row) => ({ ...row, wallet: OWNER }));
  let ids = 0;
  /* The ids are the wallet's own, as a real plan's are: two fixture worlds in one stand must not share a plan id, or isolation cannot be tested. */
  const seed = createHash("sha256").update(`ryntra:fixture:${OWNER}`).digest("hex").slice(0, 30);
  const deps = { now: () => new Date(nowMs), findRow: findRowFixture, readMarket: readMarketFixture, planId: () => `${"plan_"}${seed}${String(++ids).padStart(2, "0")}` };
  const nvdax = await createPlan(store, { owner: OWNER, mint: NVDAX, rules: fixtureRules(), activate: true }, deps);
  if (!nvdax.ok) throw new Error(`fixture plan: ${nvdax.message}`);
  const sol = await createPlan(store, { owner: OWNER, mint: SOL, rules: fixtureRules({ entry: { pricePerShare: 200, maxPricePerShare: 205, validUntil: "2026-10-15T00:00:00.000Z" }, risk: { invalidationPerShare: 180, plannedRiskUsd: 50, costBufferBps: 100 }, capital: { budgetUsd: 600, reserveForCostsUsd: 6 }, exit: { targetPerShare: 260, timeExitAt: null, invalidationIsOrder: false } }, true), activate: true }, deps);
  if (!sol.ok) throw new Error(`fixture plan: ${sol.message}`);
  /* A Review the NVDAx plan kept: blocked on the maximum price and the modelled risk at $212 per share. */
  await recordPlanReview(
    store,
    {
      owner: OWNER,
      review: {
        planId: nvdax.plan.id,
        version: 1,
        latestVersion: 1,
        reviewId: "req_fixture_review_0001",
        checkedAt: "2026-09-22T09:40:00.000Z",
        verdict: "blocked",
        checks: [
          { id: "status", outcome: "pass", required: true, expected: "active", actual: "active" },
          { id: "entryPrice", outcome: "fail", required: true, expected: "≤ $185.00 per share", actual: "$212.00 per share" },
          { id: "risk", outcome: "fail", required: true, expected: "≤ $100.00 modelled loss", actual: "$254.40 modelled loss" },
          { id: "reference", outcome: "pass", required: true, expected: "current", actual: "current" },
        ],
        quote: { side: "BUY", usd: 1000, amount: "4.716981", unit: "underlying", multiplier: 1, perShareUsd: 212, referencePerShareUsd: 211.4, referenceState: "current", deviationPct: 0.28, priceImpactPct: 0.02, slippageBps: 50, feeBps: 50, observedAt: "2026-09-22T09:40:00.000Z", reviewExpiresAt: "2026-09-22T09:40:45.000Z", modelledLossUsd: 254.4, fitUsd: 393.08 },
      },
    },
    deps,
  );
  const note: MonitorNote = {
    id: "inb_fixture_0001",
    owner: OWNER,
    monitorId: "mon_fixture_0001",
    triggerId: "trg_fixture_0001",
    title: "NVDAx: the market is above your maximum price",
    reason: "The last price $212.00 per share is above the plan's maximum $185.00; a buy at this price would not pass the plan.",
    context: "NVDAx plan v1",
    href: `/app/strategies/plans/${nvdax.plan.id}`,
    cta: "Open the plan",
    paper: false,
    unread: true,
    createdAt: "2026-09-22T09:41:00.000Z",
    locale: "en",
    subject: { kind: "trading-plan", id: nvdax.plan.id },
    text: { en: { title: "NVDAx: the market is above your maximum price", reason: "The last price $212.00 per share is above the plan's maximum $185.00; a buy at this price would not pass the plan." }, uk: { title: "NVDAx: ринок вище твоєї максимальної ціни", reason: "Остання ціна $212.00 за акцію вище максимуму плану $185.00; купівля за цією ціною не пройшла б план." } },
    finding: { kind: "plan.price_bound", outcome: "fail", facts: { symbol: "NVDAx", price: 212, bound: 185, invalidation: 160, observedAt: "2026-09-22T09:40:00.000Z" } },
  };
  const surfaceFor = (owner: string, locale: "en" | "uk"): MonitoringSurface => {
    if (owner !== OWNER) return { attention: [], watching: [], recent: [], unread: 0 };
    const words = note.text![locale];
    return {
      attention: [{ monitorId: note.monitorId, label: "NVDAx", status: "needs_attention", title: words.title, reason: words.reason, href: note.href, cta: note.cta, paper: false, lastCheckedAt: "2026-09-22T09:40:00.000Z", lastTriggeredAt: note.createdAt, subject: note.subject!, finding: note.finding! }],
      watching: [{ monitorId: "mon_fixture_0002", label: "SOL", status: "watching", title: locale === "uk" ? "SOL: стежимо" : "SOL: watching", reason: "", href: `/app/strategies/plans/${sol.plan.id}`, cta: "", paper: false, lastCheckedAt: "2026-09-22T09:40:00.000Z", lastTriggeredAt: null, subject: { kind: "trading-plan", id: sol.plan.id }, finding: null }],
      recent: [{ ...note, title: words.title, reason: words.reason }],
      unread: 1,
    };
  };
  const readers: AgentReaders = {
    spotMarket: readMarketFixture,
    async spotSearch(query) {
      const rows = Object.values(MARKETS).filter((market) => market.symbol.toLowerCase().includes(query.toLowerCase()) || market.name.toLowerCase().includes(query.toLowerCase())).map(listRow);
      return { ok: true, rows, observedAt: FIXTURE_NOW, stale: false };
    },
    stockRow: findRowFixture,
    evidence: evidenceFixture,
    async holdings(owner) {
      return owner === OWNER ? HOLDINGS : { ok: true, owner, holdings: [], tokenRead: "COMPLETE", observedAt: FIXTURE_NOW, sourceHost: "rpc.fixture" };
    },
    plans: (owner) => listPlans(store, owner, deps),
    async plan(owner, planId) {
      const read = await getPlan(store, owner, planId, deps);
      if (!read.ok) return { ok: false, code: read.code, message: read.message };
      const record = await readTradingPlan(store, owner, planId);
      return { ok: true, plan: read.plan, reviews: record?.reviews ?? [], sync: read.sync };
    },
    async planResults(owner, planId) {
      const read = await getPlanResults(store, owner, planId, deps);
      return read.ok ? { ok: true, results: read.results, sync: read.sync } : { ok: false, code: read.code, message: read.message };
    },
    async planMemory(owner) {
      const { listPlanMemory } = await import("../plans/service.ts");
      return listPlanMemory(store, owner, owner === OWNER ? [note] : [], deps);
    },
    async planAsset(mint) {
      const { readPlanAsset } = await import("../plans/service.ts");
      const read = await readPlanAsset(mint, deps);
      return read.ok ? { ok: true, read: read.read } : { ok: false, code: read.code, message: read.message };
    },
    async activity(owner) {
      return owner === OWNER ? ACTIVITY : [];
    },
    async watchlist(owner) {
      return owner === OWNER ? [SOL, BONK] : [];
    },
    async monitoring(owner, locale) {
      return surfaceFor(owner, locale);
    },
    async inboxNote(owner, inboxId) {
      return owner === OWNER && inboxId === note.id ? note : null;
    },
    ...fixtureMarketDataReaders(),
    /* AI-09: the news world — a digest for SOL and one of the market; BONK has none. */
    async news(mint) {
      return fixtureNews(mint);
    },
  };
  return { store, readers, plans: { nvdax: nvdax.plan.id, sol: sol.plan.id }, note };
}
