import { SPOT_POOL_MIN_RESERVE_USD } from '../../../lib/spot/candles.ts';
import type { Tower } from '../market/types.ts';

/**
 * The risk facts under a tower's chart: what the engine already says about the coin with the city's read — its
 * liquidity, how many hold it, how old its market is. Facts, not a score: one is marked only where the engine itself
 * draws the line — a pool thinner than `SPOT_POOL_MIN_RESERVE_USD` is not a market — or where the city does: a coin
 * whose first pool opened in the last day is new, and most new launches fade.
 */

export type Fact = Readonly<{
  key: 'liquidity' | 'holders' | 'age';
  label: string;
  value: string;
  /** Said beside the value when the fact is a risk; null when it is not. */
  risk: string | null;
}>;

const DAY_MS = 86_400_000;

/** Dollars as the city's cards write them: $1.24B · $12.4M · $840K · $9,200 · $0. */
export function usd(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '—';
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e5) return `$${(value / 1e3).toFixed(0)}K`;
  return `$${Math.round(value).toLocaleString('en-US')}`;
}

/** A count: 1.2M · 48.3K · 912. */
export function count(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '—';
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e4) return `${(value / 1e3).toFixed(1)}K`;
  return Math.round(value).toLocaleString('en-US');
}

/** How old a market is, from its first pool: 5h · 3d · 7mo · 2y. Null without a date, or one in the future. */
export function ageOf(launchedAt: string | null, now: number): Readonly<{ ms: number; text: string }> | null {
  if (!launchedAt) return null;
  const at = Date.parse(launchedAt);
  if (!Number.isFinite(at) || at > now) return null;
  const ms = now - at;
  const hours = ms / 3_600_000;
  const days = ms / DAY_MS;
  const text = hours < 1 ? '<1h' : hours < 24 ? `${Math.floor(hours)}h` : days < 60 ? `${Math.floor(days)}d` : days < 730 ? `${Math.floor(days / 30.44)}mo` : `${Math.floor(days / 365.25)}y`;
  return { ms, text };
}

export function riskFacts(tower: Pick<Tower, 'liquidity' | 'holders' | 'launchedAt'>, now: number): Fact[] {
  const liquidity = Number.isFinite(tower.liquidity) ? tower.liquidity : Number.NaN;
  const age = ageOf(tower.launchedAt, now);
  return [
    { key: 'liquidity', label: 'Liquidity', value: usd(liquidity), risk: liquidity >= 0 && liquidity < SPOT_POOL_MIN_RESERVE_USD ? 'Thin' : null },
    { key: 'holders', label: 'Holders', value: tower.holders > 0 ? count(tower.holders) : '—', risk: null },
    { key: 'age', label: 'Age', value: age?.text ?? '—', risk: age && age.ms < DAY_MS ? 'New' : null },
  ];
}
