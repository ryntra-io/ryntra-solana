/**
 * Issuer-bound proof of the exact bridge Review.
 *
 * Same mechanism as the Send lane's proof and a separate document on purpose:
 * the two bundles carry different fields, and one shared schema would have to
 * make half of each optional — which is how a proof stops proving anything in
 * particular.
 *
 * The browser may carry this and cannot rewrite it. The non-wallet Ryntra
 * issuer key signs the canonical bundle; that key cannot authorize or sign a
 * Solana transaction, and the burn route trusts only the public key this
 * deployment is configured with, never one a caller supplies.
 *
 * The signature covers the digest preimage **and** the issuing timestamp, so a
 * replay of an old Review at a new time fails even when the plan is unchanged.
 * That matters more here than on Send: a bridge blockhash expires, and a stale
 * Review presented as fresh is exactly how a second burn gets built.
 */

import { createHash, createPublicKey, sign as signBytes, verify as verifyBytes } from "node:crypto";
import { z } from "zod";

import { issuerKeyId, type IssuerKey } from "../agent-control/issuer.ts";
import { canonicalJson } from "../guard/canonical-json.ts";
import type { BaseBurnPlan } from "../base/cctp-burn.ts";
import type { SolanaCanaryIntent, SolanaCanaryVerdict } from "./canary-policy.ts";
import type { CctpBurnPlan } from "./cctp-plan.ts";
import type { CctpProviderSnapshot } from "./cctp-provider.ts";

const DOMAIN = "ryntra.solana.cctp-review-proof@1";
const HEX_HASH = /^0x[0-9a-f]{64}$/;

/**
 * What the issuer signs.
 *
 * The plan is one of the two source-side plans rather than the Solana one,
 * because the proof's whole job is to say *these exact bytes were reviewed by
 * this deployment* — and a type that only admitted one lane would have left the
 * other travelling unsigned, which is the same as travelling rewritable. The
 * digest is over the canonical bundle either way, so nothing about the mechanism
 * changes; only the set of things it can be asked about does.
 */
export type CctpReviewBundle = Readonly<{
  plan: CctpBurnPlan | BaseBurnPlan | Record<string, unknown>;
  provider: CctpProviderSnapshot;
  rpc: Readonly<{ role: "primary" | "fallback" | "independent"; host: string }>;
  simulation: Readonly<{
    status: "PRESENT" | "SKIPPED";
    succeeded: boolean;
    error: string | null;
    unitsConsumed: string | null;
  }>;
  canaryIntent: SolanaCanaryIntent;
  canaryVerdict: SolanaCanaryVerdict;
}>;

const SignedSchema = z
  .object({
    schema: z.literal("ryntra.solana.cctp-review-proof"),
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

const UnsignedSchema = z
  .object({
    schema: z.literal("ryntra.solana.cctp-review-proof"),
    schemaVersion: z.literal("1.0.0"),
    status: z.literal("UNSIGNED"),
    digest: z.string().regex(HEX_HASH),
    reasonCode: z.literal("NO_ISSUER_KEY_CONFIGURED"),
    issuedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const CctpReviewProofSchema = z.discriminatedUnion("status", [SignedSchema, UnsignedSchema]);
export type CctpReviewProof = z.output<typeof CctpReviewProofSchema>;

const preimage = (bundle: CctpReviewBundle) => `${DOMAIN}\n${canonicalJson(bundle)}`;
const signingPreimage = (bundle: CctpReviewBundle, issuedAt: string) => `${preimage(bundle)}\n${issuedAt}`;

export function cctpReviewDigest(bundle: CctpReviewBundle): string {
  return `0x${createHash("sha256").update(preimage(bundle), "utf8").digest("hex")}`;
}

export function createCctpReviewProof(args: {
  bundle: CctpReviewBundle;
  key: IssuerKey | null;
  now?: Date;
}): CctpReviewProof {
  const issuedAt = (args.now ?? new Date()).toISOString();
  const digest = cctpReviewDigest(args.bundle);
  if (!args.key) {
    return {
      schema: "ryntra.solana.cctp-review-proof",
      schemaVersion: "1.0.0",
      status: "UNSIGNED",
      digest,
      reasonCode: "NO_ISSUER_KEY_CONFIGURED",
      issuedAt,
    };
  }
  return SignedSchema.parse({
    schema: "ryntra.solana.cctp-review-proof",
    schemaVersion: "1.0.0",
    status: "SIGNED",
    algorithm: "Ed25519",
    digest,
    keyId: args.key.keyId,
    publicKey: args.key.publicKey,
    signature: signBytes(null, Buffer.from(signingPreimage(args.bundle, issuedAt), "utf8"), args.key.privateKey).toString("base64"),
    issuedAt,
  });
}

export function verifyCctpReviewProof(args: {
  bundle: CctpReviewBundle;
  proof: CctpReviewProof;
  trustedPublicKey: string;
}): Readonly<{ ok: true }> | Readonly<{ ok: false; reason: string }> {
  if (args.proof.status !== "SIGNED") return { ok: false, reason: args.proof.reasonCode };
  if (args.proof.publicKey !== args.trustedPublicKey) {
    return { ok: false, reason: "The bridge Review proof was not signed by this deployment's issuer key." };
  }
  if (args.proof.keyId !== issuerKeyId(args.proof.publicKey)) {
    return { ok: false, reason: "The bridge Review proof key id does not derive from its public key." };
  }
  if (args.proof.digest !== cctpReviewDigest(args.bundle)) {
    return {
      ok: false,
      reason: "The reviewed burn plan, provider facts, simulation or policy verdict changed after the proof was issued.",
    };
  }
  try {
    const valid = verifyBytes(
      null,
      Buffer.from(signingPreimage(args.bundle, args.proof.issuedAt), "utf8"),
      createPublicKey({ key: Buffer.from(args.proof.publicKey, "base64"), format: "der", type: "spki" }),
      Buffer.from(args.proof.signature, "base64"),
    );
    return valid ? { ok: true } : { ok: false, reason: "The bridge Review proof signature is invalid." };
  } catch (failure) {
    return {
      ok: false,
      reason: `The bridge Review proof could not be verified: ${failure instanceof Error ? failure.message : String(failure)}`,
    };
  }
}
