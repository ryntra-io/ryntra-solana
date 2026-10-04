/* Mock ExecutionIntent preflight for the Robinhood Trading MCP.

   This module decides and does not act. There is no client, no endpoint, no
   credential and no dispatch function in this file — `dispatch` is a constant
   string saying so, and the suite fails if `evaluateMockIntent` reaches the
   network or if the venue's host appears here at all.

   It exists so the policy shape can be exercised against a real venue's
   vocabulary before any write path exists, and so two refusals stay separate:
   *the door is shut* and *nothing here could open it anyway*. The second one
   survives the first being fixed, which is the whole point — a reader who sees
   only "blocked: 403" would reasonably expect a working credential to unblock an
   order, and it would not.

   Verdicts are ALLOW / REVIEW / BLOCK. BLOCK is absorbing and every reason is
   still collected, so a refusal names all of its causes rather than the first. */

import type { DataState } from "../domain/capability.ts";
import type { PerOrderHumanApproval } from "./custody.ts";
import { enforcementModeFor, type ControlPathTopology } from "./enforcement.ts";
import type { ReachabilityState } from "./reachability.ts";

/** What an intent would do. `OBSERVE_LOCAL` touches no provider at all. */
export type IntentEffect =
  /** Read a record Ryntra already holds. The only effect that reaches nothing. */
  | "OBSERVE_LOCAL"
  /** Ask the provider for state. */
  | "READ_PROVIDER"
  /** Change provider state that holds no assets. */
  | "WRITE_NO_ASSET"
  /** Create, cancel or alter a real order. */
  | "WRITE_ORDER";

export type IntentSide = "BUY" | "SELL" | null;

export type MockExecutionIntent = {
  /** Always true. A record that could be mistaken for a real intent is the thing to avoid. */
  mock: true;
  venue: "robinhood-brokerage";
  surface: "robinhood-trading-mcp";
  effect: string;
  symbol: string;
  side: IntentSide;
  notionalUsd: number;
};

export type EvaluationContext = {
  reachability: ReachabilityState;
  topology: ControlPathTopology;
  perOrderHumanApproval: PerOrderHumanApproval;
  dataState: DataState;
  /** Notional above which a person has to look before anything may proceed. */
  reviewAboveUsd: number;
};

export type Verdict = "ALLOW" | "REVIEW" | "BLOCK";

export type IntentReason = {
  code: string;
  severity: "blocking" | "review";
  detail: string;
};

export type IntentDecision = {
  verdict: Verdict;
  reasons: IntentReason[];
  /** Constant false. Nothing in this module sends anything anywhere. */
  dispatched: false;
  dispatch: typeof DISPATCH_IS_NOT_IMPLEMENTED;
};

export const DISPATCH_IS_NOT_IMPLEMENTED =
  "Dispatch is not implemented: this package is read-only discovery and sends nothing to Robinhood.";

const KNOWN_EFFECTS: readonly IntentEffect[] = [
  "OBSERVE_LOCAL",
  "READ_PROVIDER",
  "WRITE_NO_ASSET",
  "WRITE_ORDER",
];

/**
 * Fail-closed on the effect axis: an effect this module has never heard of is an
 * order. The alternative is that a new verb defaults to the one branch that
 * touches nothing, which is how a write slips through a read-only gate by being
 * unfamiliar.
 */
function normalizeEffect(effect: string): IntentEffect {
  return (KNOWN_EFFECTS as readonly string[]).includes(effect) ? (effect as IntentEffect) : "WRITE_ORDER";
}

export function mockIntent(input: {
  effect: string;
  symbol: string;
  side?: IntentSide;
  notionalUsd?: number;
}): MockExecutionIntent {
  return {
    mock: true,
    venue: "robinhood-brokerage",
    surface: "robinhood-trading-mcp",
    effect: input.effect,
    symbol: input.symbol,
    side: input.side ?? null,
    notionalUsd: input.notionalUsd ?? 0,
  };
}

export function evaluateMockIntent(
  intent: MockExecutionIntent,
  context: EvaluationContext,
): IntentDecision {
  const reasons: IntentReason[] = [];
  const effect = normalizeEffect(intent.effect);
  const reachesProvider = effect !== "OBSERVE_LOCAL";
  const writes = effect === "WRITE_NO_ASSET" || effect === "WRITE_ORDER";

  /* The door. Checked first because it is the fact a live probe measured, and
     stated in the provider's terms rather than as a generic failure. */
  if (reachesProvider && context.reachability !== "REACHABLE") {
    reasons.push({
      code: "VENUE_UNREACHABLE",
      severity: "blocking",
      detail:
        "The Robinhood Trading MCP is " + context.reachability +
        " from this origin, so nothing may be asked of it.",
    });
  }

  /* The path. Separate from the door on purpose: fixing the 403 does not create
     an adapter, and a reader must not be able to conclude that it would. */
  if (writes && enforcementModeFor(context.topology) !== "ENFORCED_THROUGH_RYNTRA") {
    reasons.push({
      code: "NO_ENFORCED_PATH",
      severity: "blocking",
      detail:
        "This request would not pass through a Ryntra adapter (topology " + context.topology +
        "), so no control here could refuse it. Ryntra may observe, import, reconcile and alert " +
        "on this surface, and may not authorize on it.",
    });
  }

  /* The person. An order nobody sees is refused on its own axis, because the
     provider itself makes the per-order human step optional. */
  if (effect === "WRITE_ORDER" && context.perOrderHumanApproval === "NONE") {
    reasons.push({
      code: "NO_HUMAN_AUTHORIZATION",
      severity: "blocking",
      detail:
        "No person authorizes this order. Robinhood permits an agent to place trades without " +
        "confirmation when the customer configures it that way; Ryntra does not represent that " +
        "configuration as authorized.",
    });
  }

  /* A gap in knowledge must never render as safety, and a disagreement is worse
     than a gap: acting on one of two conflicting values is choosing without
     knowing that you chose. */
  if (context.dataState === "conflicting") {
    reasons.push({
      code: "CONFLICTING_MARKET_DATA",
      severity: "blocking",
      detail: "Two sources disagree about " + intent.symbol + "; the disagreement has to be resolved first.",
    });
  } else if (context.dataState === "stale" || context.dataState === "unknown") {
    reasons.push({
      code: context.dataState === "stale" ? "STALE_MARKET_DATA" : "UNKNOWN_MARKET_DATA",
      severity: "review",
      detail: "Data for " + intent.symbol + " is " + context.dataState + ".",
    });
  }

  if (intent.notionalUsd > context.reviewAboveUsd) {
    reasons.push({
      code: "ABOVE_REVIEW_THRESHOLD",
      severity: "review",
      detail:
        intent.notionalUsd + " USD is above the " + context.reviewAboveUsd + " USD review threshold.",
    });
  }

  const verdict: Verdict = reasons.some(function (reason) { return reason.severity === "blocking"; })
    ? "BLOCK"
    : reasons.length > 0
      ? "REVIEW"
      : "ALLOW";

  return { verdict, reasons, dispatched: false, dispatch: DISPATCH_IS_NOT_IMPLEMENTED };
}
