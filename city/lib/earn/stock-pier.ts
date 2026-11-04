import { rawFromText } from '../../../lib/earn/model.ts';
import { SOLANA_MAINNET_USDC_MINT } from '../../../lib/solana/send-kinds.ts';
import { spendable } from '../districts/harbor/deposit.ts';
import { CURATED } from '../market/curated.ts';
import type { Holdings } from '../trade/wallet.ts';
import { SOL_MINT } from './lst.ts';
import type { StockSession, StockStep } from './stock-pier-hours.ts';

/**
 * The Stock Pier («Причал акцій», CITY-98, `docs/research/ryntra-earn-2026-10-29/SPEC.md` E7): a person builds their own
 * pool of a verified stock against SOL or USDC — a Meteora DAMM v2 pool made from one template that knows the
 * exchange's hours — and puts the first liquidity in with the same signature. Where the pair's pier already stands,
 * the person moors beside it (the engine's own add). The name sits beside the Shelf's «SOL Pier»; «Мій причал» is the
 * creator's window of the Launch (CITY-141) and stays its own.
 *
 * Verified means three things the server checks before a pair is offered: the issuer's catalogue and Jupiter name the
 * mint, the venue accepts it as it is (a Token-2022 mint whose extensions need a badge is offered only where the badge
 * already stands on chain — Ryntra asks Meteora for none), and its market traded in the last seven days.
 *
 * Pure: the window, the store, the routes and the tests import it alike.
 */

export const STOCK_QUOTES = ['sol', 'usdc'] as const;
export type StockQuote = (typeof STOCK_QUOTES)[number];
export const DEFAULT_QUOTE: StockQuote = 'sol';

export const QUOTE: Readonly<Record<StockQuote, Readonly<{ mint: string; symbol: string; decimals: number }>>> = {
  sol: { mint: SOL_MINT, symbol: 'SOL', decimals: 9 },
  usdc: { mint: SOLANA_MAINNET_USDC_MINT, symbol: 'USDC', decimals: 6 },
};

export function isStockQuote(value: unknown): value is StockQuote {
  return typeof value === 'string' && (STOCK_QUOTES as readonly string[]).includes(value);
}

/** The stocks a pier may be asked for: the city's own avenue towers. The server confirms each before it is offered. */
export const STOCK_CANDIDATES: readonly string[] = CURATED.filter(([, district]) => district === 'avenue').map(([mint]) => mint);

/* ------------------------------------------------------------------ template */

/**
 * The template «Exchange hours», fixed when the pool is made (a DAMM v2 pool's fee and range never change after):
 * - the whole curve, so a gap over a weekend never leaves the range — the pool keeps earning while the price jumps;
 * - a base fee of 0.30 % with the venue's volatility part on top (at most a fifth of the base), which rises when the
 *   price jumps — at the open after a close, most of all;
 * - fees collected in the quote coin only (SOL or USDC), so what it earns is said in SOL without a swap;
 * - activation at once; no alpha vault; nothing locked — the liquidity is the person's to take out.
 */
export const STOCK_PIER_BASE_FEE_BPS = 30;
export const STOCK_PIER_DYNAMIC_SHARE_PCT = 20;
export const STOCK_PIER_SLIPPAGE_BPS = 100;
export const STOCK_PIER_VENUE = 'meteora-damm2' as const;

/* ------------------------------------------------------------------ verification */

/** Seven days of trading in the stock's own market, in dollars, below which a pair is quiet and not offered. */
export const STOCK_PIER_MIN_VOLUME_7D_USD = 5_000;
const DAY_S = 86_400;

/** The stock market's volume over the last seven days from daily bars (seconds, dollar volume); null when none says. */
export function volume7d(candles: readonly Readonly<{ time: number; volume?: number | null }>[], nowMs: number): number | null {
  const since = Math.floor(nowMs / 1000) - 7 * DAY_S;
  let total = 0;
  let seen = false;
  for (const bar of candles) {
    if (!(bar.time > since) || typeof bar.volume !== 'number' || !Number.isFinite(bar.volume) || bar.volume < 0) continue;
    total += bar.volume;
    seen = true;
  }
  return seen ? total : null;
}

/**
 * Token-2022 extensions the venue takes without a badge. Anything else on a mint (an xStock's Scaled UI Amount, its
 * pause, its permanent delegate) needs the venue's badge for that mint to stand on chain already.
 */
export const NO_BADGE_EXTENSIONS: ReadonlySet<string> = new Set(['TransferFeeConfig', 'MetadataPointer', 'TokenMetadata']);

export type MintFacts = Readonly<{
  program: 'SPL_TOKEN' | 'TOKEN_2022';
  extensions: readonly string[];
  /** The mint carries the Scaled UI Amount extension: an xStock or its kin. */
  scaled: boolean;
  paused: boolean;
  /** New token accounts start frozen (an allow-listed token): a pool's vault would be frozen too. */
  startsFrozen: boolean;
}>;

/** Whether the venue accepts the mint as it is: a plain token, a Token-2022 mint with no extension that needs a badge, or one whose badge stands. */
export function venueAccepts(facts: MintFacts, badge: boolean): boolean {
  if (facts.program === 'SPL_TOKEN') return true;
  return badge || facts.extensions.every((kind) => NO_BADGE_EXTENSIONS.has(kind));
}

export type StockVerdict =
  | Readonly<{ ok: true }>
  | Readonly<{
      ok: false;
      why: 'not-stock' | 'unverified' | 'badge' | 'paused' | 'frozen' | 'halted' | 'unpriced' | 'quiet';
    }>;

export type VerifyInput = Readonly<{
  facts: MintFacts | null;
  badge: boolean;
  /** Jupiter's verified mark; the issuer's own catalogue confirming the mint. */
  verified: boolean;
  issuerConfirmed: boolean;
  halted: boolean | null;
  priceUsd: number | null;
  volume7dUsd: number | null;
}>;

/** A candidate as a pair the window offers, or why not — the first reason that holds. */
export function verifyStock(input: VerifyInput): StockVerdict {
  const { facts } = input;
  if (!facts || !facts.scaled) return { ok: false, why: 'not-stock' };
  if (!input.verified || !input.issuerConfirmed) return { ok: false, why: 'unverified' };
  if (input.halted === true || facts.paused) return { ok: false, why: input.halted === true ? 'halted' : 'paused' };
  if (facts.startsFrozen) return { ok: false, why: 'frozen' };
  if (!venueAccepts(facts, input.badge)) return { ok: false, why: 'badge' };
  if (input.priceUsd === null || !Number.isFinite(input.priceUsd) || input.priceUsd <= 0) return { ok: false, why: 'unpriced' };
  if (input.volume7dUsd === null || input.volume7dUsd < STOCK_PIER_MIN_VOLUME_7D_USD) return { ok: false, why: 'quiet' };
  return { ok: true };
}

/* ------------------------------------------------------------------ the list */

/** The pair's pier on the venue: the one customizable pool of the two mints, standing or not yet built. */
export type PierSpot = Readonly<{
  address: string;
  built: boolean;
  /** Whether the stock is the pool's A (a pier this window builds always is; one made elsewhere may be the other way round). */
  stockIsA: boolean;
  /** For a standing pier: its base fee and what it holds, in dollars; null when not read. */
  feeBps: number | null;
  depthUsd: number | null;
}>;

export type StockPair = Readonly<{
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  /** The mint's token program id. */
  program: string;
  /** Dollars for one token as the wallet shows it (the scaled unit). */
  priceUsd: number;
  /** The multiplier in force: one base token is this many shown tokens. */
  multiplier: number;
  volume7dUsd: number;
  session: StockSession | null;
  /** A corporate step of the multiplier, scheduled or just taken; null when none is in sight. */
  step: StockStep | null;
  /** The issuer can move or burn any holder's balance (a permanent delegate), a pool's vault included. */
  issuerMoves: boolean;
  piers: Readonly<Record<StockQuote, PierSpot>>;
}>;

export type StockPierList = Readonly<{
  pairs: readonly StockPair[];
  /** Dollars for one SOL and one USDC, as the venue's price read states them. */
  quoteUsd: Readonly<Record<StockQuote, number | null>>;
  at: string;
}>;

const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const num = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const pos = (value: unknown): value is number => num(value) && value > 0;
const text = (value: unknown, max = 64): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;

function readSpot(raw: unknown): PierSpot | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Record<string, unknown>;
  if (!text(v.address) || !MINT.test(v.address) || typeof v.built !== 'boolean') return null;
  return {
    address: v.address,
    built: v.built,
    stockIsA: v.stockIsA !== false,
    feeBps: num(v.feeBps) ? v.feeBps : null,
    depthUsd: num(v.depthUsd) ? v.depthUsd : null,
  };
}

function readSession(raw: unknown): StockSession | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Record<string, unknown>;
  const open = typeof v.open === 'boolean' ? v.open : null;
  const next = typeof v.nextChangeAt === 'string' && Number.isFinite(Date.parse(v.nextChangeAt)) ? v.nextChangeAt : null;
  return { open, nextChangeAt: next };
}

function readStep(raw: unknown): StockStep | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Record<string, unknown>;
  if (typeof v.at !== 'string' || !Number.isFinite(Date.parse(v.at)) || !pos(v.from) || !pos(v.to)) return null;
  return { at: v.at, from: v.from, to: v.to };
}

/** The list as the window receives it, field by field; a pair that does not read is left out. */
export function readStockPierList(raw: unknown): StockPierList | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Record<string, unknown>;
  if (!Array.isArray(v.pairs)) return null;
  const pairs: StockPair[] = [];
  for (const entry of v.pairs.slice(0, STOCK_CANDIDATES.length + 8)) {
    if (!entry || typeof entry !== 'object') continue;
    const p = entry as Record<string, unknown>;
    const piers = p.piers as Record<string, unknown> | undefined;
    const sol = readSpot(piers?.sol);
    const usdc = readSpot(piers?.usdc);
    if (!text(p.mint) || !MINT.test(p.mint) || !text(p.symbol, 24) || !text(p.name, 96) || !text(p.program) || !MINT.test(p.program)) continue;
    if (!num(p.decimals) || !Number.isInteger(p.decimals) || p.decimals < 0 || p.decimals > 12) continue;
    if (!pos(p.priceUsd) || !pos(p.multiplier) || !num(p.volume7dUsd) || !sol || !usdc) continue;
    pairs.push({
      mint: p.mint,
      symbol: p.symbol,
      name: p.name,
      decimals: p.decimals,
      program: p.program,
      priceUsd: p.priceUsd,
      multiplier: p.multiplier,
      volume7dUsd: p.volume7dUsd,
      session: readSession(p.session),
      step: readStep(p.step),
      issuerMoves: p.issuerMoves === true,
      piers: { sol, usdc },
    });
  }
  const q = (v.quoteUsd ?? {}) as Record<string, unknown>;
  return {
    pairs,
    quoteUsd: {
      sol: pos(q.sol) ? q.sol : null,
      usdc: pos(q.usdc) ? q.usdc : null,
    },
    at: typeof v.at === 'string' ? v.at : '',
  };
}

/* ------------------------------------------------------------------ prices and amounts */

/**
 * The quote coin for one base token of the stock — the pool's own unit, before the multiplier: one base token is
 * `multiplier` shown tokens, so it is worth that many times the shown price. Null without a quote price.
 */
export function rawPrice(pair: Pick<StockPair, 'priceUsd' | 'multiplier'>, quoteUsd: number | null): number | null {
  if (quoteUsd === null || !(quoteUsd > 0)) return null;
  const value = (pair.priceUsd * pair.multiplier) / quoteUsd;
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** The quote coin for one token as the wallet shows it. */
export function shownPrice(pair: Pick<StockPair, 'priceUsd'>, quoteUsd: number | null): number | null {
  return quoteUsd !== null && quoteUsd > 0 ? pair.priceUsd / quoteUsd : null;
}

/** Dollars for one base token of the stock: what a deposit is priced at against its ceiling. */
export function baseUsd(pair: Pick<StockPair, 'priceUsd' | 'multiplier'>): number {
  return pair.priceUsd * pair.multiplier;
}

/** An amount of the quote coin as typed («1.5», «0,25») in its base units; null for anything else or nothing. */
export function quoteUnitsFromText(textIn: string, quote: StockQuote): bigint | null {
  const raw = rawFromText(textIn, QUOTE[quote].decimals);
  return raw !== null && raw > 0n ? raw : null;
}

export type StockSplit = Readonly<{
  /** Base units of the stock (A) and of the quote coin (B) for the engine. */
  amountA: string;
  amountB: string;
  stockUnits: bigint;
  quoteUnits: bigint;
}>;

/**
 * An amount of worth in the quote coin as the pool's two coins: half as the quote coin, half as the stock at the price.
 * The whole curve takes the two in equal worth; the Review then says exactly what goes in.
 */
export function stockSplit(pair: Pick<StockPair, 'priceUsd' | 'multiplier' | 'decimals'>, quote: StockQuote, quoteUsd: number | null, worth: bigint): StockSplit | null {
  const price = rawPrice(pair, quoteUsd);
  if (price === null || worth <= 0n) return null;
  const quoteUnits = worth / 2n;
  const otherHalf = Number(worth - quoteUnits) / 10 ** QUOTE[quote].decimals;
  const stock = (otherHalf / price) * 10 ** pair.decimals;
  if (!Number.isFinite(stock) || stock < 1) return null;
  const stockUnits = BigInt(Math.floor(stock));
  if (quoteUnits <= 0n || stockUnits <= 0n) return null;
  return {
    amountA: stockUnits.toString(),
    amountB: quoteUnits.toString(),
    stockUnits,
    quoteUnits,
  };
}

/** The worth of stock units in the quote coin's base units, at the price. */
export function stockWorth(pair: Pick<StockPair, 'priceUsd' | 'multiplier' | 'decimals'>, quote: StockQuote, quoteUsd: number | null, units: bigint): bigint | null {
  const price = rawPrice(pair, quoteUsd);
  if (price === null) return null;
  const value = (Number(units) / 10 ** pair.decimals) * price * 10 ** QUOTE[quote].decimals;
  return Number.isFinite(value) ? BigInt(Math.floor(value)) : null;
}

/**
 * SOL kept aside before a Review states it: a new pool's accounts (the pool and its two vaults — they stay the pool's),
 * the position's three (they come back on exit) and the network. The Review's own figure replaces it at once.
 */
export const STOCK_BUILD_RESERVE_LAMPORTS = 30_000_000n;
export const STOCK_MOOR_RESERVE_LAMPORTS = 12_000_000n;
/** Never under this much worth, in the quote coin: 0.05 SOL, 10 USDC. */
export const STOCK_PIER_FLOOR: Readonly<Record<StockQuote, bigint>> = {
  sol: 50_000_000n,
  usdc: 10_000_000n,
};
/** What never comes back stays at most this share of what goes in: one twentieth. */
export const STOCK_PIER_LOST_SHARE = 20n;

/**
 * The least worth putting in, in the quote coin's base units: never under the floor, and high enough that what never
 * comes back — a new pool's own accounts and the network — stays within a twentieth of it. SOL lost turns into USDC at
 * SOL's price.
 */
export function stockMinimum(lostLamports: bigint | null, quote: StockQuote, solUsd: number | null): bigint {
  const floor = STOCK_PIER_FLOOR[quote];
  if (lostLamports === null || lostLamports <= 0n) return floor;
  let byCost: bigint;
  if (quote === 'sol') byCost = lostLamports * STOCK_PIER_LOST_SHARE;
  else {
    if (solUsd === null || !(solUsd > 0)) return floor;
    byCost = BigInt(Math.ceil((Number(lostLamports * STOCK_PIER_LOST_SHARE) / 1e9) * solUsd * 1e6));
  }
  return byCost > floor ? byCost : floor;
}

export type StockFit = Readonly<{
  fits: boolean;
  short: 'quote' | 'stock' | null;
  /** How much of the stock is missing, base units. */
  stockMissing: bigint;
}>;

/** Whether the wallet holds both sides and, in SOL, what it must keep aside for rent and the network. */
export function stockFit(pair: Pick<StockPair, 'mint'>, quote: StockQuote, split: StockSplit | null, holdings: Holdings | null, reserveLamports: bigint): StockFit {
  const none: StockFit = { fits: true, short: null, stockMissing: 0n };
  if (!split) return none;
  const sol = spendable(holdings, SOL_MINT);
  const quoteHeld = quote === 'sol' ? sol : spendable(holdings, QUOTE.usdc.mint);
  const quoteNeed = quote === 'sol' ? split.quoteUnits + reserveLamports : split.quoteUnits;
  if (quoteHeld !== null && quoteNeed > quoteHeld) return { fits: false, short: 'quote', stockMissing: 0n };
  if (quote === 'usdc' && sol !== null && reserveLamports > sol) return { fits: false, short: 'quote', stockMissing: 0n };
  const stock = spendable(holdings, pair.mint);
  if (stock !== null && split.stockUnits > stock)
    return {
      fits: false,
      short: 'stock',
      stockMissing: split.stockUnits - stock,
    };
  return none;
}

/** The most worth the wallet can put in, quote base units: twice the smaller side it holds; null while unknown. */
export function stockMax(
  pair: Pick<StockPair, 'mint' | 'priceUsd' | 'multiplier' | 'decimals'>,
  quote: StockQuote,
  quoteUsd: number | null,
  holdings: Holdings | null,
  reserveLamports: bigint,
): bigint | null {
  const sol = spendable(holdings, SOL_MINT);
  const quoteHeld = quote === 'sol' ? (sol === null ? null : sol > reserveLamports ? sol - reserveLamports : 0n) : spendable(holdings, QUOTE.usdc.mint);
  const stock = spendable(holdings, pair.mint);
  if (quoteHeld === null || stock === null) return null;
  const fromStock = stockWorth(pair, quote, quoteUsd, stock);
  if (fromStock === null) return null;
  return (quoteHeld < fromStock ? quoteHeld : fromStock) * 2n;
}

/** The door's body: build the pair's pier, or moor beside it where it stands — the server decides from the chain. */
export type StockBuildBody = Readonly<{
  action: 'build';
  stock: string;
  quote: StockQuote;
  owner: string;
  amountA: string;
  amountB: string;
}>;

export function stockBuildBody(pair: Pick<StockPair, 'mint'>, quote: StockQuote, owner: string, split: StockSplit): StockBuildBody {
  return {
    action: 'build',
    stock: pair.mint,
    quote,
    owner,
    amountA: split.amountA,
    amountB: split.amountB,
  };
}

const DIGITS = /^\d{1,30}$/;

/** The door's body read field by field; anything else is refused before the chain is asked. */
export function parseStockBuild(body: unknown): StockBuildBody | null {
  if (!body || typeof body !== 'object') return null;
  const v = body as Record<string, unknown>;
  if (v.action !== 'build' || !text(v.stock) || !MINT.test(v.stock) || !isStockQuote(v.quote) || !text(v.owner) || !MINT.test(v.owner)) return null;
  if (typeof v.amountA !== 'string' || typeof v.amountB !== 'string' || !DIGITS.test(v.amountA) || !DIGITS.test(v.amountB)) return null;
  if (BigInt(v.amountA) <= 0n || BigInt(v.amountB) <= 0n) return null;
  return {
    action: 'build',
    stock: v.stock,
    quote: v.quote,
    owner: v.owner,
    amountA: v.amountA,
    amountB: v.amountB,
  };
}

/** Dollars a deposit puts in at these prices; null when either side has none. */
export function depositUsdOf(pair: Pick<StockPair, 'priceUsd' | 'multiplier' | 'decimals'>, quote: StockQuote, quoteUsd: number | null, amountA: bigint, amountB: bigint): number | null {
  if (quoteUsd === null || !(quoteUsd > 0)) return null;
  const usd = (Number(amountA) / 10 ** pair.decimals) * baseUsd(pair) + (Number(amountB) / 10 ** QUOTE[quote].decimals) * quoteUsd;
  return Number.isFinite(usd) && usd > 0 ? usd : null;
}

/** A dollar figure, short: $1.2M, $84K, $950. */
export function usdShort(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e4) return `$${Math.round(value / 1e3)}K`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(1)}K`;
  return `$${Math.round(value)}`;
}
