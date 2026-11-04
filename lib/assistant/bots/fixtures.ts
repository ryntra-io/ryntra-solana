/**
 * Fixtures of the bot tools (CITY-133) — for the tests and the review's
 * screens only, never a production read: candles of a ranging and a
 * trending market drawn from a seeded walk, readers over them, and a
 * wallet's Hangar answer as the engine gives it. Deterministic: the same
 * seed draws the same market.
 */

import type { Candle } from "../../bots/backtest/candles.ts";
import type { HangarAnswer } from "../../bots/hangar/hangar.ts";
import type { BotsCandles, BotsReaders, BotsTimeframe } from "./tools.ts";

export const FIXTURE_NOW_MS = Date.parse("2026-10-31T12:00:00.000Z");
export const FIXTURE_SOL = "So11111111111111111111111111111111111111112";
export const FIXTURE_JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
export const FIXTURE_WALLET = "7kPfjp3MRJ6gX2pQnyQ8NdXyb8bA2HQb4kq6hQbd9mUr";

const BAR_MS: Readonly<Record<BotsTimeframe, number>> = { "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000 };
const BARS: Readonly<Record<BotsTimeframe, number>> = { "1h": 300, "4h": 300, "1d": 366 };

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export type MarketShape = "range" | "trend_up" | "trend_down";

/**
 * Bars that end at `price` on `endMs`: a range swings around the price inside a channel; a trend climbs (or falls)
 * steadily toward it. Each bar's high and low wrap its open and close.
 */
export function syntheticCandles(args: Readonly<{ price: number; shape: MarketShape; timeframe: BotsTimeframe; endMs?: number; seed?: number; bars?: number }>): Candle[] {
  const bars = args.bars ?? BARS[args.timeframe];
  const barMs = BAR_MS[args.timeframe];
  const end = Math.floor((args.endMs ?? FIXTURE_NOW_MS) / barMs) * barMs;
  const random = mulberry32(args.seed ?? 7);
  const hours = barMs / 3_600_000;
  const swing = 0.006 * Math.sqrt(hours);
  const closes: number[] = [];
  for (let i = 0; i < bars; i += 1) {
    const x = i / (bars - 1);
    const noise = (random() - 0.5) * 2 * swing;
    let level: number;
    if (args.shape === "range") level = 1 + 0.02 * Math.sin(i / 1.5) + 0.012 * Math.sin(i / 45) + noise;
    else if (args.shape === "trend_up") level = 0.55 + 0.45 * x + noise * 0.6;
    else level = 1.6 - 0.6 * x + noise * 0.6;
    closes.push(level);
  }
  const scale = args.price / closes[closes.length - 1]!;
  const out: Candle[] = [];
  let open = closes[0]! * scale;
  closes.forEach((level, i) => {
    const c = level * scale;
    const wick = Math.abs(c - open) * 0.4 + c * swing * 0.3 * random();
    out.push({ t: end - (bars - 1 - i) * barMs, o: open, h: Math.max(open, c) + wick, l: Math.max(1e-12, Math.min(open, c) - wick), c });
    open = c;
  });
  return out;
}

/** Readers over drawn markets, one shape a coin; a coin not listed has no chart. */
export function fixtureReaders(
  markets: Readonly<Record<string, Readonly<{ price: number; shape: MarketShape; symbol: string; seed?: number }>>>,
  extra: Partial<BotsReaders> = {},
): BotsReaders & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    candles: async (mint: string, timeframe: BotsTimeframe): Promise<BotsCandles | null> => {
      calls.push(`candles:${mint}:${timeframe}`);
      const market = markets[mint];
      if (!market) return null;
      return { candles: syntheticCandles({ price: market.price, shape: market.shape, timeframe, seed: market.seed }), observedAt: new Date(FIXTURE_NOW_MS).toISOString(), stale: false };
    },
    symbol: async (mint) => markets[mint]?.symbol ?? null,
    now: () => FIXTURE_NOW_MS,
    ...extra,
  };
}

/** A wallet's Hangar as the engine answers it: a grid out of its range below, an exit ladder ahead of holding, a range behind. */
export function fixtureHangar(wallet: string = FIXTURE_WALLET, at: number = FIXTURE_NOW_MS): HangarAnswer {
  const day = 86_400_000;
  const iso = (ms: number) => new Date(ms).toISOString();
  return {
    wallet,
    at,
    bots: [
      {
        id: "grid:8yQ9mU7vBz5Zt7GdV3w6Jr6V3d9cfu5o3Mt1WQnD2a3K",
        kind: "grid",
        venue: "meteora_dlmm",
        name: "SOL/USDC",
        status: "out_of_range",
        detail: "below",
        vsHold: { usd: -4.18, pct: -1.7, from: iso(at - 12 * day), to: iso(at) },
        feesUsd: 2.4,
        lastFill: null,
        filler: "pool_swaps",
        noRyntraSignature: true,
        legs: null,
        refs: { position: "8yQ9mU7vBz5Zt7GdV3w6Jr6V3d9cfu5o3Mt1WQnD2a3K" },
      },
      {
        id: "ladder:sell:JUP",
        kind: "ladder",
        venue: "meteora_dlmm",
        name: "JUP/USDC",
        status: "partial",
        detail: null,
        vsHold: { usd: 3.05, pct: 2.9, from: iso(at - 9 * day), to: iso(at) },
        feesUsd: null,
        lastFill: null,
        filler: "pool_swaps",
        noRyntraSignature: true,
        legs: { total: 4, filled: 1, pending: 3, closed: 0 },
        refs: { orders: [] },
      },
      {
        id: "range_lp:3fZ5gJ1wV2qX9r8T7y6U5i4O3p2A1s9D8f7G6h5J4k3L",
        kind: "range_lp",
        venue: "meteora_damm_v2",
        name: "SOL/USDC",
        status: "working",
        detail: null,
        vsHold: { usd: -1.12, pct: -0.9, from: iso(at - 5 * day), to: iso(at) },
        feesUsd: 0.65,
        lastFill: null,
        filler: "pool_swaps",
        noRyntraSignature: true,
        legs: null,
        refs: { position: "3fZ5gJ1wV2qX9r8T7y6U5i4O3p2A1s9D8f7G6h5J4k3L" },
      },
    ],
    issues: [],
    sunset: null,
    read: { positions: true, orders: true, rules: false },
  };
}
