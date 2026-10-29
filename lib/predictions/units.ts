/**
 * A chance printed in the units the person chose: a percent, cents per
 * contract, what a purchase of their usual amount pays if it comes true, or
 * decimal odds. Each is the same price said another way; none adds a fee or a
 * guess. The payout is the plain one (amount ÷ price, before any fee), so it
 * carries «≈» — the exact sum is the Review's.
 *
 * Pure.
 */

import type { ChanceUnits } from "./preferences.ts";

type Locale = "en" | "uk";

const usd = (value: number): string => `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const usdWhole = (value: number): string => `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

const known = (p: number | null | undefined): p is number => typeof p === "number" && Number.isFinite(p) && p >= 0 && p <= 1;

/** The figure itself, short enough for a card or a button. */
export function chanceText(p: number | null | undefined, units: ChanceUnits, amountUsd: number): string {
  if (!known(p)) return "—";
  const percent = p * 100;
  switch (units) {
    case "percent":
      return `${percent.toFixed(percent < 10 ? 1 : 0)}%`;
    case "cents":
      return `${percent.toFixed(percent < 10 ? 1 : 0)}¢`;
    case "odds":
      return p === 0 ? "—" : (1 / p).toFixed(2);
    case "payout":
      return p === 0 ? "—" : `${usdWhole(amountUsd)} → ≈${usd(amountUsd / p)}`;
  }
}

/** What the figure means, once, in words: under a card's figure or in a tooltip. */
export function chanceMeaning(p: number | null | undefined, units: ChanceUnits, amountUsd: number, locale: Locale): string {
  if (!known(p) || p === 0) return "";
  const uk = locale === "uk";
  switch (units) {
    case "percent":
      return uk ? "імовірність за ціною ринку" : "the market's chance";
    case "cents":
      return uk ? `контракт коштує ${(p * 100).toFixed(1)}¢, платить $1` : `a contract costs ${(p * 100).toFixed(1)}¢ and pays $1`;
    case "odds":
      return uk ? `$1 повертає ${usd(1 / p)}` : `$1 returns ${usd(1 / p)}`;
    case "payout":
      return uk ? `Купуєш на ${usdWhole(amountUsd)} — отримаєш ≈ ${usd(amountUsd / p)}, до комісій` : `Buy ${usdWhole(amountUsd)} — get ≈ ${usd(amountUsd / p)}, before fees`;
  }
}

/* Below this chance a payout is a long shot's multiple; it never stands as the large figure. */
const LONG_SHOT = 0.1;

/**
 * The large figure of a card, an outcome and the overview: the market's
 * estimate in the person's units. A payout leads only when the person chose
 * payouts and the outcome is not a long shot; otherwise its chance does.
 */
export function chanceHero(p: number | null | undefined, units: ChanceUnits, amountUsd: number): Readonly<{ text: string; units: ChanceUnits }> {
  const shown: ChanceUnits = units === "payout" && !(known(p) && p >= LONG_SHOT) ? "percent" : units;
  return { text: chanceText(p, shown, amountUsd), units: shown };
}

/**
 * The line under the large figure, always in view: what the usual amount
 * pays if the outcome comes true («$10 → ≈$11.49 if Yes») under a chance, or
 * the chance itself under a payout. Without an outcome name (a button that
 * already carries it) the payout stands alone. Empty when there is no price.
 */
export function chanceSecond(p: number | null | undefined, units: ChanceUnits, amountUsd: number, outcome: string, locale: Locale): string {
  if (!known(p) || p === 0) return "";
  if (chanceHero(p, units, amountUsd).units === "payout") return locale === "uk" ? `шанс ${chanceText(p, "percent", amountUsd)}` : `${chanceText(p, "percent", amountUsd)} chance`;
  const pays = chanceText(p, "payout", amountUsd);
  if (!outcome) return pays;
  return locale === "uk" ? `${pays}, якщо «${outcome}»` : `${pays} if ${outcome}`;
}

/** A move over a period in the same units: cents for cents, points otherwise. */
export function moveText(delta: number | null | undefined, units: ChanceUnits): string {
  if (delta == null || !Number.isFinite(delta)) return "—";
  const points = delta * 100;
  const sign = points > 0 ? "+" : points < 0 ? "−" : "";
  return `${sign}${Math.abs(points).toFixed(1)}${units === "cents" ? "¢" : " pp"}`;
}

/** The example a setting shows beside each choice, at a 62% chance. */
export function unitsExample(units: ChanceUnits, amountUsd: number): string {
  return chanceText(0.62, units, amountUsd);
}
