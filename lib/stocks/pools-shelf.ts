/**
 * A stock's pools on Meteora, as its own page shows them: every pool of the stock on DLMM and DLMM Pro, each
 * with its pair, how much it holds, the fee a trade pays now, what traded through it in a day and — on the one pool where
 * Ryntra's limit orders on the stock rest — what such an order keeps of what fills. One action a row, both the engine's
 * own: «Deposit» (the stock pools' deposit) or «Limit with bonus». Nothing here
 * builds, signs or moves anything.
 *
 * Every figure is a venue's or the engine's as read, never one worked out here:
 *
 * - DLMM — Meteora's Data API through the engine's pool catalogue (`lib/liquidity/catalog`), searched by the stock's
 *   mint: depth, a day's volume, the fee now (base and the part that grows with volatility);
 * - DLMM Pro — the program's own accounts (`lib/pro-pools/read.server.ts`): depth from the two vaults at Jupiter's
 *   prices, the fee now; a day's volume from the indexer's rows in the database (`lib/pro-pools/store.ts`) — a day
 *   counted only in part is said as a floor, a pool the indexer does not hold has none;
 * - the bonus — the ladder market of the stock (`GET /api/v1/ladders/market`, `lib/pro-limits`): the pool its ladder
 *   rests in and the owner's share of the fee there.
 *
 * What the shelf leaves out, so a person never sees it: a pool that holds next to nothing, a pool with its swaps shut,
 * a blacklisted one, a pair whose other coin nobody vouched for (not SOL or a dollar, not verified, no name, a test, a
 * crude name, or a ticker that passes for another coin's), and DAMM v2 — the shelf is DLMM's and DLMM Pro's.
 *
 * Pure and client-safe: the server builds the answer from it (`pools-shelf.server.ts`, the door
 * `GET /api/v1/stocks/pools`), the screen and the tests read it alike.
 */

import type { CatalogPool } from "../liquidity/catalog/model.ts";
import { quietReason, type ProPoolRow } from "../pro-pools/model.ts";
import type { StoreStates } from "../pro-pools/store.ts";

export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
/** The coins a pair may be priced in without a word from a catalogue: SOL and the two dollars. */
export const SHELF_QUOTES: readonly string[] = [SOL_MINT, USDC_MINT, USDT_MINT];
/** The coins the stock pools' deposit pairs a stock with (`lib/earn-dlmm/stocks.ts`, `STOCK_QUOTES`). */
export const DLMM_DEPOSIT_QUOTES: readonly string[] = [USDC_MINT, SOL_MINT];

/** A pool is on the shelf from this much in it, dollars: below, it is empty to a person — dust or a test. */
export const SHELF_MIN_TVL_USD = 100;
/** The most rows the shelf carries, the deepest first; the pool of the stock's limit orders is kept whatever its depth. */
export const SHELF_MAX = 8;
/** A DLMM Pro pool's day is the indexer's while its row was written within this long of the indexer's last step, ms. */
export const PRO_DAY_LIVE_MS = 10 * 60_000;

export type ShelfVenue = "dlmm" | "dlmm-pro";

export type ShelfCoin = Readonly<{ mint: string; symbol: string }>;

export type ShelfPool = Readonly<{
  venue: ShelfVenue;
  address: string;
  /** The stock's side of the pair. */
  stock: ShelfCoin;
  /** The coin the stock is paired with. */
  other: ShelfCoin;
  /** What the pool holds, dollars. */
  tvlUsd: number;
  /** The fee a trade pays now, per cent. */
  feePct: number | null;
  /** What traded through the pool in the last 24 hours, dollars; null — nobody counted it. */
  volume24hUsd: number | null;
  /** Whether the whole day was counted; `false` — only a part, so the figure is a floor; null without a figure. */
  volumeWhole: boolean | null;
  /** What a limit order keeps of the fee on what fills, per cent — only on the pool where the stock's limits rest. */
  bonusPct: number | null;
  /** New money goes in here through the engine's own deposit, for everyone, now. */
  deposit: boolean;
  /** The stock's limit orders rest here and the pool takes new ones now. */
  limit: boolean;
}>;

export type PoolsShelf = Readonly<{
  mint: string;
  /** Whether the stocks engine knows the mint as a stock; a coin that is no stock has no shelf. */
  isStock: boolean;
  /** The stock's ticker, as the stocks engine names it. */
  symbol: string | null;
  /** When the answer was put together, ISO. */
  at: string;
  pools: readonly ShelfPool[];
  /** Which venue answered: one that did not leaves its pools out, never says «no pools» for them. */
  read: Readonly<{ dlmm: boolean; pro: boolean }>;
}>;

/** A DLMM Pro pool's day as the indexer counted it. */
export type ProDay = Readonly<{ usd: number | null; whole: boolean }>;

/** The pool the stock's limit orders rest in, as the ladder market says it. */
export type ShelfLadder = Readonly<{ pool: string; ownerBps: number; placing: boolean }>;

export type ShelfInput = Readonly<{
  mint: string;
  /** The stock's ticker; null — the stocks engine does not know the mint as a stock. */
  symbol: string | null;
  nowMs: number;
  /** The catalogue's pools found for the mint; null — the catalogue did not answer. */
  dlmm: readonly CatalogPool[] | null;
  /** DLMM Pro's pools; null — the program did not answer. */
  pro: readonly ProPoolRow[] | null;
  proDays?: ReadonlyMap<string, ProDay>;
  ladder?: ShelfLadder | null;
  /** Whether the engine takes new money into this stock's pools now, for everyone: its switches, the stock's seat, no pause. */
  deposits?: Readonly<{ dlmm: boolean; pro: boolean }>;
  /** A ticker that passes for another coin's (`lib/world/text-safety/lookalike.ts`). */
  passesFor?: (symbol: string, mint: string) => boolean;
}>;

const finitePositive = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;
const cleanSymbol = (symbol: string | null | undefined): string | null => {
  const text = symbol?.trim();
  return text ? text.slice(0, 16) : null;
};

/** A coin the shelf pairs a stock with: SOL or a dollar, or one its catalogue verified under a plain name. */
function vouched(mint: string, symbol: string | null, verified: boolean | null, passesFor: (symbol: string, mint: string) => boolean): boolean {
  if (SHELF_QUOTES.includes(mint)) return true;
  if (verified !== true || !symbol) return false;
  return !passesFor(symbol, mint);
}

/** One DLMM pool of the catalogue as a row of the shelf; null for anything the shelf leaves out. */
export function dlmmShelfPool(pool: CatalogPool, input: Pick<ShelfInput, "mint" | "symbol" | "deposits" | "passesFor">): ShelfPool | null {
  const { mint } = input;
  const passesFor = input.passesFor ?? (() => false);
  if (pool.kind !== "dlmm" || pool.blacklisted) return null;
  if ((pool.x.mint === mint) === (pool.y.mint === mint)) return null;
  if (!finitePositive(pool.tvlUsd) || pool.tvlUsd < SHELF_MIN_TVL_USD) return null;
  if (!finitePositive(pool.binStepBps)) return null;
  const other = pool.x.mint === mint ? pool.y : pool.x;
  const otherSymbol = cleanSymbol(other.symbol);
  if (!vouched(other.mint, otherSymbol, other.verified, passesFor) || !otherSymbol) return null;
  const fee = pool.dynamicFeePct ?? pool.baseFeePct;
  const volume = pool.volume24hUsd !== null && Number.isFinite(pool.volume24hUsd) && pool.volume24hUsd >= 0 ? pool.volume24hUsd : null;
  return {
    venue: "dlmm",
    address: pool.address,
    stock: { mint, symbol: cleanSymbol(input.symbol) ?? cleanSymbol(pool.x.mint === mint ? pool.x.symbol : pool.y.symbol) ?? `${mint.slice(0, 4)}…` },
    other: { mint: other.mint, symbol: otherSymbol },
    tvlUsd: pool.tvlUsd,
    feePct: fee !== null && Number.isFinite(fee) && fee >= 0 ? fee : null,
    volume24hUsd: volume,
    volumeWhole: volume === null ? null : true,
    bonusPct: null,
    deposit: input.deposits?.dlmm === true && DLMM_DEPOSIT_QUOTES.includes(other.mint),
    limit: false,
  };
}

/** One DLMM Pro pool of the program as a row of the shelf; null for anything the shelf leaves out. */
export function proShelfPool(row: ProPoolRow, input: Pick<ShelfInput, "mint" | "symbol" | "deposits" | "passesFor" | "proDays" | "ladder">): ShelfPool | null {
  const { mint } = input;
  const passesFor = input.passesFor ?? (() => false);
  if ((row.x.mint === mint) === (row.y.mint === mint)) return null;
  if (!row.open.swap) return null;
  if (!finitePositive(row.tvlUsd) || row.tvlUsd < SHELF_MIN_TVL_USD) return null;
  if (quietReason(row, passesFor) !== null) return null;
  const stock = row.x.mint === mint ? row.x : row.y;
  const other = row.x.mint === mint ? row.y : row.x;
  const otherSymbol = cleanSymbol(other.symbol);
  if (!vouched(other.mint, otherSymbol, other.verified, passesFor) || !otherSymbol) return null;
  const day = input.proDays?.get(row.address) ?? null;
  const usd = day && day.usd !== null && Number.isFinite(day.usd) && day.usd >= 0 ? day.usd : null;
  const ladder = input.ladder ?? null;
  const limit = ladder !== null && ladder.pool === row.address && ladder.placing && finitePositive(ladder.ownerBps);
  return {
    venue: "dlmm-pro",
    address: row.address,
    stock: { mint, symbol: cleanSymbol(input.symbol) ?? cleanSymbol(stock.symbol) ?? `${mint.slice(0, 4)}…` },
    other: { mint: other.mint, symbol: otherSymbol },
    tvlUsd: row.tvlUsd,
    feePct: Number.isFinite(row.fee.totalBps) && row.fee.totalBps >= 0 ? row.fee.totalBps / 100 : null,
    volume24hUsd: usd,
    volumeWhole: usd === null ? null : day!.whole,
    bonusPct: limit ? ladder!.ownerBps / 100 : null,
    // DLMM Pro's stock piers are pools of SOL against the stock, open to new liquidity.
    deposit: input.deposits?.pro === true && other.mint === SOL_MINT && row.open.deposits,
    limit,
  };
}

/**
 * What decides whether new money goes into the stock's pools now, for everyone: the stock's seat (a listed company's
 * token its issuer still sells, `lib/earn-pro/stocks.ts`), its issuer's pause as the mint states it (null — not read),
 * and the deployment's switches as the stock pools' deposit reads them.
 */
export type DepositSwitches = Readonly<{
  seat: boolean;
  paused: boolean | null;
  /** `RYNTRA_EARN_DLMM_STOCKS`: `canary` serves one wallet, never a shelf everyone reads. */
  dlmm: "closed" | "canary" | "open";
  /** The Harbor's stop (`RYNTRA_CITY_HARBOR_STOP`). */
  dlmmStopped: boolean;
  /** DLMM Pro is open on this deployment (`RYNTRA_EARN_PRO`). */
  pro: boolean;
  /** `RYNTRA_EARN_PRO_STOCKS=open`. */
  proStocks: boolean;
  /** DLMM Pro's own stop of new money. */
  proStopped: boolean;
}>;

/** Whether the shelf offers a deposit on each venue: never on a guess — a mint not read, a pause, a canary, a stop. */
export function shelfDeposits(switches: DepositSwitches): Readonly<{ dlmm: boolean; pro: boolean }> {
  const open = switches.seat && switches.paused === false;
  return {
    dlmm: open && switches.dlmm === "open" && !switches.dlmmStopped,
    pro: open && switches.pro && switches.proStocks && !switches.proStopped,
  };
}

/** Deepest first; a tie by address, so the order holds from one read to the next. */
export function byDepth(a: ShelfPool, b: ShelfPool): number {
  return b.tvlUsd - a.tvlUsd || (a.address < b.address ? -1 : a.address > b.address ? 1 : 0);
}

/** The shelf of a mint that is no stock. */
export function noShelf(mint: string, nowMs: number): PoolsShelf {
  return { mint, isStock: false, symbol: null, at: new Date(nowMs).toISOString(), pools: [], read: { dlmm: true, pro: true } };
}

/** The shelf: both venues' rows, each pool once, the deepest first, at most `SHELF_MAX` — the limit's pool kept. */
export function shelfOf(input: ShelfInput): PoolsShelf {
  if (input.symbol === null) return noShelf(input.mint, input.nowMs);
  const rows: ShelfPool[] = [];
  const seen = new Set<string>();
  const add = (row: ShelfPool | null) => {
    if (!row || seen.has(row.address)) return;
    seen.add(row.address);
    rows.push(row);
  };
  for (const row of input.pro ?? []) add(proShelfPool(row, input));
  for (const pool of input.dlmm ?? []) add(dlmmShelfPool(pool, input));
  rows.sort(byDepth);
  const top = rows.slice(0, SHELF_MAX);
  const limit = rows.find((row) => row.limit);
  if (limit && !top.includes(limit)) top.splice(SHELF_MAX - 1, 1, limit);
  return { mint: input.mint, isStock: true, symbol: cleanSymbol(input.symbol), at: new Date(input.nowMs).toISOString(), pools: top, read: { dlmm: input.dlmm !== null, pro: input.pro !== null } };
}

/**
 * Each listed DLMM Pro pool's day, as the indexer's rows in the database hold it: a pool counted (its summary), whose
 * row the indexer still writes (within `PRO_DAY_LIVE_MS` of its last step), after a step that ended. A pool missing from
 * the map has no day to show — it reads «—», never 0.
 */
export function proDaysOf(states: StoreStates | null, pools: readonly string[], liveMs: number = PRO_DAY_LIVE_MS): ReadonlyMap<string, ProDay> {
  const out = new Map<string, ProDay>();
  if (!states || states.step.endedAgo === null) return out;
  for (const pool of pools) {
    const state = states.pools.get(pool);
    const summary = state?.summary;
    if (!state || !summary) continue;
    if (state.writtenAgo - (states.step.startedAgo ?? 0) >= liveMs) continue;
    out.set(pool, { usd: summary.stats.volume.usd, whole: summary.stats.whole });
  }
  return out;
}

/* ------------------------------------------------------------------ the screen's guard */

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const isCoin = (value: unknown): value is ShelfCoin => isObject(value) && typeof value.mint === "string" && typeof value.symbol === "string";
const numberOrNull = (value: unknown): boolean => value === null || (typeof value === "number" && Number.isFinite(value));

export function isShelfPool(value: unknown): value is ShelfPool {
  if (!isObject(value)) return false;
  return (
    (value.venue === "dlmm" || value.venue === "dlmm-pro") &&
    typeof value.address === "string" &&
    isCoin(value.stock) &&
    isCoin(value.other) &&
    typeof value.tvlUsd === "number" &&
    Number.isFinite(value.tvlUsd) &&
    numberOrNull(value.feePct) &&
    numberOrNull(value.volume24hUsd) &&
    (value.volumeWhole === null || typeof value.volumeWhole === "boolean") &&
    numberOrNull(value.bonusPct) &&
    typeof value.deposit === "boolean" &&
    typeof value.limit === "boolean"
  );
}

/** Whether a body is the shelf of `mint`, as far as a screen relies on it. */
export function isPoolsShelf(value: unknown, mint?: string): value is PoolsShelf {
  if (!isObject(value) || typeof value.mint !== "string" || typeof value.isStock !== "boolean" || !Array.isArray(value.pools)) return false;
  if (mint !== undefined && value.mint !== mint) return false;
  return value.pools.every(isShelfPool);
}
