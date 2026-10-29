/**
 * The arithmetic Liquidity Studio's venues share: base units as bigint,
 * shares and slippage in basis points, a position's place against the price.
 * Money never passes through a float here; a fee rate read as a percent from
 * an SDK becomes basis points once, rounded to a hundredth of a basis point.
 *
 * Pure.
 */

import type { Amount } from "@ryntra/core/adapters";

import { LiquidityRefusal, type LiquidityToken, type RangeState } from "./contract.ts";

export const BPS = 10_000n;

export function amountOf(token: LiquidityToken, units: bigint | string): Amount {
  return { units: BigInt(units).toString(), asset: token.mint, decimals: token.decimals };
}

/** A request's base-unit string: digits only, no sign, no point. */
export function parseUnits(value: string, field: string): bigint {
  if (typeof value !== "string" || !/^\d{1,30}$/.test(value)) throw new LiquidityRefusal("BAD_REQUEST", `${field} is not a whole number of base units.`);
  return BigInt(value);
}

export function assertBps(value: number, field: string, min: number, max: number): number {
  if (!Number.isInteger(value) || value < min || value > max) throw new LiquidityRefusal("BAD_REQUEST", `${field} must be a whole number of basis points from ${min} to ${max}.`);
  return value;
}

/** `units × bps / 10 000`, rounded down. */
export function shareOf(units: bigint, bps: number | bigint): bigint {
  return (units * BigInt(bps)) / BPS;
}

/** The least to accept back: rounded down, so the threshold never asks for more than the program pays. */
export function minusSlippage(units: bigint, slippageBps: number): bigint {
  return (units * (BPS - BigInt(slippageBps))) / BPS;
}

/** The most to let in: rounded up. */
export function plusSlippage(units: bigint, slippageBps: number): bigint {
  const scaled = units * (BPS + BigInt(slippageBps));
  return scaled / BPS + (scaled % BPS === 0n ? 0n : 1n);
}

/** A rate the SDK gives as a percent (0.25 = 0.25 %) in basis points, to a hundredth. */
export function percentToBps(percent: number | string): number {
  const value = typeof percent === "number" ? percent : Number(percent);
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100 * 100) / 100;
}

/** A fee numerator over 10⁹ (DAMM v2's denominator) in basis points, to a hundredth. */
export function numeratorToBps(numerator: bigint, denominator = 1_000_000_000n): number {
  return Number((numerator * 1_000_000n) / denominator) / 100;
}

/** Bins: above when every bin sits over the active one (only X), below when under it (only Y). */
export function binRangeState(lowerBin: number, upperBin: number, activeBin: number): RangeState {
  if (lowerBin > activeBin) return "above";
  if (upperBin < activeBin) return "below";
  return "in_range";
}

/** A DAMM v2 curve against its own bounds: at the bound it holds one token only. */
export function sqrtRangeState(sqrtPrice: bigint, sqrtMin: bigint, sqrtMax: bigint): RangeState {
  if (sqrtPrice <= sqrtMin) return "above";
  if (sqrtPrice >= sqrtMax) return "below";
  return "in_range";
}

/**
 * Which side an add in this range accepts: above the price only X, below only Y,
 * across it both. A side the range cannot take is refused, not quietly dropped.
 */
export function assertSidesFit(state: RangeState, amountX: bigint, amountY: bigint): void {
  if (amountX === 0n && amountY === 0n) throw new LiquidityRefusal("AMOUNT_ZERO", "Both amounts are zero.");
  if (state === "above" && amountY > 0n) throw new LiquidityRefusal("SIDE_NOT_ACCEPTED", "A range above the price takes only the base token.");
  if (state === "below" && amountX > 0n) throw new LiquidityRefusal("SIDE_NOT_ACCEPTED", "A range below the price takes only the quote token.");
}

/** Bin range checks for a new DLMM position: ordered, within the program's bin ids, at most `maxBins` wide. */
export function assertBinRange(lower: number, upper: number, maxBins: number, maxBinId: number): void {
  if (!Number.isInteger(lower) || !Number.isInteger(upper) || lower > upper) throw new LiquidityRefusal("RANGE_INVALID", "The bin range is not ordered whole numbers.");
  if (Math.abs(lower) > maxBinId || Math.abs(upper) > maxBinId) throw new LiquidityRefusal("RANGE_INVALID", "The bin range is outside the pool's bins.");
  if (upper - lower + 1 > maxBins) throw new LiquidityRefusal("RANGE_TOO_WIDE", `A new position holds at most ${maxBins} bins.`);
}

/**
 * An SDK's base-unit figure as a whole number, floored: a decimal string, an exponent form a Decimal prints from 1e21
 * on ("1.5e+21"), a BN or a bigint.
 */
export function wholeUnits(value: string | bigint | { toString(): string }): bigint {
  if (typeof value === "bigint") return value;
  const text = value.toString().trim();
  const match = /^(\d*)(?:\.(\d*))?(?:e\+?(\d+))?$/i.exec(text);
  if (!match) throw new Error(`Not a non-negative number of base units: ${text.slice(0, 40)}`);
  const [, whole = "", fraction = "", exponent = "0"] = match;
  const shift = Number(exponent);
  const digits = (whole + fraction.padEnd(shift, "0")).slice(0, whole.length + shift);
  return BigInt(digits === "" ? "0" : digits);
}

/** How far a price moved from another, basis points of the first; prices are read figures, never money. */
export function driftBps(from: string, to: string): number {
  const a = Number(from);
  const b = Number(to);
  if (!(a > 0) || !Number.isFinite(b)) return Number.POSITIVE_INFINITY;
  return (Math.abs(b - a) / a) * 10_000;
}

/** Sum of base-unit strings (an SDK's per-bin amounts). */
export function sumUnits(values: readonly (string | bigint)[]): bigint {
  let total = 0n;
  for (const value of values) total += BigInt(value);
  return total;
}
