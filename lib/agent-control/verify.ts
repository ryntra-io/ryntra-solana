import { AGENT_HASH_DOMAINS_V2, hashAgentPayloadV2 } from "./canonical.ts";
import { verifyActionPassportPreview } from "./core.ts";
import { verifyIssuerAttestation, type IssuerAxisResult } from "./issuer.ts";
import {
  ARTIFACT_HASH_DOMAIN_BY_KIND,
  AgentArtifactSchema,
  UNSIGNED_ATTESTATION,
  type AgentArtifactKind,
} from "./artifacts.ts";

/**
 * The one Artifact Verifier.
 *
 * It dispatches on the artifact's own `kind`, never on a caller-supplied hint,
 * for a reason worth stating: a verifier that is *told* what it is checking can
 * be told wrong, and the caller with the strongest incentive to mislabel an
 * artifact is the one presenting it.
 *
 * **The three proof axes are reported separately and never collapsed.** There
 * is deliberately no single boolean that merges them, because every merge loses
 * the distinction that matters. A valid unsigned artifact and a tampered signed
 * one would both be "false"; a signed artifact with no human authorization and
 * a fully authorized one would both be "true". A reader needs to know which of
 * the three is missing, so all three are returned and none is summarized.
 *
 * `integrity` is not an axis. It is the precondition: it says the bytes are
 * self-consistent. An artifact that fails integrity is not an artifact whose
 * axes are worth reading, and the axes are reported anyway rather than hidden,
 * so a reader can see that the signature was fine and the content was edited.
 */

export const ARTIFACT_VERIFIER_VERSION = "2.0.0" as const;

export type AuthorizationAxisVerdict =
  | "AUTHORIZED"
  | "NOT_AUTHORIZED"
  | "DEMO_ACKNOWLEDGEMENT_ONLY"
  | "NOT_APPLICABLE";

export type ObservationAxisVerdict = "OBSERVED" | "NOT_OBSERVED" | "NOT_APPLICABLE";

export type ArtifactVerification = Readonly<{
  recognised: boolean;
  generation: "v2" | "legacy-1.0.0" | null;
  kind: AgentArtifactKind | "ACTION_PASSPORT_PREVIEW" | null;
  schemaVersion: string | null;
  integrity: Readonly<{ valid: boolean; issues: readonly string[] }>;
  issuer: IssuerAxisResult;
  authorization: Readonly<{ verdict: AuthorizationAxisVerdict; detail: string }>;
  observation: Readonly<{ verdict: ObservationAxisVerdict; detail: string }>;
}>;

const UNRECOGNISED: ArtifactVerification = Object.freeze({
  recognised: false,
  generation: null,
  kind: null,
  schemaVersion: null,
  integrity: Object.freeze({ valid: false, issues: Object.freeze(["UNRECOGNISED_ARTIFACT"]) }),
  issuer: Object.freeze({ verdict: "UNSIGNED" as const, keyId: null, detail: "no artifact to check" }),
  authorization: Object.freeze({ verdict: "NOT_APPLICABLE" as const, detail: "no artifact to check" }),
  observation: Object.freeze({ verdict: "NOT_APPLICABLE" as const, detail: "no artifact to check" }),
});

function looksLikeLegacyPreview(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === "ACTION_PASSPORT_PREVIEW"
  );
}

function verifyLegacy(value: unknown): ArtifactVerification {
  const result = verifyActionPassportPreview(value);
  if (!result.valid && result.verdict === "INVALID" && result.outcomeStatus === null) {
    /* Failed the schema itself: it claimed to be a preview and was not one. */
    return {
      ...UNRECOGNISED,
      kind: "ACTION_PASSPORT_PREVIEW",
      schemaVersion: null,
      integrity: { valid: false, issues: result.issues },
    };
  }
  const authorization = (value as { authorization?: { status?: unknown } }).authorization;
  return Object.freeze({
    recognised: true,
    generation: "legacy-1.0.0" as const,
    kind: "ACTION_PASSPORT_PREVIEW" as const,
    schemaVersion: "1.0.0",
    integrity: Object.freeze({ valid: result.valid, issues: Object.freeze([...result.issues]) }),
    /* v1 predates signing entirely. Reporting it as unsigned is the true
       statement; reporting it as invalid would punish an artifact for being
       old, and reporting it as valid would invent an assurance. */
    issuer: Object.freeze({
      verdict: "UNSIGNED" as const,
      keyId: null,
      detail: "this artifact generation predates issuer signatures",
    }),
    authorization: Object.freeze(
      authorization?.status === "RECORDED_DEMO_ONLY"
        ? {
            verdict: "DEMO_ACKNOWLEDGEMENT_ONLY" as const,
            detail: "a demo acknowledgement was recorded; it is not a human authorization",
          }
        : { verdict: "NOT_AUTHORIZED" as const, detail: "no authorization of any kind is recorded" },
    ),
    observation: Object.freeze({
      verdict: "NOT_OBSERVED" as const,
      detail: "a preview carries no observed outcome",
    }),
  });
}

function checkV2Integrity(artifact: Record<string, unknown>, kind: AgentArtifactKind): string[] {
  const issues: string[] = [];
  const {
    integrity,
    contentHash,
    issuer,
    authorizationProof,
    ...core
  } = artifact as Record<string, unknown> & { integrity: { hash?: unknown } };

  if (contentHash !== hashAgentPayloadV2(ARTIFACT_HASH_DOMAIN_BY_KIND[kind], core)) {
    issues.push("CONTENT_HASH_MISMATCH");
  }

  const attached = {
    ...core,
    contentHash,
    issuer,
    ...(authorizationProof === undefined ? {} : { authorizationProof }),
  };
  if (integrity?.hash !== hashAgentPayloadV2(AGENT_HASH_DOMAINS_V2.integrity, attached)) {
    issues.push("INTEGRITY_HASH_MISMATCH");
  }
  return issues;
}

/**
 * Verify any Agent Control artifact.
 *
 * `trustedPublicKeys` narrows the issuer axis from "this signature is
 * cryptographically sound" to "this signature is Ryntra's". Omitting it is a
 * weaker check and says so in the axis detail rather than pretending otherwise.
 */
export function verifyAgentArtifact(
  value: unknown,
  options: { trustedPublicKeys?: readonly string[] } = {},
): ArtifactVerification {
  if (looksLikeLegacyPreview(value)) return verifyLegacy(value);

  const parsed = AgentArtifactSchema.safeParse(value);
  if (!parsed.success) {
    const kind = (value as { kind?: unknown })?.kind;
    if (typeof kind !== "string" || !(kind in ARTIFACT_HASH_DOMAIN_BY_KIND)) return UNRECOGNISED;
    return {
      ...UNRECOGNISED,
      recognised: true,
      generation: "v2",
      kind: kind as AgentArtifactKind,
      integrity: {
        valid: false,
        issues: parsed.error.issues.map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`),
      },
    };
  }

  const artifact = parsed.data;
  const issues = checkV2Integrity(artifact as unknown as Record<string, unknown>, artifact.kind);

  const issuer = verifyIssuerAttestation({
    kind: artifact.kind,
    contentHash: artifact.contentHash,
    attestation: artifact.issuer ?? UNSIGNED_ATTESTATION,
    trustedPublicKeys: options.trustedPublicKeys,
  });

  let authorization: { verdict: AuthorizationAxisVerdict; detail: string } = {
    verdict: "NOT_APPLICABLE",
    detail: "this artifact kind carries no authorization",
  };
  let observation: { verdict: ObservationAxisVerdict; detail: string } = {
    verdict: "NOT_APPLICABLE",
    detail: "this artifact kind carries no observation",
  };

  if (artifact.kind === "ACTION_PASSPORT") {
    authorization =
      artifact.authorizationProof.status === "PRESENT"
        ? { verdict: "AUTHORIZED", detail: `authorized by ${artifact.authorizationProof.method}` }
        : artifact.demoAcknowledgement.status === "RECORDED_DEMO_ONLY"
          ? {
              verdict: "DEMO_ACKNOWLEDGEMENT_ONLY",
              detail: "a demo acknowledgement was recorded; it is not a human authorization",
            }
          : { verdict: "NOT_AUTHORIZED", detail: artifact.authorizationProof.reasonCode };
    observation = { verdict: "NOT_OBSERVED", detail: "a proposal carries no observed outcome" };
  }

  if (artifact.kind === "OUTCOME_RECEIPT") {
    observation = {
      verdict: "OBSERVED",
      detail: `${artifact.outcome.status} over ${artifact.outcome.observedEffects.length} observed effect(s)`,
    };
  }

  return Object.freeze({
    recognised: true,
    generation: "v2" as const,
    kind: artifact.kind,
    schemaVersion: artifact.schemaVersion,
    integrity: Object.freeze({ valid: issues.length === 0, issues: Object.freeze(issues) }),
    issuer,
    authorization: Object.freeze(authorization),
    observation: Object.freeze(observation),
  });
}
