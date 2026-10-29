import type { Tower } from '../market/types.ts';
import { ownedMints, type Holdings } from './wallet.ts';

/**
 * «Mine»: the coins of the connected wallet that stand in the city, what they are worth at the city's price and how
 * they moved. The balances are the engine's holdings read; the price is the tower's, read with the city. How a coin
 * moved since it was bought is said only when the engine measured what the whole holding cost — every coin of it came
 * through Ryntra trades whose dollar value was recorded, and the history was read whole. Anything less, and the card
 * says the market's 24-hour move instead, marked as such: a transfer-in never reads as a profit.
 */

/** The engine's history answers with at most this many trades of one coin: a full page may hide older ones. */
export const HISTORY_PAGE = 30;

/** One trade of the wallet's history, as `/api/growth/cards` lists it: raw units and USD micros, as strings. */
export type HistoryTrade = Readonly<{ kind?: unknown; mint?: unknown; costMicros?: unknown; quantityRaw?: unknown }>;

/** What the coins now held cost, in USD micros, and how many of them that covers. */
export type Basis = Readonly<{ costMicros: bigint; quantityRaw: bigint }>;

const DIGITS = /^(0|[1-9][0-9]*)$/;

/**
 * What the holding of `mint` cost, from the engine's measured trades: buys add what they paid and what arrived, sales
 * take off the cost of what they closed. Null unless that covers exactly the balance the wallet holds now — a coin
 * that also came from elsewhere, or left by a transfer, has no known cost — and unless the history was read whole.
 */
export function basisOf(trades: readonly HistoryTrade[], mint: string, balanceRaw: string, complete: boolean): Basis | null {
  if (!complete || trades.length >= HISTORY_PAGE || !DIGITS.test(balanceRaw)) return null;
  let cost = 0n;
  let quantity = 0n;
  for (const trade of trades) {
    if (trade.mint !== mint) continue;
    if (typeof trade.costMicros !== 'string' || !DIGITS.test(trade.costMicros)) return null;
    if (typeof trade.quantityRaw !== 'string' || !DIGITS.test(trade.quantityRaw)) return null;
    const sign = trade.kind === 'BUY' ? 1n : trade.kind === 'SELL' ? -1n : 0n;
    if (sign === 0n) return null;
    cost += sign * BigInt(trade.costMicros);
    quantity += sign * BigInt(trade.quantityRaw);
  }
  if (quantity <= 0n || cost <= 0n || quantity !== BigInt(balanceRaw)) return null;
  return { costMicros: cost, quantityRaw: quantity };
}

export type Change = Readonly<{
  /** `bought`: against what the holding cost; `day`: the market's move over 24 hours, not the person's. */
  since: 'bought' | 'day';
  pct: number;
}>;

export type MineRow = Readonly<{
  tower: Tower;
  amountRaw: string;
  decimals: number;
  /** At the tower's price; null when the city has no usable price for it. */
  valueUsd: number | null;
  change: Change | null;
}>;

export type Mine = Readonly<{
  rows: readonly MineRow[];
  /** The sum of the rows that have a value; null when none has. */
  totalUsd: number | null;
  /** Rows without a value, left out of the total. */
  unvalued: number;
  /** Coins the wallet holds that have no tower in the city: counted, never priced here. */
  elsewhere: number;
}>;

/** What `raw` base units are as a number of coins. Precise enough for a dollar figure; amounts are written from raw. */
function units(raw: string, decimals: number): number {
  return Number(raw) / 10 ** decimals;
}

/** The wallet's coins that stand in the city, worth the most first. SOL itself stays out: every wallet keeps it for fees. */
export function mineOf(holdings: Holdings | null, towers: readonly Tower[], bases: ReadonlyMap<string, Basis | null> = new Map()): Mine {
  const owned = ownedMints(holdings);
  if (!holdings || owned.size === 0) return { rows: [], totalUsd: null, unvalued: 0, elsewhere: 0 };
  const byMint = new Map(towers.map((tower) => [tower.id, tower]));
  const rows: MineRow[] = [];
  let elsewhere = 0;
  for (const mint of owned) {
    const tower = byMint.get(mint);
    const balance = holdings.tokens.get(mint);
    if (!tower || !balance) {
      elsewhere += 1;
      continue;
    }
    const priced = Number.isFinite(tower.price) && tower.price > 0;
    const valueUsd = priced ? units(balance.spendableRaw, balance.decimals) * tower.price : null;
    const basis = bases.get(mint) ?? null;
    let change: Change | null = null;
    if (basis && valueUsd !== null) change = { since: 'bought', pct: (valueUsd / (Number(basis.costMicros) / 1e6) - 1) * 100 };
    else if (Number.isFinite(tower.change24h)) change = { since: 'day', pct: tower.change24h };
    rows.push({ tower, amountRaw: balance.spendableRaw, decimals: balance.decimals, valueUsd, change });
  }
  rows.sort((a, b) => (b.valueUsd ?? -1) - (a.valueUsd ?? -1));
  const valued = rows.filter((row) => row.valueUsd !== null);
  return {
    rows,
    totalUsd: valued.length ? valued.reduce((sum, row) => sum + row.valueUsd!, 0) : null,
    unvalued: rows.length - valued.length,
    elsewhere,
  };
}

/** Dollars as the panel writes them: $1,240 · $12.40 · $0.0042 · <$0.01. */
export function formatUsd(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value < 0) return '—';
  if (value === 0) return '$0';
  if (value < 0.01) return '<$0.01';
  if (value >= 1_000_000) return `$${Number((value / 1_000_000).toFixed(2))}M`;
  if (value >= 10_000) return `$${Math.round(value).toLocaleString('en-US')}`;
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** A move as a signed percent: +12.4%, −3.1%, 0%. */
export function formatPct(pct: number): string {
  if (!Number.isFinite(pct)) return '—';
  const abs = Math.abs(pct);
  const text = abs >= 100 ? abs.toFixed(0) : abs >= 10 ? abs.toFixed(1) : abs.toFixed(2);
  if (Number(text) === 0) return '0%';
  return `${pct > 0 ? '+' : '−'}${Number(text)}%`;
}

/** How old a read is, in words: just now, 40s ago, 3 min ago, at 14:05. */
export function readAge(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return `at ${new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}
