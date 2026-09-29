import "server-only";

import {
  getCapabilityFreshness,
  getCapabilityTruthTone,
  getPublicCapabilitiesForSurface,
  productCapabilityById,
  type ProductCapabilityId,
} from "./capabilities";
import type {
  LandingCapabilityCard,
  LandingLoopStage,
  LandingPublicModel,
} from "./public-capability-view";

const LOOP_STAGE_COPY: readonly Readonly<{
  registryId: ProductCapabilityId;
  label: string;
  detail: string;
}>[] = [
  {
    registryId: "strategy-lab-v1",
    label: "StrategySpec",
    detail: "Manual local preview; no persistence, navigation or execution.",
  },
  {
    registryId: "supported-route-readiness",
    label: "Readiness",
    detail: "Scoped checks exist for supported current routes; the venue-neutral scanner is planned.",
  },
  {
    registryId: "smarttrade-plan",
    label: "Human disposition",
    detail: "No trade, paper, manual review or an explicitly supported live route.",
  },
  {
    registryId: "complete-decision-loop",
    label: "DecisionReceipt",
    detail: "Prepared contracts are not a shipped, production-persisted receipt layer.",
  },
  {
    registryId: "complete-decision-loop",
    label: "ReviewRecord",
    detail: "Evidence-backed review and immutable next drafts are not shipped.",
  },
] as const;

export function getLandingPublicModel(now = new Date()): LandingPublicModel {
  const capabilities: readonly LandingCapabilityCard[] =
    getPublicCapabilitiesForSurface("landing").map((capability) => ({
      id: capability.id,
      label: capability.label,
      maturity: capability.maturity,
      mode: capability.mode,
      scopeLabel:
        [
          capability.scope.provider?.label,
          capability.scope.route,
        ].filter(Boolean).join(" · ") || "Ryntra product layer",
      lastVerifiedAt: capability.lastVerifiedAt,
      freshness: getCapabilityFreshness(capability, now),
      truthTone: getCapabilityTruthTone(capability, now),
      limitation: capability.limitation,
    }));

  const loopStages: readonly LandingLoopStage[] = LOOP_STAGE_COPY.map((stage) => ({
    ...stage,
    maturity: productCapabilityById(stage.registryId).maturity,
  }));

  return { capabilities, loopStages };
}
