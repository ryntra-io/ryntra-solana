/**
 * Sell Higher · Buy Lower · the Wheel (CITY-97, spec E6) — the city's arithmetic on top of the engine's DLMM limit
 * orders (`lib/liquidity/studio/limit-orders.ts`). A person thinks in their own units: a price per share (an xStock)
 * or per SOL, and an amount of shares or SOL. The pool thinks in raw units: Y per X of base tokens, in bins of a fixed
 * step. This file turns one into the other and back, and nothing else decides a figure.
 *
 * Rules it keeps:
 * - **The live multiplier.** An xStock is a Token-2022 mint with the Scaled UI Amount extension: one base token stands
 *   for `multiplier` shares (`lib/stocks/units.ts`). A target per share becomes a base-token price through the
 *   multiplier in force now; the same order read back is said through the multiplier in force then — so an order
 *   placed before a corporate action is offered again (`replaceDue`) once the multiplier has moved.
 * - **The eve of a corporate action.** While a new multiplier is scheduled (from a day before it takes effect until
 *   the issuer's own quarter of an hour after), a new order that the step could fill at once — a sale near the price
 *   when the units grow, a purchase near it when they shrink — is not placed (`eveGuard`). Further away it may be.
 * - **Never on the wrong side.** A sale sits wholly over the price, a purchase wholly under it.
 *
 * Pure: prices are read figures, never money; amounts are bigint base units.
 */

import { multiplierRatio, rawFromScaledRaw, type Multiplier } from '../../../lib/stocks/units.ts';
import type { LimitBins, LimitSide } from '../../../lib/liquidity/studio/limit-orders.ts';
import { readAction } from './corporate.ts';

/** What the person does with the asset: sell it higher, or buy it lower. */
export type Intent = 'sell' | 'buy';

/** One price, or a ladder over several bins beyond it (filled bit by bit as the price walks). */
export type LimitForm = 'one' | 'ladder';
export const LADDER_BINS = 10;

export type LimitMarket = Readonly<{
  /** The DLMM pool. */
  pool: string;
  asset: Readonly<{ mint: string; symbol: string; decimals: number; kind: 'sol' | 'stock'; name: string | null }>;
  quote: Readonly<{ mint: string; symbol: string; decimals: number }>;
  /** Whether the asset is the pool's X (else its Y). */
  assetIsX: boolean;
  binStepBps: number;
  activeBin: number;
  /** The pool's swap fee now, basis points: the maker earns half of it on what fills. */
  feeBps: number;
  /** The live Scaled UI multiplier (an xStock); one for SOL and a mint without the extension. */
  multiplier: Multiplier;
  /** The asset's dollar price per unit as the wallet shows it, the venue's figure; for reading only. */
  priceUsd: number | null;
  /** The quote's dollar price, the venue's figure; for the ceiling's estimate on the card only. */
  quoteUsd: number | null;
  at: string;
}>;

/** The asset's side in the pool: selling X is an ask, selling Y a bid; buying is the other way. */
export function poolSide(intent: Intent, assetIsX: boolean): LimitSide {
  return (intent === 'sell') === assetIsX ? 'ask' : 'bid';
}

/** Y per X in raw units at a bin: the program's own price, (1 + step)^bin. */
export function rawPriceAt(bin: number, binStepBps: number): number {
  return (1 + binStepBps / 10_000) ** bin;
}

/** The pool's price in whole tokens (Y per X) from a raw one. */
function wholePrice(raw: number, market: Pick<LimitMarket, 'assetIsX' | 'asset' | 'quote'>): number {
  const [xDecimals, yDecimals] = market.assetIsX ? [market.asset.decimals, market.quote.decimals] : [market.quote.decimals, market.asset.decimals];
  return raw * 10 ** (xDecimals - yDecimals);
}

/** The asset's price in the quote per base token at a bin. */
export function basePriceAt(market: LimitMarket, bin: number): number {
  const whole = wholePrice(rawPriceAt(bin, market.binStepBps), market);
  return market.assetIsX ? whole : 1 / whole;
}

/** The asset's price in the quote per unit the wallet shows (a share, a SOL) at a bin, through a multiplier. */
export function unitPriceAt(market: LimitMarket, bin: number, multiplier: number = market.multiplier.current): number {
  return basePriceAt(market, bin) / multiplier;
}

/** The asset's price now, per unit the wallet shows, in the quote. */
export function unitPriceNow(market: LimitMarket): number {
  return unitPriceAt(market, market.activeBin);
}

/** A hair of tolerance so a price exactly on a bin is that bin, not the next. */
const EPSILON = 1e-9;

/**
 * The bin a target per unit sits in: for a sale the nearest bin at or over the target (never sell under it), for a
 * purchase the nearest at or under it (never pay over it) — in the asset's terms, whichever way the pool counts.
 */
export function binForTarget(market: LimitMarket, intent: Intent, target: number): number | null {
  if (!Number.isFinite(target) || target <= 0) return null;
  const base = target * market.multiplier.current;
  const poolWhole = market.assetIsX ? base : 1 / base;
  const [xDecimals, yDecimals] = market.assetIsX ? [market.asset.decimals, market.quote.decimals] : [market.quote.decimals, market.asset.decimals];
  const raw = poolWhole * 10 ** (yDecimals - xDecimals);
  const exact = Math.log(raw) / Math.log(1 + market.binStepBps / 10_000);
  if (!Number.isFinite(exact)) return null;
  // The asset's price rises with the bin when it is X and falls with it when it is Y.
  const up = (intent === 'sell') === market.assetIsX;
  return up ? Math.ceil(exact - EPSILON) : Math.floor(exact + EPSILON);
}

/** The order's bins from the target's bin: one, or a ladder running away from the price. */
export function binsFor(side: LimitSide, bin: number, form: LimitForm): LimitBins {
  const width = form === 'ladder' ? LADDER_BINS : 1;
  return side === 'ask' ? { lower: bin, upper: bin + width - 1 } : { lower: bin - width + 1, upper: bin };
}

/** An ask wholly over the price, a bid wholly under it. */
export function binsFit(side: LimitSide, bins: LimitBins, activeBin: number): boolean {
  return side === 'ask' ? bins.lower > activeBin : bins.upper < activeBin;
}

/** The order's prices per unit: where it starts filling (nearest the price) and where it ends. */
export function orderUnitPrices(market: LimitMarket, side: LimitSide, bins: LimitBins, multiplier: number = market.multiplier.current): Readonly<{ near: number; far: number }> {
  const [nearBin, farBin] = side === 'ask' ? [bins.lower, bins.upper] : [bins.upper, bins.lower];
  return { near: unitPriceAt(market, nearBin, multiplier), far: unitPriceAt(market, farBin, multiplier) };
}

/** A typed decimal at a token's decimals into base units; null when it is no amount. */
export function unitsOfText(text: string, decimals: number): bigint | null {
  const clean = text.trim().replace(',', '.');
  if (!/^\d*(\.\d*)?$/.test(clean) || clean === '' || clean === '.') return null;
  const [whole = '', fraction = ''] = clean.split('.');
  if (fraction.length > decimals) return null;
  const units = BigInt((whole || '0') + fraction.padEnd(decimals, '0'));
  return units > 0n ? units : null;
}

/**
 * What goes into the order, base units: a sale's shares through the multiplier (one base token is `multiplier`
 * shares), a purchase's amount of the quote as typed.
 */
export function depositUnits(market: LimitMarket, intent: Intent, typed: string): bigint | null {
  if (intent === 'buy') return unitsOfText(typed, market.quote.decimals);
  const scaled = unitsOfText(typed, market.asset.decimals);
  if (scaled === null) return null;
  const raw = market.multiplier.current === 1 ? scaled : rawFromScaledRaw(scaled, market.multiplier.current);
  return raw > 0n ? raw : null;
}

/* ------------------------------------------------------- dollars on the card (CITY-190) */

/** Whether the market's prices are dollars: a USDC quote. */
export function quotedInDollars(market: Pick<LimitMarket, 'quote'>): boolean {
  return market.quote.symbol === 'USDC';
}

/** Whether what goes in is itself dollars (a purchase paid in USDC): then the amount needs no second unit. */
export function depositInDollars(market: Pick<LimitMarket, 'quote'>, intent: Intent): boolean {
  return intent === 'buy' && quotedInDollars(market);
}

/** The dollars one unit of what goes in is worth: a share or a SOL on a sale, the quote on a purchase; null unknown. */
export function depositUnitUsd(market: Pick<LimitMarket, 'priceUsd' | 'quoteUsd'>, intent: Intent): number | null {
  const usd = intent === 'sell' ? market.priceUsd : market.quoteUsd;
  return usd !== null && Number.isFinite(usd) && usd > 0 ? usd : null;
}

/** The places an amount typed through dollars keeps: the token's own, at most six. */
const DOLLAR_PLACES = 6;

function decimalOf(text: string): number | null {
  const clean = text.trim().replace(',', '.');
  if (!/^\d*(\.\d*)?$/.test(clean) || clean === '' || clean === '.') return null;
  const value = Number(clean);
  return Number.isFinite(value) ? value : null;
}

/**
 * Dollars typed on the card as the amount that goes in, the coin field's own text: at the venue's price now, rounded
 * down so it never asks for more than the dollars typed. Empty when it is no amount or there is no price.
 */
export function coinOfUsd(market: LimitMarket, intent: Intent, usdText: string): string {
  const usd = decimalOf(usdText);
  const unitUsd = depositUnitUsd(market, intent);
  if (usd === null || usd <= 0 || unitUsd === null) return '';
  const places = Math.min(DOLLAR_PLACES, intent === 'sell' ? market.asset.decimals : market.quote.decimals);
  const scaled = Math.floor((usd / unitUsd) * 10 ** places + 1e-6);
  if (!(scaled > 0)) return '';
  const text = String(scaled).padStart(places + 1, '0');
  const whole = text.slice(0, text.length - places);
  const fraction = text.slice(text.length - places).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

/** The amount that goes in as dollars for the field: rounded down to the cent. Empty when unknown. */
export function usdOfCoin(market: LimitMarket, intent: Intent, coinText: string): string {
  const coin = decimalOf(coinText);
  const unitUsd = depositUnitUsd(market, intent);
  if (coin === null || coin <= 0 || unitUsd === null) return '';
  const cents = Math.floor(coin * unitUsd * 100 + 1e-6);
  return String(cents / 100);
}

/** Base units of the asset as units the wallet shows (shares), a display number. */
export function shownUnits(raw: bigint, decimals: number, multiplier: number): number {
  const { num, den } = multiplierRatio(multiplier);
  return Number((raw * num * 1_000_000n) / (den * 10n ** BigInt(decimals))) / 1_000_000;
}

/**
 * What the order brings if every bin fills, as a display number in the other side's units: a sale is paid the quote,
 * a purchase the asset's shown units. Spread as the engine spreads it (evenly, the remainder nearest the price); the
 * engine's own preview states the exact figure before the signature.
 */
export function fullFillShown(market: LimitMarket, intent: Intent, bins: LimitBins, deposit: bigint): number {
  const width = bins.upper - bins.lower + 1;
  const each = Number(deposit / BigInt(width));
  const rest = Number(deposit - BigInt(width) * (deposit / BigInt(width)));
  let total = 0;
  for (let bin = bins.lower; bin <= bins.upper; bin += 1) {
    const side = poolSide(intent, market.assetIsX);
    const nearest = side === 'ask' ? bin === bins.lower : bin === bins.upper;
    const units = each + (nearest ? rest : 0);
    const base = basePriceAt(market, bin);
    if (intent === 'sell') total += (units / 10 ** market.asset.decimals) * base;
    else total += ((units / 10 ** market.quote.decimals) / base) * market.multiplier.current;
  }
  return total;
}

/**
 * The chain's multiplier with the issuer's announcement: the chain is the truth of the multiplier in force; a new one
 * the issuer has announced is taken when the chain schedules none yet, or schedules it later — but only while the
 * issuer and the chain agree on the multiplier in force now (else the announcement is about something else).
 */
export function mergePending(chain: Multiplier, issuer: Readonly<{ current: number; pending: number | null; effectiveAt: string | null }> | null, nowMs: number): Multiplier {
  if (!issuer || issuer.pending === null || issuer.effectiveAt === null) return chain;
  const at = Date.parse(issuer.effectiveAt);
  if (!Number.isFinite(at) || at <= nowMs) return chain;
  if (Math.abs(issuer.current / chain.current - 1) > 1e-9) return chain;
  const chainAt = chain.effectiveAt === null ? Number.POSITIVE_INFINITY : Date.parse(chain.effectiveAt);
  if (chain.pending !== null && Number.isFinite(chainAt) && chainAt <= at) return chain;
  return { current: chain.current, pending: issuer.pending, effectiveAt: new Date(at).toISOString() };
}

/* ------------------------------------------------------- the eve of an event */

/** From a day before a scheduled multiplier takes effect… */
export const EVE_BEFORE_MS = 24 * 60 * 60 * 1000;
/** …to the issuer's own quarter of an hour after it (`lib/stocks/units.ts`, `ACTIVATION_WINDOW_MS`). */
export const EVE_AFTER_MS = 15 * 60 * 1000;
/** The least band around the price that is closed on the eve. */
export const EVE_MIN_BAND = 0.02;
/** Room beyond the step itself. */
export const EVE_MARGIN = 0.01;

export type EveGuard =
  | Readonly<{ blocked: false; eve: boolean; at: string | null }>
  | Readonly<{ blocked: true; eve: true; at: string; kind: 'dividend' | 'split' | 'other'; band: number }>;

/**
 * Whether a new order may be placed now, on the eve of a scheduled multiplier change. `ratio` is the order's nearest
 * price over the price now, both in the same unit (the multiplier cancels out). When the units grow (a dividend, a
 * split) the token's raw price steps up at the change, so a sale within the step's reach — plus a margin, and never
 * under two per cent — would fill on the step alone; when they shrink (a reverse split) the same holds for a purchase.
 */
export function eveGuard(input: Readonly<{ intent: Intent; multiplier: Multiplier | null; mint: string; ratio: number; nowMs: number }>): EveGuard {
  const { multiplier, nowMs } = input;
  if (!multiplier || multiplier.pending === null || multiplier.effectiveAt === null) return { blocked: false, eve: false, at: null };
  const at = Date.parse(multiplier.effectiveAt);
  if (!Number.isFinite(at) || nowMs < at - EVE_BEFORE_MS || nowMs > at + EVE_AFTER_MS) return { blocked: false, eve: false, at: null };
  const step = multiplier.pending / multiplier.current;
  if (!Number.isFinite(step) || step <= 0 || step === 1) return { blocked: false, eve: true, at: multiplier.effectiveAt };
  const action = readAction({ mint: input.mint, at: multiplier.effectiveAt, from: multiplier.current, to: multiplier.pending });
  const kind = action.kind === 'dividend' ? 'dividend' : action.kind === 'split' || action.kind === 'reverse-split' ? 'split' : 'other';
  if (input.intent === 'sell' && step > 1) {
    const band = Math.max(EVE_MIN_BAND, step - 1 + EVE_MARGIN);
    if (input.ratio <= 1 + band) return { blocked: true, eve: true, at: multiplier.effectiveAt, kind, band };
  }
  if (input.intent === 'buy' && step < 1) {
    const band = Math.max(EVE_MIN_BAND, 1 - step + EVE_MARGIN);
    if (input.ratio >= 1 - band) return { blocked: true, eve: true, at: multiplier.effectiveAt, kind, band };
  }
  return { blocked: false, eve: true, at: multiplier.effectiveAt };
}

/**
 * The eve guard on an engine preview (the server's own check before a ticket reaches the wallet): the pool's price and
 * the order's bin prices, Y per X in whole tokens, turned into the asset's terms.
 */
export function previewRatio(input: Readonly<{ assetIsX: boolean; side: LimitSide; poolPrice: number; lowerPrice: number; upperPrice: number }>): number | null {
  const { assetIsX, side, poolPrice, lowerPrice, upperPrice } = input;
  if (!(poolPrice > 0) || !(lowerPrice > 0) || !(upperPrice > 0)) return null;
  // The bin nearest the price fills first: an ask's lowest, a bid's highest.
  const nearPool = side === 'ask' ? lowerPrice : upperPrice;
  const asAsset = (pool: number) => (assetIsX ? pool : 1 / pool);
  return asAsset(nearPool) / asAsset(poolPrice);
}

/* ------------------------------------------------------- re-place and the Wheel */

/** What the device keeps of an order placed here: the multiplier and the target per unit it was placed at. */
export type PlacedRecord = Readonly<{ order: string; pool: string; mint: string; intent: Intent; target: number; multiplier: number; at: number }>;

/** An order placed through one multiplier and read now through another: its price per share moved with the units. */
export function replaceDue(record: PlacedRecord | null, current: number): boolean {
  if (!record || !(record.multiplier > 0) || !(current > 0)) return false;
  return Math.abs(current / record.multiplier - 1) > 1e-9;
}

/** The Wheel's next target: a filled sale offers a purchase this far under the price it sold at; a filled purchase, a sale this far over. */
export const WHEEL_STEP = 0.05;

export function wheelTarget(intent: Intent, filledAt: number): number {
  return intent === 'sell' ? filledAt * (1 - WHEEL_STEP) : filledAt * (1 + WHEEL_STEP);
}

export function readRecord(raw: unknown): PlacedRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Record<string, unknown>;
  const key = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  if (typeof v.order !== 'string' || !key.test(v.order) || typeof v.pool !== 'string' || !key.test(v.pool) || typeof v.mint !== 'string' || !key.test(v.mint)) return null;
  if (v.intent !== 'sell' && v.intent !== 'buy') return null;
  if (typeof v.target !== 'number' || !(v.target > 0) || typeof v.multiplier !== 'number' || !(v.multiplier > 0) || typeof v.at !== 'number') return null;
  return { order: v.order, pool: v.pool, mint: v.mint, intent: v.intent, target: v.target, multiplier: v.multiplier, at: v.at };
}
