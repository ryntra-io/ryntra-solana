/**
 * Issuer-bound proof of the exact Send Review bundle.
 *
 * The browser is allowed to carry this document but cannot rewrite it: the
 * same non-wallet Ryntra issuer key that signs evidence artifacts signs the
 * canonical plan + preflight + verdict bundle. This key cannot authorize or
 * sign a Solana transaction. Settlement trusts only the currently configured
 * issuer public key, never an arbitrary key supplied by a caller.
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
import type { SolanaCanaryIntent, SolanaCanaryVerdict } from "./canary-policy.ts";
import type { SolanaPolicyVerdict, SplTransferPreflight } from "./contracts.ts";
import type { TransferPlan } from "./transaction.ts";

const DOMAIN = "ryntra.solana.send-review-proof@2";
const HEX_HASH = /^0x[0-9a-f]{64}$/;

export type SendReviewBundle = Readonly<{
  plan: TransferPlan;
  preflight: SplTransferPreflight;
  verdict: SolanaPolicyVerdict;
  provider: Readonly<{ role: "primary" | "fallback"; host: string }>;
  canaryIntent: SolanaCanaryIntent;
  canaryVerdict: SolanaCanaryVerdict;
}>;

const SignedSendReviewProofSchema = z
  .object({
    schema: z.literal("ryntra.solana.send-review-proof"),
    schemaVersion: z.literal("2.0.0"),
    status: z.literal("SIGNED"),
    algorithm: z.literal("Ed25519"),
    digest: z.string().regex(HEX_HASH),
    keyId: z.string().min(1).max(128),
    publicKey: z.string().min(32).max(256),
    signature: z.string().min(64).max(512),
    issuedAt: z.string().datetime({ offset: true }),
  })
  .strict();

const UnsignedSendReviewProofSchema = z
  .object({
    schema: z.literal("ryntra.solana.send-review-proof"),
    schemaVersion: z.literal("2.0.0"),
    status: z.literal("UNSIGNED"),
    digest: z.string().regex(HEX_HASH),
    reasonCode: z.literal("NO_ISSUER_KEY_CONFIGURED"),
    issuedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const SendReviewProofSchema = z.discriminatedUnion("status", [
  SignedSendReviewProofSchema,
  UnsignedSendReviewProofSchema,
]);

export type SendReviewProof = z.output<typeof SendReviewProofSchema>;

function preimage(bundle: SendReviewBundle): string {
  return `${DOMAIN}\n${canonicalJson(bundle)}`;
}

function signingPreimage(bundle: SendReviewBundle, issuedAt: string): string {
  return `${preimage(bundle)}\n${issuedAt}`;
}

export function sendReviewDigest(bundle: SendReviewBundle): string {
  return `0x${createHash("sha256").update(preimage(bundle), "utf8").digest("hex")}`;
}

export function createSendReviewProof(args: {
  bundle: SendReviewBundle;
  key: IssuerKey | null;
  now?: Date;
}): SendReviewProof {
  const issuedAt = (args.now ?? new Date()).toISOString();
  const digest = sendReviewDigest(args.bundle);
  if (!args.key) {
    return {
      schema: "ryntra.solana.send-review-proof",
      schemaVersion: "2.0.0",
      status: "UNSIGNED",
      digest,
      reasonCode: "NO_ISSUER_KEY_CONFIGURED",
      issuedAt,
    };
  }
  return SignedSendReviewProofSchema.parse({
    schema: "ryntra.solana.send-review-proof",
    schemaVersion: "2.0.0",
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

export function verifySendReviewProof(args: {
  bundle: SendReviewBundle;
  proof: SendReviewProof;
  trustedPublicKey: string;
}): Readonly<{ ok: true }> | Readonly<{ ok: false; reason: string }> {
  if (args.proof.status !== "SIGNED") {
    return { ok: false, reason: args.proof.reasonCode };
  }
  if (args.proof.publicKey !== args.trustedPublicKey) {
    return { ok: false, reason: "The Review proof was not signed by this deployment's issuer key." };
  }
  if (args.proof.keyId !== issuerKeyId(args.proof.publicKey)) {
    return { ok: false, reason: "The Review proof key id does not derive from its public key." };
  }
  const digest = sendReviewDigest(args.bundle);
  if (args.proof.digest !== digest) {
    return { ok: false, reason: "The Review plan, preflight or verdict changed after the proof was issued." };
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
    return valid ? { ok: true } : { ok: false, reason: "The Review proof signature is invalid." };
  } catch (failure) {
    return {
      ok: false,
      reason: `The Review proof could not be verified: ${failure instanceof Error ? failure.message : String(failure)}`,
    };
  }
}
