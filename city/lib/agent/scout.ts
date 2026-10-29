import type { Tower } from '../market/types.ts';
import { explain, matches, type Fact, type Rule } from './rule.ts';

/**
 * What the scout does on each look over the city, and when it pauses for the week. It only ever picks a tower
 * and says why; buying stays the person's own tap and their own signature in the trade card.
 */

export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
/** A tower the scout brought is not brought again for this long, so the finds do not repeat. */
export const SEEN_MS = 6 * 60 * 60 * 1000;

/** One buy the person made from a find: when, which coin, and what it cost in US dollars. */
export type Spend = Readonly<{ at: number; mint: string; usd: number }>;

export type Decision =
  /** The city's data is not a live, fresh read: the scout brings nothing from old figures. */
  | Readonly<{ kind: 'waiting' }>
  /** This week's budget is used up; the scout rests until the oldest buy leaves the seven days. */
  | Readonly<{ kind: 'resting'; until: number | null }>
  /** Nothing in the city fits the rule right now. */
  | Readonly<{ kind: 'quiet' }>
  | Readonly<{ kind: 'find'; tower: Tower; facts: Fact[] }>;

/** Buys of the last seven days, oldest first; older ones are dropped. */
export function keepWeek(ledger: readonly Spend[], now: number): Spend[] {
  return ledger.filter((s) => now - s.at < WEEK_MS && s.at <= now && Number.isFinite(s.usd) && s.usd >= 0).sort((a, b) => a.at - b.at);
}

export function spentInWeek(ledger: readonly Spend[], now: number): number {
  return keepWeek(ledger, now).reduce((sum, s) => sum + s.usd, 0);
}

export function leftInWeek(budget: number, ledger: readonly Spend[], now: number): number {
  return Math.max(0, budget - spentInWeek(ledger, now));
}

/** When some budget comes back: the moment enough of the oldest buys leave the seven days. Null if it is not used up. */
export function opensAgainAt(budget: number, ledger: readonly Spend[], now: number): number | null {
  const week = keepWeek(ledger, now);
  let spent = week.reduce((sum, s) => sum + s.usd, 0);
  if (spent < budget) return null;
  for (const s of week) {
    spent -= s.usd;
    if (spent < budget) return s.at + WEEK_MS;
  }
  return null;
}

/**
 * What a buy cost in US dollars, from what left the wallet: USDC counts as a dollar, SOL at the city's price for SOL.
 * Null when the amount or the price is not known.
 */
export function usdOfBuy(
  paid: Readonly<{ inputMint: string; inputRaw: string | null; decimals: number | null }>,
  prices: Readonly<{ solMint: string; usdcMint: string; sol: number | null }>,
): number | null {
  if (paid.inputRaw === null || paid.decimals === null || !/^\d+$/.test(paid.inputRaw)) return null;
  const amount = Number(paid.inputRaw) / 10 ** paid.decimals;
  if (paid.inputMint === prices.usdcMint) return amount;
  if (paid.inputMint === prices.solMint && prices.sol !== null && prices.sol > 0) return amount * prices.sol;
  return null;
}

/**
 * One look over the city. Live, fresh data only; nothing once the week's budget is spent; never the same tower twice
 * within a few hours; and among what fits, the strongest match.
 */
export function decide(
  input: Readonly<{
    rule: Rule;
    towers: readonly Tower[];
    live: boolean;
    seen: Readonly<Record<string, number>>;
    ledger: readonly Spend[];
    now: number;
  }>,
): Decision {
  const { rule, towers, live, seen, ledger, now } = input;
  if (leftInWeek(rule.budget, ledger, now) <= 0) return { kind: 'resting', until: opensAgainAt(rule.budget, ledger, now) };
  if (!live) return { kind: 'waiting' };
  const fresh = matches(towers, rule).filter((t) => !(now - (seen[t.id] ?? -Infinity) < SEEN_MS));
  const tower = fresh[0];
  return tower ? { kind: 'find', tower, facts: explain(tower, rule) } : { kind: 'quiet' };
}
