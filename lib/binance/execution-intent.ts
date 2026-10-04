/* Mock ExecutionIntent evaluation for the Binance surface (read-only discovery).

   This module decides and does not act. It exists so the policy shape can be exercised against a
   real venue's vocabulary before any write path is built — and so the boundary is a property of
   the code rather than of an intention. There is no client, no endpoint, no credential and no
   dispatch function in this file; `dispatch` is a constant string saying so, and the test suite
   fails if `evaluateIntent` reaches the network.

   Verdicts are ALLOW / REVIEW / BLOCK. BLOCK is absorbing: every reason is still collected, so a
   refusal can name all of its causes rather than only the first one found. */

import type { DataState } from "../domain/capability.ts";
import type { BinanceProductType, BinanceSurfaceId } from "./instrument.ts";
import type { BinanceMcpScope } from "./capability.ts";

export type IntentSide = "BUY" | "SELL";

export type MockIntentInput = {
  surface: BinanceSurfaceId;
  product: BinanceProductType;
  base: string;
  quote: string;
  side: string;
  orderType: "MARKET" | "LIMIT";
  notionalUsd: number;
};

export type MockExecutionIntent = {
  /** Always true. A record that could be mistaken for a real intent is the thing to avoid. */
  mock: true;
  surface: BinanceSurfaceId;
  product: BinanceProductType;
  base: string;
  quote: string;
  side: IntentSide;
  orderType: "MARKET" | "LIMIT";
  notionalUsd: number;
  /** The Binance MCP scope this action would require if it were ever sent. */
  requiredScope: BinanceMcpScope;
};

export type EvaluationContext = {
  grantedScopes: readonly BinanceMcpScope[];
  killSwitchEngaged: boolean;
  dataState: DataState;
  tradable: boolean;
  /** Notional above which a human has to look at it before it may proceed. */
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
  "Dispatch is not implemented: this package is read-only discovery and sends nothing to Binance.";

/**
 * Builds a mock intent. A withdrawal is rejected here rather than blocked downstream, because the
 * Agentic surface has no withdrawal scope at all — an intent that cannot exist should not be
 * representable, and representing it as "blocked" would imply a policy could one day allow it.
 */
export function mockIntent(input: MockIntentInput): MockExecutionIntent {
  if (input.side !== "BUY" && input.side !== "SELL") {
    throw new Error(
      `Unsupported side "${input.side}". The Binance Agentic surface exposes no withdrawal scope, ` +
        "so a withdrawal intent is not representable.",
    );
  }

  return Object.freeze({
    mock: true as const,
    surface: input.surface,
    product: input.product,
    base: input.base,
    quote: input.quote,
    side: input.side,
    orderType: input.orderType,
    notionalUsd: input.notionalUsd,
    requiredScope: "trade" as const,
  });
}

export function evaluateIntent(
  intent: MockExecutionIntent,
  context: EvaluationContext,
): IntentDecision {
  const reasons: IntentReason[] = [];

  if (context.killSwitchEngaged) {
    reasons.push({
      code: "KILL_SWITCH_ENGAGED",
      severity: "blocking",
      detail: "The client kill switch is engaged; no intent may be prepared or relayed.",
    });
  }

  if (!context.grantedScopes.includes(intent.requiredScope)) {
    reasons.push({
      code: "SCOPE_NOT_GRANTED",
      severity: "blocking",
      detail: `This action needs the "${intent.requiredScope}" scope, which the authorization does not carry.`,
    });
  }

  if (!context.tradable) {
    reasons.push({
      code: "INSTRUMENT_NOT_TRADABLE",
      severity: "blocking",
      detail: `${intent.base}/${intent.quote} is not two-sided tradable on ${intent.surface} right now.`,
    });
  }

  // A gap in knowledge must never render as safety. Conflicting sources are worse than a gap:
  // acting on one of two disagreeing prices is choosing without knowing that you chose.
  if (context.dataState === "conflicting") {
    reasons.push({
      code: "CONFLICTING_MARKET_DATA",
      severity: "blocking",
      detail: "Two sources disagree about this instrument; the disagreement has to be resolved first.",
    });
  } else if (context.dataState === "stale" || context.dataState === "unknown") {
    reasons.push({
      code: context.dataState === "stale" ? "STALE_MARKET_DATA" : "UNKNOWN_MARKET_DATA",
      severity: "review",
      detail: `Market data for ${intent.base}/${intent.quote} is ${context.dataState}.`,
    });
  }

  if (intent.notionalUsd > context.reviewAboveUsd) {
    reasons.push({
      code: "ABOVE_REVIEW_THRESHOLD",
      severity: "review",
      detail: `${intent.notionalUsd} USD is above the ${context.reviewAboveUsd} USD review threshold.`,
    });
  }

  const verdict: Verdict = reasons.some((reason) => reason.severity === "blocking")
    ? "BLOCK"
    : reasons.length > 0
      ? "REVIEW"
      : "ALLOW";

  return { verdict, reasons, dispatched: false, dispatch: DISPATCH_IS_NOT_IMPLEMENTED };
}
