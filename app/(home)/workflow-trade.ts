/**
 * One illustrative NVDAx trade, told across the six cards of the third block
 * (workflow-cards.tsx).
 *
 * The figures are examples, not quotes — the frame that shows them is
 * `aria-hidden` and the words beside it say so in words — and they are chosen
 * once, here, so that the six cards agree with each other: the plan's rule
 * produces the position the ticket spends and the result compares; the
 * review's expected fill is the research card's Solana quote; the deviation
 * is that quote against the underlying's reference. Everything under
 * `DERIVED` is arithmetic on these inputs, pinned by workflow.test.mjs, so a
 * changed example cannot leave one card telling a different story from the
 * next. The mint and the picture are the same NVDAx the universe orbits.
 */

import { RULE_MINIMUM_USD, PRICE_CONDITION_DEFAULT_PCT } from "../../lib/autoinvest/limits.ts";
import { LOSS_LIMIT_PRESETS } from "../../lib/plans/purchase.ts";

export const TRADE = {
  symbol: "NVDAx",
  name: "NVIDIA xStock",
  underlying: "NVDA",
  mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
  icon: "NVDAx.png",
  /* The underlying's last reference price and the Solana quote for the token. */
  reference: 214.72,
  quote: 214.94,
  change24h: 1.84,
  /* The Spot market header's own two figures for NVDAx, as read on 2026-09-13. */
  liquidity: "$1.9M",
  volume24h: "$6.2M",
  earningsInDays: 4,
  /* The plan. */
  entry: 215,
  target: 228,
  invalidation: 208,
  budget: 2000,
  maxRiskPercent: 1.0,
  horizon: "5–10 days",
  /* The order and what came back. */
  spend: 1000,
  maxSlippagePercent: 0.3,
  priceImpactPercent: 0.08,
  actualSlippagePercent: 0.08,
} as const;

const round = (value: number, digits: number) => Number(value.toFixed(digits));

/** The arithmetic every card reads, never retyped on a card. */
export const DERIVED = {
  /** Tokens the spend buys at the quote. */
  units: round(TRADE.spend / TRADE.quote, 2),
  /** What the position loses at the invalidation price. */
  riskAtInvalidation: round((TRADE.spend * (TRADE.entry - TRADE.invalidation)) / TRADE.entry, 2),
  /** Distance to the target over distance to the invalidation. */
  rewardToRisk: round((TRADE.target - TRADE.entry) / (TRADE.entry - TRADE.invalidation), 1),
  /** The Solana quote against the underlying's reference, in percent. */
  deviationPercent: round(((TRADE.quote - TRADE.reference) / TRADE.reference) * 100, 2),
  targetPercent: round(((TRADE.target - TRADE.entry) / TRADE.entry) * 100, 1),
  invalidationPercent: round(((TRADE.invalidation - TRADE.entry) / TRADE.entry) * 100, 1),
} as const;

const money = (value: number, digits = 2) => `$${value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
const signed = (value: number, digits = 2) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(digits)}%`;

/** The strings the cards print. */
export const FIGURES = {
  reference: money(TRADE.reference),
  quote: money(TRADE.quote),
  change24h: signed(TRADE.change24h),
  deviation: signed(DERIVED.deviationPercent),
  entry: money(TRADE.entry),
  target: money(TRADE.target),
  invalidation: money(TRADE.invalidation),
  targetMove: signed(DERIVED.targetPercent, 1),
  invalidationMove: signed(DERIVED.invalidationPercent, 1),
  budget: money(TRADE.budget, 0),
  maxRisk: `${TRADE.maxRiskPercent.toFixed(1)}%`,
  position: money(TRADE.spend, 0),
  spend: `${TRADE.spend.toLocaleString("en-US")} USDC`,
  units: `${DERIVED.units.toFixed(2)} ${TRADE.symbol}`,
  riskAtInvalidation: `−${money(DERIVED.riskAtInvalidation)}`,
  rewardToRisk: `${DERIVED.rewardToRisk.toFixed(1)} : 1`,
  maxSlippage: `${TRADE.maxSlippagePercent.toFixed(2)}%`,
  priceImpact: `${TRADE.priceImpactPercent.toFixed(2)}%`,
  actualSlippage: `${TRADE.actualSlippagePercent.toFixed(2)}%`,
  earnings: `${TRADE.earningsInDays} days`,
} as const;

/** The sum of the purchase the third block walks, in dollars — the product's least (canon v5.5 В35). */
const BUY_USD = RULE_MINIMUM_USD;

/**
 * The purchase the third block walks since the new site of canon v5.5: $1 of
 * NVDAx at the same illustrative quote, so the hero's terminal and the
 * frame's cards never disagree about the price. «All costs» is Ryntra's fee
 * on the lane and the network's, under a cent on $1 — the same line the real
 * purchase sheet shows for $1 of NVDAx (read on ryntra.io on 2026-09-26). The
 * loss limits and the price condition are the product's own presets, and the
 * rule's sum is the purchase's: one story from the company to the rule.
 */
export const BUY = {
  sum: money(BUY_USD, 0),
  whole: String(BUY_USD),
  paid: money(BUY_USD),
  pay: `${money(BUY_USD)} USDC`,
  price: FIGURES.quote,
  change: FIGURES.change24h,
  units: (BUY_USD / TRADE.quote).toFixed(4),
  costs: "< $0.01",
  time: "14:02",
  lossLimits: [LOSS_LIMIT_PRESETS.careful.stopPct, LOSS_LIMIT_PRESETS.balanced.stopPct].map((pct) => `−${pct}%`),
  /* The rule: every day at two, the price condition at its default, a month's budget part spent. */
  ruleAt: "14:00",
  condition: `${PRICE_CONDITION_DEFAULT_PCT}%`,
  budget: `${money(12, 0)} / ${money(30, 0)}`,
  /* The two other rows of the Markets list, with the day's change each showed then. */
  others: [
    { symbol: "SPYx", name: "S&P 500", change: signed(0.42), icon: "SPYx.png" },
    { symbol: "AAPLx", name: "Apple", change: signed(-0.37), icon: "AAPLx.png" },
  ],
} as const;
