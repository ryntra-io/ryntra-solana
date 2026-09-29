/**
 * Reading an Outcome Receipt without asking the issuer whether it is real.
 *
 * A receipt whose only verifier is the party that wrote it proves nothing, so
 * this module is deliberately the *bounded* half of `lib/agent-control/verify.ts`:
 * everything a stranger needs to check a Solana receipt offline, and nothing
 * that would drag Guard's private money-path contracts into a public kit.
 *
 * The two things that must never be re-implemented are not re-implemented.
 * Canonicalization comes from `lib/guard/canonical-json.ts` and the frozen v2
 * hash domains come from `lib/agent-control/canonical.ts` — the same bytes the
 * issuer signed, by import rather than by imitation. What *is* stated twice is
 * the receipt's shape and the issuer-axis ladder, because the authoritative
 * ones live behind that heavy import chain; `receipt.test.mjs` mints a real
 * signed receipt through `createOutcomeReceipt` and fails the moment the two
 * readings disagree on any axis, clean or tampered.
 *
 * Four axes, reported separately and never merged into one word:
 *
 * - **schema** — is this the shape of an Outcome Receipt at all;
 * - **integrity** — do both hashes recompute over these exact bytes;
 * - **issuer** — is the Ed25519 signature sound, and separately, is the key one
 *   the reader trusts. "Signed by someone" is not "signed by Ryntra";
 * - **binding** — does the receipt's registry pin name the Solana adapter. A
 *   perfectly valid BNB receipt is a valid receipt and is not a Solana one.
 */

import { createHash, createPublicKey, verify as verifyBytes } from "node:crypto";
import { z } from "zod";

import {
  SOLANA_CAIP2,
  SOLANA_TOKEN_2022_ADAPTER_REF,
  SPL_TRANSFER_ACTION_REF,
} from "../agent-control/adapters/solana-token-2022.ts";
import {
  JUPITER_SWAP_ACTION_REF,
  JUPITER_SWAP_ADAPTER_REF,
  JUPITER_SWAP_ADOPTED_RPC_ACTION_REF,
  JUPITER_SWAP_UNKNOWN_SUBMISSION_ACTION_REF,
} from "../agent-control/adapters/jupiter-swap.ts";
import { AGENT_HASH_DOMAINS_V2, agentCanonicalPreimage, hashAgentPayloadV2 } from "../agent-control/canonical.ts";
import { correctionForReceipt, type ReceiptCorrection } from "./receipt-corrections.ts";

const HEX_HASH = /^0x[0-9a-f]{64}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const timestamp = z.string().datetime({ offset: true });

/** Historical v2.0 receipt copy retained so already signed bytes still parse. */
export const LEGACY_SOLANA_RECEIPT_LIMITATIONS = [
  "OUTCOME RECEIPT — AN OBSERVATION, NOT AN INSTRUCTION",
  "Ryntra observed and reconciled this outcome; it did not sign, submit, fund or execute it.",
] as const;

/** The current neutral limitation: submitter truth comes from the action pin. */
export const SOLANA_RECEIPT_LIMITATIONS = [
  "OUTCOME RECEIPT — AN OBSERVATION, NOT AN INSTRUCTION",
  "Ryntra observed and reconciled this outcome. The wallet supplied any required signature; submission responsibility is stated by the receipt's bound action path.",
] as const;

const IssuerAttestationShape = z.discriminatedUnion("status", [
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
      reasonCode: z.enum(["NO_ISSUER_KEY_CONFIGURED", "ISSUER_KEY_UNAVAILABLE", "SIGNING_NOT_REQUESTED"]),
      keyId: z.null(),
      publicKey: z.null(),
      signature: z.null(),
      signedAt: z.null(),
    })
    .strict(),
]);

/**
 * The bounded Outcome Receipt shape.
 *
 * Kept strict for the same reason the authoritative schema is: an unknown
 * field in an artifact whose hash covers every field is not a harmless extra,
 * it is a receipt whose hash cannot recompute.
 */
export const SolanaOutcomeReceiptSchema = z
  .object({
    schemaVersion: z.literal("2.0.0"),
    kind: z.literal("OUTCOME_RECEIPT"),
    id: z.string().min(3).max(128),
    createdAt: timestamp,
    maturity: z.literal("OBSERVED"),
    registry: z
      .object({
        registryDigest: z.string().regex(HEX_HASH),
        refs: z
          .array(z.object({ ref: z.string().min(3).max(128), contentHash: z.string().regex(HEX_HASH) }).strict())
          .min(1)
          .max(16),
      })
      .strict(),
    actionPassportHash: z.string().regex(HEX_HASH),
    outcome: z
      .object({
        status: z.enum(["MATCHED", "DEVIATION_RECORDED", "FAILED"]),
        chainRef: z.string().min(3).max(128),
        transactionHash: z.string().min(3).max(256),
        observedEffects: z
          .array(
            z
              .object({
                description: z.string().min(1).max(512),
                sourceRef: z.string().min(1).max(512),
                observedAt: timestamp,
              })
              .strict(),
          )
          .min(1)
          .max(64),
        reconciledAt: timestamp,
      })
      .strict(),
    limitations: z.union([
      z.tuple([
        z.literal(SOLANA_RECEIPT_LIMITATIONS[0]),
        z.literal(SOLANA_RECEIPT_LIMITATIONS[1]),
      ]),
      z.tuple([
        z.literal(LEGACY_SOLANA_RECEIPT_LIMITATIONS[0]),
        z.literal(LEGACY_SOLANA_RECEIPT_LIMITATIONS[1]),
      ]),
    ]),
    contentHash: z.string().regex(HEX_HASH),
    issuer: IssuerAttestationShape,
    integrity: z.object({ algorithm: z.literal("SHA-256"), hash: z.string().regex(HEX_HASH) }).strict(),
  })
  .strict();

export type SolanaOutcomeReceipt = z.output<typeof SolanaOutcomeReceiptSchema>;

export const SOLANA_RECEIPT_ISSUER_VERDICTS = [
  "SIGNATURE_VALID",
  "SIGNATURE_INVALID",
  "UNSIGNED",
  "UNTRUSTED_KEY",
] as const;
export type SolanaReceiptIssuerVerdict = (typeof SOLANA_RECEIPT_ISSUER_VERDICTS)[number];

export const SOLANA_RECEIPT_BINDING_VERDICTS = [
  "SOLANA_PINNED",
  "SOLANA_PINNED_WITH_PROVENANCE_MISMATCH",
  "NOT_SOLANA",
  "UNREADABLE",
] as const;
export type SolanaReceiptBindingVerdict = (typeof SOLANA_RECEIPT_BINDING_VERDICTS)[number];

export type SolanaReceiptVerification = Readonly<{
  recognised: boolean;
  kind: "OUTCOME_RECEIPT" | null;
  schemaVersion: string | null;
  schema: Readonly<{ valid: boolean; issues: readonly string[] }>;
  /** Both hashes recomputed from the receipt's own bytes. */
  integrity: Readonly<{ valid: boolean; issues: readonly string[] }>;
  issuer: Readonly<{ verdict: SolanaReceiptIssuerVerdict; keyId: string | null; detail: string }>;
  binding: Readonly<{ verdict: SolanaReceiptBindingVerdict; detail: string; refs: readonly string[] }>;
  correction: ReceiptCorrection | null;
  /** A plain reading of what was observed. Null when the shape failed. */
  outcome: Readonly<{
    status: "MATCHED" | "DEVIATION_RECORDED" | "FAILED";
    chainRef: string;
    network: "mainnet" | "devnet" | null;
    transactionHash: string;
    observedEffects: number;
    reconciledAt: string;
  }> | null;
}>;

const UNRECOGNISED: SolanaReceiptVerification = Object.freeze({
  recognised: false,
  kind: null,
  schemaVersion: null,
  schema: Object.freeze({ valid: false, issues: Object.freeze(["UNRECOGNISED_ARTIFACT"]) }),
  integrity: Object.freeze({ valid: false, issues: Object.freeze(["UNRECOGNISED_ARTIFACT"]) }),
  issuer: Object.freeze({ verdict: "UNSIGNED" as const, keyId: null, detail: "no receipt to check" }),
  binding: Object.freeze({
    verdict: "UNREADABLE" as const,
    detail: "no receipt to read a registry pin from",
    refs: Object.freeze([]),
  }),
  correction: null,
  outcome: null,
});

/** The key id the issuer derives from its own public key, re-derived here. */
function derivedKeyId(publicKeyBase64: string): string {
  return `ryntra-issuer-${createHash("sha256").update(publicKeyBase64, "utf8").digest("hex").slice(0, 16)}`;
}

function checkIntegrity(receipt: SolanaOutcomeReceipt): string[] {
  const issues: string[] = [];
  const { integrity, contentHash, issuer, ...core } = receipt;

  if (contentHash !== hashAgentPayloadV2(AGENT_HASH_DOMAINS_V2.outcomeReceipt, core)) {
    issues.push("CONTENT_HASH_MISMATCH");
  }
  const attached = { ...core, contentHash, issuer };
  if (integrity.hash !== hashAgentPayloadV2(AGENT_HASH_DOMAINS_V2.integrity, attached)) {
    issues.push("INTEGRITY_HASH_MISMATCH");
  }
  return issues;
}

function checkIssuer(
  receipt: SolanaOutcomeReceipt,
  trustedPublicKeys?: readonly string[],
): SolanaReceiptVerification["issuer"] {
  const attestation = receipt.issuer;
  if (attestation.status === "UNSIGNED") {
    return { verdict: "UNSIGNED", keyId: null, detail: attestation.reasonCode };
  }

  /* The exact bytes the issuer signed: the frozen signature domain over the
     canonical {kind, contentHash} payload. Imported, never re-derived. */
  const signed = Buffer.from(
    agentCanonicalPreimage(AGENT_HASH_DOMAINS_V2.issuerSignature, {
      kind: receipt.kind,
      contentHash: receipt.contentHash,
    }),
    "utf8",
  );

  let valid = false;
  try {
    valid = verifyBytes(
      null,
      signed,
      createPublicKey({ key: Buffer.from(attestation.publicKey, "base64"), format: "der", type: "spki" }),
      Buffer.from(attestation.signature, "base64"),
    );
  } catch {
    return { verdict: "SIGNATURE_INVALID", keyId: attestation.keyId, detail: "UNREADABLE_KEY_OR_SIGNATURE" };
  }

  if (!valid) {
    return {
      verdict: "SIGNATURE_INVALID",
      keyId: attestation.keyId,
      detail: "the signature does not cover this artifact's content hash",
    };
  }
  if (attestation.keyId !== derivedKeyId(attestation.publicKey)) {
    return {
      verdict: "SIGNATURE_INVALID",
      keyId: attestation.keyId,
      detail: "the key id does not derive from the key it names",
    };
  }
  if (trustedPublicKeys && !trustedPublicKeys.includes(attestation.publicKey)) {
    return {
      verdict: "UNTRUSTED_KEY",
      keyId: attestation.keyId,
      detail: "the signature is valid but the key is not one this verifier publishes",
    };
  }
  return { verdict: "SIGNATURE_VALID", keyId: attestation.keyId, detail: "signed by the named issuer key" };
}

function checkBinding(receipt: SolanaOutcomeReceipt): SolanaReceiptVerification["binding"] {
  const refs = receipt.registry.refs.map((entry) => entry.ref);
  const hasTokenAdapter = refs.includes(SOLANA_TOKEN_2022_ADAPTER_REF);
  const hasJupiterAdapter = refs.includes(JUPITER_SWAP_ADAPTER_REF);
  const hasAction = refs.includes(SPL_TRANSFER_ACTION_REF);
  const correction = correctionForReceipt(receipt);
  if (correction) {
    return {
      verdict: "SOLANA_PINNED_WITH_PROVENANCE_MISMATCH",
      detail: `${correction.codes.join(", ")}. The original signed receipt remains immutable; correction ${correction.correctionHash} binds its exact hashes and adopted RPC lane.`,
      refs,
    };
  }
  if (!hasTokenAdapter && !hasJupiterAdapter) {
    return {
      verdict: "NOT_SOLANA",
      detail: `The receipt pins ${refs.join(", ")} and none is ${SOLANA_TOKEN_2022_ADAPTER_REF} or ${JUPITER_SWAP_ADAPTER_REF}; this is a valid receipt for something else.`,
      refs,
    };
  }
  if (hasJupiterAdapter) {
    const action = [
      JUPITER_SWAP_ACTION_REF,
      JUPITER_SWAP_ADOPTED_RPC_ACTION_REF,
      JUPITER_SWAP_UNKNOWN_SUBMISSION_ACTION_REF,
    ].find((ref) => refs.includes(ref));
    return {
      verdict: "SOLANA_PINNED",
      detail: action
        ? `The receipt pins ${JUPITER_SWAP_ADAPTER_REF} and ${action}.`
        : `The receipt pins ${JUPITER_SWAP_ADAPTER_REF}; no supported Jupiter submission action is pinned alongside it.`,
      refs,
    };
  }
  return {
    verdict: "SOLANA_PINNED",
    detail: hasAction
      ? `The receipt pins ${SOLANA_TOKEN_2022_ADAPTER_REF} and ${SPL_TRANSFER_ACTION_REF}.`
      : `The receipt pins ${SOLANA_TOKEN_2022_ADAPTER_REF}; no SPL transfer action is pinned alongside it.`,
    refs,
  };
}

function networkOf(chainRef: string): "mainnet" | "devnet" | null {
  if (chainRef === SOLANA_CAIP2.mainnet) return "mainnet";
  if (chainRef === SOLANA_CAIP2.devnet) return "devnet";
  return null;
}

/**
 * Verify one Solana Outcome Receipt, offline.
 *
 * Never throws and never returns a single word: a caller gets four axes and
 * decides what its own threshold is. `trustedPublicKeys` narrows the issuer
 * axis from "this signature is sound" to "this signature is one of these
 * keys'"; omitting it is the weaker check and the axis detail says so instead
 * of quietly implying the stronger one.
 */
export function verifySolanaOutcomeReceipt(
  value: unknown,
  options: Readonly<{ trustedPublicKeys?: readonly string[] }> = {},
): SolanaReceiptVerification {
  const kind = (value as { kind?: unknown } | null)?.kind;
  if (kind !== "OUTCOME_RECEIPT") return UNRECOGNISED;

  const parsed = SolanaOutcomeReceiptSchema.safeParse(value);
  if (!parsed.success) {
    return {
      ...UNRECOGNISED,
      recognised: true,
      kind: "OUTCOME_RECEIPT",
      schemaVersion: typeof (value as { schemaVersion?: unknown }).schemaVersion === "string"
        ? (value as { schemaVersion: string }).schemaVersion
        : null,
      schema: {
        valid: false,
        issues: parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
      },
      integrity: { valid: false, issues: ["SCHEMA_INVALID"] },
      issuer: { verdict: "UNSIGNED", keyId: null, detail: "the receipt's shape failed before any signature was read" },
      binding: { verdict: "UNREADABLE", detail: "the receipt's shape failed before its registry pin was read", refs: [] },
    };
  }

  const receipt = parsed.data;
  const integrityIssues = checkIntegrity(receipt);
  return Object.freeze({
    recognised: true,
    kind: "OUTCOME_RECEIPT" as const,
    schemaVersion: receipt.schemaVersion,
    schema: Object.freeze({ valid: true, issues: Object.freeze([]) }),
    integrity: Object.freeze({ valid: integrityIssues.length === 0, issues: Object.freeze(integrityIssues) }),
    issuer: Object.freeze(checkIssuer(receipt, options.trustedPublicKeys)),
    binding: Object.freeze(checkBinding(receipt)),
    correction: correctionForReceipt(receipt),
    outcome: Object.freeze({
      status: receipt.outcome.status,
      chainRef: receipt.outcome.chainRef,
      network: networkOf(receipt.outcome.chainRef),
      transactionHash: receipt.outcome.transactionHash,
      observedEffects: receipt.outcome.observedEffects.length,
      reconciledAt: receipt.outcome.reconciledAt,
    }),
  });
}
