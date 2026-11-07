/**
 * Market Replay (CITY-51, decision 72): both agents trade the same hidden stretch of Solana's market history on paper,
 * step by step, seeing only the bars up to now. Whoever ends with more wins. The bars come from Ryntra's market-data
 * gateway (`segment.ts`), rebased so the stretch opens at 100 and stripped of its times, so a model cannot look the
 * stretch up in its memory; which stretch it was is shown once the match is over.
 *
 *   config  = { harness, steps, lookback, cash, feeBps, bars: [[o, h, l, c], …] }   lookback + steps bars
 *   move    = { side: buy | sell | hold, size: 0 … 1, thought }
 *   derived = { step, cash: [n, n], units: [n, n], equity: [n, n] }
 *   result  = { winner, reason, equity: [n, n] }                                      reason: equity · even · fault · double_fault
 *
 * Step i (from 0) is decided on bars 0 … lookback + i − 1 and filled at the open of bar lookback + i: nobody trades on a
 * price they could not have known. `buy` spends `size` of the cash, `sell` sells `size` of the units, each paying
 * `feeBps` of what it trades. After the last step both are valued at the last close; equal to a billionth — a draw.
 * Rounds are played at once (`rounds.ts`), so both orders of a step are fixed before either fills.
 *
 * Every figure is rounded to a billionth after each step, the same on every machine: the replay derives exactly the
 * numbers the harness recorded. Paper only — nothing here is a sum a transaction is sized from.
 *
 * Pure: no store, no clock, no network.
 */

import { isRecord } from "../judge/hash.ts";
import { MoveRejected, type ReplayGame } from "../judge/replay.ts";
import { checkThought, faultEnding, readRound, SEATS, type Ending, type Fault, type Pair, type Seat } from "./rounds.ts";

export const MARKET = { id: "market-replay", version: "1" } as const;

/** One standard Market Replay: 20 steps (decision 72) on 12 bars of context, 1 000 on paper, 0.1 % a trade. */
export const MARKET_DEFAULTS = { steps: 20, lookback: 12, cash: 1_000, feeBps: 10 } as const;

export type Bar = [o: number, h: number, l: number, c: number];
export type MarketConfig = { harness: string; steps: number; lookback: number; cash: number; feeBps: number; bars: Bar[] };

export const SIDES = ["buy", "sell", "hold"] as const;
export type Side = (typeof SIDES)[number];
export type MarketMove = { side: Side; size: number; thought: string };

export type MarketStep = { step: number; moves: Pair<MarketMove | null>; faults: Pair<Fault | null>; price: number; equity: Pair<number> };

export type MarketState = {
  config: MarketConfig;
  step: number;
  cash: Pair<number>;
  units: Pair<number>;
  steps: MarketStep[];
  ending: (Ending & { equity: Pair<number> }) | null;
};

/** A billionth: every figure is kept at this precision. */
export const fix = (value: number): number => Math.round(value * 1e9) / 1e9;

const whole = (value: unknown, min: number, max: number): value is number => Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
const positive = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0 && value < 1e12;

export function readMarketConfig(raw: unknown): MarketConfig {
  if (!isRecord(raw)) throw new MoveRejected("config is an object");
  const { harness, steps, lookback, cash, feeBps, bars } = raw;
  if (typeof harness !== "string" || !/^[A-Za-z0-9._:/@-]{1,96}$/.test(harness)) throw new MoveRejected("config names its harness");
  if (!whole(steps, 1, 40) || !whole(lookback, 2, 48) || !whole(cash, 1, 1_000_000) || !whole(feeBps, 0, 100)) {
    throw new MoveRejected("steps 1-40, lookback 2-48, cash 1-1000000, feeBps 0-100");
  }
  if (!Array.isArray(bars) || bars.length !== lookback + steps) throw new MoveRejected("lookback + steps bars");
  const out: Bar[] = [];
  for (const bar of bars) {
    if (!Array.isArray(bar) || bar.length !== 4 || !bar.every(positive)) throw new MoveRejected("a bar is [o, h, l, c], all positive");
    const [o, h, l, c] = bar as Bar;
    if (h < Math.max(o, c, l) || l > Math.min(o, c, h)) throw new MoveRejected("a bar's high and low hold its open and close");
    out.push([o, h, l, c]);
  }
  return { harness, steps, lookback, cash, feeBps, bars: out };
}

function readMove(raw: unknown, seat: Seat): MarketMove {
  if (!isRecord(raw) || Object.keys(raw).sort().join(",") !== "side,size,thought") throw new MoveRejected(`seat ${seat}: a move is { side, size, thought }`);
  if (!(SIDES as readonly unknown[]).includes(raw.side)) throw new MoveRejected(`seat ${seat}: side is buy, sell or hold`);
  const size = raw.size;
  if (typeof size !== "number" || !Number.isFinite(size) || size < 0 || size > 1 || fix(size) !== size) throw new MoveRejected(`seat ${seat}: size is 0 … 1`);
  if (raw.side === "hold" && size !== 0) throw new MoveRejected(`seat ${seat}: hold has size 0`);
  return { side: raw.side as Side, size, thought: checkThought(raw.thought, seat) };
}

const equityAt = (state: Pick<MarketState, "cash" | "units">, price: number): Pair<number> => [fix(state.cash[0] + state.units[0] * price), fix(state.cash[1] + state.units[1] * price)];

export const market: ReplayGame<MarketState> = {
  id: MARKET.id,
  version: MARKET.version,
  start(config) {
    const cfg = readMarketConfig(config);
    return { config: cfg, step: 0, cash: [cfg.cash, cfg.cash], units: [0, 0], steps: [], ending: null };
  },
  step(state, input) {
    if (state.ending) throw new MoveRejected("the match is over");
    const round = readRound(input, state.step + 1, readMove);
    const { config } = state;
    const price = config.bars[config.lookback + state.step]![0];
    const fee = config.feeBps / 10_000;
    const cash: Pair<number> = [...state.cash];
    const units: Pair<number> = [...state.units];
    for (const seat of SEATS) {
      const move = round.moves[seat];
      if (!move || move.side === "hold" || move.size === 0) continue;
      if (move.side === "buy") {
        const spend = fix(cash[seat] * move.size);
        units[seat] = fix(units[seat] + (spend * (1 - fee)) / price);
        cash[seat] = fix(cash[seat] - spend);
      } else {
        const sold = fix(units[seat] * move.size);
        cash[seat] = fix(cash[seat] + sold * price * (1 - fee));
        units[seat] = fix(units[seat] - sold);
      }
    }
    const next = { cash, units };
    const step = round.round;
    const equity = equityAt(next, price);
    const faulted = faultEnding(round.faults);
    let ending: MarketState["ending"] = null;
    if (faulted) ending = { ...faulted, equity };
    else if (step === config.steps) {
      const final = equityAt(next, config.bars[config.bars.length - 1]![3]);
      const gap = Math.abs(final[0] - final[1]) / Math.max(final[0], final[1], 1e-9);
      ending = gap < 1e-9 ? { winner: null, reason: "even", equity: final } : { winner: final[0] > final[1] ? 0 : 1, reason: "equity", equity: final };
    }
    return { ...state, step, cash, units, steps: [...state.steps, { step, moves: round.moves, faults: round.faults, price, equity }], ending };
  },
  derive: (state) => ({ step: state.step, cash: state.cash, units: state.units, equity: state.steps.at(-1)?.equity ?? [state.config.cash, state.config.cash] }),
  result: (state) => (state.ending ? { winner: state.ending.winner, reason: state.ending.reason, equity: state.ending.equity } : null),
};

/* ------------------------------------------------------------------ what each one sees */

/** What an agent sees before it moves: the bars so far, its own book, the other's equity — never the bars ahead. */
export type MarketSeatView = {
  format: "market-replay";
  step: number;
  steps: number;
  bars: Bar[];
  cash: number;
  units: number;
  equity: number;
  theirEquity: number;
  feeBps: number;
  history: { step: number; mine: { side: Side; size: number } | null; price: number }[];
};

export function marketSeatView(state: MarketState, seat: Seat): MarketSeatView {
  const { config } = state;
  const visible = config.bars.slice(0, config.lookback + state.step);
  const last = visible[visible.length - 1]![3];
  const equity = equityAt(state, last);
  return {
    format: "market-replay",
    step: state.step + 1,
    steps: config.steps,
    bars: visible,
    cash: state.cash[seat],
    units: state.units[seat],
    equity: equity[seat],
    theirEquity: equity[(1 - seat) as Seat],
    feeBps: config.feeBps,
    history: state.steps.map((s) => ({ step: s.step, mine: s.moves[seat] ? { side: s.moves[seat]!.side, size: s.moves[seat]!.size } : null, price: s.price })),
  };
}
