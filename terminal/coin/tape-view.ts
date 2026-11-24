import { isWholeTrade, type TokenHolder, type TokenPool, type TokenTrade } from '../../lib/spot/token-page.ts';
import type { HoldersReach, TraderRow, TradersBasis } from '../../lib/spot/token-traders.ts';
import { isWalletLabel, type LabelBasis, type WalletLabel } from '../../lib/spot/wallet-labels.ts';
import type { EarnBinsAnswer } from '../../lib/earn-pools/bins.ts';
import { digits } from '../../city/lib/i18n/dict.ts';
import type { Lang } from '../../city/lib/i18n/langs.ts';
import { placedFigure, placesFor, priceText } from '../ui/figures.ts';

/**
 * The market of one coin as its desk shows it: the trades as they come, who traded most, who holds it, its
 * pools and the liquidity of its deepest concentrated pool by price. Every figure is the engine's own read
 * (`/api/spot/token`: GeckoTerminal's trades and pools, the chain's largest accounts; `/api/v1/earn/pools/bins`: the
 * pool's bins); here they are only arranged. Pure: the screen reads, these lay out, the tests check.
 */

export type { HoldersReach, LabelBasis, TokenHolder, TokenPool, TokenTrade, TraderRow, TradersBasis, WalletLabel };

/** The most trades the desk keeps of one coin: the engine's read is the pool's last few hundred. */
export const TAPE_KEEP = 300;

/**
 * The newest trades first, each once: a fresh read laid over what the screen holds, so a trade stays where it stood
 * and the new ones come in at the top. `fresh` — the signatures that were not on screen before (the screen lights them
 * a moment). A first read lights nothing. Only whole trades are kept — a trade without its price, its size or its
 * dollars is not a row (a tape of «Buy — 0.000069 —» reads as broken), whatever the source sent.
 */
export function mergeTape(held: readonly TokenTrade[], read: readonly TokenTrade[]): Readonly<{ trades: TokenTrade[]; fresh: ReadonlySet<string> }> {
  const key = (trade: TokenTrade) => `${trade.signature}:${trade.side}`;
  const known = new Set(held.map(key));
  const seen = new Set<string>();
  const all: TokenTrade[] = [];
  for (const trade of [...read, ...held]) {
    if (!isWholeTrade(trade)) continue;
    const k = key(trade);
    if (seen.has(k)) continue;
    seen.add(k);
    all.push(trade);
  }
  all.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const trades = all.slice(0, TAPE_KEEP);
  const fresh = held.length ? new Set(trades.filter((trade) => !known.has(key(trade))).map((trade) => trade.signature)) : new Set<string>();
  return { trades, fresh };
}

/** One wallet's trading over the trades read: what it bought and sold in dollars, its net, how many trades. */
export type Trader = Readonly<{ wallet: string; bought: number; sold: number; net: number; trades: number; last: string }>;

/** The traders of the trades read, the most dollars traded first (bought and sold together). */
export function tradersOf(trades: readonly TokenTrade[], limit = 50): Trader[] {
  const by = new Map<string, { wallet: string; bought: number; sold: number; trades: number; last: string }>();
  for (const trade of trades) {
    const row = by.get(trade.wallet) ?? { wallet: trade.wallet, bought: 0, sold: 0, trades: 0, last: trade.at };
    const usd = trade.usd ?? 0;
    if (trade.side === 'buy') row.bought += usd;
    else row.sold += usd;
    row.trades += 1;
    if (Date.parse(trade.at) > Date.parse(row.last)) row.last = trade.at;
    by.set(trade.wallet, row);
  }
  return [...by.values()]
    .map((row) => ({ ...row, net: row.bought - row.sold }))
    .sort((a, b) => b.bought + b.sold - (a.bought + a.sold) || a.wallet.localeCompare(b.wallet))
    .slice(0, limit);
}

/** The buyers' share of the dollars traded, 0…1; null without a dollar figure on either side. */
export function buyShareOf(trades: readonly TokenTrade[]): number | null {
  let buy = 0;
  let sell = 0;
  for (const trade of trades) {
    if (trade.usd === null) continue;
    if (trade.side === 'buy') buy += trade.usd;
    else sell += trade.usd;
  }
  return buy + sell > 0 ? buy / (buy + sell) : null;
}

/** A trade this large or larger is marked on the candles — and the five largest at most, so marks never cover them. */
export const MARK_MIN_USD = 1_000;
export const MARK_MOST = 5;

/** A mark of the market's own over the candles: the time (ms), the price in dollars, the side, the size as said. */
export type TapeMark = Readonly<{ id: string; t: number; price: number; side: 'buy' | 'sell'; usd: number }>;

/** The largest trades of the read as marks on the candles: past `MARK_MIN_USD`, the largest `MARK_MOST`, oldest first. */
export function bigTrades(trades: readonly TokenTrade[], most = MARK_MOST, min = MARK_MIN_USD): TapeMark[] {
  return trades
    .filter((trade) => trade.usd !== null && trade.usd >= min && trade.priceUsd !== null && trade.priceUsd > 0)
    .sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0))
    .slice(0, most)
    .map((trade) => ({ id: `trade:${trade.signature}:${trade.side}`, t: Date.parse(trade.at), price: trade.priceUsd!, side: trade.side, usd: trade.usd! }))
    .filter((mark) => Number.isFinite(mark.t))
    .sort((a, b) => a.t - b.t);
}

/** A trade this recent is «now»: the market is live while its newest trade is at most this old. */
export const LIVE_TRADE_MS = 90_000;

/**
 * What the chart's chip says («Live» stood over a tape whose newest trade was five minutes old). `live` only
 * while the newest trade read is at most `LIVE_TRADE_MS` old and the read did not fail — and, over candles, while their
 * read is fresh too; else the newest trade's time, quietly, where there is one; else «Delayed».
 */
export function liveOf(input: Readonly<{ ticks: boolean; candlesFresh: boolean; newestTradeAt: string | null; tradesStale: boolean; now: number }>): Readonly<{ kind: 'live' } | { kind: 'trade'; at: string } | { kind: 'delayed' }> {
  const at = input.newestTradeAt;
  const t = at ? Date.parse(at) : Number.NaN;
  const known = at !== null && Number.isFinite(t);
  const tradesLive = known && !input.tradesStale && input.now - t <= LIVE_TRADE_MS;
  const fed = input.ticks || input.candlesFresh;
  if (fed && (input.ticks ? tradesLive : tradesLive || !known)) return { kind: 'live' };
  if (fed && known) return { kind: 'trade', at: at! };
  return { kind: 'delayed' };
}

/**
 * A price for the narrow trades column («$0.000002…» was cut at 1440): a run of four zeros or more after
 * the point folds into a small figure — $0.0₅2389 — as the chart's scale writes it; four significant figures.
 */
export function tapePrice(price: number, lang: Lang): string {
  if (!Number.isFinite(price) || price <= 0 || price >= 0.01) return priceText(price, lang);
  return digits(`$${placedFigure(price, placesFor(price, 4))}`, lang);
}

/** A wallet short, as a trader reads it: the first four and the last four. */
export const shortAddress = (address: string): string => (address.length > 12 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address);

/** How long ago, short: «12s», «4m», «3h», «2d» — the units the screen's words write. */
export function agoOf(at: string, now: number): Readonly<{ unit: 's' | 'm' | 'h' | 'd'; n: number }> | null {
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return null;
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return { unit: 's', n: s };
  if (s < 3_600) return { unit: 'm', n: Math.floor(s / 60) };
  if (s < 86_400) return { unit: 'h', n: Math.floor(s / 3_600) };
  return { unit: 'd', n: Math.floor(s / 86_400) };
}

/** The holders a person reads: the pools, locks and vaults (a program's accounts) apart from the people's wallets. */
export function holdersSplit(holders: readonly TokenHolder[]): Readonly<{ people: TokenHolder[]; programs: TokenHolder[] }> {
  const people: TokenHolder[] = [];
  const programs: TokenHolder[] = [];
  for (const holder of holders) (holder.labels.includes('program') || holder.labels.includes('pool') ? programs : people).push(holder);
  return { people, programs };
}

/** One row of the pool's liquidity by price, as an order book draws it. */
export type DepthRow = Readonly<{ key: string; price: number; usd: number; total: number; side: 'ask' | 'bid'; share: number }>;

/** How many rows each side of the price the pool's book shows. */
export const DEPTH_SIDE_ROWS = 14;
/** A bin worth less than a cent holds nothing a book would show. */
export const DEPTH_DUST_USD = 0.01;

/**
 * The pool's bins as an order book in dollars: above the price what the pool sells of the coin (asks), under it what it
 * buys the coin with (bids), each row a band of bins gathered to `rows` a side, its worth in dollars and the running
 * total from the price outwards; `share` is a row's total against the deepest side's total (the bar behind it). The
 * pool prices Y per one X; `side` says which of the two the coin is, and `coinUsd` the coin's dollar price now. Empty
 * where the coin's dollar price is not known.
 */
export function depthBook(answer: EarnBinsAnswer, side: 'x' | 'y', coinUsd: number | null, rows = DEPTH_SIDE_ROWS): Readonly<{ asks: DepthRow[]; bids: DepthRow[] }> {
  if (coinUsd === null || !(coinUsd > 0) || !answer.bins.length || !(answer.price > 0)) return { asks: [], bids: [] };
  const coinNow = side === 'x' ? answer.price : 1 / answer.price;
  // One unit of the pool's other coin in dollars: the coin's dollar price over its price in that coin.
  const otherUsd = coinUsd / coinNow;
  const xUsd = side === 'x' ? coinUsd : otherUsd;
  const yUsd = side === 'x' ? otherUsd : coinUsd;
  const worth = (bin: EarnBinsAnswer['bins'][number]) => (Number(bin.x) / 10 ** answer.x.decimals) * xUsd + (Number(bin.y) / 10 ** answer.y.decimals) * yUsd;
  // The coin's dollar price at a bin: the pool's price there, turned to the coin and to dollars.
  const usdAt = (price: number) => (side === 'x' ? price : 1 / price) * otherUsd;
  const above = answer.bins.filter((bin) => bin.offset > 0);
  const below = answer.bins.filter((bin) => bin.offset < 0);
  // For the coin as Y the pool's «above» is the coin's «below»: what lies over the pool's price is under the coin's.
  const up = side === 'x' ? above : below;
  const down = side === 'x' ? below : above;
  const gather = (bins: readonly EarnBinsAnswer['bins'][number][], tone: 'ask' | 'bid'): DepthRow[] => {
    // A book shows the levels that hold something: an empty bin of the pool is no level — a run of «$0» rows
    // over a price the pool has not filled read as a broken book.
    const near = bins.filter((bin) => worth(bin) >= DEPTH_DUST_USD).sort((a, b) => Math.abs(a.offset) - Math.abs(b.offset));
    if (!near.length) return [];
    const size = Math.max(1, Math.ceil(near.length / rows));
    const out: DepthRow[] = [];
    let total = 0;
    for (let start = 0; start < near.length; start += size) {
      const group = near.slice(start, start + size);
      const usd = group.reduce((sum, bin) => sum + worth(bin), 0);
      total += usd;
      const edge = group[group.length - 1]!;
      out.push({ key: `${tone}:${edge.id}`, price: usdAt(edge.price), usd, total, side: tone, share: 0 });
    }
    return out;
  };
  const asks = gather(up, 'ask');
  const bids = gather(down, 'bid');
  // The step the price stands in holds both coins: it counts on neither side's bar (offset 0 is in neither list).
  const deepest = Math.max(asks.at(-1)?.total ?? 0, bids.at(-1)?.total ?? 0);
  const withShare = (list: DepthRow[]) => list.map((row) => ({ ...row, share: deepest > 0 ? row.total / deepest : 0 }));
  return { asks: withShare(asks), bids: withShare(bids) };
}

/** The dex's own name, as people know it, for a pool row. */
export function dexName(dex: string | null): string {
  if (!dex) return '—';
  const known: Readonly<Record<string, string>> = {
    orca: 'Orca',
    raydium: 'Raydium',
    'raydium-clmm': 'Raydium CLMM',
    'raydium-cp': 'Raydium CPMM',
    meteora: 'Meteora DLMM',
    'meteora-damm-v2': 'Meteora DAMM v2',
    'meteora-dbc': 'Meteora DBC',
    pumpswap: 'PumpSwap',
    'pump-fun': 'pump.fun',
    phoenix: 'Phoenix',
    lifinity: 'Lifinity',
    'lifinity-v2': 'Lifinity',
  };
  return known[dex] ?? dex.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/* ------------------------------------------------- who bought, who holds, who earned */

/**
 * The marks a wallet shows beside it, in the order a trader reads them: the wallet's own (Ryntra's agent, the creator, a
 * top holder, a pool or a vault, a new wallet) before the trade's (a big one). Only the marks the engine sent; a field
 * that is absent or holds something else is no mark.
 */
export const MARK_ORDER: readonly WalletLabel[] = ['ryntra-agent', 'creator', 'top-holder', 'pool', 'program', 'fresh', 'big'];

export function marksOf(labels: readonly unknown[] | undefined, most = 2): WalletLabel[] {
  if (!Array.isArray(labels) || !labels.length) return [];
  const known = new Set(labels.filter(isWalletLabel));
  return MARK_ORDER.filter((mark) => known.has(mark)).slice(0, most);
}

/** The signs the rows show (each row its first `most`), in the marks' own order: what the trades' «i» explains. */
export function signsOf(trades: readonly Readonly<{ labels?: readonly unknown[] }>[], most = 2): WalletLabel[] {
  const shown = new Set(trades.flatMap((trade) => marksOf(trade.labels, most)));
  return MARK_ORDER.filter((mark) => shown.has(mark));
}

/** What the trades' marks stand on, as the filters need it: the creator named, the top holders read. Null — no marks came. */
export type TapeMarks = Readonly<{ creator: boolean; top: boolean; bigUsd: number }>;

export function tapeMarksOf(basis: unknown): TapeMarks | null {
  if (!basis || typeof basis !== 'object') return null;
  const b = basis as Partial<LabelBasis>;
  const bigUsd = typeof b.bigTradeUsd === 'number' && Number.isFinite(b.bigTradeUsd) && b.bigTradeUsd > 0 ? b.bigTradeUsd : MARK_MIN_USD;
  return { creator: b.creator === true, top: typeof b.topHolders === 'number' && b.topHolders > 0, bigUsd };
}

export const TAPE_FILTERS = ['all', 'creator', 'big', 'top', 'mine'] as const;
export type TapeFilter = (typeof TAPE_FILTERS)[number];

/**
 * The filters a person can pick over the trades: «All» and «Big» always; «Creator» once the creator is named and «Top
 * holders» once the holders were read — never a filter that would be empty for want of a read; «Mine» with a wallet.
 */
export function tapeFiltersOf(marks: TapeMarks | null, me: string | null): TapeFilter[] {
  return TAPE_FILTERS.filter((filter) => filter === 'all' || filter === 'big' || (filter === 'creator' && marks?.creator === true) || (filter === 'top' && marks?.top === true) || (filter === 'mine' && Boolean(me)));
}

/** A big trade: the engine's own mark where it marked the trades, else the dollars against the bar. */
export function isBigTrade(trade: TokenTrade, marks: TapeMarks | null): boolean {
  if (marks) return Array.isArray(trade.labels) && trade.labels.includes('big');
  return trade.usd !== null && trade.usd >= MARK_MIN_USD;
}

/** The trades a filter keeps, in their order. A filter the screen does not offer now keeps them all. */
export function filterTape(trades: readonly TokenTrade[], filter: TapeFilter, marks: TapeMarks | null, me: string | null): readonly TokenTrade[] {
  if (!tapeFiltersOf(marks, me).includes(filter) || filter === 'all') return trades;
  const has = (trade: TokenTrade, mark: WalletLabel) => Array.isArray(trade.labels) && trade.labels.includes(mark);
  if (filter === 'creator') return trades.filter((trade) => has(trade, 'creator'));
  if (filter === 'top') return trades.filter((trade) => has(trade, 'top-holder'));
  if (filter === 'mine') return trades.filter((trade) => trade.wallet === me);
  return trades.filter((trade) => isBigTrade(trade, marks));
}

/** What a holder did in the trades read: bought more, sold, both evenly; null — it did not trade in them. */
export type HolderMove = Readonly<{ kind: 'added' | 'sold' | 'even'; tokens: number }>;

export function holderMoveOf(holder: Pick<TokenHolder, 'change' | 'trades'>): HolderMove | null {
  const change = holder.change;
  if (change === null || !Number.isFinite(change)) return null;
  if (change > 0) return { kind: 'added', tokens: change };
  if (change < 0) return { kind: 'sold', tokens: -change };
  return holder.trades > 0 ? { kind: 'even', tokens: 0 } : null;
}

/** A holder's marks: the creator, a pool or a vault — the facts the holders read states. */
export function holderMarksOf(labels: readonly string[]): WalletLabel[] {
  if (labels.includes('creator')) return ['creator'];
  if (labels.includes('pool')) return ['pool'];
  if (labels.includes('program')) return ['program'];
  return [];
}

/**
 * Whether the holders listed are only part of them, and of how many: the largest `listed` of `of` holders, or the largest
 * `listed` where the count is not stated. Null — the list is every holder, or the read did not say how far it reaches.
 */
export function holdersPartOf(reach: HoldersReach | null | undefined, listed: number): Readonly<{ listed: number; of: number | null }> | null {
  if (!reach || listed <= 0) return null;
  if (reach.holders !== null && Number.isFinite(reach.holders) && reach.holders > listed) return { listed, of: reach.holders };
  if (reach.holders === null && !reach.whole) return { listed, of: null };
  return null;
}

/** The traders' order: by their result, the largest first (`down`) or the smallest; a result not known goes last, by turnover. */
export function sortTraders(rows: readonly TraderRow[], dir: 'down' | 'up' = 'down'): TraderRow[] {
  const turnover = (row: TraderRow) => row.boughtUsd + row.soldUsd;
  return [...rows].sort((a, b) => {
    const ka = a.resultUsd !== null && Number.isFinite(a.resultUsd);
    const kb = b.resultUsd !== null && Number.isFinite(b.resultUsd);
    if (ka !== kb) return ka ? -1 : 1;
    if (ka && kb && a.resultUsd !== b.resultUsd) return dir === 'down' ? b.resultUsd! - a.resultUsd! : a.resultUsd! - b.resultUsd!;
    return turnover(b) - turnover(a) || a.wallet.localeCompare(b.wallet);
  });
}

/** A signed sum in dollars as a result is read: «+$1.2K», «−$310», «$0». */
export function signedSum(value: number, sum: (abs: number) => string): string {
  if (!Number.isFinite(value)) return '—';
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${sum(Math.abs(value))}`;
}

/** The tone of a result: mint up, flare down, none for nothing. */
export const resultTone = (value: number | null): 'up' | 'down' | undefined => (value === null || !Number.isFinite(value) || value === 0 ? undefined : value > 0 ? 'up' : 'down');
