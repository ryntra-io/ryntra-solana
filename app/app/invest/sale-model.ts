/**
 * «Продати з позиції» — the pure half.
 *
 * What a sale of a company a person holds is decided here once and tested:
 * how much of the position a sum in dollars or a share of it sells — in the
 * mint's raw units, the one amount the execution path takes — what the
 * position is worth, and the company's facts the sale's sheet says, read the
 * same way whether the sheet opens on the company's page or on the position
 * in Portfolio. No fetch, no clock, no React: the page and the sheet hand the
 * facts in.
 */

import type { StockAsset } from "../../../lib/stocks/asset.server.ts";
import { companyDisplayName } from "../../../lib/stocks/shelf.ts";
import { MIN_BUY_USD, truthLine } from "./company-model.ts";

type Lang = "en" | "uk";

/**
 * The least a sale typed in dollars is — a dollar, as for a purchase. Selling
 * the whole position is never held to it: a person may always leave a
 * position.
 */
export const MIN_SALE_USD = MIN_BUY_USD;

/** The quick choices are shares of the position — 25 %, 50 %, 75 % and 100 %, as the purchase's are shares of the wallet's USDC; 100 % is exactly what the wallet holds. */
export const SALE_SHARE_PRESETS_PCT = [25, 50, 75, 100] as const;

/** The sum a sale opens on when the position is worth at least that much — the purchase's $10, a default and never advice; a smaller position opens on no sum. */
export const DEFAULT_SALE_USD = 10;

/** A sum within half a cent of the position's value is the whole position: the last fraction of a share is never left behind by rounding. */
const WHOLE_TOLERANCE_USD = 0.005;

/** What the sale's sheet says about the company, read from the same facts its page draws. */
export type SaleAsset = Readonly<{
  mint: string;
  /** The token's symbol — the venue's key, never shown at rest. */
  symbol: string;
  /** The company as a person names it («Apple», never the token's ticker). */
  name: string;
  icon: string | null;
  /** The mint's decimals as the chain states them; null when unread. */
  decimals: number | null;
  /** The Scaled UI Amount multiplier in force; null where the mint carries none. */
  multiplier: number | null;
  unit: "share" | "token";
  preIpo: boolean;
  /** The one line of truth about what the token is. */
  truth: string;
  /** The fee the mint withholds on every transfer, basis points, as the chain states it — a PreStocks token's; null where it charges none. */
  issuerFeeBps: number | null;
  /** One token as the wallet shows it, in dollars — the venue's price; null when unpriced. */
  priceUsd: number | null;
  /** Whether a sale can be offered now: the issuer has not paused trading and there is a price. */
  sellable: boolean;
}>;

/**
 * The company's facts for its sale, from the stock asset the page and the
 * `/api/stocks/asset` read both carry — the name, the truth, the fee from the
 * chain, the multiplier and the decimals exactly as the company page reads
 * them (`company-view.tsx`).
 */
export function saleAssetOf(asset: StockAsset, lang: Lang): SaleAsset {
  const { row } = asset;
  const rep = row.representation;
  const preIpo = rep.instrument.class === "pre-ipo";
  const name = companyDisplayName(rep.underlying.name ?? rep.name, preIpo ? null : rep.underlying.symbol);
  const feeBps = row.transferFee?.basisPoints ?? null;
  const onchain = "error" in asset.onchain ? null : asset.onchain;
  const price = typeof row.market.priceUsd === "number" && Number.isFinite(row.market.priceUsd) && row.market.priceUsd > 0 ? row.market.priceUsd : null;
  return {
    mint: rep.mint,
    symbol: rep.symbol,
    name,
    icon: row.market.icon ?? null,
    decimals: onchain?.decimals ?? null,
    multiplier: asset.chainMultiplier?.current ?? row.multiplier?.current ?? null,
    unit: rep.instrument.unitBasis === "token" ? "token" : "share",
    preIpo,
    truth: truthLine(rep.issuer.id, name, lang, feeBps),
    issuerFeeBps: feeBps,
    priceUsd: price,
    sellable: rep.tradingHalted !== true && price !== null,
  };
}

const positiveMultiplier = (multiplier: number | null): number => (multiplier !== null && Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1);

/** The position in the unit the wallet shows — shares for a listed company, tokens for a private one: raw × multiplier ÷ 10^decimals. */
export function unitsOf(raw: bigint, decimals: number, multiplier: number | null): number {
  if (raw <= 0n || !Number.isInteger(decimals) || decimals < 0) return 0;
  return (Number(raw) / 10 ** decimals) * positiveMultiplier(multiplier);
}

/** What the position is worth at the price, in dollars; null without a price. */
export function positionUsd(heldRaw: bigint, decimals: number, multiplier: number | null, priceUsd: number | null): number | null {
  if (priceUsd === null || !Number.isFinite(priceUsd) || priceUsd <= 0) return null;
  return unitsOf(heldRaw, decimals, multiplier) * priceUsd;
}

/** A share of the position in raw units, never rounded up — 100 % is exactly what the wallet holds. */
export function shareRaw(heldRaw: bigint, pct: number): bigint {
  if (heldRaw <= 0n || !Number.isFinite(pct) || pct <= 0) return 0n;
  if (pct >= 100) return heldRaw;
  return (heldRaw * BigInt(Math.round(pct * 100))) / 10_000n;
}

/** Whether a sum in dollars reaches the whole position — within half a cent of its value. */
export function isWholePosition(usd: number, valueUsd: number | null): boolean {
  return valueUsd !== null && Number.isFinite(usd) && usd >= valueUsd - WHOLE_TOLERANCE_USD;
}

/** Whether a sum in dollars is more than the position is worth — beyond the half cent that still reads as all of it. */
export function isOverPosition(usd: number, valueUsd: number | null): boolean {
  return valueUsd !== null && Number.isFinite(usd) && usd > valueUsd + WHOLE_TOLERANCE_USD;
}

/**
 * The raw units a sum in dollars sells at the price: the whole position when
 * the sum reaches its value, never more than is held, never rounded up.
 * Null without a price, a positive sum or the mint's decimals.
 */
export function rawForUsd(usd: number, heldRaw: bigint, decimals: number | null, multiplier: number | null, priceUsd: number | null): bigint | null {
  if (!Number.isFinite(usd) || usd <= 0 || decimals === null || !Number.isInteger(decimals) || decimals < 0 || heldRaw <= 0n) return null;
  const value = positionUsd(heldRaw, decimals, multiplier, priceUsd);
  if (value === null || priceUsd === null) return null;
  if (isWholePosition(usd, value)) return heldRaw;
  const raw = BigInt(Math.floor(((usd / priceUsd) / positiveMultiplier(multiplier)) * 10 ** decimals));
  return raw > heldRaw ? heldRaw : raw;
}

/**
 * A share of the position in dollars and cents, never rounded up — the figure
 * a quick choice puts into the sum; null without a price.
 */
export function shareUsd(heldRaw: bigint, decimals: number, multiplier: number | null, priceUsd: number | null, pct: number): number | null {
  const value = positionUsd(shareRaw(heldRaw, pct), decimals, multiplier, priceUsd);
  return value === null ? null : Math.floor(value * 100 + 1e-6) / 100;
}

/** The sum a sale opens on: the purchase's $10 when the position is worth at least that, no sum otherwise (never a preselected sale of everything). */
export function openingSaleUsd(valueUsd: number | null): number | null {
  return valueUsd !== null && valueUsd >= DEFAULT_SALE_USD ? DEFAULT_SALE_USD : null;
}
