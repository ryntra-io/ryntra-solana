/**
 * The arithmetic of the pool action screens, pure: typed amounts to base
 * units and back, a DLMM range from the active bin, and the price at a bin.
 * Money stays a decimal string of base units from the field to the build.
 */

export const RANGE_WIDTHS = ["narrow", "medium", "wide"] as const;
export type RangeWidth = (typeof RANGE_WIDTHS)[number];
/** Bins on each side of the price: 11, 31 and 69 bins in all — the widest fits one position (70). */
export const HALF_WIDTH: Readonly<Record<RangeWidth, number>> = { narrow: 5, medium: 15, wide: 34 };

/** The form's width nearest to a half-width in bins — how a rebalance (SOL-2b) opens the same width it left. */
export function widthNear(half: number): RangeWidth {
  return RANGE_WIDTHS.reduce((best, width) => (Math.abs(HALF_WIDTH[width] - half) < Math.abs(HALF_WIDTH[best] - half) ? width : best), RANGE_WIDTHS[0]);
}

export const RANGE_PLACES = ["around", "above", "below"] as const;
/** `around` — both tokens, across the price; `above` — the base token only, sold as the price rises; `below` — the quote only, bought as it falls. */
export type RangePlace = (typeof RANGE_PLACES)[number];

export const SLIPPAGES_BPS = [50, 100, 200] as const;
export const DEFAULT_SLIPPAGE_BPS = 100;

/** A typed amount — digits, one point or comma, no more decimals than the token has — as base units; null when it is not one. */
export function toBaseUnits(typed: string, decimals: number): string | null {
  const text = typed.trim().replace(",", ".");
  if (!/^\d*(?:\.\d*)?$/.test(text) || text === "" || text === ".") return null;
  const [whole = "", fraction = ""] = text.split(".");
  if (fraction.length > decimals) return null;
  const units = BigInt((whole || "0") + fraction.padEnd(decimals, "0"));
  return units.toString();
}

/** Base units as a number of whole tokens, for showing only. */
export function fromBaseUnits(units: string, decimals: number): number {
  return Number(units) / 10 ** decimals;
}

/** A number as a decimal string a field can hold, cut (never rounded up) to the token's decimals — for a derived amount. */
export function typedOf(value: number, decimals: number): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  const places = Math.min(decimals, 9);
  const factor = 10 ** places;
  const cut = (Math.floor(value * factor) / factor).toFixed(places);
  return places === 0 ? cut : cut.replace(/\.?0+$/, "");
}

/** Base units as the exact decimal string a field holds: «Max» never passes through a float. */
export function typedFromUnits(units: string | bigint, decimals: number): string {
  const value = BigInt(units);
  if (value <= 0n) return "";
  const text = value.toString().padStart(decimals + 1, "0");
  const whole = text.slice(0, text.length - decimals);
  const fraction = decimals > 0 ? text.slice(text.length - decimals).replace(/0+$/, "") : "";
  return fraction ? `${whole}.${fraction}` : whole;
}

/** SOL «Max» leaves in the wallet: a new position's rent, two new bin arrays of the pool, and the network. */
export const SOL_RESERVE_LAMPORTS = 200_000_000n;

/** The bins of a new DLMM position, inclusive, from where the price is. */
export function dlmmBins(activeBin: number, width: RangeWidth, place: RangePlace): Readonly<{ lower: number; upper: number }> {
  const half = HALF_WIDTH[width];
  if (place === "above") return { lower: activeBin + 1, upper: activeBin + 1 + 2 * half };
  if (place === "below") return { lower: activeBin - 1 - 2 * half, upper: activeBin - 1 };
  return { lower: activeBin - half, upper: activeBin + half };
}

/** The price at a bin `offset` bins from the active one: each bin is one step of `binStepBps` above the last. */
export function priceAtOffset(price: number, binStepBps: number, offset: number): number {
  return price * (1 + binStepBps / 10_000) ** offset;
}

/** Which sides a range takes: one off the price takes one token only. */
export function sidesOf(place: RangePlace): Readonly<{ x: boolean; y: boolean }> {
  return place === "above" ? { x: true, y: false } : place === "below" ? { x: false, y: true } : { x: true, y: true };
}

/** Shares of a position to withdraw, basis points. */
export const WITHDRAW_SHARES = [2_500, 5_000, 7_500, 10_000] as const;
