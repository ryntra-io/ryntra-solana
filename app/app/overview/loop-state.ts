import {
  getCapabilityFreshness,
  productCapabilityById,
  type ProductCapabilityId,
} from "../../../lib/product/capabilities.ts";

/**
 * The decision loop, with each stage's real state.
 *
 * The stages are the product's own lifecycle, and each one is bound to the
 * capability that would have to be true for it to work. Nothing here is
 * authored: the state comes from the registry and fails closed the same way the
 * public site does — a claim past its review window renders as re-verifying
 * rather than at its previous confidence.
 *
 * That matters more inside the cabinet than outside it. A signed-in operator is
 * about to act; a dashboard that told them a stage was live when its evidence
 * had expired would be the most expensive sentence on the page.
 */

export type LoopStageId = "plan" | "readiness" | "authorize" | "execute" | "receipt" | "review";

export type LoopStageState =
  | "live"
  | "paper"
  | "preview"
  | "in_build"
  | "after_gate"
  | "re_verifying";

export type LoopStage = Readonly<{
  id: LoopStageId;
  capabilityId: ProductCapabilityId;
  state: LoopStageState;
  /** Exactly what the state covers, from the registry. */
  scope: string;
  /** The registry's own stated limitation. */
  limitation: string;
}>;

/** Which capability each stage stands or falls on. */
const STAGE_CAPABILITY: Readonly<Record<LoopStageId, ProductCapabilityId>> = {
  plan: "smarttrade-plan",
  readiness: "supported-route-readiness",
  authorize: "arcus-spot-rfq",
  execute: "arcus-spot-rfq",
  receipt: "complete-decision-loop",
  review: "decision-journal",
};

const MATURITY_STATE: Record<string, LoopStageState> = {
  live: "live",
  paper: "paper",
  preview: "preview",
  planned: "in_build",
  after_gate: "after_gate",
};

export const LOOP_STATE_LABEL: Readonly<Record<LoopStageState, string>> = {
  live: "Live",
  paper: "Paper",
  preview: "Preview",
  in_build: "In build",
  after_gate: "Behind a gate",
  re_verifying: "Re-verifying",
};

export const LOOP_STATE_TONE: Readonly<Record<LoopStageState, "ok" | "info" | "warn" | "idle">> = {
  live: "ok",
  paper: "info",
  preview: "info",
  in_build: "idle",
  after_gate: "idle",
  re_verifying: "warn",
};

export const LOOP_ORDER: readonly LoopStageId[] = [
  "plan",
  "readiness",
  "authorize",
  "execute",
  "receipt",
  "review",
];

export function loopStages(now = new Date()): readonly LoopStage[] {
  return LOOP_ORDER.map((id) => {
    const capabilityId = STAGE_CAPABILITY[id];
    const capability = productCapabilityById(capabilityId);
    const fresh = getCapabilityFreshness(capability, now) === "fresh";
    const state = fresh ? (MATURITY_STATE[capability.maturity] ?? "in_build") : "re_verifying";
    const scope =
      [capability.scope.provider?.label, capability.scope.route].filter(Boolean).join(" · ") ||
      "Ryntra product layer";
    return { id, capabilityId, state, scope, limitation: capability.limitation };
  });
}
