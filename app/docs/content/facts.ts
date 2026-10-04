import { PRODUCT_ROUTES } from "../../shell/product-routes.ts";
import { MENU_DESTINATIONS, MENU_PAGE_LABELS, MENU_ROWS, MENU_SECTION_IDS, MENU_SECTION_LABELS, PAGE_LABELS, drawn, type MenuDestinationId, type MenuSectionId, type PageReadiness, type ProductPageId } from "../../shell/domains.ts";
import { BUY_SHARE_PRESETS_PCT, DEFAULT_BUY_USD, MIN_BUY_USD } from "../../app/invest/company-model.ts";
import { SUGGESTED_SOL_LAMPORTS } from "../../app/invest/funding-model.ts";
import { DEFAULT_SALE_USD, MIN_SALE_USD, SALE_SHARE_PRESETS_PCT } from "../../app/invest/sale-model.ts";
import { LOSS_LIMIT_PRESETS } from "../../../lib/plans/purchase.ts";
import {
  BUDGET_MINIMUM_USD,
  PAYMENT_FIXED_MAX_USD,
  PAYMENT_FIXED_MIN_USD,
  PAYMENT_PERCENT_PRESETS,
  PAYMENT_ROUNDUP_STEPS_USD,
  PRICE_CONDITION_DEFAULT_PCT,
  PRICE_CONDITION_MAX_AGE_MINUTES,
  PRICE_CONDITION_PRESETS_PCT,
  RULE_DIP_PRESETS_PCT,
  RULE_LIST_LIMIT,
} from "../../../lib/autoinvest/limits.ts";
import { RULE_REMINDER_HOURS } from "../../../lib/autoinvest/schedule.ts";
import { POINTS_POLICY_V1 } from "../../../lib/points/policy.ts";
import { REWARD_MINIMUM_CLAIM_USD_MICROS, REWARD_RATE_BPS, USD_MICROS_PER_USD } from "../../../lib/rewards/model.ts";
import { RYNTRA_SERVICE_FEE_POLICY } from "../../../lib/swap/service-fee.ts";

/**
 * The figures the documentation states, read from the code that charges,
 * accrues and gates with them. A number typed into a sentence is a number
 * that stops being true the day the policy changes; these cannot.
 */

const bpsToPercent = (bps: number): string => {
  const value = bps / 100;
  return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(2).replace(/0$/, "")}%`;
};

/** Ryntra's service fee on each lane, as the product quotes it. */
export const FEES = {
  swap: bpsToPercent(RYNTRA_SERVICE_FEE_POLICY.JUPITER_REFERRAL),
  spot: bpsToPercent(RYNTRA_SERVICE_FEE_POLICY.JUPITER_REFERRAL),
  bridge: bpsToPercent(RYNTRA_SERVICE_FEE_POLICY.RELAY_APP_FEE),
  /** The trader's share of the collected fee returned as cashback, applied to the swap lane. */
  swapNetOfCashback: bpsToPercent(RYNTRA_SERVICE_FEE_POLICY.JUPITER_REFERRAL * (10_000 - REWARD_RATE_BPS.CASHBACK) / 10_000),
} as const;

/** A figure as Ukrainian writes it — a comma for the decimal point, «0,5%», as the app's own Ukrainian does («100,06%»). */
export const ukDecimal = (text: string): string => text.replace(/(\d)\.(\d)/g, "$1,$2");

/** The same fees in Ukrainian writing. */
export const FEES_UK = {
  swap: ukDecimal(FEES.swap),
  spot: ukDecimal(FEES.spot),
  bridge: ukDecimal(FEES.bridge),
  swapNetOfCashback: ukDecimal(FEES.swapNetOfCashback),
} as const;

/** A purchase in Simple: the least it can be, the sum the sheet opens on, and the shares of the wallet's USDC one press chooses. */
export const PURCHASE = {
  minimum: `${MIN_BUY_USD}`,
  opensOn: `${DEFAULT_BUY_USD}`,
  shares: BUY_SHARE_PRESETS_PCT.map((pct) => `${pct}%`).join(" · "),
} as const;

/** «Продати з позиції»: the least a sale typed in dollars is, the sum its sheet opens on for a position worth that, and its quick shares of the position — read from the code the sheet uses. */
export const SALE = {
  minimum: `${MIN_SALE_USD}`,
  opensOn: `${DEFAULT_SALE_USD}`,
  shares: SALE_SHARE_PRESETS_PCT.map((pct) => `${pct}%`).join(" · "),
} as const;

/** «Поповнити»: the least a purchase spends, and the SOL the top-up suggests for the network — read from the code the screens use. */
export const TOP_UP = {
  minimum: `$${MIN_BUY_USD}`,
  sol: {
    en: new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(Number(SUGGESTED_SOL_LAMPORTS) / 1e9),
    uk: new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 4 }).format(Number(SUGGESTED_SOL_LAMPORTS) / 1e9),
  },
} as const;

/** «Автоінвест»: the least a rule's purchase is, how long a reminder stays open, how many rules a wallet holds, the falls «Якщо впаде» offers, the least a month's budget is — read from the rules' own code. */
export const AUTOINVEST = {
  minimum: `$${MIN_BUY_USD}`,
  reminderHours: RULE_REMINDER_HOURS,
  rules: RULE_LIST_LIMIT,
  dipPresets: RULE_DIP_PRESETS_PCT.map((pct) => `${pct}%`).join(" · "),
  budgetMinimum: `${BUDGET_MINIMUM_USD}`,
  /* «Умова ціни»: the limit a new rule opens on, the limits offered and how old the data may be. */
  conditionDefault: `${PRICE_CONDITION_DEFAULT_PCT}%`,
  conditionPresets: PRICE_CONDITION_PRESETS_PCT.map((pct) => `${pct}%`).join(" · "),
  conditionMaxAgeMinutes: PRICE_CONDITION_MAX_AGE_MINUTES,
  /* «З кожної оплати»: the round-up steps, the fixed sum's bounds and the per cents offered. */
  roundupSteps: PAYMENT_ROUNDUP_STEPS_USD.map((usd) => `$${usd}`).join(" · "),
  fixedFrom: `$${PAYMENT_FIXED_MIN_USD.toFixed(2)}`,
  fixedTo: `$${PAYMENT_FIXED_MAX_USD}`,
  percentPresets: PAYMENT_PERCENT_PRESETS.map((pct) => `${pct}%`).join(" · "),
} as const;

/** The loss limits a purchase in Simple offers, per cent below the price it is bought at (the published presets). */
export const LOSS_LIMITS = {
  careful: `${LOSS_LIMIT_PRESETS.careful.stopPct}%`,
  balanced: `${LOSS_LIMIT_PRESETS.balanced.stopPct}%`,
} as const;

/** The targets the same presets set, per cent above the price («Ryntra попередить» on a position held). */
export const LOSS_TARGETS = {
  careful: `${LOSS_LIMIT_PRESETS.careful.targetPct}%`,
  balanced: `${LOSS_LIMIT_PRESETS.balanced.targetPct}%`,
} as const;

/** The Rewards split of a collected service fee, in whole percent. */
export const REWARDS = {
  cashbackPercent: REWARD_RATE_BPS.CASHBACK / 100,
  referralL1Percent: REWARD_RATE_BPS.REFERRAL_L1 / 100,
  referralL2Percent: REWARD_RATE_BPS.REFERRAL_L2 / 100,
  claimFloorUsd: Number(REWARD_MINIMUM_CLAIM_USD_MICROS / USD_MICROS_PER_USD),
} as const;

const usd = (micros: bigint): number => Number(micros / USD_MICROS_PER_USD);
const perDollar = (perThousand: bigint): string => {
  const value = Number(perThousand) / 1000;
  return Number.isInteger(value) ? value.toFixed(0) : String(value);
};

/** The Points policy, V1, as the ledger applies it. */
export const POINTS = {
  version: POINTS_POLICY_V1.version,
  tiers: POINTS_POLICY_V1.volumeTiers.map((tier) => ({
    upToUsd: tier.upToUsdMicros === null ? null : usd(tier.upToUsdMicros),
    perDollar: perDollar(tier.pointsPerThousandUsd),
  })),
  dailyCap: Number(POINTS_POLICY_V1.dailyVolumePointsCap),
  activeDayPoints: Number(POINTS_POLICY_V1.activeDay.points),
  activeDayMinimumUsd: usd(POINTS_POLICY_V1.activeDay.minimumDayVolumeUsdMicros),
  qualifiedReferralPoints: Number(POINTS_POLICY_V1.qualifiedReferral.points),
  strategyCompletedPoints: Number(POINTS_POLICY_V1.strategyCompleted.points),
  /** Lifetime points at which each level begins; index 0 is level 1. */
  levels: POINTS_POLICY_V1.levels.map((points) => Number(points)),
} as const;

const fmt = (value: number): string => value.toLocaleString("en-US");

/** The tier table as the documentation shows it, in both languages. */
export function pointsTierRows(locale: "en" | "uk"): readonly (readonly string[])[] {
  let from = 0;
  return POINTS.tiers.map((tier) => {
    const range = tier.upToUsd === null
      ? locale === "uk" ? `понад $${fmt(from)}` : `above $${fmt(from)}`
      : `$${fmt(from)} – $${fmt(tier.upToUsd)}`;
    const rate = locale === "uk" ? `${tier.perDollar} бала за $1` : `${tier.perDollar} point${tier.perDollar === "1" ? "" : "s"} per $1`;
    from = tier.upToUsd ?? from;
    return [range, rate];
  });
}

export function levelRows(locale: "en" | "uk"): readonly (readonly string[])[] {
  return POINTS.levels.map((at, index) => [
    locale === "uk" ? `Рівень ${index + 1}` : `Level ${index + 1}`,
    index === 0 ? (locale === "uk" ? "від 0 балів" : "from 0 points") : (locale === "uk" ? `від ${fmt(at)} балів` : `from ${fmt(at)} points`),
  ]);
}

/** The pages of the menu with the section that holds them and their readiness, from the registry. */
export type ProductPageFact = Readonly<{ id: ProductPageId; href: string; section: MenuSectionId; label: Readonly<{ en: string; uk: string }>; sectionLabel: Readonly<{ en: string; uk: string }>; readiness: PageReadiness }>;

/**
 * Only the pages the menu draws, section by section in the menu's order (the
 * menu you can see). A planned page and a page kept off the surface are
 * registered and drawn nowhere — not in the menu, not in the documentation's
 * table. A section that holds one row names itself by that row.
 */
export const PRODUCT_PAGES: readonly ProductPageFact[] = MENU_SECTION_IDS.flatMap((section) =>
  MENU_ROWS[section].flatMap((ref): ProductPageFact[] => {
    if (!("page" in ref)) return [];
    const route = PRODUCT_ROUTES.find((row) => row.id === ref.page);
    if (!route || !drawn(route)) return [];
    const label = MENU_PAGE_LABELS[ref.page] ?? PAGE_LABELS[ref.page];
    return [{ id: ref.page, href: route.href, section, label, sectionLabel: MENU_SECTION_LABELS[section] ?? label, readiness: route.readiness }];
  }),
);

export function readinessOf(id: ProductPageId): PageReadiness {
  const route = PRODUCT_ROUTES.find((row) => row.id === id);
  if (!route) throw new Error(`no product route ${id}`);
  return route.readiness;
}

export function hrefOf(id: ProductPageId): string {
  const route = PRODUCT_ROUTES.find((row) => row.id === id);
  if (!route) throw new Error(`no product route ${id}`);
  return route.href;
}

/** Where a place of the menu that is not a registered page opens — Markets, Autoinvest, Top up, Ryntra — from the menu's own list. */
export function destinationHref(id: MenuDestinationId): string {
  return MENU_DESTINATIONS[id].href;
}
