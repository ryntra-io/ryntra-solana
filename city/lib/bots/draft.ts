import { KIND_FACTS, type BotKind } from './kinds.ts';
import type { Weather } from './weather.ts';
import { EXIT_POLICIES, type ExitPolicy } from '../../../lib/bots/ladder/exit.ts';
import { LADDER_SHAPES, type LadderShape } from '../../../lib/bots/ladder/plan.ts';
import { SMART_DEFAULT_LADDER_PCT } from '../../../lib/bots/ladder/smart.ts';

export { EXIT_POLICIES, LADDER_SHAPES, type ExitPolicy, type LadderShape };

/**
 * A bot's settings before it starts — the draft the hub edits and the strategies save. Levels of a
 * ladder are kept as percents from the price the bot starts at, so a draft saved today starts sensibly next week; a
 * grid's range is in prices, as the person drew it on the chart.
 */

export type Pair = Readonly<{ mint: string; symbol: string }>;

/*
 * What a ranged bot does once the price leaves its range (`lib/bots/ladder/exit.ts`, chosen before the start):
 * - `stop` — stops and keeps what it holds;
 * - `sellAll` — sells everything back to USDC;
 * - `rebuild` — sets the same range again around the new price;
 * - `wait` — keeps its orders and goes on if the price comes back.
 */

type Common = Readonly<{
  pair: Pair;
  /** The most the bot ever uses, USD. */
  amountUsd: number;
  exit: ExitPolicy;
  /** The saved strategy and version it was copied from. */
  copiedFrom?: Readonly<{ strategyId: string; versionId: string }>;
}>;

export type GridDraft = Common & Readonly<{ kind: 'grid' | 'lpRange'; lower: number; upper: number; levels: number }>;
/** A ladder's steps as percents from the start; `shape` — the same amount on each, or more on the far ones (even if missing). */
type LadderSteps = Readonly<{ steps: number; firstPct: number; lastPct: number; shape?: LadderShape }>;
export type BuyLadderDraft = Common & LadderSteps & Readonly<{ kind: 'buyLadder' }>;
export type ExitLadderDraft = Common & LadderSteps & Readonly<{ kind: 'exitLadder' }>;
export type RecurringDraft = Common & Readonly<{ kind: 'recurring'; everyHours: number; buys: number }>;
/**
 * Smart DCA: `ladderPct` of the amount as a buy ladder placed once, the rest as reminders — leaning into dips, and none
 * while the price is over `ceilingPct` from the start. Drafts saved before the ladder existed have none of these and
 * read as reminders only (`smartParts`).
 */
export type SmartDcaDraft = Common &
  Readonly<{ kind: 'smartDca'; everyHours: number; buys: number; ladderPct?: number; steps?: number; firstPct?: number; lastPct?: number; shape?: LadderShape; ceilingPct?: number | null }>;
export type RebalancerDraft = Common & Readonly<{ kind: 'rebalancer'; targetPct: number; driftPct: number }>;
export type AlertDraft = Common & Readonly<{ kind: 'priceAlert'; movePct: number }>;
export type SignalDraft = Common & Readonly<{ kind: 'signal'; fast: number; slow: number }>;

export type BotDraft = GridDraft | BuyLadderDraft | ExitLadderDraft | RecurringDraft | SmartDcaDraft | RebalancerDraft | AlertDraft | SignalDraft;
export type DraftKind = BotDraft['kind'];

export const DRAFT_KINDS: readonly DraftKind[] = ['grid', 'lpRange', 'buyLadder', 'exitLadder', 'recurring', 'smartDca', 'rebalancer', 'priceAlert', 'signal'];
export const isDraftKind = (kind: BotKind): kind is DraftKind => (DRAFT_KINDS as readonly string[]).includes(kind);

/** The amounts a person taps instead of typing. */
export const AMOUNTS = [50, 100, 250, 500] as const;
export const DEFAULT_AMOUNT = 100;
/** The least a bot starts with. */
export const MIN_AMOUNT = 10;
/** And the most a paper bot takes: practice is for learning, not for size. */
export const MAX_AMOUNT = 100_000;

export const GRID_LEVELS = [6, 10, 16, 24] as const;
export const LADDER_STEPS = [3, 4, 5, 8] as const;
export const SMART_LADDER_PCTS = [0, 30, 50, 70] as const;
export const CEILINGS = [null, 5, 10, 20] as const;
export const EVERY_HOURS = [24, 72, 168] as const;

const round = (value: number, digits: number) => {
  const p = 10 ** digits;
  return Math.round(value * p) / p;
};

/** Enough significant digits for a price of any size. */
export function priceRound(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return value;
  const digits = Math.max(0, 4 - Math.floor(Math.log10(value)));
  return round(value, Math.min(12, digits));
}

/**
 * A draft for a bot on a pair, sized for the week's weather: a grid spans the week's range a little widened around the
 * price; ladders step by about a typical day's move; reminders spread the amount over five.
 */
export function defaultDraft(kind: DraftKind, pair: Pair, price: number, weather: Weather | null, amountUsd = DEFAULT_AMOUNT): BotDraft {
  const day = Math.max(1.5, Math.min(15, weather?.dayMovePct ?? 4));
  const exit: ExitPolicy = KIND_FACTS[kind].ranged ? 'wait' : 'stop';
  const common = { pair, amountUsd, exit } as const;
  switch (kind) {
    case 'grid':
    case 'lpRange': {
      const low = weather ? Math.min(weather.low, price * (1 - day / 100)) : price * (1 - (2 * day) / 100);
      const high = weather ? Math.max(weather.high, price * (1 + day / 100)) : price * (1 + (2 * day) / 100);
      return { ...common, kind, lower: priceRound(low * 0.98), upper: priceRound(high * 1.02), levels: kind === 'grid' ? 10 : 24 };
    }
    case 'buyLadder':
      return { ...common, kind, steps: 5, firstPct: round(day / 2, 1), lastPct: round(Math.min(45, day * 3), 1) };
    case 'exitLadder':
      return { ...common, kind, steps: 4, firstPct: round(day, 1), lastPct: round(Math.min(80, day * 4), 1) };
    case 'recurring':
      return { ...common, kind, everyHours: 24, buys: 5 };
    case 'smartDca':
      return { ...common, kind, everyHours: 24, buys: 5, ladderPct: SMART_DEFAULT_LADDER_PCT, steps: 4, firstPct: round(day / 2, 1), lastPct: round(Math.min(45, day * 3), 1), shape: 'deeper', ceilingPct: null };
    case 'rebalancer':
      return { ...common, kind, targetPct: 50, driftPct: 5 };
    case 'priceAlert':
      return { ...common, kind, movePct: -round(Math.max(5, day * 2), 0) };
    case 'signal':
      return { ...common, kind, fast: 12, slow: 26 };
  }
}

export type DraftIssue = 'amount' | 'range' | 'levels' | 'steps' | 'percent' | 'schedule' | 'target' | 'signal';

/** A Smart DCA draft's two legs, with the defaults of a draft saved before its ladder existed: no ladder at all. */
export function smartParts(draft: SmartDcaDraft): Readonly<{ ladderPct: number; steps: number; firstPct: number; lastPct: number; shape: LadderShape; ceilingPct: number | null }> {
  return {
    ladderPct: typeof draft.ladderPct === 'number' && Number.isFinite(draft.ladderPct) ? draft.ladderPct : 0,
    steps: draft.steps ?? 4,
    firstPct: draft.firstPct ?? 2,
    lastPct: draft.lastPct ?? 12,
    shape: draft.shape ?? 'even',
    ceilingPct: typeof draft.ceilingPct === 'number' ? draft.ceilingPct : null,
  };
}

/** The ladder a draft places on the chain, if it places one: its kind's side, steps, percents and dollars. */
export function ladderOf(draft: BotDraft): Readonly<{ side: 'buy' | 'exit'; steps: number; firstPct: number; lastPct: number; shape: LadderShape; amountUsd: number }> | null {
  switch (draft.kind) {
    case 'buyLadder':
    case 'exitLadder':
      return { side: draft.kind === 'buyLadder' ? 'buy' : 'exit', steps: draft.steps, firstPct: draft.firstPct, lastPct: draft.lastPct, shape: draft.shape ?? 'even', amountUsd: draft.amountUsd };
    case 'smartDca': {
      const parts = smartParts(draft);
      if (parts.ladderPct <= 0) return null;
      return { side: 'buy', steps: parts.steps, firstPct: parts.firstPct, lastPct: parts.lastPct, shape: parts.shape, amountUsd: (draft.amountUsd * parts.ladderPct) / 100 };
    }
    default:
      return null;
  }
}

/** What is wrong with a draft, if anything; a draft with no issues can start. */
export function draftIssues(draft: BotDraft): DraftIssue[] {
  const issues: DraftIssue[] = [];
  if (!(draft.amountUsd >= MIN_AMOUNT && draft.amountUsd <= MAX_AMOUNT)) issues.push('amount');
  switch (draft.kind) {
    case 'grid':
    case 'lpRange':
      if (!(draft.lower > 0 && draft.upper > draft.lower * 1.01)) issues.push('range');
      if (!(Number.isInteger(draft.levels) && draft.levels >= 3 && draft.levels <= 69)) issues.push('levels');
      break;
    case 'buyLadder':
    case 'exitLadder':
      if (!(Number.isInteger(draft.steps) && draft.steps >= 2 && draft.steps <= 12)) issues.push('steps');
      if (!(draft.firstPct > 0 && draft.lastPct > draft.firstPct && draft.lastPct < (draft.kind === 'buyLadder' ? 90 : 500))) issues.push('percent');
      break;
    case 'recurring':
      if (!(draft.everyHours >= 1 && Number.isInteger(draft.buys) && draft.buys >= 2 && draft.buys <= 60)) issues.push('schedule');
      break;
    case 'smartDca': {
      if (!(draft.everyHours >= 1 && Number.isInteger(draft.buys) && draft.buys >= 2 && draft.buys <= 60)) issues.push('schedule');
      const parts = smartParts(draft);
      if (!(parts.ladderPct >= 0 && parts.ladderPct <= 90)) issues.push('percent');
      else if (parts.ladderPct > 0) {
        if (!(Number.isInteger(parts.steps) && parts.steps >= 2 && parts.steps <= 12)) issues.push('steps');
        if (!(parts.firstPct > 0 && parts.lastPct > parts.firstPct && parts.lastPct < 90)) issues.push('percent');
      }
      break;
    }
    case 'rebalancer':
      if (!(draft.targetPct >= 10 && draft.targetPct <= 90 && draft.driftPct >= 1 && draft.driftPct <= 25)) issues.push('target');
      break;
    case 'priceAlert':
      if (!(Number.isFinite(draft.movePct) && draft.movePct !== 0 && Math.abs(draft.movePct) <= 80)) issues.push('percent');
      break;
    case 'signal':
      if (!(Number.isInteger(draft.fast) && Number.isInteger(draft.slow) && draft.fast >= 2 && draft.slow > draft.fast && draft.slow <= 200)) issues.push('signal');
      break;
  }
  return issues;
}

/** The price levels a ranged draft keeps, low to high, at the price it starts at. */
export function levelsOf(draft: BotDraft, startPrice: number): number[] {
  switch (draft.kind) {
    case 'grid':
    case 'lpRange': {
      const n = Math.max(2, draft.levels);
      const ratio = draft.upper / draft.lower;
      return Array.from({ length: n }, (_, i) => draft.lower * ratio ** (i / (n - 1)));
    }
    case 'buyLadder':
      return spread(draft.firstPct, draft.lastPct, draft.steps).map((pct) => startPrice * (1 - pct / 100)).sort((a, b) => a - b);
    case 'exitLadder':
      return spread(draft.firstPct, draft.lastPct, draft.steps).map((pct) => startPrice * (1 + pct / 100));
    case 'smartDca': {
      const parts = smartParts(draft);
      if (parts.ladderPct <= 0) return [];
      return spread(parts.firstPct, parts.lastPct, parts.steps).map((pct) => startPrice * (1 - pct / 100)).sort((a, b) => a - b);
    }
    default:
      return [];
  }
}

/** `steps` evenly spaced percents from `first` to `last`. */
export function spread(first: number, last: number, steps: number): number[] {
  if (steps <= 1) return [first];
  return Array.from({ length: steps }, (_, i) => first + ((last - first) * i) / (steps - 1));
}

/**
 * The band a ranged bot works in at its start price; leaving it applies the exit policy. A grid's band is its range;
 * a buy ladder's runs from a little under its last step to a tenth over the start; an exit ladder's from 15 % under the
 * start to a little over its last step.
 */
export function bandOf(draft: BotDraft, startPrice: number): Readonly<{ lower: number; upper: number }> | null {
  switch (draft.kind) {
    case 'grid':
    case 'lpRange':
      return { lower: draft.lower, upper: draft.upper };
    case 'buyLadder': {
      const levels = levelsOf(draft, startPrice);
      return { lower: levels[0]! * 0.95, upper: startPrice * 1.1 };
    }
    case 'smartDca': {
      const levels = levelsOf(draft, startPrice);
      return levels.length ? { lower: levels[0]! * 0.95, upper: startPrice * 1.1 } : null;
    }
    case 'exitLadder': {
      const levels = levelsOf(draft, startPrice);
      return { lower: startPrice * 0.85, upper: levels[levels.length - 1]! * 1.05 };
    }
    default:
      return null;
  }
}

/** The draft's settings that differ from another's: what a new version or a fork changed. */
export function changedFields(before: BotDraft, after: BotDraft): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  keys.delete('copiedFrom');
  return [...keys].filter((key) => JSON.stringify((before as Record<string, unknown>)[key]) !== JSON.stringify((after as Record<string, unknown>)[key])).sort();
}
