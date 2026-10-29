/**
 * The execution truth's figures as a person reads them: exact amounts in the mint's own scale, rates to the hundredth
 * of a per cent, SOL from lamports, dollars from micros — Ukrainian with its comma and no-break spaces. Pure.
 */

import { displayAmount } from "../../../../lib/solana/amounts.ts";
import type { TruthAssets } from "../../../../lib/solana/receipt-truth.ts";

const NBSP = " ";

function localise(figure: string, locale: "en" | "uk"): string {
  return locale === "uk" ? figure.replaceAll(",", NBSP).replace(".", ",") : figure;
}

/** An exact amount with its code, or null when the mint's scale is not known — never a guessed scale. */
export function amountText(raw: string, mint: string | null, assets: TruthAssets, locale: "en" | "uk"): string | null {
  if (!mint) return null;
  const asset = assets[mint];
  if (!asset || typeof asset.decimals !== "number") return null;
  const figure = localise(displayAmount(raw, asset.decimals), locale);
  return asset.symbol ? `${figure}${NBSP}${asset.symbol}` : figure;
}

/** Basis points as a per cent, «0.10 %»; `signed` puts a plus or a minus in front. */
export function rateText(bps: number, locale: "en" | "uk", signed = false): string {
  const magnitude = Math.abs(bps) / 100;
  const figure = localise(magnitude < 0.01 && bps !== 0 ? "<0.01" : magnitude.toFixed(2), locale);
  const sign = signed ? (bps > 0 ? "+" : bps < 0 ? "−" : "") : "";
  return `${sign}${figure}${NBSP}%`;
}

export function solText(lamports: string, locale: "en" | "uk"): string {
  return `${localise(displayAmount(lamports, 9), locale)}${NBSP}SOL`;
}

/**
 * Dollars from micros: «$0.25»; under a cent, to the hundredth of a cent, «$0.0008» — a real figure, never rounded to
 * nothing; «<$0.0001» below that. Rounded down: a rebate is never shown larger than it is.
 */
export function usdMicrosText(micros: string, locale: "en" | "uk"): string {
  const value = BigInt(micros);
  if (value >= 10_000n) return `$${localise((Number(value / 10_000n) / 100).toFixed(2), locale)}`;
  if (value >= 100n) return `$${localise((Number(value / 100n) / 10_000).toFixed(4), locale)}`;
  return value > 0n ? `<$${localise("0.0001", locale)}` : "$0";
}
