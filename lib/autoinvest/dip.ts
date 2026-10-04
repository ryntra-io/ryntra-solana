/**
 * «Якщо впаде» — a rule that reminds when a company's price falls N % below
 * its reference point.
 *
 * **The reference point** is the price when the rule was turned on, or what
 * the last purchase under it paid per unit: after a purchase the point moves
 * to that purchase. **The trigger** is the point less N %.
 *
 * **One note per crossing.** The rule is armed while the price stands above
 * the trigger. The first read at or below it opens one reminder and disarms
 * the rule; it arms again only when the price is read back above the trigger
 * with no reminder open. A price that hovers about the line reminds once, not
 * every five minutes, and a price that keeps falling after a missed reminder
 * does not remind again until it has come back and fallen anew.
 *
 * **A price is a fact with a time.** The one read on the company's page
 * (Jupiter's price per unit as the wallet shows it); a read that failed or is
 * older than `DIP_PRICE_MAX_AGE_MS` decides nothing — neither a crossing nor
 * arming.
 *
 * Pure and client-safe: prices, rows and the clock are arguments.
 */

import type { SolanaWalletAction } from "../solana/action-ledger.ts";
import { usdcOutOf } from "./budget.ts";

/** How old a price may be and still decide a crossing. */
export const DIP_PRICE_MAX_AGE_MS = 30 * 60_000;

/** The price at which a rule reminds: the point less N %. */
export function dipTriggerUsd(anchorUsd: number, dropPct: number): number {
  return anchorUsd * (1 - dropPct / 100);
}

/** How far a price stands below the point, in per cent (negative when above). */
export function fallPct(anchorUsd: number, priceUsd: number): number {
  return (1 - priceUsd / anchorUsd) * 100;
}

export type DipPrice = Readonly<{ usd: number; observedAtMs: number }>;

/** A price that may decide: positive, finite, and read recently enough. */
export function usablePrice(price: DipPrice | null | undefined, nowMs: number): number | null {
  if (!price || !Number.isFinite(price.usd) || price.usd <= 0) return null;
  if (!Number.isFinite(price.observedAtMs) || nowMs - price.observedAtMs > DIP_PRICE_MAX_AGE_MS) return null;
  return price.usd;
}

/**
 * What a settled purchase paid per unit as the wallet shows it: the USDC that
 * left, over the units that arrived (raw ÷ 10^decimals × the Scaled UI
 * multiplier — the unit Jupiter prices). Null where a figure is missing.
 */
export function purchasePriceUsd(row: SolanaWalletAction, decimals: number | null, multiplier: number | null): number | null {
  const spent = usdcOutOf(row);
  const raw = row.in?.amountRaw;
  if (spent === null || spent <= 0 || !raw || !/^\d+$/.test(raw) || decimals === null || multiplier === null || !(multiplier > 0)) return null;
  const units = (Number(BigInt(raw)) / 10 ** decimals) * multiplier;
  return units > 0 && Number.isFinite(units) ? spent / units : null;
}
