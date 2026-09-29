/**
 * Exact decimal↔raw conversion for base-unit amounts, in string arithmetic.
 *
 * A float on a money surface is a defect: 0.1 + 0.2 is not 0.3 in the type
 * this module refuses to touch. Scaling is digit placement — padding, a
 * split, and grouping for the eye — and parsing is the same walk in reverse,
 * refusing anything that is not a plain decimal numeral.
 */

/** Raw base units → a grouped decimal string with the point placed exactly. */
export function scaleRawAmount(rawAmount: string, decimals: number): string {
  const padded = rawAmount.padStart(decimals + 1, "0");
  const whole = padded.slice(0, padded.length - decimals) || "0";
  const fraction = decimals > 0 ? padded.slice(padded.length - decimals) : "";
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction ? `${grouped}.${fraction}` : grouped;
}

/**
 * Exact amount with trailing zeros stripped. `0.000000000` becomes `0`;
 * `95,500,000.000000` becomes `95,500,000`. The chain's decimals are not
 * discarded — remaining fractional digits stay.
 */
export function displayAmount(rawAmount: string, decimals: number): string {
  const exact = scaleRawAmount(rawAmount, decimals);
  if (!exact.includes(".")) return exact;
  const [whole, fraction] = exact.split(".");
  const trimmed = fraction.replace(/0+$/, "");
  return trimmed.length > 0 ? `${whole}.${trimmed}` : whole;
}

/**
 * The same exact amount, ungrouped: digits and one point, for a machine to
 * read. `1,000.5` on a screen is `1000.5` here — a client that parses the
 * figure must never meet a separator it has to guess at (contract 1.22.0).
 */
export function exactDecimal(rawAmount: string, decimals: number): string {
  return displayAmount(rawAmount, decimals).replaceAll(",", "");
}

export type ParsedAmount = Readonly<{ ok: true; raw: string }> | Readonly<{ ok: false; reason: string }>;

/**
 * A human decimal string → raw base units. Refusals are sentences: more
 * fractional digits than the mint has decimals is a precision the chain
 * cannot represent, and rounding it silently would move money.
 */
export function parseHumanAmount(human: string, decimals: number): ParsedAmount {
  const trimmed = human.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    return { ok: false, reason: "Enter a plain decimal amount — digits, and at most one point." };
  }
  const [whole, fraction = ""] = trimmed.split(".");
  if (fraction.length > decimals) {
    return {
      ok: false,
      reason: `This mint has ${decimals} decimal place${decimals === 1 ? "" : "s"}; ${fraction.length} were entered, and rounding silently would change the amount.`,
    };
  }
  const raw = (whole + fraction.padEnd(decimals, "0")).replace(/^0+(?=\d)/, "");
  if (!/[1-9]/.test(raw)) {
    return { ok: false, reason: "The amount is zero; there is nothing to quote." };
  }
  return { ok: true, raw };
}
