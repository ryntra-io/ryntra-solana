import { TOWER_FIGURES, type Tower, type TowerFigure } from '../../city/lib/market/types.ts';
import { isMint } from '../../city/lib/search/mint.ts';
import type { Balance } from '../../city/lib/trade/tiles.ts';

/**
 * What the coin's screen works out from the engine's reads, without React: the coin an address names, the person's
 * position in it, the facts under the ticket and the wallet's own trades of it. Every figure is the engine's — the
 * market read (`/api/city`), the wallet's balances, its recorded trades (`/api/growth/cards`); nothing here invents one.
 *
 * Pure: the screen and the tests read it as it is.
 */

/** The coin an address in the browser names: a Solana mint, or nothing. */
export function mintOf(address: string | null | undefined): string | null {
  if (typeof address !== 'string') return null;
  let mint = address;
  try {
    mint = decodeURIComponent(address);
  } catch {
    return null;
  }
  return isMint(mint) ? mint : null;
}

/** A read of the engine as the coin's search makes it: the address and the request, the answer. */
export type ReadFetch = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Whether an answer of the engine is an answer: a clean «yes» or «no such thing» (2xx, 404, 400) says what is at the
 * address; the engine's limit (429) and its failures (5xx) say only that it was not read.
 */
export const answered = (status: number): boolean => status !== 429 && status < 500;

/**
 * A fetch for the coin's search that remembers whether every read was answered: one thrown (the network) or one the
 * engine failed or limited marks the search «failed» — its «no coin» is then a silent source, never «not found». A read
 * the screen itself aborted is not a failure.
 */
export function answeredReads(base: ReadFetch = (input, init) => fetch(input, init)): Readonly<{ fetch: ReadFetch; failed: () => boolean }> {
  let failed = false;
  return {
    fetch: async (input, init) => {
      try {
        const response = await base(input, init);
        if (!answered(response.status)) failed = true;
        return response;
      } catch (error) {
        if (!init?.signal?.aborted) failed = true;
        throw error;
      }
    },
    failed: () => failed,
  };
}

/** A coin as the engine names it when the market read does not hold it. */
export type Named = Readonly<{ mint: string; symbol: string; name: string; icon: string | null; verified: boolean | null }>;

/**
 * A coin outside the market read, in the market's own shape, so the chart and the ticket take it as they take any
 * other: its name is the engine's, and every figure the market would have measured is «not measured» — a screen
 * writes a dash for it, never a zero.
 */
export function standIn(named: Named): Tower {
  return {
    id: named.mint,
    symbol: named.symbol,
    name: named.name,
    icon: named.icon,
    district: 'docks',
    price: 0,
    mcap: 0,
    liquidity: 0,
    holders: 0,
    change5m: 0,
    change1h: 0,
    change24h: 0,
    volume24h: 0,
    traders1h: 0,
    organic: 0,
    verified: named.verified === true,
    launchedAt: null,
    unread: TOWER_FIGURES,
  };
}

/** A figure of the coin, or null where the source did not measure it. */
export function figure(coin: Pick<Tower, TowerFigure | 'unread'>, name: TowerFigure): number | null {
  if (coin.unread?.includes(name)) return null;
  const value = coin[name];
  return Number.isFinite(value) ? value : null;
}

/** The facts under the ticket, in the approved design's order. */
export const FACTS = ['mcap', 'liquidity', 'volume24h', 'traders1h'] as const satisfies readonly TowerFigure[];
export type FactName = (typeof FACTS)[number];

/** The facts the engine measured for this coin; a coin with none shows no tiles at all. */
export function factsOf(coin: Pick<Tower, TowerFigure | 'unread'>): Readonly<{ name: FactName; value: number }>[] {
  return FACTS.flatMap((name) => {
    const value = figure(coin, name);
    return value !== null && value > 0 ? [{ name, value }] : [];
  });
}

export type Position = Readonly<{
  amountRaw: string;
  decimals: number;
  /** At the market's price; null when there is no usable price. */
  valueUsd: number | null;
  /** What the coins held cost on average, in dollars; null unless the engine measured the whole holding. */
  entry: number | null;
  /** The move since the entry in dollars and per cent; null without an entry or a price. */
  resultUsd: number | null;
  resultPct: number | null;
}>;

/**
 * The person's position in the coin: what the wallet holds of it, worth the market's price, and — only where the
 * engine measured what the whole holding cost — how it moved since. Null when the wallet holds none.
 */
export function positionOf(balance: Balance | null, price: number | null, entry: number | null): Position | null {
  if (!balance || !/^\d+$/.test(balance.spendableRaw) || BigInt(balance.spendableRaw) === 0n) return null;
  const units = Number(balance.spendableRaw) / 10 ** balance.decimals;
  const priced = price !== null && Number.isFinite(price) && price > 0;
  const known = priced && entry !== null && Number.isFinite(entry) && entry > 0;
  return {
    amountRaw: balance.spendableRaw,
    decimals: balance.decimals,
    valueUsd: priced ? units * price : null,
    entry: known ? entry : null,
    resultUsd: known ? (price - entry) * units : null,
    resultPct: known ? (price / entry - 1) * 100 : null,
  };
}

/** Dollars with their sign, written the English way: +$3.18, −$0.42, $0.00. */
export function signedUsd(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const text = abs >= 1000 ? abs.toLocaleString('en-US', { maximumFractionDigits: 0 }) : abs.toFixed(2);
  if (Number(text.replace(/,/g, '')) === 0) return '$0.00';
  return `${value > 0 ? '+' : '−'}$${text}`;
}

/** One of the wallet's own trades of the coin, as the engine recorded it. */
export type OwnTrade = Readonly<{
  key: string;
  side: 'buy' | 'sell';
  /** When it settled, ms. */
  at: number;
  quantityRaw: string;
  decimals: number;
  /** What a buy cost, or a sale brought, in dollars; null when the engine did not measure it. */
  usd: number | null;
  /** A sale's result against what the sold coins cost, per cent; null for a buy. */
  resultPct: number | null;
}>;

const DIGITS = /^(0|[1-9][0-9]*)$/;

function micros(value: unknown): number | null {
  return typeof value === 'string' && DIGITS.test(value) ? Number(value) / 1e6 : null;
}

/** The engine's list of the wallet's trades of one coin, newest first; rows it cannot read whole are left out. */
export function tradesOf(body: unknown, mint: string): OwnTrade[] {
  const list = body && typeof body === 'object' ? (body as { trades?: unknown }).trades : null;
  if (!Array.isArray(list)) return [];
  const trades: OwnTrade[] = [];
  for (const row of list) {
    if (!row || typeof row !== 'object') continue;
    const trade = row as Record<string, unknown>;
    if (trade.mint !== mint || (trade.kind !== 'BUY' && trade.kind !== 'SELL')) continue;
    const at = typeof trade.at === 'string' ? Date.parse(trade.at) : typeof trade.at === 'number' ? trade.at : Number.NaN;
    if (!Number.isFinite(at) || typeof trade.key !== 'string') continue;
    if (typeof trade.quantityRaw !== 'string' || !DIGITS.test(trade.quantityRaw)) continue;
    if (typeof trade.decimals !== 'number' || !Number.isInteger(trade.decimals) || trade.decimals < 0 || trade.decimals > 18) continue;
    const sale = trade.kind === 'SELL';
    trades.push({
      key: trade.key,
      side: sale ? 'sell' : 'buy',
      at,
      quantityRaw: trade.quantityRaw,
      decimals: trade.decimals,
      usd: sale ? micros(trade.proceedsMicros) : micros(trade.costMicros),
      resultPct: sale && typeof trade.resultBps === 'number' && Number.isFinite(trade.resultBps) ? trade.resultBps / 100 : null,
    });
  }
  return trades.sort((a, b) => b.at - a.at);
}
