/* Entitlements per tier. The product is free: while FLAGS.billing.enabled is false every tier
   resolves to the full product and nothing here renders; the consistency test
   (lib/domain/registry.test.mjs + entitlements.test.mjs) keeps it that way. */

import { FLAGS } from "./features.ts";

export type Tier = "free" | "pro" | "trader" | "team";

export type Entitlements = {
  /** Paper trades per day (discipline practice is never fully locked). */
  paperTradesPerDay: number | "unlimited";
  journalHistoryDays: number | "unlimited";
  riskPanels: boolean;
  routeComparison: boolean;
  telegramAlerts: boolean;
  dailyRecap: boolean;
  /** Multi-venue read-only dashboards (Hyperliquid etc.) once surfaces ship. */
  multiVenueReadOnly: boolean;
  /** API access for Team/API tier — planned, never live before its own security review. */
  apiAccess: boolean;
};

/** During free beta EVERY user gets the full current product — one honest tier. */
const BETA_ALL: Entitlements = {
  paperTradesPerDay: "unlimited",
  journalHistoryDays: "unlimited",
  riskPanels: true,
  routeComparison: true,
  telegramAlerts: true,
  dailyRecap: true,
  multiVenueReadOnly: true,
  apiAccess: false,
};

/** The tiers' shape, off while billing is disabled; the numbers are placeholders and never render. */
const DRAFT_TIERS: Record<Tier, Entitlements> = {
  free: { ...BETA_ALL, paperTradesPerDay: 10, journalHistoryDays: 90, multiVenueReadOnly: false },
  pro: { ...BETA_ALL },
  trader: { ...BETA_ALL, apiAccess: false },
  team: { ...BETA_ALL, apiAccess: true },
};

/** The only lookup the app may use. While billing is off, every tier resolves to the full beta
    entitlements — there is no paywall in the product, and no tier can be rendered as gated. */
export function entitlementsFor(tier: Tier): Entitlements {
  return FLAGS.billing.enabled ? DRAFT_TIERS[tier] : BETA_ALL;
}

export const BILLING_READINESS = {
  gateTask: "RYN-BILL-001",
  northStar: "Weekly Risk-Reviewed Decisions (WRRD)",
  requiredEvidence: ["retained_wrrd", "willingness_to_pay"],
  numericThresholds: null,
  calendarDeadline: null,
} as const;
