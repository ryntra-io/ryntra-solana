/**
 * Issuer-bound proof of the exact Swap Execution bundle (RYN-SOL-M2).
 *
 * The quote facts are already hash-bound by the Swap Quote Review. This
 * module binds everything execution adds on top of the quote: the exact
 * provider transaction (by message hash from the pre-sign firewall), the
 * taker, the simulation of those exact bytes, and the swap intent and
 * verdict the product policy produced for them. The browser carries the bundle but
 * cannot rewrite it — the non-wallet Ryntra issuer key signs the canonical
 * form, and the execute route trusts only the currently configured issuer
 * public key. The key cannot authorize or sign a Solana transaction.
 */

import {
  createHash,
  createPublicKey,
  sign as signBytes,
  verify as verifyBytes,
} from "node:crypto";
import { z } from "zod";

import { issuerKeyId, type IssuerKey } from "../agent-control/issuer.ts";
import { canonicalJson } from "../guard/canonical-json.ts";
import { SolanaActionOriginSchema, type SolanaActionOrigin } from "./action-origin.ts";
import { PlanReviewSchema, type PlanReview } from "../api/v1/contract.ts";
import {
  SwapPolicyIntentSchema,
  SwapPolicyVerdictSchema,
  type SwapPolicyIntent,
  type SwapPolicyVerdict,
} from "./swap-policy.ts";
import { SwapQuoteReviewSchema, type SwapQuoteReview } from "./swap-review.ts";
import { SwapOwnerEffectProofSchema } from "./swap-effect-firewall.ts";
import type { SwapTransactionInspection } from "./swap-transaction-check.ts";

const DOMAIN = "ryntra.solana.swap-execution-review@1";
const HEX_HASH = /^0x[0-9a-f]{64}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

export const SwapExecutionInspectionSchema = z
  .object({
    messageHashHex: z.string().regex(SHA256_HEX),
    version: z.literal(0),
    feePayer: z.string().min(32).max(44),
    signerAddresses: z.array(z.string().min(32).max(44)).min(1).max(8),
    providerPresignedCount: z.number().int().min(0).max(8),
    blockhash: z.string().min(32).max(44),
    programs: z.array(z.string().min(32).max(44)).min(1).max(64),
    tokenProgramIndices: z.array(z.number().int().min(0).max(255)).max(2),
    staticAccountCount: z.number().int().min(1).max(256),
    staticAccounts: z.array(z.string().min(32).max(44)).min(1).max(256),
    lookupTables: z
      .array(
        z
          .object({
            table: z.string().min(32).max(44),
            writableCount: z.number().int().min(0).max(256),
            readonlyCount: z.number().int().min(0).max(256),
          })
          .strict(),
      )
      .max(8),
    instructionCount: z.number().int().min(1).max(64),
    wireBytes: z.number().int().min(1).max(4_096),
    /* The address is null when the message resolves it through a lookup
       table; the index still binds it to the simulation's account vector. */
    nativeWrapRoundTrip: z
      .object({
        accountIndex: z.number().int().min(1).max(255),
        account: z.string().min(32).max(44).nullable(),
        fundedLamportsRaw: z.string().regex(/^[0-9]+$/),
        closesToTaker: z.literal(true),
      })
      .strict()
      .nullable(),
    nativeWrapCandidate: z
      .object({
        accountIndex: z.number().int().min(1).max(255),
        account: z.string().min(32).max(44).nullable(),
        fundedLamportsRaw: z.string().regex(/^[0-9]+$/),
      })
      .strict()
      .nullable(),
  })
  .strict();

export const SwapExecutionSimulationSchema = z
  .object({
    status: z.enum(["OK", "FAILED"]),
    unitsConsumed: z.string().regex(/^[0-9]+$/).nullable(),
    error: z.string().max(512).nullable(),
    sourceHost: z.string().min(1).max(128),
    observedAt: z.string().datetime({ offset: true }),
    ownerEffects: SwapOwnerEffectProofSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status === "OK" && value.ownerEffects === null) {
      context.addIssue({
        code: "custom",
        path: ["ownerEffects"],
        message: "A successful simulation must carry a verified owner-effect proof.",
      });
    }
    if (value.status === "FAILED" && value.ownerEffects !== null) {
      context.addIssue({
        code: "custom",
        path: ["ownerEffects"],
        message: "A failed simulation cannot claim verified owner effects.",
      });
    }
  });

export type SwapExecutionBundle = Readonly<{
  review: SwapQuoteReview;
  taker: string;
  lastValidBlockHeight: string;
  inspection: z.output<typeof SwapExecutionInspectionSchema>;
  simulation: z.output<typeof SwapExecutionSimulationSchema>;
  policyIntent: SwapPolicyIntent;
  policyVerdict: SwapPolicyVerdict;
  /**
   * Where the order was started from — Spot with a side, or absent for a
   * Swap. Inside the bundle rather than beside it so the issuer's proof
   * covers it: what a person is told they did is bound to what they signed.
   */
  origin?: SolanaActionOrigin;
  /**
   * The Strategy block judged for the plan `origin.plan` names — inside the
   * bundle for the same reason: the proof covers the checks that stood before
   * the signature, so Plan vs Actual reads what was really judged and
   * `execute` can refuse a bundle whose block is not the one the plan holds.
   */
  planReview?: PlanReview;
}>;

export const SwapExecutionBundleSchema = z
  .object({
    review: SwapQuoteReviewSchema,
    taker: z.string().min(32).max(44),
    lastValidBlockHeight: z.string().regex(/^[0-9]+$/),
    inspection: SwapExecutionInspectionSchema,
    simulation: SwapExecutionSimulationSchema,
    policyIntent: SwapPolicyIntentSchema,
    policyVerdict: SwapPolicyVerdictSchema,
    origin: SolanaActionOriginSchema.optional(),
    planReview: PlanReviewSchema.optional(),
  })
  .passthrough();

const SignedSwapExecutionProofSchema = z
  .object({
    schema: z.literal("ryntra.solana.swap-execution-proof"),
    schemaVersion: z.literal("1.0.0"),
    status: z.literal("SIGNED"),
    algorithm: z.literal("Ed25519"),
    digest: z.string().regex(HEX_HASH),
    keyId: z.string().min(1).max(128),
    publicKey: z.string().min(32).max(256),
    signature: z.string().min(64).max(512),
    issuedAt: z.string().datetime({ offset: true }),
  })
  .strict();

const UnsignedSwapExecutionProofSchema = z
  .object({
    schema: z.literal("ryntra.solana.swap-execution-proof"),
    schemaVersion: z.literal("1.0.0"),
    status: z.literal("UNSIGNED"),
    digest: z.string().regex(HEX_HASH),
    reasonCode: z.literal("NO_ISSUER_KEY_CONFIGURED"),
    issuedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const SwapExecutionProofSchema = z.discriminatedUnion("status", [
  SignedSwapExecutionProofSchema,
  UnsignedSwapExecutionProofSchema,
]);

export type SwapExecutionProof = z.output<typeof SwapExecutionProofSchema>;

function preimage(bundle: SwapExecutionBundle): string {
  return `${DOMAIN}\n${canonicalJson(bundle)}`;
}

function signingPreimage(bundle: SwapExecutionBundle, issuedAt: string): string {
  return `${preimage(bundle)}\n${issuedAt}`;
}

export function swapExecutionDigest(bundle: SwapExecutionBundle): string {
  return `0x${createHash("sha256").update(preimage(bundle), "utf8").digest("hex")}`;
}

export function inspectionForBundle(
  inspection: SwapTransactionInspection,
): z.output<typeof SwapExecutionInspectionSchema> {
  return SwapExecutionInspectionSchema.parse({
    messageHashHex: inspection.messageHashHex,
    version: inspection.version,
    feePayer: inspection.feePayer,
    signerAddresses: [...inspection.signerAddresses],
    providerPresignedCount: inspection.providerPresignedCount,
    blockhash: inspection.blockhash,
    programs: [...inspection.programs],
    tokenProgramIndices: [...inspection.tokenProgramIndices],
    staticAccountCount: inspection.staticAccountCount,
    staticAccounts: [...inspection.staticAccounts],
    lookupTables: inspection.lookupTables.map((entry) => ({ ...entry })),
    instructionCount: inspection.instructionCount,
    wireBytes: inspection.wireBytes,
    nativeWrapRoundTrip: inspection.nativeWrapRoundTrip
      ? { ...inspection.nativeWrapRoundTrip }
      : null,
    nativeWrapCandidate: inspection.nativeWrapCandidate
      ? { ...inspection.nativeWrapCandidate }
      : null,
  });
}

export function createSwapExecutionProof(args: {
  bundle: SwapExecutionBundle;
  key: IssuerKey | null;
  now?: Date;
}): SwapExecutionProof {
  const issuedAt = (args.now ?? new Date()).toISOString();
  const digest = swapExecutionDigest(args.bundle);
  if (!args.key) {
    return UnsignedSwapExecutionProofSchema.parse({
      schema: "ryntra.solana.swap-execution-proof",
      schemaVersion: "1.0.0",
      status: "UNSIGNED",
      digest,
      reasonCode: "NO_ISSUER_KEY_CONFIGURED",
      issuedAt,
    });
  }
  return SignedSwapExecutionProofSchema.parse({
    schema: "ryntra.solana.swap-execution-proof",
    schemaVersion: "1.0.0",
    status: "SIGNED",
    algorithm: "Ed25519",
    digest,
    keyId: args.key.keyId,
    publicKey: args.key.publicKey,
    signature: signBytes(
      null,
      Buffer.from(signingPreimage(args.bundle, issuedAt), "utf8"),
      args.key.privateKey,
    ).toString("base64"),
    issuedAt,
  });
}

export function verifySwapExecutionProof(args: {
  bundle: SwapExecutionBundle;
  proof: SwapExecutionProof;
  trustedPublicKey: string;
}): Readonly<{ ok: true }> | Readonly<{ ok: false; reason: string }> {
  if (args.proof.status !== "SIGNED") {
    return { ok: false, reason: args.proof.reasonCode };
  }
  if (args.proof.publicKey !== args.trustedPublicKey) {
    return { ok: false, reason: "The execution proof was not signed by this deployment's issuer key." };
  }
  if (args.proof.keyId !== issuerKeyId(args.proof.publicKey)) {
    return { ok: false, reason: "The execution proof key id does not derive from its public key." };
  }
  const digest = swapExecutionDigest(args.bundle);
  if (args.proof.digest !== digest) {
    return { ok: false, reason: "The reviewed order, transaction, simulation or policy verdict changed after the proof was issued." };
  }
  try {
    const valid = verifyBytes(
      null,
      Buffer.from(signingPreimage(args.bundle, args.proof.issuedAt), "utf8"),
      createPublicKey({
        key: Buffer.from(args.proof.publicKey, "base64"),
        format: "der",
        type: "spki",
      }),
      Buffer.from(args.proof.signature, "base64"),
    );
    return valid ? { ok: true } : { ok: false, reason: "The execution proof signature is invalid." };
  } catch (failure) {
    return {
      ok: false,
      reason: `The execution proof could not be verified: ${failure instanceof Error ? failure.message : String(failure)}`,
    };
  }
}
