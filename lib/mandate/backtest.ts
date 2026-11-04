/**
 * CITY-193 — a strategy of the agent run on history, and the practice without money. Pure: candles in, figures out; the reads are the route's.
 *
 * The run is the agent itself, pass by pass at each candle's close: the same caps and rhythm (`./strategy.ts`), the same
 * rule of the plan (`./plans.ts` `ruleOf`), the same autostop thresholds (`AUTOSTOP`). Every buy is the trade cap, its
 * cost counted — Ryntra's fee, the route's slippage, the network's fee. It stands against plain holding: the same money,
 * all of it in at the first candle.
 *
 * What it is and is not:
 * - a picture of what the rules would have done on those candles, never a promise of what they will do;
 * - prices are the deepest pool's in dollars (`lib/spot/candles.server.ts`), so SOL's own move is left out;
 * - a candle shows four prices, not every trade in it: the agent is taken to see the close only;
 * - `sells` — where the engine can sell, an exit or a grid's step up sells at that close; where it cannot (mainnet today,
 *   CITY-195), the agent stops buying and holds, and the run does the same.
 *
 * Floats: a picture, never a sum a transaction is sized from.
 */

import { exitOf, gridSells, ruleOf, type ExitReason, type Mark, type StrategyPlan } from "./plans.ts";
import { AUTOSTOP, steadyRhythm, type PauseReason } from "./strategy.ts";

/** A candle: open time, ms; prices in one unit. */
export type Bar = Readonly<{ t: number; o: number; h: number; l: number; c: number }>;

export type RunBudget = Readonly<{
  /** SOL a buy, SOL a day, and how many days the mandate lasts. */
  perTrade: number;
  perDay: number;
  days: number;
}>;

export type RunCosts = Readonly<{
  /** Ryntra's fee on each trade, basis points (the agent's table: 1 % on a new coin). */
  feeBps: number;
  /** What a trade loses to the route, basis points. */
  slippageBps: number;
  /** The network's fee of one trade, SOL. */
  networkSol: number;
}>;

export const RUN_COSTS: RunCosts = Object.freeze({ feeBps: 100, slippageBps: 50, networkSol: 0.000_105 });

export type RunTrade = Readonly<{ at: number; side: "buy" | "sell"; price: number; sol: number; level?: number }>;

export type RunResult = Readonly<{
  bars: number;
  fromMs: number;
  toMs: number;
  buys: number;
  sells: number;
  /** SOL put in by the buys, and SOL the sales brought back. */
  spentSol: number;
  gotSol: number;
  /** The coins still held, worth at the last close, SOL. */
  heldSol: number;
  /** (held + got − spent − network) ÷ spent; null when nothing was bought. */
  resultPct: number | null;
  /** The same money, all in at the first open, at the last close; null with nothing spent. */
  holdPct: number | null;
  /** The worst the strategy's own result stood along the way, per cent of what it had put in. */
  worstPct: number | null;
  exit: Readonly<{ at: number; why: ExitReason }> | null;
  paused: Readonly<{ at: number; why: PauseReason }> | null;
  /** The last trades, newest last (at most 20). */
  trades: readonly RunTrade[];
}>;

const DAY_MS = 86_400_000;

/** Bigints for the rule's position, from floats: the rule compares worth with spent only. */
const units = (sol: number) => BigInt(Math.max(0, Math.round(sol * 1e9)));

/**
 * The agent's run over these candles from their first open. `bornAt` — an early plan's launch; `sells` — whether the
 * engine sells where the plan says so. Candles not in time order or not priced are the caller's to leave out.
 */
export function runPlan(
  plan: StrategyPlan,
  bars: readonly Bar[],
  budget: RunBudget,
  options: Readonly<{ costs?: RunCosts; sells?: boolean; bornAt?: number | null; barMs?: number }> = {},
): RunResult {
  const costs = options.costs ?? RUN_COSTS;
  const sells = options.sells ?? false;
  const keep = 1 - (costs.feeBps + costs.slippageBps) / 10_000;
  const barMs = options.barMs ?? (bars.length > 1 ? bars[1]!.t - bars[0]!.t : 3_600_000);
  const { everyMs } = steadyRhythm(units(budget.perTrade), units(budget.perDay));
  const start = bars[0]?.t ?? 0;
  const ends = start + budget.days * DAY_MS;

  let coins = 0;
  let spent = 0;
  let got = 0;
  let network = 0;
  let worst: number | null = null;
  let exit: RunResult["exit"] = null;
  let paused: RunResult["paused"] = null;
  const marks: Mark[] = [];
  const buys: Array<{ at: number; sol: number; coins: number; level?: number }> = [];
  const trades: RunTrade[] = [];
  const held = new Map<number, number>();
  let anchor: number | null = null;
  let sellCount = 0;

  for (const bar of bars) {
    const now = bar.t + barMs;
    const price = bar.c;
    marks.push({ at: now, price });
    while (marks.length && now - marks[0]!.at > DAY_MS) marks.shift();
    if (anchor === null) anchor = price;
    const worth = coins * price;
    if (spent > 0) {
      const pct = (worth + got - spent - network) / spent;
      worst = worst === null ? pct : Math.min(worst, pct);
    }

    /* Where it can sell: a grid's level one step up goes. */
    if (sells && plan.id === "grid" && anchor !== null && held.size) {
      for (const k of gridSells(plan, anchor, [...held.keys()], price)) {
        const amount = held.get(k)!;
        got += amount * price * keep;
        network += costs.networkSol;
        coins -= amount;
        held.delete(k);
        sellCount += 1;
        trades.push({ at: now, side: "sell", price, sol: amount * price * keep, level: k });
      }
    }
    if (exit || paused || now >= ends) continue;

    /* The person's exit, looked at on every pass as the agent does — before its autostop. */
    const exitNow = exitOf(plan.exit, { spent: units(spent - got), worth: units(worth) });
    if (exitNow) {
      exit = { at: now, why: exitNow };
      if (sells && coins > 0) {
        got += coins * price * keep;
        network += costs.networkSol;
        trades.push({ at: now, side: "sell", price, sol: coins * price * keep });
        sellCount += 1;
        coins = 0;
        held.clear();
      }
      continue;
    }

    /* The caps and the rhythm: the day's budget, the spacing. */
    const today = buys.filter((buy) => now - buy.at < DAY_MS);
    const spentToday = today.reduce((sum, buy) => sum + buy.sol, 0);
    if (spentToday + budget.perTrade > budget.perDay + 1e-12) continue;
    const last = buys.at(-1);
    if (last && now - last.at < everyMs) continue;
    /* The autostop, asked as the agent asks it: only once a buy is due. */
    if (buys.length) {
      const lossBps = spent > 0 && worth < spent - got ? ((spent - got - worth) * 10_000) / (spent - got) : 0;
      let inARow = 0;
      for (const buy of [...buys].reverse()) {
        if (buy.coins * price > buy.sol * (1 - AUTOSTOP.losingTradeBps / 10_000)) break;
        inARow += 1;
      }
      if (lossBps >= AUTOSTOP.maxLossBps) paused = { at: now, why: "loss" };
      else if (inARow >= AUTOSTOP.losingInARow) paused = { at: now, why: "losses" };
      if (paused) continue;
    }

    /* The plan's rule on this buy. */
    const rule = ruleOf({ plan, now, marks, anchor, held: [...held.keys()], position: { spent: units(spent - got), worth: units(worth) }, bornAt: options.bornAt ?? null });

    if (rule.do !== "buy") continue;

    const bought = (budget.perTrade * keep) / price;
    coins += bought;
    spent += budget.perTrade;
    network += costs.networkSol;
    buys.push({ at: now, sol: budget.perTrade, coins: bought, ...(rule.level === undefined ? {} : { level: rule.level }) });
    if (rule.level !== undefined) held.set(rule.level, bought);
    trades.push({ at: now, side: "buy", price, sol: budget.perTrade, ...(rule.level === undefined ? {} : { level: rule.level }) });
  }

  const lastPrice = bars.at(-1)?.c ?? 0;
  const firstOpen = bars[0]?.o ?? 0;
  const heldSol = coins * lastPrice;
  const resultPct = spent > 0 ? ((heldSol + got - spent - network) / spent) * 100 : null;
  const holdPct = spent > 0 && firstOpen > 0 ? ((lastPrice / firstOpen) * keep - 1 - costs.networkSol / spent) * 100 : null;
  return {
    bars: bars.length,
    fromMs: bars[0]?.t ?? 0,
    toMs: bars.length ? bars.at(-1)!.t + barMs : 0,
    buys: buys.length,
    sells: sellCount,
    spentSol: spent,
    gotSol: got,
    heldSol,
    resultPct,
    holdPct,
    worstPct: worst === null ? null : worst * 100,
    exit,
    paused,
    trades: trades.slice(-20),
  };
}

/* ---------------------------------------------------------------- practice without money */

/**
 * The agent on paper: the plan, the coin and the moment it started. Nothing else is kept — its trades are the run of the
 * same rules over the candles since that moment, so the paper agent works while the person is away and two reads of it
 * always agree.
 */
export type Paper = Readonly<{
  plan: string;
  coin: string;
  symbol: string | null;
  startedAt: number;
  /** An early plan's launch, ms. */
  bornAt: number | null;
}>;

/** The paper agent's run until `now`: the candles that opened after it started, each seen only once it closed. */
export function paperRun(plan: StrategyPlan, paper: Paper, bars: readonly Bar[], budget: RunBudget, now: number, options: Readonly<{ costs?: RunCosts; sells?: boolean; barMs?: number }> = {}): RunResult {
  const barMs = options.barMs ?? (bars.length > 1 ? bars[1]!.t - bars[0]!.t : 300_000);
  const since = bars.filter((bar) => bar.t >= paper.startedAt - barMs && bar.t + barMs <= now);
  return runPlan(plan, since, budget, { ...options, barMs, bornAt: paper.bornAt });
}

/* ---------------------------------------------------------------- the candles a run reads */

/** The candles' step for a run: an hour on history (300 of them, about twelve days); finer for a practice still young. */
export function runTimeframe(since: number | null, now: number): Readonly<{ timeframe: "5m" | "15m" | "1h"; barMs: number }> {
  if (since === null) return { timeframe: "1h", barMs: 3_600_000 };
  const age = now - since;
  if (age <= 24 * 3_600_000) return { timeframe: "5m", barMs: 300_000 };
  if (age <= 72 * 3_600_000) return { timeframe: "15m", barMs: 900_000 };
  return { timeframe: "1h", barMs: 3_600_000 };
}

/** The chart's candles (`lib/chart/types.ts`, seconds) as a run's bars: priced, closed by `now`, oldest first, one per open. */
export function barsOf(candles: readonly Readonly<{ time: number; open: number; high: number; low: number; close: number }>[], barMs: number, now: number): Bar[] {
  const out = new Map<number, Bar>();
  for (const candle of candles) {
    const t = candle.time * 1000;
    const prices = [candle.open, candle.high, candle.low, candle.close];
    if (!Number.isSafeInteger(t) || !prices.every((value) => Number.isFinite(value) && value > 0) || t + barMs > now) continue;
    out.set(t, { t, o: candle.open, h: candle.high, l: candle.low, c: candle.close });
  }
  return [...out.values()].sort((a, b) => a.t - b.t);
}
