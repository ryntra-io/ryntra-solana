import type {
  CapabilityEvidenceState,
  CapabilityMaturity,
  CapabilityMode,
  CapabilityTruthTone,
  ProductCapabilityId,
} from "./capabilities";

export type LandingCapabilityCard = Readonly<{
  id: ProductCapabilityId;
  label: string;
  maturity: CapabilityMaturity;
  mode: CapabilityMode;
  scopeLabel: string;
  lastVerifiedAt: string;
  freshness: CapabilityEvidenceState;
  truthTone: CapabilityTruthTone;
  limitation: string;
}>;

export type LandingLoopStage = Readonly<{
  registryId: ProductCapabilityId;
  label: string;
  maturity: CapabilityMaturity;
  detail: string;
}>;

export type LandingPublicModel = Readonly<{
  capabilities: readonly LandingCapabilityCard[];
  loopStages: readonly LandingLoopStage[];
}>;
