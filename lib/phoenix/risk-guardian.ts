/**
 * The account's state in one scale (PERP-7; spec §12 «Ryntra Risk Guardian»): «Здоровий · Підвищений ризик ·
 * Критичний · Дані застаріли · Ліквідація». One compact line with a word, a reason and «Що це означає?» — never a
 * wall of red text, and never a verdict on whether a position is a good one.
 *
 * Every figure the scale stands on is Phoenix's own, read through the Rise SDK: the risk tier of each subaccount and
 * the room each keeps before its maintenance margin (`collateral-model.ts`). Nothing here estimates a liquidation of
 * its own — the scale only names what the protocol already says.
 *
 * No Node module here: the page imports it beside the margin view it already holds.
 */

import { RISK_ORDER, accountRisk, type PhoenixMargin } from "./collateral-model.ts";

/** The five states of the scale, from the calmest to the one that has already happened. */
export type GuardianState = "healthy" | "raised" | "critical" | "stale" | "liquidation";
export const GUARDIAN_STATES: readonly GuardianState[] = Object.freeze(["healthy", "raised", "critical", "stale", "liquidation"]);

/** What the scale offers to do. `reduce` and `close` act on a position, `cancelAll` on resting orders. */
export type GuardianAction = "reduce" | "close" | "deposit" | "cancelAll";

/**
 * Phoenix's own risk tier (SDK `RiskTier`) → the state of the scale it stands for. `cancellable` is the point where
 * the protocol may start taking the account's orders away, so it is already critical; from `liquidatable` up Phoenix
 * says the account is being liquidated, which is the fact the last state reports — the page states it rather than
 * predicting it.
 */
export const TIER_STATE: Readonly<Record<(typeof RISK_ORDER)[number], GuardianState>> = Object.freeze({
  safe: "healthy",
  atRisk: "raised",
  cancellable: "critical",
  liquidatable: "liquidation",
  backstopLiquidatable: "liquidation",
  highRisk: "liquidation",
});

export type GuardianInput = Readonly<{
  /** The cross-margin subaccount's margin view and each isolated one's, as the account block already holds them. */
  margins: readonly Pick<PhoenixMargin, "riskTier" | "portfolioUsd" | "maintenanceMarginUsd">[];
  /** Phoenix's reads stopped coming (`feed-lifecycle.ts`): the figures on screen are the last ones read. */
  stale: boolean;
  /** There is a position to reduce or close, and an order to cancel. */
  hasPositions: boolean;
  hasOrders: boolean;
  /** A subaccount with a position whose margin view was not read: the scale stands for the rest of the account. */
  partial?: boolean;
}>;

export type GuardianView = Readonly<{
  state: GuardianState;
  /** The tier Phoenix named, the scale's own reason; null when it named none. */
  tier: string | null;
  /** The least room any subaccount keeps before its maintenance margin, per cent; null when nothing can be liquidated. */
  room: number | null;
  /** The reads stopped: whatever the state, the figures beside it are the last ones Phoenix sent. */
  stale: boolean;
  partial: boolean;
  /** The actions offered, in the order they stand: a critical account leads with «Зменшити» and «Закрити». */
  actions: readonly GuardianAction[];
}>;

/** The order every state offers its actions in; a critical account puts the two that take risk off the table first. */
const ORDER: Readonly<Record<GuardianState, readonly GuardianAction[]>> = Object.freeze({
  healthy: Object.freeze([]),
  raised: Object.freeze(["reduce", "deposit"] as const),
  critical: Object.freeze(["reduce", "close", "deposit", "cancelAll"] as const),
  /* Old figures close new risk, not the way out: reducing and closing stay (PERP-4, spec §7). */
  stale: Object.freeze(["reduce", "close"] as const),
  liquidation: Object.freeze(["reduce", "close", "deposit", "cancelAll"] as const),
});

/**
 * The scale for the account as it stands now.
 *
 * Which state wins when more than one could apply: a liquidation and a critical account are never softened into «дані
 * застаріли» — old figures cannot make an account better than the last read showed it, so the worse word stands and
 * `stale` carries the warning that the numbers are old. Below that, stale reads over «підвищений ризик» and
 * «здоровий», because then what the person most needs to know is that the figures stopped.
 */
export function guardianView(input: GuardianInput): GuardianView {
  const { tier, room } = accountRisk(input.margins);
  /* `Object.hasOwn`, not `in`: `accountRisk` already keeps to the six tiers, and this holds even if it stops. */
  const named = tier !== null && Object.hasOwn(TIER_STATE, tier) ? TIER_STATE[tier as (typeof RISK_ORDER)[number]] : null;
  /* A tier Phoenix did not send, or one this release does not know, is not read as a verdict: the reason line is left empty. */
  const base: GuardianState = named ?? "healthy";
  const state: GuardianState = base === "liquidation" || base === "critical" ? base : input.stale ? "stale" : base;
  const allowed = (action: GuardianAction): boolean => (action === "deposit" ? true : action === "cancelAll" ? input.hasOrders : input.hasPositions);
  return {
    state,
    tier: named === null ? null : tier,
    room,
    stale: input.stale,
    partial: input.partial ?? false,
    actions: Object.freeze(ORDER[state].filter(allowed)),
  };
}
