/**
 * A person's grid as it is kept and read back: what was asked (the band, the coin, the pool), the orders it placed, what
 * was taken back and not yet placed again, and what it earned — and how it stands now, from the chain's own read of
 * its orders (`lib/pro-limits` `proOrders`).
 *
 * The orders live on the chain and are the person's; this record is the browser's memory of which of them make one
 * grid. Lose it and the orders still stand in the wallet, each taken or cancelled on its own.
 *
 * Pure: no I/O, no clock.
 */

import type { LadderOrderRead } from '../bots/ladder/orders.ts';
import type { ProOrder } from '../pro-limits/service.ts';

import { gridPrices, gridStep, refillPlan, type GridIntent, type GridShape } from './plan.ts';

export type GridNetwork = 'devnet' | 'mainnet';
/** Where a grid's orders rest: DLMM Pro's limit orders, or the classic DLMM ladder's (`./classic.ts`). */
export type GridVenue = 'pro' | 'dlmm';
export type GridCoin = Readonly<{ mint: string; symbol: string; decimals: number }>;
export type GridOrderRef = Readonly<{ nftMint: string; action: 'buy' | 'sell' }>;

export type GridRecord = Readonly<{
  v: 1;
  id: string;
  network: GridNetwork;
  venue: GridVenue;
  owner: string;
  pool: string;
  coin: GridCoin;
  quote: GridCoin;
  /** The band, in the quote coin's price of the coin. */
  shape: GridShape;
  /** The amount the person put in, in the quote coin. */
  amount: number;
  createdAt: number;
  stoppedAt: number | null;
  /** Every order the grid placed, first to last. */
  orders: readonly GridOrderRef[];
  /** Taken back from filled prices and not yet placed again, base units: the coin buys bought, the quote sells were paid. */
  free: Readonly<{ coinRaw: string; quoteRaw: string }>;
  /** Prices filled and taken back, over the grid's life. */
  filledTaken: number;
  /**
   * What the coin the grid holds cost, in the quote coin: the coin it sold from the start at the price the grid started
   * at, the coin its buys bought at the prices they filled at. Sells are counted against its average.
   */
  basis: Readonly<{ coinRaw: string; quoteRaw: string }>;
  /** What the grid earned on sells taken back — their pay over what the coin cost — in the quote coin; may be below zero. */
  profitRaw: string;
  /** The maker's bonus taken, per coin it was paid in. */
  bonusTaken: Readonly<Record<string, string>>;
}>;

export type GridState = 'working' | 'filled' | 'idle' | 'stopped';

export type GridView = Readonly<{
  state: GridState;
  /** The grid's orders the chain still holds. */
  live: readonly ProOrder[];
  /** Prices resting, filled and waiting to be taken, and filled over the grid's life. */
  resting: number;
  waiting: number;
  filled: number;
  /** Earned on what was taken back, in the quote coin. */
  profitRaw: bigint;
  /** The maker's bonus: taken and waiting, per coin. */
  bonus: Readonly<Record<string, bigint>>;
  /** What still rests at the edges of the grid: the highest buy, the lowest sell; null — none rests on that side. */
  edges: Readonly<{ buyHigh: number | null; sellLow: number | null }>;
  canTake: boolean;
  canStop: boolean;
}>;

const add = (into: Record<string, bigint>, mint: string | null, raw: bigint | string) => {
  if (!mint) return;
  const value = BigInt(raw);
  if (value > 0n) into[mint] = (into[mint] ?? 0n) + value;
};

/** A grid as it stands, from the chain's read of the wallet's orders. */
export function gridView(record: GridRecord, orders: readonly ProOrder[]): GridView {
  const mine = new Map(record.orders.map((order) => [order.nftMint, order.action]));
  const live = orders.filter((order) => mine.has(order.nftMint));
  let resting = 0;
  let waiting = 0;
  const bonus: Record<string, bigint> = {};
  for (const [mint, raw] of Object.entries(record.bonusTaken)) add(bonus, mint, raw);
  let buyHigh: number | null = null;
  let sellLow: number | null = null;
  for (const order of live) {
    resting += order.prices - order.filledPrices;
    waiting += order.filledPrices;
    add(bonus, order.bonus.mint, order.bonus.ownerRaw);
    const action = order.action ?? mine.get(order.nftMint) ?? null;
    if (order.prices - order.filledPrices > 0) {
      if (action === 'buy' && order.highPrice !== null) buyHigh = Math.max(buyHigh ?? 0, order.highPrice);
      if (action === 'sell' && order.lowPrice !== null) sellLow = sellLow === null ? order.lowPrice : Math.min(sellLow, order.lowPrice);
    }
  }
  const stopped = record.stoppedAt !== null;
  const state: GridState = stopped && live.length === 0 ? 'stopped' : waiting > 0 ? 'filled' : resting > 0 ? 'working' : 'idle';
  return {
    state,
    live,
    resting,
    waiting,
    filled: record.filledTaken + waiting,
    profitRaw: BigInt(record.profitRaw),
    bonus,
    edges: { buyHigh, sellLow },
    canTake: waiting > 0,
    canStop: live.length > 0,
  };
}

/**
 * A grid on the classic venue as it stands, from the ladder's read of its orders: prices resting and filled. The classic
 * read counts prices, not amounts, and its orders pay no maker's bonus — so it tells no earnings, and what filled is
 * taken back with its order when the grid is placed again.
 */
export function classicView(record: GridRecord, reads: Readonly<Record<string, LadderOrderRead | undefined>>): GridView {
  const live = record.orders.map((order) => reads[order.nftMint]).filter((read): read is LadderOrderRead => read !== undefined && read.state !== 'closed');
  const resting = live.reduce((n, read) => n + read.rungs - read.filled, 0);
  const waiting = live.reduce((n, read) => n + read.filled, 0);
  /* A classic grid is stopped only once every order was cancelled and confirmed: its reads then say nothing more. */
  const state: GridState = record.stoppedAt !== null ? 'stopped' : waiting > 0 ? 'filled' : resting > 0 ? 'working' : 'idle';
  return { state, live: [], resting, waiting, filled: record.filledTaken + waiting, profitRaw: 0n, bonus: {}, edges: { buyHigh: null, sellLow: null }, canTake: false, canStop: live.length > 0 || record.orders.length > 0 };
}

/** What placing again would place now: the free coin and quote over the grid's empty levels. */
export function gridRefill(record: GridRecord, view: GridView, price: number): Readonly<{ buy: GridIntent | null; sell: GridIntent | null }> {
  if (record.stoppedAt !== null || !(price > 0)) return { buy: null, sell: null };
  return refillPlan(gridPrices(record.shape), gridStep(record.shape), price, view.edges, { coinRaw: BigInt(record.free.coinRaw), quoteRaw: BigInt(record.free.quoteRaw) });
}

/** Base units of the quote coin a coin's amount is worth at a price (quote per coin, whole tokens), rounded down. */
export function quoteWorth(coinRaw: bigint, price: number, coinDecimals: number, quoteDecimals: number): bigint {
  if (coinRaw <= 0n || !(price > 0) || !Number.isFinite(price)) return 0n;
  /* The price as fifteen significant digits over a power of ten keeps it whole however small: coin × price × 10^(q − c). */
  const k = Math.max(0, 14 - Math.floor(Math.log10(price)));
  const scaled = BigInt(Math.round(price * 10 ** Math.min(k, 300)));
  const den = 10n ** BigInt(Math.min(k, 300));
  const shift = quoteDecimals - coinDecimals;
  const value = coinRaw * scaled;
  return shift >= 0 ? (value * 10n ** BigInt(shift)) / den : value / (den * 10n ** BigInt(-shift));
}

/**
 * The record after orders landed: a first placing (`fromFree` false) takes from the wallet, and the coin its sells rest
 * is the grid's starting coin, costed at the price the grid started at; a placing again takes from what was taken.
 */
export function withPlaced(record: GridRecord, placed: readonly Readonly<{ nftMint: string; action: 'buy' | 'sell'; restsRaw: string }>[], fromFree: boolean, startPrice: number | null = null): GridRecord {
  let coin = BigInt(record.free.coinRaw);
  let quote = BigInt(record.free.quoteRaw);
  let basisCoin = BigInt(record.basis.coinRaw);
  let basisQuote = BigInt(record.basis.quoteRaw);
  for (const order of placed) {
    if (fromFree) {
      if (order.action === 'sell') coin -= BigInt(order.restsRaw);
      else quote -= BigInt(order.restsRaw);
    } else if (order.action === 'sell' && startPrice !== null) {
      basisCoin += BigInt(order.restsRaw);
      basisQuote += quoteWorth(BigInt(order.restsRaw), startPrice, record.coin.decimals, record.quote.decimals);
    }
  }
  return {
    ...record,
    orders: [...record.orders, ...placed.map(({ nftMint, action }) => ({ nftMint, action })).filter((order) => !record.orders.some((known) => known.nftMint === order.nftMint))],
    free: { coinRaw: (coin > 0n ? coin : 0n).toString(), quoteRaw: (quote > 0n ? quote : 0n).toString() },
    basis: { coinRaw: basisCoin.toString(), quoteRaw: basisQuote.toString() },
  };
}

/** What one order's take brought to the wallet, as the lane's Review told it: per coin, after the referral's part. */
export type Taken = Readonly<{ order: ProOrder; coinRaw: bigint; quoteRaw: bigint }>;

/**
 * The record after filled prices were taken back, booked from what reached the wallet (the Review's own `receives`):
 * less the maker's bonus, it is free to be placed again. A buy's coin is costed at the price it filled at; a sell's pay, less the maker's
 * bonus, is counted against the average cost of the coin it sold — that is what the grid earned, gain or loss. The
 * bonus is the person's, counted apart.
 */
export function withTaken(record: GridRecord, taken: readonly Taken[]): GridRecord {
  let coin = BigInt(record.free.coinRaw);
  let quote = BigInt(record.free.quoteRaw);
  let profit = BigInt(record.profitRaw);
  let basisCoin = BigInt(record.basis.coinRaw);
  let basisQuote = BigInt(record.basis.quoteRaw);
  const bonus: Record<string, bigint> = {};
  for (const [mint, raw] of Object.entries(record.bonusTaken)) add(bonus, mint, raw);
  let filled = record.filledTaken;
  const actions = new Map(record.orders.map((order) => [order.nftMint, order.action]));
  for (const { order, coinRaw, quoteRaw } of taken) {
    const action = order.action ?? actions.get(order.nftMint) ?? null;
    const bonusRaw = BigInt(order.bonus.ownerRaw);
    const bonusQuote = order.bonus.mint === record.quote.mint ? bonusRaw : 0n;
    const bonusCoin = order.bonus.mint === record.coin.mint ? bonusRaw : 0n;
    /* The bonus is the person's own, counted apart: it is not placed again. */
    coin += coinRaw > bonusCoin ? coinRaw - bonusCoin : 0n;
    quote += quoteRaw > bonusQuote ? quoteRaw - bonusQuote : 0n;
    const price = order.filledPrice;
    if (action === 'buy') {
      const bought = coinRaw > bonusCoin ? coinRaw - bonusCoin : 0n;
      basisCoin += bought;
      basisQuote += price !== null ? quoteWorth(bought, price, record.coin.decimals, record.quote.decimals) : 0n;
    }
    if (action === 'sell' && price !== null && price > 0) {
      const paid = quoteRaw > bonusQuote ? quoteRaw - bonusQuote : 0n;
      /* The coin this pay sold, at the price it filled at; its cost at the average of what the grid holds. */
      const one = quoteWorth(10n ** BigInt(record.coin.decimals), price, record.coin.decimals, record.quote.decimals);
      const sold = one > 0n ? (paid * 10n ** BigInt(record.coin.decimals)) / one : 0n;
      const counted = sold < basisCoin ? sold : basisCoin;
      const cost = basisCoin > 0n ? (basisQuote * counted) / basisCoin : 0n;
      profit += paid - cost;
      basisCoin -= counted;
      basisQuote -= cost;
    }
    filled += order.filledPrices;
    add(bonus, order.bonus.mint, bonusRaw);
  }
  return {
    ...record,
    free: { coinRaw: coin.toString(), quoteRaw: quote.toString() },
    basis: { coinRaw: basisCoin.toString(), quoteRaw: basisQuote.toString() },
    profitRaw: profit.toString(),
    filledTaken: filled,
    bonusTaken: Object.fromEntries(Object.entries(bonus).map(([mint, raw]) => [mint, raw.toString()])),
  };
}

/** The record after the grid was stopped: everything came back to the wallet, nothing is left to place again. */
export function withStopped(record: GridRecord, taken: readonly Taken[], at: number): GridRecord {
  const done = withTaken(record, taken.filter(({ order }) => order.filledPrices > 0));
  return { ...done, stoppedAt: at, free: { coinRaw: '0', quoteRaw: '0' } };
}

/** What a take or a close Review says reached the wallet, as the grid's coin and quote. */
export function takenOf(order: ProOrder, receives: Readonly<{ xRaw: string; yRaw: string; x: string; y: string }> | null, coinMint: string): Taken {
  if (!receives) return { order, coinRaw: 0n, quoteRaw: 0n };
  const coinIsX = receives.x === coinMint;
  return { order, coinRaw: BigInt(coinIsX ? receives.xRaw : receives.yRaw), quoteRaw: BigInt(coinIsX ? receives.yRaw : receives.xRaw) };
}

/** A record read back from storage, or null where it is not one. */
export function readRecord(value: unknown): GridRecord | null {
  if (!value || typeof value !== 'object') return null;
  const r = value as Partial<GridRecord>;
  const coin = (c: unknown): c is GridCoin => Boolean(c) && typeof (c as GridCoin).mint === 'string' && typeof (c as GridCoin).symbol === 'string' && Number.isInteger((c as GridCoin).decimals);
  if (r.v !== 1 || typeof r.id !== 'string' || (r.network !== 'devnet' && r.network !== 'mainnet') || (r.venue !== undefined && r.venue !== 'pro' && r.venue !== 'dlmm') || typeof r.owner !== 'string' || typeof r.pool !== 'string') return null;
  if (!coin(r.coin) || !coin(r.quote) || !r.shape || typeof r.shape.lower !== 'number' || typeof r.shape.upper !== 'number' || typeof r.shape.levels !== 'number') return null;
  if (!Array.isArray(r.orders) || !r.orders.every((o) => o && typeof o.nftMint === 'string' && (o.action === 'buy' || o.action === 'sell'))) return null;
  const raw = (v: unknown) => typeof v === 'string' && /^\d{1,30}$/.test(v);
  const signed = (v: unknown) => typeof v === 'string' && /^-?\d{1,30}$/.test(v);
  if (!r.free || !raw(r.free.coinRaw) || !raw(r.free.quoteRaw) || !signed(r.profitRaw) || typeof r.createdAt !== 'number') return null;
  const basis = r.basis && raw(r.basis.coinRaw) && raw(r.basis.quoteRaw) ? { coinRaw: r.basis.coinRaw, quoteRaw: r.basis.quoteRaw } : { coinRaw: '0', quoteRaw: '0' };
  const bonus = r.bonusTaken && typeof r.bonusTaken === 'object' ? Object.fromEntries(Object.entries(r.bonusTaken).filter(([, v]) => raw(v))) : {};
  return {
    v: 1,
    id: r.id,
    network: r.network,
    venue: r.venue ?? 'pro',
    owner: r.owner,
    pool: r.pool,
    coin: r.coin,
    quote: r.quote,
    shape: { lower: r.shape.lower, upper: r.shape.upper, levels: r.shape.levels },
    amount: typeof r.amount === 'number' ? r.amount : 0,
    createdAt: r.createdAt,
    stoppedAt: typeof r.stoppedAt === 'number' ? r.stoppedAt : null,
    orders: r.orders.map((o) => ({ nftMint: o.nftMint, action: o.action })),
    free: { coinRaw: r.free.coinRaw, quoteRaw: r.free.quoteRaw },
    filledTaken: typeof r.filledTaken === 'number' ? r.filledTaken : 0,
    basis,
    profitRaw: r.profitRaw!,
    bonusTaken: bonus as Record<string, string>,
  };
}
