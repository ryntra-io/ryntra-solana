import type { EarnBinsAnswer } from '../../lib/earn-pools/bins.ts';
import type { EarnPool } from '../../lib/earn-pools/model.ts';
import type { EarnProPier } from '../../lib/api/v1/contract.ts';
import { tickerOf, type ProPoolCoin, type ProPoolRow } from '../../lib/pro-pools/model.ts';

/**
 * Any pool of Meteora as its own page reads it, and nothing more: a DLMM Pro pool from the program's own
 * account (`/api/pro/pools/<address>`), a DLMM or DAMM v2 pool from the engine's catalogue (`/api/v1/earn/pools`) with
 * its price from its bins, or a DLMM pool the catalogue does not list from its bins alone; the other pools of the same
 * pair for the picker beside its name; and which of the ticket's three tabs — Position · Limit · Swap — the pool offers,
 * as Meteora lays a pool out (Create Position · Limit Order · Swap). Pure: the screens and the tests read it alike.
 */

export type DeskVenue = 'pro' | 'dlmm' | 'damm';

export type DeskPool = Readonly<{
  venue: DeskVenue;
  address: string;
  x: ProPoolCoin;
  y: ProPoolCoin;
  /** Token Y per token X, in whole coins; null until the pool's own price is read. */
  price: number | null;
  tvlUsd: number | null;
  /** What a swap pays now, per cent. */
  feePct: number | null;
  /** The price's step between neighbours, basis points. */
  stepBps: number | null;
  /** The venue's day: what traded through the pool and what trades paid it, dollars; null where nobody keeps it (DLMM Pro). */
  volume24hUsd: number | null;
  fees24hUsd: number | null;
  /** The pool's own page at Meteora; null for DLMM Pro, which Meteora keeps to its waitlist. */
  page: string | null;
  /** The program's own row of a DLMM Pro pool: its fee's parts, the bonus of a limit order, what is open. */
  pro: ProPoolRow | null;
}>;

const SOL_MINT = 'So11111111111111111111111111111111111111112';

const coinOf = (mint: string, symbol: string | null, decimals: number, verified: boolean | null = null): ProPoolCoin => ({ mint, symbol, name: symbol, decimals, icon: null, verified, usd: null });

export function deskOfPro(row: ProPoolRow): DeskPool {
  return { venue: 'pro', address: row.address, x: row.x, y: row.y, price: row.price, tvlUsd: row.tvlUsd, feePct: row.fee.totalBps / 100, stepBps: row.stepBps, volume24hUsd: null, fees24hUsd: null, page: null, pro: row };
}

/** A catalogue pool, its coins' decimals and its own price from its bins once they are read. */
export function deskOfCatalog(pool: EarnPool, bins: EarnBinsAnswer | null): DeskPool {
  const own = bins && bins.pool === pool.address ? bins : null;
  return {
    venue: pool.kind === 'dlmm' ? 'dlmm' : 'damm',
    address: pool.address,
    x: coinOf(pool.x.mint, pool.x.symbol, own?.x.decimals ?? 0, pool.x.verified),
    y: coinOf(pool.y.mint, pool.y.symbol, own?.y.decimals ?? 0, pool.y.verified),
    price: own && own.price > 0 ? own.price : null,
    tvlUsd: pool.tvlUsd,
    feePct: pool.feePct,
    stepBps: pool.binStepBps,
    volume24hUsd: pool.volume24hUsd,
    fees24hUsd: pool.fees24hUsd,
    page: pool.page || null,
    pro: null,
  };
}

/** A DLMM pool the catalogue does not list (too shallow for it): its bins alone, its coins named by whoever names them. */
export function deskOfBins(bins: EarnBinsAnswer, symbolOf: (mint: string) => string | null = () => null): DeskPool {
  return {
    venue: 'dlmm',
    address: bins.pool,
    x: coinOf(bins.x.mint, symbolOf(bins.x.mint) ?? (bins.x.mint === SOL_MINT ? 'SOL' : null), bins.x.decimals),
    y: coinOf(bins.y.mint, symbolOf(bins.y.mint) ?? (bins.y.mint === SOL_MINT ? 'SOL' : null), bins.y.decimals),
    price: bins.price > 0 ? bins.price : null,
    tvlUsd: null,
    feePct: null,
    stepBps: bins.stepBps,
    volume24hUsd: null,
    fees24hUsd: null,
    page: null,
    pro: null,
  };
}

/** The venue's name as Meteora writes it beside a pool. */
export const VENUE_MARK: Readonly<Record<DeskVenue, string>> = { pro: 'Meteora DLMM Pro', dlmm: 'Meteora DLMM', damm: 'Meteora DAMM v2' };
/** The same, short, for a row of the picker. */
export const VENUE_SHORT: Readonly<Record<DeskVenue, string>> = { pro: 'DLMM Pro', dlmm: 'DLMM', damm: 'DAMM v2' };

/** The bins a pool's liquidity by price is read from: DLMM Pro's steps, DLMM's bins; none for DAMM v2. */
export const binsVenueOf = (venue: DeskVenue): 'pro' | 'dlmm' | null => (venue === 'damm' ? null : venue);

export type PairPool = Readonly<{
  venue: DeskVenue;
  address: string;
  feePct: number | null;
  stepBps: number | null;
  tvlUsd: number | null;
  /** What a limit order earns on top in a DLMM Pro pool, basis points; null for DLMM and DAMM v2, which have no limits. */
  bonusBps: number | null;
  here: boolean;
}>;

const samePair = (a: Readonly<{ x: { mint: string }; y: { mint: string } }>, mints: ReadonlySet<string>) => mints.size === 2 && mints.has(a.x.mint) && mints.has(a.y.mint) && a.x.mint !== a.y.mint;

/**
 * Every pool of the pair, whichever way round its two coins stand — DLMM Pro's from the program, DLMM's and DAMM v2's
 * from the catalogue — the deepest first, the page's own among them (`here`), each once.
 */
export function pairPools(here: Pick<DeskPool, 'address' | 'x' | 'y'>, pro: readonly ProPoolRow[], catalog: readonly EarnPool[]): PairPool[] {
  const mints = new Set([here.x.mint, here.y.mint]);
  const seen = new Set<string>();
  const out: PairPool[] = [];
  const add = (row: PairPool) => {
    if (seen.has(row.address)) return;
    seen.add(row.address);
    out.push(row);
  };
  for (const row of pro) if (samePair(row, mints)) add({ venue: 'pro', address: row.address, feePct: row.fee.totalBps / 100, stepBps: row.stepBps, tvlUsd: row.tvlUsd, bonusBps: row.bonusBps, here: row.address === here.address });
  for (const pool of catalog) if (samePair(pool, mints)) add({ venue: pool.kind === 'dlmm' ? 'dlmm' : 'damm', address: pool.address, feePct: pool.feePct, stepBps: pool.binStepBps, tvlUsd: pool.tvlUsd, bonusBps: null, here: pool.address === here.address });
  return out.sort((a, b) => (b.tvlUsd ?? -1) - (a.tvlUsd ?? -1) || (a.address < b.address ? -1 : 1));
}

/** The picker's groups, in their order: DLMM Pro — limit orders with a bonus —, DLMM — the most liquidity —, DAMM v2. */
export const PAIR_GROUPS: readonly DeskVenue[] = ['pro', 'dlmm', 'damm'];

/**
 * The pair's pools as the picker lays them: a group a kind of pool, DLMM Pro's first, each the deepest first; a kind
 * the pair has no pool of is no group.
 */
export function pairGroups(pools: readonly PairPool[]): Readonly<{ venue: DeskVenue; pools: readonly PairPool[] }>[] {
  return PAIR_GROUPS.map((venue) => ({ venue, pools: pools.filter((pool) => pool.venue === venue) })).filter((group) => group.pools.length > 0);
}

/**
 * The ticket's tab a turn to another pool of the pair keeps, so the turn holds no surprise: the swap stays a swap, the
 * position a position where the pool takes one (never DAMM v2's from here); a limit order, or the pool's first tab, gives
 * way to the other pool's own first — a DLMM pool has no limits, and an empty Pro pool opens on its first position.
 */
export function carriedTab(tab: string | null, venue: DeskVenue): TicketTab | null {
  if (tab === 'swap') return 'swap';
  if (tab === 'position' && venue !== 'damm') return 'position';
  return null;
}

/** The ticket's tabs, as Meteora's own: open a position · a limit order · a swap. */
export type TicketTab = 'position' | 'limit' | 'swap';
export const TICKET_TABS: readonly TicketTab[] = ['position', 'limit', 'swap'];

/**
 * Which tabs the pool's ticket shows, in Meteora's order, and the one it opens on when the address names none. A limit
 * order rests only in a DLMM Pro pool, on the coin's ladders (`ladder` — open here); a swap where trading is
 * (`trade`); a position wherever the pool has a way to add to it or is DLMM Pro or DLMM (a quiet «soon» stands where
 * no way is open yet) — a DAMM v2 pool only with a way. Arriving from the Spot or the DLMM Pro list, a Pro pool opens
 * on its limits — unless it holds nothing yet (`empty`): a limit order there has nothing to fill it, and the first
 * position is the way in; from Earn the address names the position (`?tab=position`). A pool of another kind that Earn
 * does not add to opens on its swap.
 */
export function ticketTabs(o: Readonly<{ venue: DeskVenue; ladder: boolean; trade: boolean; adds: boolean; empty?: boolean }>): Readonly<{ tabs: readonly TicketTab[]; first: TicketTab | null }> {
  const tabs = TICKET_TABS.filter((tab) => (tab === 'position' ? o.venue !== 'damm' || o.adds : tab === 'limit' ? o.venue === 'pro' && o.ladder : o.trade));
  const limitFirst = tabs.includes('limit') && !(o.empty && tabs.includes('position'));
  // A DLMM or DAMM v2 pool Earn does not add to opens on its swap: its position is only a quiet «soon» («Огляд»
  // led to a page whose ticket said «soon» and nothing else).
  const swapFirst = o.venue !== 'pro' && !o.adds && tabs.includes('swap');
  const first = limitFirst ? 'limit' : swapFirst ? 'swap' : (tabs[0] ?? null);
  return { tabs, first };
}

/** What the Position tab draws. `ticket` — the pool's own form, signed; `preview` — the signature not open here yet: «soon» and the way to a pool where it is; `soon` — one quiet line. */
export type PositionOffer = 'ticket' | 'preview' | 'soon';

/**
 * A DLMM Pro pool's offer: the form where the engine serves the pool as a pier and the terminal offers it; the form
 * without its signature where the pool has SOL on a side but is not served or not offered yet (behind its
 * two switches); a line for a pool without SOL — an opening here is paid in SOL alone.
 */
export function proOffer(row: Pick<ProPoolRow, 'x' | 'y'>, served: boolean, offered: boolean): PositionOffer {
  if (row.x.mint !== SOL_MINT && row.y.mint !== SOL_MINT) return 'soon';
  return served && offered ? 'ticket' : 'preview';
}

/** The tick a price stands in: 1.0001^tick, moved by the coins' decimals. */
const tickOf = (price: number, decimalsX: number, decimalsY: number) => Math.floor(Math.log(price / 10 ** (decimalsX - decimalsY)) / Math.log(1.0001));

/**
 * A DLMM Pro pool as the Earn form's pier, from the program's row, for the form's preview where the engine does not serve
 * the pool yet: its pair, price and step, no reward, no deposit taken. Null without SOL on a side or without a price.
 */
export function previewPier(row: ProPoolRow): EarnProPier | null {
  const solIsX = row.x.mint === SOL_MINT;
  if (!solIsX && row.y.mint !== SOL_MINT) return null;
  if (!(row.price > 0) || !Number.isFinite(row.price)) return null;
  const coin = (c: ProPoolCoin) => ({ mint: c.mint, symbol: c.mint === SOL_MINT ? 'SOL' : tickerOf(c).slice(0, 10), decimals: c.decimals });
  return { address: row.address, x: coin(row.x), y: coin(row.y), solIsX, price: row.price, feeBps: row.fee.totalBps, tickSpacing: row.tickSpacing, tickId: tickOf(row.price, row.x.decimals, row.y.decimals), depthLamports: null, rewards: [], takesDeposits: false };
}

/** A pool's page; `tab` — the ticket's tab it opens on (Earn names the position; the first tab needs none). */
export function poolHref(address: string, tab: TicketTab | null = null): string {
  return tab ? `/pool/${address}?tab=${tab}` : `/pool/${address}`;
}

/**
 * Whether a row of Earn leads to a pool's page (for the Earn screen's rows): any DLMM Pro or DLMM pool — its page draws
 * its liquidity by price; a DAMM v2 pool only where its position has a form of its own (`adds`).
 */
export const poolHasPage = (kind: 'pro' | 'dlmm' | 'damm-v2', adds: boolean): boolean => kind !== 'damm-v2' || adds;
