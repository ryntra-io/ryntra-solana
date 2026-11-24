import { botMoneyOn, botOfPlan, type MoneyBot } from '../../lib/bots/money/gates.ts';
import { SIGNAL_DEFAULTS, type SignalKind, type SignalTrigger } from '../../lib/bots/money/rules.ts';
import { planFrom, type StrategyPlan } from '../../lib/mandate/plans.ts';

/**
 * «Сітка» and «Сигнали» on the person's budget, as the screens choose them:
 * a bot is a rule she sets, so its form is a few choices — a grid's step and its levels, a signal's condition and its
 * number — and the rest is the budget card every bot of the budget shares: the coin, the budget a day, the week on paper
 * at live prices, then «Start with money» on the very plan (`terminal/agents/NewAgent.tsx` `Trader`). Every choice here
 * is within the plan's bounds (`lib/mandate/plans.ts`, `lib/bots/money/rules.ts`), so no plan the card shows is one the
 * engine would not read.
 *
 * Pure: the screens and the tests read it; the window's switch is an argument.
 */

/** A grid's step between levels, basis points — the plan's bounds are 2 % to 20 %. */
export const GRID_STEPS = [200, 500, 1_000] as const;
/** A grid's levels — the plan's bounds are 2 to 10. */
export const GRID_LEVEL_PICKS = [3, 5, 10] as const;
export const GRID_START = { stepBps: 500, levels: 5 } as const;

/** The grid that sells its levels one step up: the plan the card signs. */
export function gridPlanOf(stepBps: number, levels: number): StrategyPlan {
  return { id: 'grid', stepBps, levels, exit: null, sell: true };
}

/** The conditions a signal offers, in the card's order. */
export const SIGNAL_PICKS: readonly SignalKind[] = ['cross', 'above', 'below', 'move', 'volume'];

/** The numbers each condition offers: basis points of the price, or per cent of the trading's pace; «cross» has its own pair. */
export const SIGNAL_NUMBERS: Readonly<Record<Exclude<SignalKind, 'cross'>, readonly number[]>> = Object.freeze({
  above: [300, 500, 1_000],
  below: [300, 500, 1_000],
  move: [500, 800, 1_500],
  volume: [150, 200, 300],
});

/** A condition with one of its numbers; «cross» — the screen's own pair (an hour's prices over four hours'). */
export function triggerOf(kind: SignalKind, value: number | null): SignalTrigger {
  if (kind === 'cross') return SIGNAL_DEFAULTS.cross;
  const number = value !== null && SIGNAL_NUMBERS[kind].includes(value) ? value : (triggerNumber(SIGNAL_DEFAULTS[kind]) ?? 0);
  return kind === 'volume' ? { kind, pct: number } : { kind, bps: number };
}

/** The signal the card signs. */
export const signalPlanOf = (trigger: SignalTrigger): StrategyPlan => ({ id: 'signal', trigger, exit: null });

/** The number a condition shows picked. */
export const triggerNumber = (trigger: SignalTrigger): number | null => (trigger.kind === 'cross' ? null : trigger.kind === 'volume' ? trigger.pct : trigger.bps);

/** The page's bot a plan is. */
export const PAGE_BOT: Readonly<Record<MoneyBot, 'grid' | 'signals'>> = { grid: 'grid', signals: 'signals' };

/**
 * The bot a row of the budget runs, from its view's plan: the grid that sells, a signal, or null — regular buys and every
 * plan of before, which stay with «Recurring buys».
 */
export function rowBot(row: Readonly<{ role: string; stop: Readonly<{ record: Readonly<{ policy: string }> }> | Readonly<{ care: string }> | null }>, views: Readonly<Record<string, Readonly<{ plan?: string }>>>): MoneyBot | null {
  if (row.role !== 'trader' || !row.stop || !('record' in row.stop)) return null;
  const text = views[row.stop.record.policy]?.plan;
  return botOfPlan(text ? planFrom(text) : null);
}

/**
 * The window's switches of a bot's money — the server's names behind `NEXT_PUBLIC_`; the same words open them (`on`).
 * The window's word opens nothing by itself: the review and the book ask the server's own switch again.
 */
export type PublicMoney = Readonly<{ RYNTRA_BOTS_MONEY?: string | undefined; RYNTRA_BOTS_GRID_MONEY?: string | undefined; RYNTRA_BOTS_SIGNALS_MONEY?: string | undefined }>;

export const botMoneyShown = (bot: MoneyBot, env: PublicMoney): boolean => botMoneyOn(bot, env);

/** This deployment's window switches, written out so the build carries them. */
export function publicMoney(): PublicMoney {
  return {
    RYNTRA_BOTS_MONEY: process.env.NEXT_PUBLIC_RYNTRA_BOTS_MONEY,
    RYNTRA_BOTS_GRID_MONEY: process.env.NEXT_PUBLIC_RYNTRA_BOTS_GRID_MONEY,
    RYNTRA_BOTS_SIGNALS_MONEY: process.env.NEXT_PUBLIC_RYNTRA_BOTS_SIGNALS_MONEY,
  };
}
