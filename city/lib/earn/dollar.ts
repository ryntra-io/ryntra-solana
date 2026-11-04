import { rawFromText, textFromRaw, usdOf } from '../../../lib/earn/model.ts';

/**
 * The Dollar Saver (CITY-192, E5 of `docs/research/ryntra-earn-2026-10-29/SPEC.md`): USDC or SOL lent at Jupiter Lend's
 * floating rate, put in and taken back in one signature each. Every figure here is the engine's (`/api/solana/earn`,
 * SOL-3's `lib/earn`): the market's rate, its minimum and what it can pay out now, the wallet's position read from
 * the chain. This file only reads that answer into the card's words and checks an amount against it — the server
 * builds the transaction and checks it all again; the person's wallet is the only signer. Ryntra takes 0 % here.
 */

export const DOLLAR_ASSETS = ['USDC', 'SOL'] as const;
export type DollarAsset = (typeof DOLLAR_ASSETS)[number];
export type DollarSide = 'deposit' | 'withdraw';

/** The mints the Saver lends: USDC, and wrapped SOL (Jupiter Lend's SOL market; the deposit wraps native SOL). */
export const DOLLAR_MINT: Readonly<Record<DollarAsset, string>> = {
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  SOL: 'So11111111111111111111111111111111111111112',
};
export const DOLLAR_DECIMALS: Readonly<Record<DollarAsset, number>> = { USDC: 6, SOL: 9 };

/** What a SOL deposit leaves in the wallet for the network — the engine keeps the same (`lib/earn/actions.ts`). */
export const SOL_KEEP_LAMPORTS = 10_000_000n;

export function isDollarAsset(value: unknown): value is DollarAsset {
  return value === 'USDC' || value === 'SOL';
}

export type DollarMarket = Readonly<{
  asset: DollarAsset;
  mint: string;
  decimals: number;
  /** Per cent a year, as Jupiter Lend states it now; null when it was not read. */
  rate: number | null;
  /** The least the engine supplies, base units ($1 at the market's price); null when the price was not read. */
  minimumRaw: bigint | null;
  /** What the market can pay out right now, base units; null when not read. */
  liquidRaw: bigint | null;
  priceUsd: number | null;
}>;

export type DollarPosition = Readonly<{
  asset: DollarAsset;
  /** What the position is worth now, base units; null when the exchange rate was not read. */
  worthRaw: bigint | null;
  /** What it earned so far, base units; null when what went in was not read. */
  earnedRaw: bigint | null;
  /** What can be taken back today: the position, or the market's liquidity if that is smaller. */
  availableRaw: bigint | null;
}>;

export type DollarSurface = Readonly<{
  /** Jupiter Lend answered; false — the provider is unavailable here (no key, an outage). */
  provider: boolean;
  markets: Readonly<Record<DollarAsset, DollarMarket | null>>;
  /** The wallet's positions, by coin; empty for a guest. */
  positions: Readonly<Partial<Record<DollarAsset, DollarPosition>>>;
  /** Whether the engine builds an action for this wallet now, and the ceiling under its canary. */
  actions: Readonly<{ open: boolean; maxUsd: number | null }>;
  /** Ryntra's cut as the engine states it: 0. */
  feeBps: number;
  owner: string | null;
}>;

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const DIGITS = /^\d{1,32}$/;
const big = (value: unknown): bigint | null => (typeof value === 'string' && DIGITS.test(value) ? BigInt(value) : null);
const num = (value: unknown, max: number): number | null => (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max ? value : null);

const assetOfMint = (mint: unknown): DollarAsset | null => (mint === DOLLAR_MINT.USDC ? 'USDC' : mint === DOLLAR_MINT.SOL ? 'SOL' : null);

/** The engine's surface read into the Saver's two coins; null for an answer of another shape. */
export function readDollarSurface(body: unknown, owner: string | null): DollarSurface | null {
  if (!isObject(body) || !Array.isArray(body.providers)) return null;
  const jupiter = body.providers.find((p) => isObject(p) && p.provider === 'jupiter') as Json | undefined;
  const markets: Record<DollarAsset, DollarMarket | null> = { USDC: null, SOL: null };
  if (jupiter?.ok === true && Array.isArray(jupiter.markets)) {
    for (const entry of jupiter.markets) {
      if (!isObject(entry) || !isObject(entry.asset)) continue;
      const asset = assetOfMint(entry.asset.mint);
      if (!asset || markets[asset] || entry.asset.decimals !== DOLLAR_DECIMALS[asset]) continue;
      markets[asset] = {
        asset,
        mint: DOLLAR_MINT[asset],
        decimals: DOLLAR_DECIMALS[asset],
        // A lending rate above 100 % a year is a misread, never a figure to show.
        rate: num(entry.rateAnnualPercent, 100),
        minimumRaw: big(entry.minimumRaw),
        liquidRaw: big(entry.liquidRaw),
        priceUsd: typeof entry.priceUsd === 'number' && entry.priceUsd > 0 && Number.isFinite(entry.priceUsd) ? entry.priceUsd : null,
      };
    }
  }
  const positions: Partial<Record<DollarAsset, DollarPosition>> = {};
  if (owner && Array.isArray(body.positions)) {
    for (const entry of body.positions) {
      if (!isObject(entry) || entry.provider !== 'jupiter' || !isObject(entry.asset)) continue;
      const asset = assetOfMint(entry.asset.mint);
      if (!asset || positions[asset]) continue;
      const shares = big(entry.sharesRaw);
      // A position of none is not a position; one the chain did not answer on still is, with its figures unknown.
      if (shares === 0n) continue;
      positions[asset] = { asset, worthRaw: big(entry.underlyingRaw), earnedRaw: big(entry.earnedRaw), availableRaw: big(entry.availableRaw) };
    }
  }
  const actions = isObject(body.actions) ? body.actions : {};
  return {
    provider: jupiter?.ok === true && (markets.USDC !== null || markets.SOL !== null),
    markets,
    positions,
    actions: { open: actions.open === true && owner !== null, maxUsd: num(actions.maxUsd, 1e9) },
    feeBps: typeof body.feeBps === 'number' ? body.feeBps : 0,
    owner,
  };
}

/** An amount typed in the coin («50», «0,5») as base units; null for anything else or nothing. */
export function dollarRaw(text: string, asset: DollarAsset): bigint | null {
  const raw = rawFromText(text, DOLLAR_DECIMALS[asset]);
  return raw !== null && raw > 0n ? raw : null;
}

/** Base units as the card writes them: USDC to the cent, SOL to four places (more for a speck). */
export function dollarText(raw: bigint, asset: DollarAsset): string {
  const decimals = DOLLAR_DECIMALS[asset];
  const places = asset === 'USDC' ? 2 : raw > 0n && raw < 100_000n ? 9 : 4;
  return textFromRaw(raw, decimals, places);
}

/** Base units back into the field's own text, all digits kept. */
export function fieldText(raw: bigint, asset: DollarAsset): string {
  return textFromRaw(raw, DOLLAR_DECIMALS[asset]);
}

/** What the wallet may put in: USDC as held, SOL as spendable less what the network keeps. */
export function walletSpendable(asset: DollarAsset, spendableRaw: string | null): bigint | null {
  if (spendableRaw === null || !DIGITS.test(spendableRaw)) return null;
  const raw = BigInt(spendableRaw);
  if (asset === 'USDC') return raw;
  return raw > SOL_KEEP_LAMPORTS ? raw - SOL_KEEP_LAMPORTS : 0n;
}

export type DollarProblem = 'zero' | 'minimum' | 'balance' | 'position' | 'liquidity' | 'canary';

/** The first reason this amount cannot go, before anything is built; null — it can. The server checks it all again. */
export function dollarProblem(args: Readonly<{
  side: DollarSide;
  raw: bigint | null;
  market: DollarMarket | null;
  walletRaw: bigint | null;
  position: DollarPosition | null;
  maxUsd: number | null;
}>): DollarProblem | null {
  const { side, raw, market, walletRaw, position, maxUsd } = args;
  if (raw === null || raw <= 0n) return 'zero';
  if (side === 'deposit') {
    if (market?.minimumRaw != null && raw < market.minimumRaw) return 'minimum';
    if (walletRaw !== null && raw > walletRaw) return 'balance';
  } else {
    if (position?.worthRaw != null && raw > position.worthRaw) return 'position';
    if (market?.liquidRaw != null && market.liquidRaw <= 0n) return 'liquidity';
  }
  if (maxUsd !== null && market) {
    const usd = usdOf(raw, market.decimals, market.priceUsd);
    if (usd === null || usd > maxUsd) return 'canary';
  }
  return null;
}

/** A year at today's rate, base units: read beside the rate, never promised (the «i» says it floats). */
export function yearAt(raw: bigint | null, rate: number | null): bigint | null {
  if (raw === null || rate === null || !Number.isFinite(rate)) return null;
  return BigInt(Math.floor(Number(raw) * (rate / 100)));
}

/** A rate as the card writes it: «5.30 %» → «5.3%». */
export function rateText(rate: number): string {
  return `${rate.toLocaleString('en-US', { maximumFractionDigits: 2 })}%`;
}

/** A first deposit starts small: 10 USDC, 0.1 SOL. */
export const START_TEXT: Readonly<Record<DollarAsset, string>> = { USDC: '10', SOL: '0.1' };
