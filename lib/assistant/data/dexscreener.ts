/**
 * DexScreener — a token's DEX pairs as the assistant reads them (AI-03).
 *
 * The public `token-pairs/v1/solana/{mint}` answer — every pool the index
 * knows for the mint, free and keyless (300 requests a minute) — parsed into
 * the few figures a person asks about: each pair's venue, depth, volume over
 * 5 min / 1 h / 6 h / 24 h, price change over the same windows and the count
 * of buys and sells. Only Solana pairs that hold this exact mint are kept; a
 * price and a change are the mint's only where the mint is the pair's base —
 * where it is the quote side, the pair's price is another token's and is
 * dropped, never inverted.
 *
 * Anyone can open a pool against a token of their own and print any depth
 * and any move in it (JUP against a fresh token showed «$1.1B» and
 * «+508,227 %» on 17.10). So the figures a person reads stand on the pairs
 * against USDC, USDT or SOL only; the rest are counted, never summed.
 *
 * Every string from the answer is a label from someone else's index: it is
 * cut to a short run of plain characters before it reaches a sentence.
 *
 * Pure: an answer in, pairs out; no fetch, no clock.
 */

import { disguised, instructionLike } from "../../world/text-safety/clean.ts";

export const DEXSCREENER_BASE_URL = "https://api.dexscreener.com";
export const DEXSCREENER_SOURCE = "DexScreener";
export const DEX_PAIRS_MAX = 30;

/** The counter-assets a pair's figures are trusted against: dollars and SOL. */
export const MAJOR_QUOTES: Readonly<Record<string, string>> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: "USDC",
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: "USDT",
  So11111111111111111111111111111111111111112: "SOL",
};

export type DexWindows = Readonly<{ m5: number | null; h1: number | null; h6: number | null; h24: number | null }>;
export type DexTxns = Readonly<{ buys: number | null; sells: number | null }>;

export type DexPair = Readonly<{
  dex: string;
  pairAddress: string;
  baseSymbol: string;
  quoteSymbol: string;
  /** Whether the mint is the pair's base (its price and change are the mint's) or its quote. */
  side: "base" | "quote";
  /** The other side is USDC, USDT or SOL: the pair's figures count. */
  major: boolean;
  priceUsd: number | null;
  liquidityUsd: number | null;
  volumeUsd: DexWindows;
  /** Percent, the source's scale (1.5 = +1.5 %); null where the mint is the quote side. */
  changePct: DexWindows;
  txns: Readonly<{ h1: DexTxns; h24: DexTxns }>;
  createdAt: string | null;
}>;

export type DexPairsSummary = Readonly<{
  pairs: readonly DexPair[];
  /** The pairs against USDC, USDT or SOL — the ones whose figures are said. */
  majors: readonly DexPair[];
  /** The deepest of those where the mint is the base; null when there is none. */
  top: DexPair | null;
  /** Those pairs' 24h volume added up — one source, one moment, the same unit; null when none states it. */
  volume24hUsd: number | null;
}>;

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * A label from someone else's index — a symbol, a venue, a pool's name — as a
 * short run of plain characters: no line breaks, no markup, no quotes, cut to
 * `max`. Every external label the assistant says passes through here. A label
 * that hides a disguised word, or reads as an order to a model, is not said at
 * all (CITY-73): the fallback stands in for it.
 */
export function label(value: unknown, fallback = "?", max = 24): string {
  if (typeof value !== "string" || disguised(value) || instructionLike(value)) return fallback;
  const text = value.normalize("NFKC").replace(/[^\p{L}\p{N} ._$+/-]/gu, "").replace(/\s+/g, " ").trim().slice(0, max).trim();
  return text.length > 0 ? text : fallback;
}

function num(value: unknown): number | null {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
}

function nonNegative(value: unknown): number | null {
  const parsed = num(value);
  return parsed !== null && parsed >= 0 ? parsed : null;
}

function windows(raw: unknown, read: (value: unknown) => number | null): DexWindows {
  const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return { m5: read(row.m5), h1: read(row.h1), h6: read(row.h6), h24: read(row.h24) };
}

function txns(raw: unknown): DexTxns {
  const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return { buys: nonNegative(row.buys), sells: nonNegative(row.sells) };
}

const NO_WINDOWS: DexWindows = { m5: null, h1: null, h6: null, h24: null };

/** The answer's pairs for one mint: Solana pairs holding the mint, deepest first, at most `DEX_PAIRS_MAX`. */
export function parseDexPairs(body: unknown, mint: string): readonly DexPair[] {
  const rows = Array.isArray(body) ? body : body && typeof body === "object" && Array.isArray((body as { pairs?: unknown }).pairs) ? (body as { pairs: unknown[] }).pairs : [];
  const out: DexPair[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    if (row.chainId !== "solana") continue;
    const base = row.baseToken && typeof row.baseToken === "object" ? (row.baseToken as Record<string, unknown>) : {};
    const quote = row.quoteToken && typeof row.quoteToken === "object" ? (row.quoteToken as Record<string, unknown>) : {};
    const side = base.address === mint ? "base" : quote.address === mint ? "quote" : null;
    if (side === null) continue;
    const counter = side === "base" ? quote.address : base.address;
    const pairAddress = typeof row.pairAddress === "string" && ADDRESS.test(row.pairAddress) ? row.pairAddress : null;
    if (pairAddress === null) continue;
    const created = num(row.pairCreatedAt);
    const liquidity = row.liquidity && typeof row.liquidity === "object" ? (row.liquidity as Record<string, unknown>) : {};
    const tx = row.txns && typeof row.txns === "object" ? (row.txns as Record<string, unknown>) : {};
    out.push({
      dex: label(row.dexId),
      pairAddress,
      baseSymbol: label(base.symbol),
      quoteSymbol: label(quote.symbol),
      side,
      major: typeof counter === "string" && counter in MAJOR_QUOTES,
      priceUsd: side === "base" ? nonNegative(row.priceUsd) : null,
      liquidityUsd: nonNegative(liquidity.usd),
      volumeUsd: windows(row.volume, nonNegative),
      changePct: side === "base" ? windows(row.priceChange, num) : NO_WINDOWS,
      txns: { h1: txns(tx.h1), h24: txns(tx.h24) },
      createdAt: created !== null && created > 0 ? new Date(created).toISOString() : null,
    });
  }
  /* The trusted pairs first, deepest first within each group. */
  return out.sort((a, b) => Number(b.major) - Number(a.major) || (b.liquidityUsd ?? -1) - (a.liquidityUsd ?? -1)).slice(0, DEX_PAIRS_MAX);
}

export function summariseDexPairs(pairs: readonly DexPair[]): DexPairsSummary {
  const majors = pairs.filter((pair) => pair.major);
  const top = majors.filter((pair) => pair.side === "base").sort((a, b) => (b.liquidityUsd ?? -1) - (a.liquidityUsd ?? -1))[0] ?? null;
  const volumes = majors.map((pair) => pair.volumeUsd.h24).filter((value): value is number => value !== null);
  return { pairs, majors, top, volume24hUsd: volumes.length > 0 ? volumes.reduce((sum, value) => sum + value, 0) : null };
}

export function dexPairsUrl(mint: string): string {
  return `${DEXSCREENER_BASE_URL}/token-pairs/v1/solana/${mint}`;
}
