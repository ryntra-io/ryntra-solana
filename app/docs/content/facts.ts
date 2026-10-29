import { PRODUCT_ROUTES } from "../../shell/product-routes.ts";
import { ASSISTANT, MENU_SECTIONS, MENU_SECTION_IDS, PAGE_LABELS, drawn, type MenuSectionId, type PageReadiness, type ProductPageId } from "../../shell/domains.ts";
import type { DocsDestination } from "./model.ts";
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
  RULE_FLOOR_AGE_HOURS,
  RULE_FLOOR_LIQUIDITY_USD,
  RULE_LIST_LIMIT,
} from "../../../lib/autoinvest/limits.ts";
import { RULE_REMINDER_HOURS } from "../../../lib/autoinvest/schedule.ts";
import { REWARD_MINIMUM_CLAIM_USD_MICROS, USD_MICROS_PER_USD } from "../../../lib/rewards/model.ts";
import { RANK_THRESHOLDS, RANK_WINDOW_DAYS, REWARD_RANKS, REWARD_RULES_CURRENT } from "../../../lib/rewards/rules.ts";
import { RYNTRA_SERVICE_FEE_POLICY } from "../../../lib/swap/service-fee.ts";
import { FEE_POLICY_V2, type FeeFlow } from "../../../lib/core/fee-policy.ts";
import { launchPoolFee } from "../../../lib/core/fee-comparison.ts";
import { DEFAULT_PERP_SLIPPAGE_BPS, MAX_PERP_SLIPPAGE_BPS, MIN_ORDER_NOTIONAL_USD, MIN_PERP_SLIPPAGE_BPS, STOP_SLIPPAGE_BPS } from "../../../lib/phoenix/orders-model.ts";
import { MAX_COLLATERAL_MICRO, MIN_COLLATERAL_MICRO } from "../../../lib/phoenix/collateral-model.ts";
import { RYNTRA_BUY_FEE_BIPS } from "../../../lib/predictions/costs.ts";
import { DLMM_LIMIT_MAKER_FEE_SHARE_PERCENT, DLMM_LIMIT_MAX_BINS, TRIGGER_V1_MIN_ORDER_USD, TRIGGER_V1_MIN_REFERRAL_FEE_BPS } from "../../../lib/solana/limits/model.ts";
import { DEFAULT_GRID_LEVELS, GRID_LEVELS } from "../../../lib/bots/grid.ts";
import { DEFAULT_CREDIT_PRICES, resolveCreditsConfig } from "../../../lib/assistant/credits/prices.ts";

/**
 * The figures the documentation states, read from the code that charges,
 * accrues and gates with them. A number typed into a sentence is a number
 * that stops being true the day the policy changes; these cannot.
 */

const bpsToPercent = (bps: number): string => {
  const value = bps / 100;
  return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(2).replace(/0$/, "")}%`;
};

/** A range of rates, «0.1–1%», from the lowest and the highest of the flows named. */
const rangeOf = (flows: readonly FeeFlow[], scale = 1): string => {
  const rates = flows.map((flow) => FEE_POLICY_V2[flow].bps * scale).filter((bps) => bps > 0);
  const low = Math.min(...rates);
  const high = Math.max(...rates);
  return low === high ? bpsToPercent(low) : `${bpsToPercent(low).replace("%", "")}–${bpsToPercent(high)}`;
};
const TOKEN_FLOWS: readonly FeeFlow[] = ["MEME", "TRENDING", "MAJOR"];
const COMPANY_FLOWS: readonly FeeFlow[] = ["XSTOCK", "ONDO", "PRESTOCK"];
/* The cashback is a share of the fee Ryntra receives. Through Jupiter's /build the whole fee reaches Ryntra; through
   its order route Jupiter keeps its share (`JUPITER_REFERRAL_PROVIDER_SHARE_PERCENT`, lib/solana/quotes.ts — written
   here rather than imported so the facts carry no quote code; docs.test.mjs holds the two equal). */
export const JUPITER_ORDER_KEEPS_PERCENT = 20;
/* The order route takes no referral under this rate (`JUPITER_REFERRAL_FEE_MIN_BPS`), so a major coin carries no Ryntra fee there. */
export const JUPITER_ORDER_MIN_FEE_BPS = 50;
const NET_OF_CASHBACK = (10_000 - REWARD_RULES_CURRENT.cashbackBps) / 10_000;
const NET_OF_CASHBACK_ORDER = 1 - (REWARD_RULES_CURRENT.cashbackBps / 10_000) * ((100 - JUPITER_ORDER_KEEPS_PERCENT) / 100);

/** Ryntra's service fee on each lane, as the product quotes it — fee policy v2, by the trade's flow. */
export const FEES = {
  /** A token swap: from a major's rate to a new token's. */
  swap: rangeOf(TOKEN_FLOWS),
  spot: rangeOf(TOKEN_FLOWS),
  /** A company: xStocks to Ondo and pre-IPO. */
  company: rangeOf(COMPANY_FLOWS),
  bridge: bpsToPercent(RYNTRA_SERVICE_FEE_POLICY.RELAY_APP_FEE),
  /** The trader's share of the collected fee returned as cashback, applied to the swap lane. */
  swapNetOfCashback: rangeOf(TOKEN_FLOWS, NET_OF_CASHBACK),
  /** The same through Jupiter's order route, which keeps its share of the fee before Ryntra receives it. */
  swapNetOfCashbackOrder: rangeOf(TOKEN_FLOWS.filter((flow) => FEE_POLICY_V2[flow].bps >= JUPITER_ORDER_MIN_FEE_BPS), NET_OF_CASHBACK_ORDER),
  /** One flow's rate, «1%». */
  flow: (flow: FeeFlow): string => (FEE_POLICY_V2[flow].bps === 0 ? "0%" : bpsToPercent(FEE_POLICY_V2[flow].bps)),
} as const;

/** A figure as Ukrainian writes it — a comma for the decimal point, «0,5%», as the app's own Ukrainian does («100,06%»). */
export const ukDecimal = (text: string): string => text.replace(/(\d)\.(\d)/g, "$1,$2");

/** The same fees in Ukrainian writing. */
export const FEES_UK = {
  swap: ukDecimal(FEES.swap),
  spot: ukDecimal(FEES.spot),
  company: ukDecimal(FEES.company),
  bridge: ukDecimal(FEES.bridge),
  swapNetOfCashback: ukDecimal(FEES.swapNetOfCashback),
  swapNetOfCashbackOrder: ukDecimal(FEES.swapNetOfCashbackOrder),
  flow: (flow: FeeFlow): string => ukDecimal(FEES.flow(flow)),
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
  /* The floor a meme or a new token stands on for a rule: its liquidity and its hours on the market. */
  floorUsd: { en: `$${new Intl.NumberFormat("en-US").format(RULE_FLOOR_LIQUIDITY_USD)}`, uk: `$${new Intl.NumberFormat("uk-UA").format(RULE_FLOOR_LIQUIDITY_USD)}` },
  floorHours: RULE_FLOOR_AGE_HOURS,
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

const referralL1ByRank = REWARD_RANKS.map((rank) => REWARD_RULES_CURRENT.referralL1BpsByRank[rank] / 100);
/** The ranks' names, in the order of `REWARD_RANKS`. */
const RANK_NAMES = {
  en: ["Bronze", "Silver", "Gold", "Sapphire", "Diamond"],
  uk: ["Бронза", "Срібло", "Золото", "Сапфір", "Діамант"],
} as const;

/** The Rewards split of the service fee Ryntra received, in whole percent — the rules in force. */
export const REWARDS = {
  cashbackPercent: REWARD_RULES_CURRENT.cashbackBps / 100,
  /** The inviter's share, by the inviter's rank: «10–30». */
  referralL1Percent: `${Math.min(...referralL1ByRank)}–${Math.max(...referralL1ByRank)}`,
  referralL2Percent: REWARD_RULES_CURRENT.referralL2Bps / 100,
  /** The inviter's share at each rank, «Bronze 10%, Silver 15%, …». */
  referralL1Ladder: {
    en: RANK_NAMES.en.map((name, i) => `${name} ${referralL1ByRank[i]}%`).join(", "),
    uk: RANK_NAMES.uk.map((name, i) => `${name} ${referralL1ByRank[i]}%`).join(", "),
  },
  claimFloorUsd: Number(REWARD_MINIMUM_CLAIM_USD_MICROS / USD_MICROS_PER_USD),
  /** Days of points a rank is read over. */
  rankWindowDays: RANK_WINDOW_DAYS,
} as const;

/** The five ranks as the documentation shows them: the name, the points it begins at, the inviter's share at it. */
export function rankRows(locale: "en" | "uk"): readonly (readonly string[])[] {
  const number = new Intl.NumberFormat(locale === "en" ? "en-US" : "uk-UA");
  return REWARD_RANKS.map((rank, i) => [RANK_NAMES[locale][i], number.format(Number(RANK_THRESHOLDS[rank])), `${referralL1ByRank[i]}%`]);
}

/** The pages of the menu with the row that holds them and their readiness, from the registry. */
export type ProductPageFact = Readonly<{ id: ProductPageId; href: string; section: MenuSectionId; label: Readonly<{ en: string; uk: string }>; sectionLabel: Readonly<{ en: string; uk: string }>; readiness: PageReadiness }>;

/**
 * Only the pages the menu draws, row by row in the menu's order. A
 * planned page and a page kept off the surface are registered and drawn
 * nowhere — not in the menu, not in the documentation's table.
 */
export const PRODUCT_PAGES: readonly ProductPageFact[] = MENU_SECTION_IDS.flatMap((section) =>
  MENU_SECTIONS[section].pages.flatMap((id): ProductPageFact[] => {
    const route = PRODUCT_ROUTES.find((row) => row.id === id);
    if (!route || !drawn(route)) return [];
    return [{ id, href: route.href, section, label: PAGE_LABELS[id], sectionLabel: MENU_SECTIONS[section].label, readiness: route.readiness }];
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

/** Where a row of the menu or the assistant opens, from the menu's own list. */
export function destinationHref(id: DocsDestination): string {
  return id === "agent" ? ASSISTANT.href : MENU_SECTIONS[id].href;
}

/* ------------------------------------------------ F3: the product pages' figures */

const percentOf = (bps: number): string => bpsToPercent(bps);

/** Perps on Phoenix: the order's bounds and the collateral's, read from the code the ticket and the server use. */
export const PERPS = {
  minNotional: `$${MIN_ORDER_NOTIONAL_USD}`,
  tolerance: { default: percentOf(DEFAULT_PERP_SLIPPAGE_BPS), min: percentOf(MIN_PERP_SLIPPAGE_BPS), max: percentOf(MAX_PERP_SLIPPAGE_BPS) },
  toleranceUk: { default: ukDecimal(percentOf(DEFAULT_PERP_SLIPPAGE_BPS)), min: ukDecimal(percentOf(MIN_PERP_SLIPPAGE_BPS)), max: ukDecimal(percentOf(MAX_PERP_SLIPPAGE_BPS)) },
  /** How far a limit may stand through the mark before it is refused — the same bound as the tolerance's ceiling. */
  limitFar: percentOf(MAX_PERP_SLIPPAGE_BPS),
  /** How far from its trigger a stop may fill. */
  stopSlippage: percentOf(STOP_SLIPPAGE_BPS),
  collateralMin: `$${Number(MIN_COLLATERAL_MICRO / 1_000_000n)}`,
  collateralMax: { en: `$${Number(MAX_COLLATERAL_MICRO / 1_000_000n).toLocaleString("en-US")}`, uk: `$${Number(MAX_COLLATERAL_MICRO / 1_000_000n).toLocaleString("en-US").replace(/,/g, " ")}` },
} as const;

/** Ryntra's fee on a prediction market's buy; a sell carries none (`lib/predictions/costs.ts`). */
export const PREDICTION_BUY_FEE = { en: percentOf(RYNTRA_BUY_FEE_BIPS), uk: ukDecimal(percentOf(RYNTRA_BUY_FEE_BIPS)) } as const;

/** Spot limit orders: Jupiter's Trigger and Meteora's DLMM bins (`lib/solana/limits/model.ts`). */
export const LIMITS = {
  triggerMinimum: `$${TRIGGER_V1_MIN_ORDER_USD}`,
  triggerFloor: { en: percentOf(TRIGGER_V1_MIN_REFERRAL_FEE_BPS), uk: ukDecimal(percentOf(TRIGGER_V1_MIN_REFERRAL_FEE_BPS)) },
  dlmmMaxBins: DLMM_LIMIT_MAX_BINS,
  dlmmMakerShare: `${DLMM_LIMIT_MAKER_FEE_SHARE_PERCENT}%`,
} as const;

/** A grid: the levels it may hold and the one it opens on (`lib/bots/grid.ts`). */
export const GRID = {
  levels: GRID_LEVELS.join(" · "),
  defaultLevels: DEFAULT_GRID_LEVELS,
} as const;

const CREDITS_DEFAULT = resolveCreditsConfig({});
/** The assistant's credits as the plan sets them: what one action costs, the free daily credits and the welcome. */
export const CREDITS = {
  question: DEFAULT_CREDIT_PRICES.question,
  tokenReport: DEFAULT_CREDIT_PRICES.tokenReport,
  priceMove: DEFAULT_CREDIT_PRICES.priceMove,
  voice: DEFAULT_CREDIT_PRICES.voice,
  deep: DEFAULT_CREDIT_PRICES.deep,
  plan: DEFAULT_CREDIT_PRICES.plan,
  freeDaily: CREDITS_DEFAULT.freeDaily,
  welcome: CREDITS_DEFAULT.welcome,
  welcomeMinAgeDays: CREDITS_DEFAULT.welcomeMinAgeDays,
  welcomeMinTxs: CREDITS_DEFAULT.welcomeMinTxs,
  dailySpendCap: { en: CREDITS_DEFAULT.dailySpendCap.toLocaleString("en-US"), uk: CREDITS_DEFAULT.dailySpendCap.toLocaleString("en-US").replace(/,/g, " ") },
} as const;

const LAUNCH_FEE = launchPoolFee();
/** A Ryntra launch's own fees — the curve's and the pool's — with Ryntra's part inside them, never on top. */
export const LAUNCH_FEES = {
  sniperStart: { en: percentOf(LAUNCH_FEE.sniperStartBps), uk: ukDecimal(percentOf(LAUNCH_FEE.sniperStartBps)) },
  curve: { en: percentOf(LAUNCH_FEE.curve.baseBps), uk: ukDecimal(percentOf(LAUNCH_FEE.curve.baseBps)) },
  poolStart: { en: percentOf(LAUNCH_FEE.pool.startBps), uk: ukDecimal(percentOf(LAUNCH_FEE.pool.startBps)) },
  poolEnd: {
    en: LAUNCH_FEE.pool.endLowBps === LAUNCH_FEE.pool.endHighBps ? percentOf(LAUNCH_FEE.pool.endLowBps) : `${percentOf(LAUNCH_FEE.pool.endLowBps).replace("%", "")}–${percentOf(LAUNCH_FEE.pool.endHighBps)}`,
    uk: ukDecimal(LAUNCH_FEE.pool.endLowBps === LAUNCH_FEE.pool.endHighBps ? percentOf(LAUNCH_FEE.pool.endLowBps) : `${percentOf(LAUNCH_FEE.pool.endLowBps).replace("%", "")}–${percentOf(LAUNCH_FEE.pool.endHighBps)}`),
  },
} as const;

/** The claim floor of the Rewards rules in force: with a USDC account in the wallet, and without one. */
export const CLAIM_FLOOR = (() => {
  const floor = REWARD_RULES_CURRENT.claimFloor;
  const usdOf = (micros: bigint) => (Number(micros) / Number(USD_MICROS_PER_USD)).toFixed(2);
  const withAccount = floor ? usdOf(floor.withAccountUsdMicros) : usdOf(REWARD_MINIMUM_CLAIM_USD_MICROS);
  const withoutAccount = floor ? usdOf(floor.withoutAccountUsdMicros) : usdOf(REWARD_MINIMUM_CLAIM_USD_MICROS);
  return { en: { withAccount: `$${withAccount}`, withoutAccount: `$${withoutAccount}` }, uk: { withAccount: `$${withAccount.replace(".", ",")}`, withoutAccount: `$${withoutAccount.replace(".", ",")}` } } as const;
})();

/** «Перші $10 назад» and the inviter's window of the Rewards rules in force, when they carry them. */
export const REWARD_EXTRAS = {
  firstTen: REWARD_RULES_CURRENT.firstTen
    ? { cap: `$${Number(REWARD_RULES_CURRENT.firstTen.capUsdMicros / USD_MICROS_PER_USD)}`, days: REWARD_RULES_CURRENT.firstTen.days, wallets: REWARD_RULES_CURRENT.firstTen.walletsPerMonth }
    : null,
  inviterWindow: REWARD_RULES_CURRENT.inviterWindow ? { percent: REWARD_RULES_CURRENT.inviterWindow.bps / 100, days: REWARD_RULES_CURRENT.inviterWindow.days } : null,
  version: REWARD_RULES_CURRENT.version,
} as const;

/* How long after its first earning a wallet may still change its inviter (`REFERRAL_BIND_WINDOW_DAYS`,
   lib/rewards/referral.ts — written here rather than imported, since that module draws on node:crypto and the
   documentation renders in the browser; docs.test.mjs holds the two equal). */
export const REFERRAL_BIND_WINDOW_DAYS = 7;
