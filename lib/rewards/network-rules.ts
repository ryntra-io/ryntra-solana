/**
 * The rules of the Ryntra Network — creator partners — versioned, beside the
 * traders' rules and never mixed with them.
 *
 * ## A second programme, not a third version
 *
 * `rules.ts` computes what a trade pays back: cashback and friends, rules
 * `2.0.0`, out of the fee Ryntra received on that trade. This module computes
 * what a launch pool pays the person who brought its creator: a share of
 * Ryntra's received part of that pool. The two take from two different streams
 * of money (one fee, one payout), so neither version list knows about the
 * other, and nothing here changes what a trade earns.
 *
 * ## Policy 1.0 "Network"
 *
 * | Partner | Share of Ryntra's received part of the pool | When |
 * |---|---:|---|
 * | Standard | 20 % | the first 180 days from the pool's first fee Ryntra received |
 * | Standard, after | 10 % | while the pool earns and the programme runs |
 * | Founding — the first 20 approved | 30 % · 15 % · 10 % | days 1–90 · 91–365 · after |
 *
 * Everything paid out of one pool's Ryntra part together stays within 40 % of
 * it — the cap is checked on every pool's sums, not assumed from the rates.
 *
 * ## Versions
 *
 * A receipt is computed by the version in force when Ryntra received it (the
 * claim's moment), and an earned line keeps the version it was earned under:
 * a later version changes only what arrives after it. Days are whole days
 * counted from the pool's first received fee, day 1 being that day.
 *
 * Integers only: shares and the cap are basis points, money is USD micro-units.
 */

export const NETWORK_TIERS = ["STANDARD", "FOUNDING"] as const;
export type NetworkTier = (typeof NETWORK_TIERS)[number];

/** One step of a schedule: the share up to and including `untilDay`; null — every day after the previous step. */
export type NetworkStep = Readonly<{ untilDay: number | null; bps: number }>;

export type NetworkRules = Readonly<{
  version: string;
  /** From when receipts are computed by this version; null — from the programme's start. */
  effectiveFrom: string | null;
  schedules: Readonly<Record<NetworkTier, readonly NetworkStep[]>>;
  /** How many approved external partners are Founding. */
  foundingSeats: number;
  /** Everything paid out of one pool's received part, together, in basis points of it. */
  poolCapBps: number;
  /** How long an earned share waits before it is available (as for a friend's reward). */
  holdDays: number;
}>;

export const NETWORK_RULES_V1 = {
  version: "network-1.0.0",
  effectiveFrom: null,
  schedules: {
    STANDARD: [
      { untilDay: 180, bps: 2000 },
      { untilDay: null, bps: 1000 },
    ],
    FOUNDING: [
      { untilDay: 90, bps: 3000 },
      { untilDay: 365, bps: 1500 },
      { untilDay: null, bps: 1000 },
    ],
  },
  foundingSeats: 20,
  poolCapBps: 4000,
  holdDays: 14,
} as const satisfies NetworkRules;

/** Every version, oldest first. A new version is appended with its `effectiveFrom`; none is ever edited. */
export const NETWORK_RULES_HISTORY: readonly NetworkRules[] = [NETWORK_RULES_V1];

export const NETWORK_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A version that could pay more than its cap, or whose schedule has a gap,
 * is refused before it can compute anything.
 */
export function validateNetworkRules(rules: NetworkRules): NetworkRules {
  if (!Number.isInteger(rules.poolCapBps) || rules.poolCapBps <= 0 || rules.poolCapBps > 10_000) throw new Error(`Network rules ${rules.version}: the pool cap must be within 100 %.`);
  if (!Number.isInteger(rules.holdDays) || rules.holdDays < 0) throw new Error(`Network rules ${rules.version}: the hold must be whole days.`);
  if (!Number.isInteger(rules.foundingSeats) || rules.foundingSeats < 0) throw new Error(`Network rules ${rules.version}: Founding seats must be a whole number.`);
  if (rules.effectiveFrom !== null && !Number.isFinite(Date.parse(rules.effectiveFrom))) throw new Error(`Network rules ${rules.version}: unreadable start.`);
  for (const tier of NETWORK_TIERS) {
    const steps = rules.schedules[tier];
    if (!steps.length || steps[steps.length - 1]!.untilDay !== null) throw new Error(`Network rules ${rules.version}: the ${tier} schedule must end open.`);
    let previous = 0;
    for (const step of steps) {
      if (!Number.isInteger(step.bps) || step.bps < 0) throw new Error(`Network rules ${rules.version}: shares are whole basis points.`);
      if (step.bps > rules.poolCapBps) throw new Error(`Network rules ${rules.version}: a ${tier} share of ${step.bps} bps is above the pool cap.`);
      if (step.untilDay === null) continue;
      if (!Number.isInteger(step.untilDay) || step.untilDay <= previous) throw new Error(`Network rules ${rules.version}: the ${tier} days must rise.`);
      previous = step.untilDay;
    }
  }
  return rules;
}

for (const rules of NETWORK_RULES_HISTORY) validateNetworkRules(rules);

/** The version a receipt at `at` is computed by. */
export function networkRulesAt(at: string, history: readonly NetworkRules[] = NETWORK_RULES_HISTORY): NetworkRules {
  const ms = Date.parse(at);
  if (!Number.isFinite(ms)) throw new Error("Network rules need a readable moment.");
  let chosen: NetworkRules | null = null;
  for (const rules of history) {
    if (rules.effectiveFrom === null || Date.parse(rules.effectiveFrom) <= ms) chosen = rules;
  }
  if (!chosen) throw new Error("No network rules were in force at that moment.");
  return chosen;
}

/** A version by name, or null when this build does not know it. */
export function networkRulesOf(version: string, history: readonly NetworkRules[] = NETWORK_RULES_HISTORY): NetworkRules | null {
  return history.find((rules) => rules.version === version) ?? null;
}

/** Which day of the pool's earning a moment is: 1 on the day of its first received fee. */
export function networkDay(firstReceivedAt: string, at: string): number {
  const from = Date.parse(firstReceivedAt);
  const to = Date.parse(at);
  if (!Number.isFinite(from) || !Number.isFinite(to)) throw new Error("A pool day needs readable moments.");
  return Math.max(1, Math.floor((to - from) / NETWORK_DAY_MS) + 1);
}

/** The share a tier earns on a day, in basis points. */
export function networkShareBps(rules: NetworkRules, tier: NetworkTier, day: number): number {
  for (const step of rules.schedules[tier]) if (step.untilDay === null || day <= step.untilDay) return step.bps;
  return 0;
}

/** The last day of the step `day` falls in; null when it is the open last step. */
export function networkStepEnds(rules: NetworkRules, tier: NetworkTier, day: number): number | null {
  for (const step of rules.schedules[tier]) if (step.untilDay === null || day <= step.untilDay) return step.untilDay;
  return null;
}
