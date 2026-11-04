/**
 * The rules Ryntra's bot tools follow (CITY-133, B3). Pure: every figure
 * comes in from the engine — its weather, its backtest on its own candles,
 * its Hangar — and what is decided here is which of the engine's bots to
 * name for a horizon, whether the costs eat the amount, and what a bot's
 * Hangar row says about its result. No clock, no store, no words (the tools
 * write the words), and nothing here signs or sends.
 */

import { backtest, type Backtest } from "../../bots/backtest/backtest.ts";
import type { BacktestPeriod, Candle } from "../../bots/backtest/candles.ts";
import type { ExecutionCosts } from "../../bots/backtest/sim.ts";
import type { HangarBot } from "../../bots/hangar/hangar.ts";
import type { Fit, Weather } from "../../bots/weather/weather.ts";
import { ASSISTANT_BOT_KINDS, ENGINE_WEATHER_BOT, GOAL_BOTS, HORIZON_SUITS, type AssistantBotKind, type AssistantGoal, type Horizon, type SimDays } from "./kinds.ts";
import { engineSetting, type Plan } from "./plan.ts";

/* ------------------------------------------------------------------ candidates */

const FIT_SCORE: Readonly<Record<Fit, number | null>> = { good: 2, fair: 1, poor: null };

export type Candidate = Readonly<{ kind: AssistantBotKind; fit: Fit; score: number }>;

/**
 * The engine's bots for a horizon, best first: a bot the engine rates `poor` now is never named, nor one that does
 * not suit the horizon at all. A goal keeps to its own bots. Ties keep the window's order (grid, ladders, recurring).
 */
export function rankCandidates(weather: Weather, horizon: Horizon, goal: AssistantGoal | null = null): Candidate[] {
  const kinds = goal ? GOAL_BOTS[goal] : ASSISTANT_BOT_KINDS;
  const out: Candidate[] = [];
  for (const kind of kinds) {
    const fit = weather.fit[ENGINE_WEATHER_BOT[kind]].fit;
    const fitScore = FIT_SCORE[fit];
    const suits = HORIZON_SUITS[kind][horizon];
    if (fitScore === null || suits === 0) continue;
    out.push({ kind, fit, score: fitScore * 2 + suits });
  }
  return out.sort((a, b) => b.score - a.score || ASSISTANT_BOT_KINDS.indexOf(a.kind) - ASSISTANT_BOT_KINDS.indexOf(b.kind));
}

/* ------------------------------------------------------------------ one window of the engine's backtest */

/** The engine's bars for each simulated window: hours for a week, four hours for a month, days for half a year. */
export const WINDOW_BARS: Readonly<Record<SimDays, Readonly<{ timeframe: "1h" | "4h" | "1d"; barHours: number; bars: number; period: BacktestPeriod }>>> = {
  7: { timeframe: "1h", barHours: 1, bars: 168, period: "7d" },
  30: { timeframe: "4h", barHours: 4, bars: 180, period: "30d" },
  180: { timeframe: "1d", barHours: 24, bars: 180, period: "180d" },
};

/** Less of a window than this is not replayed: a young coin's month is not a month. */
export const MIN_COVERAGE = 0.5;

/**
 * The share of the amount the costs may take before a bot is «not worth it» — the engine's own line
 * (`NOT_WORTH_SHARE` in `lib/bots/backtest/preflight.ts`, kept equal by a test; not imported, so this module's
 * imports stay the engine's pure reads).
 */
export const COSTS_EAT_SHARE = 0.02;

export type CostCheck = Readonly<{
  /** Pool and protocol fees paid — they scale with the amount. */
  feesUsd: number;
  /** Price lost to slippage — it scales with the amount. */
  slippageUsd: number;
  /** The network's signature and priority fees — per transaction, they do not. */
  networkUsd: number;
  totalUsd: number;
  /** Costs against the amount, percent. */
  sharePct: number;
  worth: boolean;
  /** The amount from which the costs stop eating it; null when what scales already passes the line. */
  fromUsd: number | null;
}>;

export function costCheck(costs: Backtest["result"]["costs"], amountUsd: number, share: number = COSTS_EAT_SHARE): CostCheck {
  const feesUsd = costs.protocolUsd;
  const slippageUsd = costs.slippageUsd;
  const networkUsd = costs.networkUsd + costs.priorityUsd;
  const totalUsd = feesUsd + slippageUsd + networkUsd;
  const sharePct = amountUsd > 0 ? (totalUsd / amountUsd) * 100 : Number.POSITIVE_INFINITY;
  const scaling = amountUsd > 0 ? (feesUsd + slippageUsd) / amountUsd : Number.POSITIVE_INFINITY;
  const room = share - scaling;
  return { feesUsd, slippageUsd, networkUsd, totalUsd, sharePct, worth: totalUsd <= amountUsd * share, fromUsd: room > 0 ? Math.ceil(networkUsd / room) : null };
}

export type WindowRun =
  | Readonly<{
      days: SimDays;
      ok: true;
      /** What the bot made or lost over the window, costs out, USD. */
      netUsd: number;
      /** The bot against putting the same amount into the coin at the window's start and holding it, USD. */
      vsHoldUsd: number;
      holdNetUsd: number;
      costs: CostCheck;
      feesEarnedUsd: number;
      worstDrawdownPct: number;
      /** The engine's dollar stress test on where the bot ends. */
      stress: Readonly<{ shockPct: number; lossUsd: number }>;
      /** Walk-forward: the setting fitted on each part, run on the next — without hindsight; null when too short. */
      walkForwardNetUsd: number | null;
      /** A grid's figures: candles cannot replay a bin's crossings exactly. */
      approximate: boolean;
      /** The share of the window's bars the engine holds, 0–1. */
      coverage: number;
      fills: number;
      from: number;
      to: number;
    }>
  | Readonly<{ days: SimDays; ok: false; reason: "short" | "not_read" }>;

/** One window of the engine's backtest of a plan, on the engine's own candles of that window. */
export function runWindow(days: SimDays, candles: readonly Candle[] | null, plan: Plan, amountUsd: number, symbol: string, costs: ExecutionCosts): WindowRun {
  if (candles === null) return { days, ok: false, reason: "not_read" };
  const shape = WINDOW_BARS[days];
  const bars = candles.slice(-shape.bars);
  const coverage = Math.min(1, bars.length / shape.bars);
  if (coverage < MIN_COVERAGE || bars.length < 10) return { days, ok: false, reason: "short" };
  const setting = engineSetting(plan, amountUsd, bars[0]!.o, bars.length, shape.barHours);
  const run = setting ? backtest(bars, setting, { period: shape.period, symbol, costs }) : null;
  if (!run) return { days, ok: false, reason: "short" };
  const holdEnd = run.hold?.endUsd ?? run.result.holdUsd;
  return {
    days,
    ok: true,
    netUsd: run.result.pnlUsd,
    vsHoldUsd: run.result.endUsd - holdEnd,
    holdNetUsd: holdEnd - run.result.startUsd,
    costs: costCheck(run.result.costs, amountUsd),
    feesEarnedUsd: run.result.feesEarnedUsd,
    worstDrawdownPct: run.result.maxDrawdownPct,
    stress: { shockPct: run.stress.shockPct, lossUsd: run.stress.lossUsd },
    walkForwardNetUsd: run.walkForward ? run.walkForward.pnlUsd : null,
    approximate: run.approximate,
    coverage,
    fills: run.result.fills,
    from: run.result.from,
    to: run.result.to,
  };
}

/* ------------------------------------------------------------------ «why is my bot where it is» */

export type BotCause = "range_above" | "range_below" | "needs_you" | "behind" | "ahead" | "unpriced" | "done";

export type BotReading = Readonly<{
  cause: BotCause;
  /** Against holding what went in, USD, and the days it covers; null — not priced. */
  vsHoldUsd: number | null;
  days: number | null;
  feesUsd: number | null;
}>;

const daysOf = (from: string, to: string): number => Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) || 1);

/**
 * What a bot's Hangar row says: a grid or range whose price left it (above — all sold; below — all bought), a bot
 * that waits for the person, a bot behind or ahead of holding what went in — never more than its own figures show.
 */
export function readBot(bot: HangarBot): BotReading {
  const vsHoldUsd = bot.vsHold ? bot.vsHold.usd : null;
  const days = bot.vsHold ? daysOf(bot.vsHold.from, bot.vsHold.to) : null;
  const base = { vsHoldUsd, days, feesUsd: bot.feesUsd };
  if (bot.status === "out_of_range") return { ...base, cause: bot.detail === "above" ? "range_above" : "range_below" };
  if (bot.status === "needs_you") return { ...base, cause: "needs_you" };
  if (bot.status === "closed" || bot.status === "filled") return { ...base, cause: "done" };
  if (vsHoldUsd === null) return { ...base, cause: "unpriced" };
  return { ...base, cause: vsHoldUsd < 0 ? "behind" : "ahead" };
}

export type HangarSummary = Readonly<{
  live: number;
  /** Bots with a result against holding; the rest are counted, not summed. */
  measured: number;
  vsHoldUsd: number | null;
  best: HangarBot | null;
  worst: HangarBot | null;
  /** Bots that wait for the person or stand out of their range: the one thing worth a look. */
  attention: HangarBot | null;
}>;

/** The wallet's bots in one reading — the report Ryntra gives: against holding, the best and the worst, what needs a look. */
export function summarizeHangar(bots: readonly HangarBot[]): HangarSummary {
  const live = bots.filter((b) => b.status !== "closed" && b.status !== "filled");
  const measured = live.filter((b) => b.vsHold !== null);
  const sorted = [...measured].sort((a, b) => (b.vsHold?.usd ?? 0) - (a.vsHold?.usd ?? 0));
  const attention = live.find((b) => b.status === "needs_you") ?? live.find((b) => b.status === "out_of_range") ?? null;
  return {
    live: live.length,
    measured: measured.length,
    vsHoldUsd: measured.length ? measured.reduce((sum, b) => sum + (b.vsHold?.usd ?? 0), 0) : null,
    best: sorted[0] ?? null,
    worst: sorted.length > 1 ? sorted[sorted.length - 1]! : null,
    attention,
  };
}
