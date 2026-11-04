/**
 * CITY-193 — a strategy tested before a lamport moves: on history, or on paper since a moment (`./backtest.ts`). The
 * candles are the city's own chart's (`lib/spot/candles.server.ts`: the deepest pool, in dollars, GeckoTerminal's public
 * OHLCV), read with its cache and its rate discipline; a coin without them is not tested — never on bars from somewhere
 * else, never on a guess.
 *
 * Server only. Public data; it holds no key, signs nothing and places nothing.
 */

import { barsOf, paperRun, runPlan, runTimeframe, type RunResult } from "./backtest.ts";
import { BUDGET_PRESETS, type BudgetPresetId } from "./presets.ts";
import type { StrategyPlan } from "./plans.ts";

type Candles = (mint: string, timeframe: "5m" | "15m" | "1h") => Promise<Readonly<{ ok: true; candles: readonly Readonly<{ time: number; open: number; high: number; low: number; close: number }>[] }> | Readonly<{ ok: false }>>;

export type TestAnswer = Readonly<{ ok: true; mode: "history" | "paper"; timeframe: string; result: RunResult }> | Readonly<{ ok: false; code: "NO_HISTORY" | "TOO_YOUNG" }>;

/** The fewest closed candles a run on history stands on: a day of hours. */
export const HISTORY_MIN_BARS = 24;

export async function testPlan(
  input: Readonly<{ coin: string; plan: StrategyPlan; preset: BudgetPresetId; since: number | null; bornAt: number | null; sells?: boolean }>,
  deps: Readonly<{ candles?: Candles; now?: () => number }> = {},
): Promise<TestAnswer> {
  const now = (deps.now ?? Date.now)();
  const read = deps.candles ?? (async (mint, timeframe) => (await import("../spot/candles.server.ts")).readSpotCandles(mint, timeframe, "page"));
  /* An early plan's launch is hours old: its history is read in five minutes, as a practice's first day is. */
  const { timeframe, barMs } = input.since === null && input.plan.id === "early" ? runTimeframe(now, now) : runTimeframe(input.since, now);
  const answer = await read(input.coin, timeframe).catch(() => ({ ok: false as const }));
  if (!answer.ok) return { ok: false, code: "NO_HISTORY" };
  const bars = barsOf(answer.candles, barMs, now);
  const preset = BUDGET_PRESETS[input.preset];
  const budget = { perTrade: Number(preset.perTrade) / 1e9, perDay: Number(preset.perDay) / 1e9, days: preset.days };
  if (input.since !== null) {
    const paper = { plan: "", coin: input.coin, symbol: null, startedAt: input.since, bornAt: input.bornAt };
    return { ok: true, mode: "paper", timeframe, result: paperRun(input.plan, paper, bars, budget, now, { barMs, sells: input.sells ?? false }) };
  }
  if (bars.length < HISTORY_MIN_BARS && input.plan.id !== "early") return { ok: false, code: "TOO_YOUNG" };
  /* An early plan on history: its launch's own first hours, from its first candle. */
  return { ok: true, mode: "history", timeframe, result: runPlan(input.plan, bars, budget, { barMs, sells: input.sells ?? false, bornAt: input.plan.id === "early" ? (input.bornAt ?? bars[0]?.t ?? null) : null }) };
}
