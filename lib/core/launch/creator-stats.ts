/**
 * The creator's cabinet in figures — «Мої лаунчі» and the creator's public
 * profile.
 *
 * What a launch earned its creator's side over the last day and week, by
 * source, beside the all-time counters `./creator-earnings.ts` reads: every
 * window figure is a sum of the programs' own swap events —
 * - **on the curve** — the creator's part of each swap's trading fee, as the
 *   program splits it (rounded down per swap);
 * - **at graduation** — the graduation fee's creator part, once, at the moment
 *   the curve finished;
 * - **from the locked LP** — the LP part of each pool swap's fee times the
 *   creator role's share of the pool's liquidity, counted only where that
 *   share is known not to have moved since the window's first swap.
 *
 * A window whose transactions were not all read is a floor («≥») when it
 * found something, and «not read» when it found nothing — never a zero on a
 * guess. The same rule holds for the volume, the traders and the repeat
 * traders. The depth around the price is the pool's own reserves (or its
 * liquidity inside its range): what moves the price 2 % up and 2 % down,
 * before the pool's fee.
 *
 * Pure and client-safe: no clock unless given, no network.
 */

import { creatorGraduationFeeRaw, type CreatorFeesRead } from "./creator-earnings.ts";

export const STAT_WINDOWS = { day: 24 * 60 * 60, week: 7 * 24 * 60 * 60 } as const;
export type StatWindow = keyof typeof STAT_WINDOWS;

/** A figure over a window, raw in the pair currency: exact, a floor, or not read (`raw: null`). */
export type WindowFigure = Readonly<{ raw: string | null; atLeast: boolean }>;
export type CountFigure = Readonly<{ count: number | null; atLeast: boolean }>;

/** One trade as the windows read it — the decoded swap's own figures. */
export type StatTrade = Readonly<{
  signature: string;
  slot: number;
  at: number;
  side: "buy" | "sell";
  venue: "curve" | "pool";
  trader: string;
  tokensRaw: string;
  pairRaw: string;
  feeRaw: string;
  /** The creator's part of a curve swap's trading fee; absent on a swap decoded before it was counted. */
  creatorRaw?: string;
  /** The LP part of a pool swap's fee, in the pair currency; absent where it was not counted. */
  lpRaw?: string;
}>;

/** Which part of the token's history was read: whole, or from a time on, with the transactions listed and not read. */
export type HistoryCover = Readonly<{ complete: boolean; coveredFrom: number | null; gaps: readonly number[] }>;

/** Whether every transaction since `since` was read — `windowReadWhole` of the market, kept here so the client can use it. */
export function coverReaches(cover: HistoryCover, since: number): boolean {
  if (cover.complete) return true;
  return (cover.coveredFrom === null || cover.coveredFrom < since) && cover.gaps.every((at) => at < since);
}

const ZERO: WindowFigure = { raw: "0", atLeast: false };
const UNREAD: WindowFigure = { raw: null, atLeast: false };

/** A sum over the trades since `since`: exact when every one was read and counted, a floor when something was found, else unread. */
export function windowSum(trades: readonly StatTrade[], since: number, cover: HistoryCover, pick: (trade: StatTrade) => bigint | undefined): WindowFigure {
  let total = 0n;
  let missing = false;
  for (const trade of trades) {
    if (trade.at < since) continue;
    const value = pick(trade);
    if (value === undefined) missing = true;
    else total += value;
  }
  if (coverReaches(cover, since) && !missing) return { raw: total.toString(), atLeast: false };
  return total > 0n ? { raw: total.toString(), atLeast: true } : UNREAD;
}

/** The share of the pool the creator's role holds, and whether the pool's liquidity moved — by slot — as the reads saw it. */
export type LpShare = Readonly<{
  positionLiquidity: string;
  poolLiquidity: string;
  /** Every add or removal of liquidity on the pool the history read, by slot; null when some pool transaction was decoded without looking. */
  changeSlots: readonly number[] | null;
}>;

export type RevenueInput = Readonly<{
  now: number;
  trades: readonly StatTrade[];
  cover: HistoryCover;
  /** The chain's counters for the creator role; null when they could not be read. */
  read: Pick<CreatorFeesRead, "graduation"> | null;
  /** When the curve finished (unix seconds); null before, or when not read. */
  graduatedAt: number | null;
  migrated: boolean | null;
  lp: LpShare | null;
}>;

export type SourceWindows = Readonly<{ curve: WindowFigure; graduation: WindowFigure; lp: WindowFigure }>;

/** The LP part over a window: the role's share of each pool swap's LP fee, when that share held for every swap counted. */
export function lpWindow(input: RevenueInput, since: number): WindowFigure {
  if (input.migrated === false) return ZERO;
  if (input.migrated === null || !input.lp || input.lp.changeSlots === null) return UNREAD;
  const pool = BigInt(input.lp.poolLiquidity);
  const position = BigInt(input.lp.positionLiquidity);
  /* A transaction not read could have moved the pool's liquidity: the LP part is exact or not given — never a floor on a share that may be wrong. */
  if (pool <= 0n || !coverReaches(input.cover, since)) return UNREAD;
  const swaps = input.trades.filter((trade) => trade.venue === "pool" && trade.at >= since);
  if (swaps.length) {
    const first = Math.min(...swaps.map((trade) => trade.slot));
    /* Liquidity added or taken out at or after the window's first swap: the share then is not the share now. */
    if (input.lp.changeSlots.some((slot) => slot >= first)) return UNREAD;
  }
  if (swaps.some((trade) => trade.lpRaw === undefined)) return UNREAD;
  return { raw: swaps.reduce((total, trade) => total + (BigInt(trade.lpRaw ?? "0") * position) / pool, 0n).toString(), atLeast: false };
}

/** The graduation fee falls in a window when the curve finished inside it. */
export function graduationWindow(input: RevenueInput, since: number): WindowFigure {
  if (input.migrated === false) return ZERO;
  if (input.migrated === null || !input.read || input.graduatedAt === null) return UNREAD;
  return input.graduatedAt >= since ? { raw: creatorGraduationFeeRaw(input.read.graduation).toString(), atLeast: false } : ZERO;
}

/** What the creator's role earned over the last day and the last week, by source. */
export function revenueWindows(input: RevenueInput): Readonly<Record<StatWindow, SourceWindows>> {
  const curve = input.trades.filter((trade) => trade.venue === "curve");
  const of = (seconds: number): SourceWindows => {
    const since = input.now - seconds;
    return {
      curve: windowSum(curve, since, input.cover, (trade) => (trade.creatorRaw === undefined ? undefined : BigInt(trade.creatorRaw))),
      graduation: graduationWindow(input, since),
      lp: lpWindow(input, since),
    };
  };
  return { day: of(STAT_WINDOWS.day), week: of(STAT_WINDOWS.week) };
}

/** A window's sources added up: exact only when every source is; a floor when one is; unread when one is unread. */
export function windowTotal(sources: SourceWindows): WindowFigure {
  const parts = [sources.curve, sources.graduation, sources.lp];
  if (parts.some((part) => part.raw === null)) return UNREAD;
  return { raw: parts.reduce((total, part) => total + BigInt(part.raw ?? "0"), 0n).toString(), atLeast: parts.some((part) => part.atLeast) };
}

/** The volume over the last day, the last week and all the read history. */
export function volumeWindows(trades: readonly StatTrade[], cover: HistoryCover, now: number): Readonly<Record<StatWindow | "all", WindowFigure>> {
  const pair = (trade: StatTrade) => BigInt(trade.pairRaw);
  return {
    day: windowSum(trades, now - STAT_WINDOWS.day, cover, pair),
    week: windowSum(trades, now - STAT_WINDOWS.week, cover, pair),
    all: windowSum(trades, Number.NEGATIVE_INFINITY, cover, pair),
  };
}

/** The fees every swap of the pool paid over a window — the creator's market after the DEX. */
export function poolFeeWindows(trades: readonly StatTrade[], cover: HistoryCover, now: number): Readonly<Record<StatWindow, WindowFigure>> {
  const pool = trades.filter((trade) => trade.venue === "pool");
  const fee = (trade: StatTrade) => BigInt(trade.feeRaw);
  return { day: windowSum(pool, now - STAT_WINDOWS.day, cover, fee), week: windowSum(pool, now - STAT_WINDOWS.week, cover, fee) };
}

/**
 * The people who traded and those who came back — traded in two transactions or more. The creator's own wallets (the
 * creator and the wallets their buys paid for) and Ryntra's own are left out: a cabinet counts the market, not its makers.
 */
export function traderCounts(trades: readonly StatTrade[], complete: boolean, excluded: ReadonlySet<string>): Readonly<{ traders: CountFigure; repeat: CountFigure }> {
  const seen = new Map<string, Set<string>>();
  for (const trade of trades) {
    if (excluded.has(trade.trader)) continue;
    const signatures = seen.get(trade.trader) ?? new Set<string>();
    signatures.add(trade.signature);
    seen.set(trade.trader, signatures);
  }
  const traders = seen.size;
  const repeat = [...seen.values()].filter((signatures) => signatures.size >= 2).length;
  /* Read in part, a count is a floor — and a floor of nothing says nothing. */
  const figure = (count: number): CountFigure => (complete ? { count, atLeast: false } : count > 0 ? { count, atLeast: true } : { count: null, atLeast: false });
  return { traders: figure(traders), repeat: figure(repeat) };
}

/** The graduated pool as the depth reads it: its square-root price (Q64), its range, its liquidity and its pair reserve. */
export type PoolDepthState = Readonly<{
  tokenIsA: boolean;
  compounding: boolean;
  sqrtPrice: string;
  sqrtMinPrice: string;
  sqrtMaxPrice: string;
  liquidity: string;
  pairReserveRaw: string;
}>;

/** How much of the pair currency moves the price 2 % up (a buy pays it in) and 2 % down (a sale takes it out), before the pool's fee. */
export type Depth = Readonly<{ upRaw: string; downRaw: string }>;

const Q128 = 2 ** 128;
const UP = Math.sqrt(1.02);
const DOWN = Math.sqrt(0.98);

/**
 * The depth ±2 % of a graduated pool whose pair is its B side. A compounding pool prices by its two reserves (x·y = k),
 * so the pair moved is y·(√1.02 − 1) and y·(1 − √0.98); a concentrated one by its liquidity inside its range, so it is
 * L·Δ√P / 2¹²⁸, clipped at the range's ends. Null when the pair is the pool's A side — the formula here is the B side's.
 */
export function poolDepth(pool: PoolDepthState): Depth | null {
  if (!pool.tokenIsA) return null;
  const floor = (value: number) => BigInt(Math.max(0, Math.floor(value))).toString();
  if (pool.compounding) {
    const y = Number(BigInt(pool.pairReserveRaw));
    return { upRaw: floor(y * (UP - 1)), downRaw: floor(y * (1 - DOWN)) };
  }
  const liquidity = Number(BigInt(pool.liquidity));
  const sqrt = Number(BigInt(pool.sqrtPrice));
  const high = Math.min(sqrt * UP, Number(BigInt(pool.sqrtMaxPrice)));
  const low = Math.max(sqrt * DOWN, Number(BigInt(pool.sqrtMinPrice)));
  return { upRaw: floor((liquidity * (high - sqrt)) / Q128), downRaw: floor((liquidity * (sqrt - low)) / Q128) };
}

/** A creator's sale as the profile and the cabinet list it: where to see it, when, how many tokens and for what. */
export type CreatorSale = Readonly<{ signature: string; at: number; tokensRaw: string; pairRaw: string }>;

/** The creator's own trades on the token: what they bought and sold, the newest sales first. */
export function creatorSales(trades: readonly StatTrade[], creator: string, limit = 5): Readonly<{ boughtRaw: string; soldRaw: string; sales: readonly CreatorSale[] }> {
  let boughtRaw = 0n;
  let soldRaw = 0n;
  const sales: CreatorSale[] = [];
  for (const trade of trades) {
    if (trade.trader !== creator) continue;
    if (trade.side === "buy") boughtRaw += BigInt(trade.tokensRaw);
    else {
      soldRaw += BigInt(trade.tokensRaw);
      sales.push({ signature: trade.signature, at: trade.at, tokensRaw: trade.tokensRaw, pairRaw: trade.pairRaw });
    }
  }
  return { boughtRaw: boughtRaw.toString(), soldRaw: soldRaw.toString(), sales: sales.sort((a, b) => b.at - a.at).slice(0, limit) };
}

/** A figure in a wallet's part: the role's figure times its share, rounded down — the vault pays each wallet so. */
export function partOfFigure(figure: WindowFigure, shareBps: number): WindowFigure {
  if (figure.raw === null) return figure;
  return { raw: ((BigInt(figure.raw) * BigInt(shareBps)) / 10_000n).toString(), atLeast: figure.atLeast };
}
