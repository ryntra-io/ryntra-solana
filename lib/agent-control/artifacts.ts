import { z } from "zod";

import { EvidenceItemSchema, PolicyResultSchema } from "../guard/contracts.ts";
import { AGENT_HASH_DOMAINS_V2, hashAgentPayloadV2 } from "./canonical.ts";
import { AgentControlPolicySchema } from "./contracts.ts";
import {
  AGENT_ACTION_CLASSES,
  AGENT_BUDGET_RULES,
  RegistryPinSchema,
} from "./registry.ts";

/**
 * The v2 artifact model: three distinct types instead of one.
 *
 * v1 shipped a single `ActionPassportPreview` with the intent, the policy, the
 * authorization, the execution state and the outcome nested inside it. That
 * conflated three things with different lifetimes and different truth
 * conditions — what an agent *is*, what was *proposed*, and what actually
 * *happened* — so the one type had to carry `OUTCOME_NOT_OBSERVED` forever,
 * and an outcome could only ever be a field that says there isn't one.
 *
 * Three types split them:
 *
 * - `AgentPassport` — a read subject. What is known about an agent.
 * - `ActionPassport` — a proposal. What was asked for, and what policy said.
 * - `OutcomeReceipt` — an observation. What a chain or provider was seen to do.
 *
 * The consequence that matters is the third one. An `OutcomeReceipt` cannot be
 * constructed without an observed outcome, so "no outcome" is the *absence of
 * a receipt* rather than a receipt that says nothing. Nothing in this
 * repository observes an outcome, so it produces no `OutcomeReceipt` at all —
 * which is exactly the honest state, and the first one comes from the first
 * action that actually executes.
 *
 * Every type carries the same three-axis proof envelope, and the axes are never
 * collapsed into one verdict:
 *
 * 1. **Issuer signature** — Ryntra states that it produced these exact bytes.
 * 2. **Authorization proof** — a human authorized this exact artifact.
 * 3. **Observation** — an independent source was read and reconciled.
 *
 * A signed artifact with no authorization is a perfectly valid artifact that
 * simply has not been authorized, and a verifier says so rather than failing.
 */

const timestamp = z.string().datetime({ offset: true });
const HEX_HASH = /^0x[0-9a-f]{64}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const CAIP2 = /^[a-z0-9-]+:[A-Za-z0-9-]+$/;
const DECIMAL_STRING = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

export const AGENT_ARTIFACT_KINDS = [
  "AGENT_PASSPORT",
  "ACTION_PASSPORT",
  "OUTCOME_RECEIPT",
] as const;

export type AgentArtifactKind = (typeof AGENT_ARTIFACT_KINDS)[number];

export const ARTIFACT_HASH_DOMAIN_BY_KIND = {
  AGENT_PASSPORT: AGENT_HASH_DOMAINS_V2.agentPassport,
  ACTION_PASSPORT: AGENT_HASH_DOMAINS_V2.actionPassport,
  OUTCOME_RECEIPT: AGENT_HASH_DOMAINS_V2.outcomeReceipt,
} as const;

/* -------------------------------------------------------------------------- */
/* Axis 1 — the issuer signature                                              */
/* -------------------------------------------------------------------------- */

export const ISSUER_UNSIGNED_REASONS = [
  "NO_ISSUER_KEY_CONFIGURED",
  "ISSUER_KEY_UNAVAILABLE",
  "SIGNING_NOT_REQUESTED",
] as const;

/**
 * Signed or explicitly unsigned, never absent and never fabricated.
 *
 * The unsigned branch exists because the alternative shapes are both worse: an
 * optional field reads as "we forgot", and a placeholder signature is a lie a
 * verifier would have to be told to ignore. An artifact produced with no key
 * configured says so, names why, and verifies as *unsigned* rather than as
 * valid.
 */
export const IssuerAttestationSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("SIGNED"),
      algorithm: z.literal("Ed25519"),
      keyId: z.string().min(3).max(128),
      publicKey: z.string().regex(BASE64).min(32).max(128),
      signature: z.string().regex(BASE64).min(64).max(256),
      signedAt: timestamp,
    })
    .strict(),
  z
    .object({
      status: z.literal("UNSIGNED"),
      reasonCode: z.enum(ISSUER_UNSIGNED_REASONS),
      keyId: z.null(),
      publicKey: z.null(),
      signature: z.null(),
      signedAt: z.null(),
    })
    .strict(),
]);

export type IssuerAttestation = z.output<typeof IssuerAttestationSchema>;

export const UNSIGNED_ATTESTATION: IssuerAttestation = Object.freeze({
  status: "UNSIGNED",
  reasonCode: "NO_ISSUER_KEY_CONFIGURED",
  keyId: null,
  publicKey: null,
  signature: null,
  signedAt: null,
});

/* -------------------------------------------------------------------------- */
/* Axis 2 — the human authorization proof                                     */
/* -------------------------------------------------------------------------- */

/**
 * Defined here, required nowhere.
 *
 * The first real authorization fills the `PRESENT` branch with an EIP-712
 * wallet signature over the exact `contentHash`. It is defined a release early
 * so the artifact bytes do not have to change again when a real authorization
 * arrives — which is the whole point of freezing the serialization first.
 *
 * The demo acknowledgement has no way into this type. It lives on the
 * `ActionPassport` in its own field, carries `demoOnly: true`, and the schema
 * below refuses an artifact that tries to present one as a proof.
 */
export const AuthorizationProofSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("NOT_PRESENT"),
      reasonCode: z.enum(["NOT_REQUESTED", "NOT_SUPPORTED_IN_THIS_RELEASE"]),
    })
    .strict(),
  z
    .object({
      status: z.literal("PRESENT"),
      method: z.literal("EIP712"),
      subjectRef: z.string().min(1).max(256),
      contentHash: z.string().regex(HEX_HASH),
      nonce: z.string().min(8).max(128),
      expiresAt: timestamp,
      signature: z.string().min(64).max(512),
    })
    .strict(),
]);

export type AuthorizationProof = z.output<typeof AuthorizationProofSchema>;

export const NO_AUTHORIZATION_PROOF: AuthorizationProof = Object.freeze({
  status: "NOT_PRESENT",
  reasonCode: "NOT_SUPPORTED_IN_THIS_RELEASE",
});

/**
 * The demo acknowledgement, kept as its own type so it can never be read as
 * axis 2. `demoOnly` is a literal `true`: there is no value of this type that
 * describes a real authorization, so `RECORDED_DEMO_ONLY` cannot be promoted by
 * any assignment, cast or spread.
 */
export const DemoAcknowledgementSchema = z
  .object({
    status: z.enum(["NOT_RECORDED", "RECORDED_DEMO_ONLY"]),
    demoOnly: z.literal(true),
    subjectRef: z.string().min(1).max(256).nullable(),
    /**
     * What was acknowledged. It binds the *intent*, not the artifact: the
     * artifact's own `contentHash` covers this block, so binding it here would
     * be circular and unsatisfiable.
     */
    intentHash: z.string().regex(HEX_HASH).nullable(),
    recordedAt: timestamp.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    const bound = [value.subjectRef, value.intentHash, value.recordedAt];
    const shouldBeBound = value.status === "RECORDED_DEMO_ONLY";
    if (bound.some((entry) => (shouldBeBound ? entry === null : entry !== null))) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: shouldBeBound
          ? "A recorded demo acknowledgement must bind the artifact it acknowledges."
          : "An unrecorded acknowledgement cannot carry bindings.",
      });
    }
  });

export type DemoAcknowledgement = z.output<typeof DemoAcknowledgementSchema>;

/* -------------------------------------------------------------------------- */
/* Axis 3 — the observation                                                   */
/* -------------------------------------------------------------------------- */

/**
 * An observed effect. Every field is required, because an observation with an
 * unknown source is not an observation.
 */
export const ObservedEffectSchema = z
  .object({
    description: z.string().min(1).max(512),
    sourceRef: z.string().min(1).max(512),
    observedAt: timestamp,
  })
  .strict();

export const ObservedOutcomeSchema = z
  .object({
    status: z.enum(["MATCHED", "DEVIATION_RECORDED", "FAILED"]),
    chainRef: z.string().regex(CAIP2),
    transactionHash: z.string().min(3).max(256),
    observedEffects: z.array(ObservedEffectSchema).min(1).max(64),
    reconciledAt: timestamp,
  })
  .strict();

export type ObservedOutcome = z.output<typeof ObservedOutcomeSchema>;

/* -------------------------------------------------------------------------- */
/* The v2 intent — registry-backed, no closed enums                           */
/* -------------------------------------------------------------------------- */

export const AgentActionIntentV2Schema = z
  .object({
    schemaVersion: z.literal("2.0.0"),
    id: z.string().min(3).max(128),
    source: z
      .object({
        /** A registry reference, not one of five literals. */
        ref: z.string().min(3).max(128),
        agentId: z.string().min(1).max(256),
        agentName: z.string().min(1).max(128).nullable(),
        requestId: z.string().min(1).max(256),
      })
      .strict(),
    subjectRef: z.string().min(1).max(256),
    requestText: z.string().min(1).max(2_000),
    action: z
      .object({
        /** Layer one: the closed class a verifier can read without the registry. */
        canonicalClass: z.enum(AGENT_ACTION_CLASSES),
        /** Layer two: the provider-scoped subtype, resolved through the registry. */
        ref: z.string().min(3).max(128),
        budgetRule: z.enum(AGENT_BUDGET_RULES),
        chainRef: z.string().regex(CAIP2),
        jobType: z.string().min(1).max(128),
        deliverable: z.string().min(1).max(1_000),
        budget: z
          .object({
            amount: z.string().regex(DECIMAL_STRING).max(128),
            assetRef: z.string().min(3).max(256),
          })
          .strict()
          .nullable(),
        providerRef: z.string().min(1).max(256).nullable(),
        evaluatorRef: z.string().min(1).max(256).nullable(),
        deadline: timestamp,
        expectedEffects: z.array(z.string().min(1).max(512)).min(1).max(32),
      })
      .strict(),
    policyRef: z
      .object({ id: z.string().min(1).max(128), version: z.number().int().positive() })
      .strict(),
    evidenceRequirements: z.array(z.string().min(1).max(128)).min(1).max(32),
    humanAuthorizationRequired: z.literal(true),
    createdAt: timestamp,
    expiresAt: timestamp,
    revision: z.number().int().positive(),
    idempotencyKey: z.string().min(8).max(256),
  })
  .strict()
  .superRefine((value, context) => {
    if (Date.parse(value.expiresAt) <= Date.parse(value.createdAt)) {
      context.addIssue({ code: "custom", path: ["expiresAt"], message: "Intent expiry must be after creation." });
    }
    if (Date.parse(value.action.deadline) > Date.parse(value.expiresAt)) {
      context.addIssue({
        code: "custom",
        path: ["action", "deadline"],
        message: "The job deadline cannot outlive the intent.",
      });
    }
    if (Date.parse(value.action.deadline) <= Date.parse(value.createdAt)) {
      context.addIssue({
        code: "custom",
        path: ["action", "deadline"],
        message: "The job deadline must be after intent creation.",
      });
    }
    /* The budget rule is registry data now, so the two branches `contracts.ts`
       hard-coded become one comparison that any future subtype inherits. */
    if (value.action.budgetRule === "FORBIDDEN" && value.action.budget !== null) {
      context.addIssue({
        code: "custom",
        path: ["action", "budget"],
        message: "This action class moves no value and therefore carries no budget.",
      });
    }
    if (value.action.budgetRule === "REQUIRED" && value.action.budget === null) {
      context.addIssue({
        code: "custom",
        path: ["action", "budget"],
        message: "This action commits value and must name an exact amount and asset.",
      });
    }
  });

export type AgentActionIntentV2 = z.output<typeof AgentActionIntentV2Schema>;

/* -------------------------------------------------------------------------- */
/* The three artifacts                                                        */
/* -------------------------------------------------------------------------- */

const envelope = {
  schemaVersion: z.literal("2.0.0"),
  id: z.string().min(3).max(128),
  createdAt: timestamp,
  registry: RegistryPinSchema,
  /** Covers everything except the issuer block and the integrity block. */
  contentHash: z.string().regex(HEX_HASH),
  issuer: IssuerAttestationSchema,
  integrity: z
    .object({ algorithm: z.literal("SHA-256"), hash: z.string().regex(HEX_HASH) })
    .strict(),
};

export const AGENT_PASSPORT_V2_LIMITATIONS = [
  "AGENT PASSPORT — READ ONLY",
  "Every fact is what a named source returned when it was read, not a Ryntra assessment.",
  "An issuer-declared field is the subject describing itself and is unverified.",
] as const;

export const AgentPassportArtifactSchema = z
  .object({
    ...envelope,
    kind: z.literal("AGENT_PASSPORT"),
    maturity: z.literal("READ_ONLY"),
    subjectRef: z.string().min(1).max(256),
    /** The existing read-only passport body, carried whole rather than re-modelled. */
    body: z.unknown(),
    bodyHash: z.string().regex(HEX_HASH),
    limitations: z.tuple([
      z.literal(AGENT_PASSPORT_V2_LIMITATIONS[0]),
      z.literal(AGENT_PASSPORT_V2_LIMITATIONS[1]),
      z.literal(AGENT_PASSPORT_V2_LIMITATIONS[2]),
    ]),
  })
  .strict();

export const ACTION_PASSPORT_V2_LIMITATIONS = [
  "ACTION PASSPORT — A PROPOSAL, NOT AN OUTCOME",
  "No provider action, wallet signature or transaction was submitted.",
  "An outcome is a separate artifact and none exists for this proposal.",
  "External Agentverse, Agent Launch, ERC-8183 and BNB capabilities are not Ryntra maturity.",
] as const;

export const ActionPassportArtifactSchema = z
  .object({
    ...envelope,
    kind: z.literal("ACTION_PASSPORT"),
    maturity: z.literal("SOURCE_PREVIEW"),
    intent: AgentActionIntentV2Schema,
    intentHash: z.string().regex(HEX_HASH),
    evidence: z
      .object({ items: z.array(EvidenceItemSchema).min(1).max(16), root: z.string().regex(HEX_HASH) })
      .strict(),
    policy: z
      .object({ definition: AgentControlPolicySchema, result: PolicyResultSchema })
      .strict(),
    /** Axis 2, and the demo acknowledgement that is deliberately not axis 2. */
    authorizationProof: AuthorizationProofSchema,
    demoAcknowledgement: DemoAcknowledgementSchema,
    execution: z
      .object({
        status: z.literal("UNAVAILABLE"),
        reasonCode: z.enum([
          "SOURCE_PREVIEW_ONLY",
          "NO_PROVIDER_SIGNER",
          "NO_WALLET_AUTHORIZATION",
          "EXTERNAL_CONTRACT_UNVERIFIED",
        ]),
      })
      .strict(),
    limitations: z.tuple([
      z.literal(ACTION_PASSPORT_V2_LIMITATIONS[0]),
      z.literal(ACTION_PASSPORT_V2_LIMITATIONS[1]),
      z.literal(ACTION_PASSPORT_V2_LIMITATIONS[2]),
      z.literal(ACTION_PASSPORT_V2_LIMITATIONS[3]),
    ]),
  })
  .strict()
  .superRefine((value, context) => {
    /* The promotion this model exists to refuse, asserted rather than assumed:
       a recorded demo acknowledgement may never coincide with a present
       authorization proof, because the two would then be read as corroborating
       each other. */
    if (
      value.demoAcknowledgement.status === "RECORDED_DEMO_ONLY" &&
      value.authorizationProof.status === "PRESENT"
    ) {
      context.addIssue({
        code: "custom",
        path: ["authorizationProof"],
        message: "A demo acknowledgement is never an authorization; the two cannot both be present.",
      });
    }
    if (
      value.demoAcknowledgement.status === "RECORDED_DEMO_ONLY" &&
      value.demoAcknowledgement.intentHash !== value.intentHash
    ) {
      context.addIssue({
        code: "custom",
        path: ["demoAcknowledgement", "intentHash"],
        message: "A recorded acknowledgement must bind the intent it was recorded against.",
      });
    }
  });

export const LEGACY_OUTCOME_RECEIPT_LIMITATIONS = [
  "OUTCOME RECEIPT — AN OBSERVATION, NOT AN INSTRUCTION",
  "Ryntra observed and reconciled this outcome; it did not sign, submit, fund or execute it.",
] as const;

export const OUTCOME_RECEIPT_LIMITATIONS = [
  "OUTCOME RECEIPT — AN OBSERVATION, NOT AN INSTRUCTION",
  "Ryntra observed and reconciled this outcome. The wallet supplied any required signature; submission responsibility is stated by the receipt's bound action path.",
] as const;

export const OutcomeReceiptArtifactSchema = z
  .object({
    ...envelope,
    kind: z.literal("OUTCOME_RECEIPT"),
    maturity: z.literal("OBSERVED"),
    /**
     * The exact pre-action evidence digest this outcome answers.
     *
     * The legacy wire name is retained for v2 compatibility. A Solana Swap
     * receipt binds the issuer-signed SwapExecutionProof digest here; the
     * field alone is not an Agent Control human-authorization proof.
     */
    actionPassportHash: z.string().regex(HEX_HASH),
    outcome: ObservedOutcomeSchema,
    limitations: z.union([
      z.tuple([
        z.literal(OUTCOME_RECEIPT_LIMITATIONS[0]),
        z.literal(OUTCOME_RECEIPT_LIMITATIONS[1]),
      ]),
      z.tuple([
        z.literal(LEGACY_OUTCOME_RECEIPT_LIMITATIONS[0]),
        z.literal(LEGACY_OUTCOME_RECEIPT_LIMITATIONS[1]),
      ]),
    ]),
  })
  .strict();

export const AgentArtifactSchema = z.discriminatedUnion("kind", [
  AgentPassportArtifactSchema,
  ActionPassportArtifactSchema,
  OutcomeReceiptArtifactSchema,
]);

export type AgentPassportArtifact = z.output<typeof AgentPassportArtifactSchema>;
export type ActionPassportArtifact = z.output<typeof ActionPassportArtifactSchema>;
export type OutcomeReceiptArtifact = z.output<typeof OutcomeReceiptArtifactSchema>;
export type AgentArtifact = z.output<typeof AgentArtifactSchema>;

/* -------------------------------------------------------------------------- */
/* Sealing                                                                    */
/* -------------------------------------------------------------------------- */

type Sealable = Record<string, unknown> & { kind: AgentArtifactKind };

type Sealed<T> = T & {
  contentHash: string;
  issuer: IssuerAttestation;
  integrity: { algorithm: "SHA-256"; hash: string };
};

/**
 * Compute `contentHash` and `integrity` for an artifact body.
 *
 * **`contentHash` covers the content and nothing else.** Both proof axes —
 * the issuer signature and the human authorization — attach to it from the
 * outside and are excluded from it, for a reason that is easy to get wrong:
 * a proof is a statement *about* a hash, so a hash that covered the proof
 * could never be the hash the proof was made over. The first draft of this
 * function put the demo acknowledgement's binding inside the hash it was
 * bound to, which is unsatisfiable by construction.
 *
 * The practical consequence is the useful one. An unsigned artifact and the
 * same artifact signed an hour later carry the identical `contentHash`, so a
 * signature can be added, checked or stripped without touching the content —
 * which is what makes the three axes independent instead of entangled.
 *
 * `integrity` is the outer seal and does cover everything, including the
 * issuer block, so a signature cannot be swapped after the fact unnoticed.
 */
export function sealArtifact<T extends Sealable>(
  core: T,
  issuer: IssuerAttestation,
  authorizationProof?: AuthorizationProof,
): Sealed<T> & { authorizationProof?: AuthorizationProof } {
  const domain = ARTIFACT_HASH_DOMAIN_BY_KIND[core.kind];
  const contentHash = hashAgentPayloadV2(domain, core);
  const attached = {
    ...core,
    contentHash,
    issuer,
    ...(authorizationProof ? { authorizationProof } : {}),
  };
  return {
    ...attached,
    integrity: {
      algorithm: "SHA-256" as const,
      hash: hashAgentPayloadV2(AGENT_HASH_DOMAINS_V2.integrity, attached),
    },
  } as Sealed<T> & { authorizationProof?: AuthorizationProof };
}

/** The bytes an issuer signature covers: the content hash under its own domain. */
export function issuerSigningPayload(kind: AgentArtifactKind, contentHash: string): {
  kind: AgentArtifactKind;
  contentHash: string;
} {
  return { kind, contentHash };
}

/**
 * Build an `OutcomeReceipt`.
 *
 * The observation is a required parameter of a non-nullable type, and the
 * schema requires at least one observed effect with a named source. There is no
 * argument list that produces an empty receipt, which is the acceptance
 * criterion for this type: with nothing observed, the correct artifact is no
 * artifact.
 */
export function createOutcomeReceipt({
  id,
  actionPassportHash,
  outcome,
  registry,
  issuer = UNSIGNED_ATTESTATION,
  now = new Date(),
}: {
  id: string;
  actionPassportHash: string;
  outcome: ObservedOutcome;
  registry: z.output<typeof RegistryPinSchema>;
  issuer?: IssuerAttestation;
  now?: Date;
}): OutcomeReceiptArtifact {
  const observed = ObservedOutcomeSchema.parse(outcome);
  return OutcomeReceiptArtifactSchema.parse(
    sealArtifact(
      {
        schemaVersion: "2.0.0" as const,
        kind: "OUTCOME_RECEIPT" as const,
        id,
        createdAt: now.toISOString(),
        maturity: "OBSERVED" as const,
        registry,
        actionPassportHash,
        outcome: observed,
        limitations: OUTCOME_RECEIPT_LIMITATIONS,
      },
      issuer,
    ),
  );
}
