import "server-only";

import { AGENT_CONTROL_DOD_CHECKS } from "./agent-control-truth";
import {
  capabilityAxes,
  getCapabilityFreshness,
  getPublicCapabilitiesForSurface,
  type CapabilityAxes,
  type CapabilityEvidenceState,
} from "./capabilities";

/*
 * The public build truth for Agent Control, read from the registry.
 *
 * This module exists because the landing had the opposite arrangement: the
 * capability map was a hand-written table in `app/(home)/data.ts`, a file with
 * no imports at all, and it printed `LIVE` beside two rows while the registry
 * had every Agent Control capability at `preview`. Nothing failed, because
 * nothing was comparing them.
 *
 * So the page no longer holds status words. It holds ids; the words come from
 * here, and `agent-control-truth.test.mjs` fails if a status literal reappears
 * in the landing data.
 */

/** One capability as the public surfaces render it. */
export type AgentControlCard = {
  id: string;
  label: string;
  /** What the reader is allowed to conclude — never a marketing word. */
  publicLabel: string;
  scopeLabel: string;
  limitation: string;
  lastVerifiedAt: string;
  freshness: CapabilityEvidenceState;
  axes: CapabilityAxes;
};

/**
 * `passed / applicable` over blocking Definition-of-Done checks.
 *
 * Deliberately not a percentage and deliberately not summed across
 * capabilities: a single number over a whole product is never shown,
 * because it has no denominator a reader can check.
 */
export type VerificationCoverage = {
  passed: number;
  applicable: number;
  /** Named blockers that stop promotion whatever the ratio says. */
  blockers: readonly string[];
};

export type AgentControlPublicModel = {
  cards: readonly AgentControlCard[];
  coverage: VerificationCoverage;
  build: string;
  /** Networks with a real per-network status rather than a decorative badge. */
  networks: readonly AgentControlNetwork[];
};

export type AgentControlNetwork = {
  name: string;
  environment: CapabilityAxes["environment"];
  enforcement: CapabilityAxes["enforcement"];
  note: string;
};

const NETWORKS: readonly AgentControlNetwork[] = [
  {
    name: "BNB Testnet",
    environment: "TESTNET",
    enforcement: "OBSERVE_ONLY",
    note: "Bounded observer for a known job id and transaction hash.",
  },
  {
    name: "Base",
    environment: "MOCK",
    enforcement: "OBSERVE_ONLY",
    note: "Selected P1 rail. No adapter is built; the rail choice is made by a person with authority.",
  },
  {
    name: "Solana",
    environment: "MOCK",
    enforcement: "OBSERVE_ONLY",
    note: "Adapter roadmap behind the validation gate. Not built.",
  },
  {
    name: "x402",
    environment: "MOCK",
    enforcement: "OBSERVE_ONLY",
    note: "No x402 implementation exists in the product. Protocol reading only.",
  },
];

/**
 * The build this page was generated from.
 *
 * Vercel supplies the commit; a local build has none, and printing a fake one
 * would defeat the point of stamping it at all — so the fallback says `local`
 * rather than inventing a hash.
 */
function buildStamp(): string {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA;
  return sha ? sha.slice(0, 7) : "local";
}

export function getAgentControlPublicModel(now = new Date()): AgentControlPublicModel {
  const cards: readonly AgentControlCard[] = getPublicCapabilitiesForSurface("agent_control").map(
    (capability) => ({
      id: capability.id,
      label: capability.label,
      publicLabel: capability.publicLabel,
      scopeLabel:
        [capability.scope.provider?.label, capability.scope.route].filter(Boolean).join(" · ") ||
        capability.scope.venues.join(" · ") ||
        "Ryntra product layer",
      limitation: capability.limitation,
      lastVerifiedAt: capability.lastVerifiedAt,
      freshness: getCapabilityFreshness(capability, now),
      axes: capabilityAxes(capability),
    }),
  );

  const blockers = AGENT_CONTROL_DOD_CHECKS.filter((check) => !check.passed && check.blocker).map(
    (check) => check.blocker as string,
  );

  return {
    cards,
    coverage: {
      passed: AGENT_CONTROL_DOD_CHECKS.filter((check) => check.passed).length,
      applicable: AGENT_CONTROL_DOD_CHECKS.length,
      blockers,
    },
    build: buildStamp(),
    networks: NETWORKS,
  };
}
