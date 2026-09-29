/**
 * Units of a tokenized stock — the part of the maths that is security.
 *
 * On Solana an xStock is a Token-2022 mint with the Scaled UI Amount
 * extension. The raw balance never changes on a corporate event; an
 * issuer-set multiplier changes what the balance *means*:
 *
 *   base_token_amount = raw_amount / 10^decimals
 *   scaled_ui_amount  = base_token_amount × active_multiplier
 *
 * A token's market price (Jupiter, per token) and a stock's reference price
 * (per underlying share) therefore measure different things until one of them
 * is converted. Every function here says which unit it takes and which it
 * returns, and none of them applies the multiplier twice.
 *
 * Amounts stay `bigint`. Prices are display numbers — they are compared,
 * never settled — and the comparison itself is only allowed when both
 * sides carry the same currency, side and unit basis, which the caller states
 * by choosing these functions rather than by dividing in place.
 */

/** The issuer's multiplier as the chain and the issuer's API both state it. */
export type Multiplier = Readonly<{
  /** The multiplier in force now. `1` until the first corporate event. */
  current: number;
  /** A published multiplier that has not activated yet, or null. */
  pending: number | null;
  /** ISO time the pending multiplier activates, or null. */
  effectiveAt: string | null;
}>;

/**
 * Example amounts for orientation; the Review always quotes the real amount.
 * They are the sums a first purchase is made of — $1, $5, $10 and $25 (canon
 * v5.5 В35: a purchase from a dollar).
 */
export const STOCK_QUOTE_PRESETS_USD = [1, 5, 10, 25] as const;

/** Fifteen minutes either side of an activation is the issuer's own advice for venues to pause. */
export const ACTIVATION_WINDOW_MS = 15 * 60 * 1000;

export type MultiplierState = "active" | "pending" | "activation-window";

/**
 * Where a mint stands relative to its next corporate event.
 *
 * `activation-window` is the state in which a dependent action is re-reviewed
 * or held: the units may change under a transaction that is in
 * flight, so a figure computed before the window is not a figure to sign on.
 */
export function multiplierState(multiplier: Multiplier, nowMs: number): MultiplierState {
  if (multiplier.pending === null || multiplier.effectiveAt === null) return "active";
  const at = Date.parse(multiplier.effectiveAt);
  if (!Number.isFinite(at)) return "pending";
  if (Math.abs(at - nowMs) <= ACTIVATION_WINDOW_MS) return "activation-window";
  return at > nowMs ? "pending" : "active";
}

/**
 * The Scaled UI Amount extension stores two multipliers: `multiplier` and
 * `newMultiplier` with the timestamp the new one takes effect. Once that
 * moment has passed the new value is the one in force — the extension does
 * not rewrite the old field — so the current multiplier is decided by the
 * clock, and the pending one exists only before its activation.
 */
export function multiplierFromChain(
  scaled: Readonly<{ multiplier: number; newMultiplier: number; newMultiplierEffectiveAt: string | null }>,
  nowMs: number,
): Multiplier {
  const effective = scaled.newMultiplierEffectiveAt === null ? Number.NaN : Date.parse(scaled.newMultiplierEffectiveAt);
  const hasNew = Number.isFinite(scaled.newMultiplier) && scaled.newMultiplier > 0 && Number.isFinite(effective);
  if (!hasNew) return { current: scaled.multiplier, pending: null, effectiveAt: null };
  if (effective <= nowMs) return { current: scaled.newMultiplier, pending: null, effectiveAt: null };
  return { current: scaled.multiplier, pending: scaled.newMultiplier, effectiveAt: new Date(effective).toISOString() };
}

/**
 * The multiplier of a mint from what the chain states: the Scaled UI Amount
 * configuration when the extension is present, one-to-one when a token
 * program mint carries no such extension — a chain fact, not a guess. A mint
 * that could not be read stays unknown.
 */
export function multiplierFromMint(
  onchain: Readonly<{ scaledUi: Readonly<{ multiplier: number; newMultiplier: number; newMultiplierEffectiveAt: string | null }> | null }> | null,
  nowMs: number,
): Multiplier | null {
  if (onchain === null) return null;
  if (onchain.scaledUi) return multiplierFromChain(onchain.scaledUi, nowMs);
  return { current: 1, pending: null, effectiveAt: null };
}

/**
 * A multiplier as an exact ratio of integers.
 *
 * The chain stores the multiplier as a 64-bit float; the issuer publishes it
 * as a decimal. Both are read into fifteen significant digits — the precision
 * an f64 actually carries — and turned into numerator/denominator so the
 * scaled amount is computed with integers, never with a floating product on
 * a raw balance.
 */
export function multiplierRatio(multiplier: number): Readonly<{ num: bigint; den: bigint }> {
  if (!Number.isFinite(multiplier) || multiplier <= 0) throw new Error(`A multiplier must be a positive finite number, got ${multiplier}.`);
  const text = multiplier.toPrecision(15);
  const [mantissa, exponent = "0"] = text.toLowerCase().split("e");
  const [whole, fraction = ""] = mantissa.split(".");
  const digits = (whole + fraction).replace(/^0+(?=\d)/, "");
  const shift = Number(exponent) - fraction.length;
  const base = BigInt(digits);
  if (shift >= 0) return { num: base * 10n ** BigInt(shift), den: 1n };
  return reduce(base, 10n ** BigInt(-shift));
}

function reduce(num: bigint, den: bigint): Readonly<{ num: bigint; den: bigint }> {
  let a = num;
  let b = den;
  while (b !== 0n) [a, b] = [b, a % b];
  const gcd = a === 0n ? 1n : a;
  return { num: num / gcd, den: den / gcd };
}

/**
 * The scaled UI amount — what the holder economically owns in underlying
 * units — as a decimal string with `fractionDigits` places, truncated toward
 * zero (a balance is never rounded up).
 */
export function scaledAmountString(rawAmount: bigint, decimals: number, multiplier: number, fractionDigits = 6): string {
  if (rawAmount < 0n) throw new Error("A raw amount cannot be negative.");
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 30) throw new Error(`Decimals out of range: ${decimals}.`);
  const { num, den } = multiplierRatio(multiplier);
  /* raw × num / (den × 10^decimals), carried to fractionDigits places. */
  const scaledInteger = (rawAmount * num * 10n ** BigInt(fractionDigits)) / (den * 10n ** BigInt(decimals));
  return formatFixed(scaledInteger, fractionDigits);
}

/** The base token amount (raw / 10^decimals) as a decimal string — the unit Jupiter prices. */
export function baseAmountString(rawAmount: bigint, decimals: number, fractionDigits = 6): string {
  return scaledAmountString(rawAmount, decimals, 1, fractionDigits);
}

function formatFixed(value: bigint, fractionDigits: number): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(fractionDigits + 1, "0");
  const whole = digits.slice(0, digits.length - fractionDigits);
  const fraction = fractionDigits === 0 ? "" : "." + digits.slice(digits.length - fractionDigits);
  return `${negative ? "-" : ""}${whole}${fraction}`;
}

/**
 * A per-token price turned into a per-underlying-share price.
 *
 * One token stands for `multiplier` shares, so a token that trades at P is a
 * share that trades at P / multiplier. Used to put Jupiter's token price on the
 * same basis as an exchange reference before any comparison.
 */
export function perShareFromTokenPrice(tokenPriceUsd: number, multiplier: number): number | null {
  if (!Number.isFinite(tokenPriceUsd) || tokenPriceUsd <= 0) return null;
  if (!Number.isFinite(multiplier) || multiplier <= 0) return null;
  return tokenPriceUsd / multiplier;
}

/**
 * The executable per-share price of a concrete quote.
 *
 * Buy: what the person pays in USD divided by the underlying units they would
 * receive. Sell: what they would receive in USD divided by the units they give.
 * `scaledAmount` is the scaled UI amount string of the token leg.
 */
export function perShareExecutable(usdAmount: number, scaledAmount: string): number | null {
  const units = Number(scaledAmount);
  if (!Number.isFinite(usdAmount) || usdAmount <= 0 || !Number.isFinite(units) || units <= 0) return null;
  return usdAmount / units;
}

/**
 *   reference_deviation_pct = (executable_price / reference_price − 1) × 100
 *
 * Both prices must be per share, in the same currency, for the same side.
 * Positive on a Buy is not an arbitrage and negative is not an assured gain;
 * the number is a fact about this quote against this reference at this time.
 */
export function deviationPct(executablePerShare: number | null, referencePerShare: number | null): number | null {
  if (executablePerShare === null || referencePerShare === null) return null;
  if (!Number.isFinite(executablePerShare) || !Number.isFinite(referencePerShare) || referencePerShare <= 0) return null;
  return (executablePerShare / referencePerShare - 1) * 100;
}

/**
 * The raw base amount behind an amount a person typed in scaled units — the
 * units the wallet shows. Parsed at the mint's own decimals, the typed
 * figure is a count of scaled units; one base token stands for `multiplier`
 * of them, so the raw amount is that count over the multiplier, as an exact
 * ratio of integers, truncated toward zero (the chain never owes a fraction
 * of a raw unit). A multiplier of one returns the count unchanged.
 */
export function rawFromScaledRaw(scaledRaw: bigint, multiplier: number): bigint {
  if (scaledRaw < 0n) throw new Error("A raw amount cannot be negative.");
  const { num, den } = multiplierRatio(multiplier);
  return (scaledRaw * den) / num;
}

/** Whether a multiplier changes what a raw amount means — one, or none, does not. */
export function isScaledMultiplier(multiplier: number | null | undefined): multiplier is number {
  return typeof multiplier === "number" && Number.isFinite(multiplier) && multiplier > 0 && Math.abs(multiplier - 1) > 1e-9;
}
