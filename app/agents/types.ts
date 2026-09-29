import type {
  AgentActionIntent,
  ActionPassportPreview,
} from "@/lib/agent-control/contracts";
import type { AgentPassport } from "@/lib/agent-control/agent-passport";

export type AgentPassportData = AgentPassport;

export type AgentPassportReadPhase =
  | "idle"
  | "loading"
  | "invalid"
  | "error"
  | "loaded";

export type AgentPolicyResultView = Readonly<{
  id: string;
  decision:
    | "ALLOWED_BY_POLICY"
    | "BLOCKED_BY_RULE"
    | "INSUFFICIENT_EVIDENCE"
    | "EXPIRED"
    | "UNSUPPORTED";
  status: "PASS" | "BLOCK";
  blockers: readonly string[];
  warnings: readonly string[];
  policyDigest: string;
  evidenceRoot: string;
  evaluatedAt: string;
}>;

export type AgentPreflightView = Readonly<{
  intent: AgentActionIntent;
  evidence: readonly Readonly<{
    id: string;
    provider: string;
    sourceRef: string;
    observedAt: string;
    validUntil: string;
    status: string;
    availability: string;
  }>[];
  evidenceRoot: string;
  policy: Readonly<{
    id: string;
    version: number;
    allowedChains: readonly string[];
    allowedActions: readonly string[];
    requireHumanAuthorization: true;
    executionEnabled: false;
  }>;
  policyResult: AgentPolicyResultView;
}>;

export type AgentDemoData = Readonly<{
  mode: "SAMPLE_NOT_ONCHAIN";
  externalState: Readonly<{
    agentverseRegistration: "NOT_VERIFIED";
    agentLaunchTokenRead: "NOT_INCLUDED";
    bnbApexJob: "NOT_OBSERVED";
  }>;
  sources: readonly Readonly<{
    id: string;
    label: string;
    url: string;
    status: string;
    limitation: string;
  }>[];
  preflight: AgentPreflightView;
  passport: ActionPassportPreview;
}>;

/**
 * What the unified verifier returns, mirrored for the browser.
 *
 * No top-level `valid`, deliberately. Every merge of the three axes loses the
 * distinction a reader needs: a valid unsigned artifact and a tampered signed
 * one would both read as false.
 */
export type ArtifactVerificationView = Readonly<{
  recognised: boolean;
  generation: "v2" | "legacy-1.0.0" | null;
  kind: string | null;
  schemaVersion: string | null;
  integrity: Readonly<{ valid: boolean; issues: readonly string[] }>;
  issuer: Readonly<{
    verdict: "SIGNATURE_VALID" | "SIGNATURE_INVALID" | "UNSIGNED" | "UNTRUSTED_KEY";
    keyId: string | null;
    detail: string;
  }>;
  authorization: Readonly<{
    verdict: "AUTHORIZED" | "NOT_AUTHORIZED" | "DEMO_ACKNOWLEDGEMENT_ONLY" | "NOT_APPLICABLE";
    detail: string;
  }>;
  observation: Readonly<{
    verdict: "OBSERVED" | "NOT_OBSERVED" | "NOT_APPLICABLE";
    detail: string;
  }>;
}>;
