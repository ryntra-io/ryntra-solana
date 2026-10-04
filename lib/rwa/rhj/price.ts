/**
 * Comparing two prices that are not the same quantity.
 *
 * The Asset Passport established the rule and proved what it costs to break:
 * on live `AAPL`, comparing the token's oracle price against the venue's raw
 * underlying quote reported `0.208%` where the honest share-against-share
 * figure was `0.152%`. The 56-basis-point gap was the multiplier, not the
 * market. After a 4:1 split the same mistake reads 300%.
 *
 * This module is that rule applied to the direct issuer API, where the trap is
 * sharper because the provider itself publishes both quantities under names
 * that both look like a price:
 *
 *   `/rhj/prices/{symbol}` → raw **underlying-equity** bid/ask (`REFERENCE`)
 *   Chainlink feed         → **multiplier-adjusted** token value (`ORACLE`)
 *
 * So `comparePrices` does not take two numbers. It takes two `RoledPrice`s, and
 * when their bases disagree it returns a **reason instead of a number**. The
 * defect guarded is not a wrong formula — the formula is trivial and any test
 * of it passes. It is a correct formula applied to a pair nobody checked.
 *
 * **Conversion is explicit and one-directional.** `toUnderlyingShare` divides a
 * token figure by `currentMultiplier`; `toToken` multiplies. Neither is applied
 * automatically inside a comparison, because a silent conversion is how an
 * unread multiplier becomes `1.0` and publishes a token price as a share price
 * while looking entirely ordinary.
 */

import {
  compareDecimal,
  parseDecimalText,
  rescale,
  subtractDecimal,
  type DecimalValue,
} from "../../home/portfolio/decimal.ts";
import { basisOf, type PriceBasis, type PriceRole, type SourceIdentity } from "./identity.ts";

export type RoledPrice = Readonly<{
  role: PriceRole;
  /** Exact decimal text as the source stated it. Never a float. */
  value: string;
  currency: string;
  identity: SourceIdentity;
}>;

export function basisOfPrice(price: RoledPrice): PriceBasis {
  return basisOf(price.role);
}

/**
 * The multiplier as `/rhj/assets` states it: 18-dp shares-per-token, decimal
 * text. `null` means it was not read — which is a first-class outcome, never a
 * reason to fall back to one.
 */
export type Multiplier = Readonly<{ value: string; source: string }> | null;

export type ComparisonRefusal = Readonly<{
  ok: false;
  reason: string;
  /** Machine-readable so a surface can branch without matching prose. */
  code:
    | "BASIS_MISMATCH"
    | "CURRENCY_MISMATCH"
    | "SAME_ROLE"
    | "NOT_A_DECIMAL"
    | "ZERO_DENOMINATOR"
    | "MULTIPLIER_MISSING";
}>;

export type Comparison = Readonly<{
  ok: true;
  basis: PriceBasis;
  currency: string;
  left: RoledPrice;
  right: RoledPrice;
  /** Signed difference, left minus right, as exact decimal text. */
  differenceText: string;
  /** Signed relative difference against `right`, in basis points. */
  differenceBps: number;
  /** What was applied to make the two comparable, so the reader can audit it. */
  conversion: string | null;
}>;

export type ComparisonResult = Comparison | ComparisonRefusal;

const BPS = 10_000n;

function decimalOf(value: string): DecimalValue | null {
  try {
    return parseDecimalText(value);
  } catch {
    return null;
  }
}

function unitsAt(value: DecimalValue, scale: number): bigint {
  return BigInt(rescale(value, scale, "TOWARD_ZERO").units);
}

/**
 * The scale a converted figure is stated at.
 *
 * Six digits beyond the source's own, capped at the 18 the decimal helpers
 * allow. Wide enough that an 18-dp multiplier cannot truncate a per-share price
 * into uselessness, narrow enough that the result still reads as a price.
 */
const MAX_SCALE = 18;

function resultScale(sourceScale: number): number {
  return Math.min(MAX_SCALE, sourceScale + 6);
}

function text(value: DecimalValue): string {
  const negative = value.units.startsWith("-");
  const digits = (negative ? value.units.slice(1) : value.units).padStart(value.scale + 1, "0");
  const whole = digits.slice(0, digits.length - value.scale) || "0";
  const fraction = value.scale === 0 ? "" : "." + digits.slice(digits.length - value.scale);
  return (negative ? "-" : "") + whole + fraction;
}

/**
 * Convert a token-basis figure to the underlying share it represents.
 *
 * `share = token / multiplier`. A missing multiplier refuses; it never becomes
 * `1.0`. That single branch is the difference between "we could not tell you
 * the per-share price" and publishing a token price labelled as a share price.
 */
export function toUnderlyingShare(
  price: RoledPrice,
  multiplier: Multiplier,
): Readonly<{ ok: true; value: string; conversion: string }> | ComparisonRefusal {
  if (basisOfPrice(price) === "UNDERLYING_SHARE") {
    return { ok: true, value: price.value, conversion: "none — already on the underlying share" };
  }
  if (multiplier === null) {
    return {
      ok: false,
      code: "MULTIPLIER_MISSING",
      reason: "the current multiplier was not read, so a token price cannot be stated per underlying share",
    };
  }
  const amount = decimalOf(price.value);
  const factor = decimalOf(multiplier.value);
  if (amount === null || factor === null) {
    return { ok: false, code: "NOT_A_DECIMAL", reason: "a value is not exact decimal text" };
  }
  const denominator = BigInt(factor.units);
  /* Checked before any arithmetic: the decimal helpers reject an out-of-range
     scale by throwing, which would turn a zero multiplier into a crash rather
     than the refusal a reader needs to see. */
  if (denominator === 0n) {
    return { ok: false, code: "ZERO_DENOMINATOR", reason: "the multiplier is zero" };
  }
  const outScale = resultScale(amount.scale);
  /* share = token ÷ multiplier, carried out in integer units so no float ever
     touches a price. The multiplier's own scale cancels out of the exponent. */
  const units = (BigInt(amount.units) * 10n ** BigInt(factor.scale + outScale - amount.scale)) / denominator;
  return {
    ok: true,
    value: text({ units: units.toString(), scale: outScale }),
    conversion: `divided by currentMultiplier ${multiplier.value} (${multiplier.source})`,
  };
}

/** `token = share × multiplier`. Same refusal on a missing multiplier, same reason. */
export function toToken(
  price: RoledPrice,
  multiplier: Multiplier,
): Readonly<{ ok: true; value: string; conversion: string }> | ComparisonRefusal {
  if (basisOfPrice(price) === "TOKEN") {
    return { ok: true, value: price.value, conversion: "none — already on the token" };
  }
  if (multiplier === null) {
    return {
      ok: false,
      code: "MULTIPLIER_MISSING",
      reason: "the current multiplier was not read, so an underlying-share price cannot be stated per token",
    };
  }
  const amount = decimalOf(price.value);
  const factor = decimalOf(multiplier.value);
  if (amount === null || factor === null) {
    return { ok: false, code: "NOT_A_DECIMAL", reason: "a value is not exact decimal text" };
  }
  const outScale = resultScale(amount.scale);
  const shed = amount.scale + factor.scale - outScale;
  const product = BigInt(amount.units) * BigInt(factor.units);
  /* token = share × multiplier. `shed` is never negative because `resultScale`
     never exceeds the combined scale of an 18-dp multiplier and a price. */
  const units = shed >= 0 ? product / 10n ** BigInt(shed) : product * 10n ** BigInt(-shed);
  return {
    ok: true,
    value: text({ units: units.toString(), scale: outScale }),
    conversion: `multiplied by currentMultiplier ${multiplier.value} (${multiplier.source})`,
  };
}

/**
 * Compare two roled prices.
 *
 * Refuses a basis mismatch outright. A caller that wants the comparison must
 * convert one side first and say so, which is what `convertThenCompare` does
 * with the conversion recorded on the result.
 */
export function comparePrices(left: RoledPrice, right: RoledPrice): ComparisonResult {
  if (left.currency !== right.currency) {
    return {
      ok: false,
      code: "CURRENCY_MISMATCH",
      reason: `${left.currency} and ${right.currency} are different currencies`,
    };
  }
  const leftBasis = basisOfPrice(left);
  const rightBasis = basisOfPrice(right);
  if (leftBasis !== rightBasis) {
    return {
      ok: false,
      code: "BASIS_MISMATCH",
      reason:
        `${left.role} is quoted on the ${leftBasis.toLowerCase().replace("_", " ")} and ` +
        `${right.role} on the ${rightBasis.toLowerCase().replace("_", " ")}; ` +
        "apply currentMultiplier before comparing them",
    };
  }
  if (left.role === right.role) {
    return {
      ok: false,
      code: "SAME_ROLE",
      reason: `both figures are ${left.role}; a divergence needs two different roles`,
    };
  }

  return compareOnBasis(left, right, left.value, leftBasis, null);
}

/**
 * The arithmetic, once, for both entry points.
 *
 * `comparePrices` reaches it only after proving the two bases agree.
 * `convertThenCompare` reaches it after *making* them agree, passing the
 * converted value and the basis it now sits on. Splitting it this way is what
 * lets an explicit conversion succeed without weakening the guard that refuses
 * an implicit one — the earlier shape re-entered the basis check with the
 * original role attached and refused every conversion it had just performed.
 */
function compareOnBasis(
  left: RoledPrice,
  right: RoledPrice,
  leftValue: string,
  basis: PriceBasis,
  conversion: string | null,
): ComparisonResult {
  const a = decimalOf(leftValue);
  const b = decimalOf(right.value);
  if (a === null || b === null) {
    return { ok: false, code: "NOT_A_DECIMAL", reason: "a value is not exact decimal text" };
  }
  const scale = Math.max(a.scale, b.scale);
  const difference = subtractDecimal(a, b, scale, "TOWARD_ZERO");
  const denominator = unitsAt(b, scale);
  if (denominator === 0n) {
    return { ok: false, code: "ZERO_DENOMINATOR", reason: "the reference figure is zero" };
  }
  /* Rounded away from zero, matching the material-change engine: on a
     monitoring surface, under-reporting is the expensive direction. */
  const numerator = BigInt(difference.units) * BPS;
  const magnitude = numerator < 0n ? -numerator : numerator;
  const absDenominator = denominator < 0n ? -denominator : denominator;
  const quotient = (magnitude + absDenominator - 1n) / absDenominator;
  const signed = numerator < 0n ? -quotient : quotient;

  return {
    ok: true,
    basis,
    currency: left.currency,
    left,
    right,
    differenceText: text(difference),
    differenceBps: Number(signed),
    conversion,
  };
}

/**
 * Convert `left` onto `right`'s basis using an explicit multiplier, then
 * compare. The conversion that was applied travels on the result, so a reader
 * is never shown a divergence without being able to see what made the two
 * figures comparable.
 */
export function convertThenCompare(
  left: RoledPrice,
  right: RoledPrice,
  multiplier: Multiplier,
): ComparisonResult {
  if (left.currency !== right.currency) {
    return {
      ok: false,
      code: "CURRENCY_MISMATCH",
      reason: `${left.currency} and ${right.currency} are different currencies`,
    };
  }
  if (left.role === right.role) {
    return {
      ok: false,
      code: "SAME_ROLE",
      reason: `both figures are ${left.role}; a divergence needs two different roles`,
    };
  }
  const target = basisOfPrice(right);
  const converted = target === "UNDERLYING_SHARE" ? toUnderlyingShare(left, multiplier) : toToken(left, multiplier);
  if (converted.ok !== true) return converted;

  return compareOnBasis(left, right, converted.value, target, converted.conversion);
}

/** Whether two exact decimal texts are the same number, scale differences aside. */
export function sameDecimal(left: string, right: string): boolean {
  const a = decimalOf(left);
  const b = decimalOf(right);
  if (a === null || b === null) return false;
  return compareDecimal(a, b) === 0;
}
