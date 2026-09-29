/**
 * The public contracts of the Solana evidence layer, as zod — the one source
 * the published JSON Schemas are generated from.
 *
 * The passport itself is built by `passport.ts` from plain types; the schema
 * here is the *published shape* of that output, and a binding test parses
 * every real fixture passport against it, so the two cannot drift without a
 * red test. Everything an integrator consumes — passport, preflight, policy,
 * verdict — lives here; everything that computes lives beside it.
 */

import { z } from "zod";

import { SOLANA_NETWORKS } from "./rpc.ts";
import { SOLANA_PROVENANCE, TOKEN_PROGRAM_KINDS } from "./types.ts";

const Provenance = z.enum(SOLANA_PROVENANCE);
const Network = z.enum(SOLANA_NETWORKS);
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const RAW_AMOUNT = /^(0|[1-9]\d*)$/;
const RAW_DELTA = /^-?(0|[1-9]\d*)$/;

const fact = <T extends z.ZodType>(value: T) =>
  z.object({ value, provenance: Provenance, meaning: z.string().min(1) }).strict();

const ExtensionFactSchema = z
  .object({
    kind: z.string().min(1),
    provenance: Provenance,
    meaning: z.string().min(1),
    fields: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
    affectsTransfers: z.boolean(),
  })
  .strict();

export const SolanaAssetPassportSchema = z
  .object({
    schema: z.literal("ryntra.solana.asset-passport"),
    schemaVersion: z.literal("0.1.0"),
    network: Network,
    identity: z
      .object({
        mint: z.string().regex(BASE58),
        programKind: z.enum(TOKEN_PROGRAM_KINDS),
        programId: z.string().regex(BASE58),
        decimals: fact(z.number().int().min(0).max(255)),
        supply: fact(z.string().regex(RAW_AMOUNT)),
        mintAuthority: fact(z.string().regex(BASE58).nullable()),
        freezeAuthority: fact(z.string().regex(BASE58).nullable()),
        isInitialized: fact(z.boolean()),
      })
      .strict(),
    extensions: z.array(ExtensionFactSchema),
    unsupportedKinds: z.array(z.string()),
    observedAt: z.string(),
    source: z.object({ ref: z.string().min(1), label: z.string().min(1) }).strict(),
  })
  .strict();

export type SolanaAssetPassportContract = z.output<typeof SolanaAssetPassportSchema>;

/**
 * The exact transfer preview. Every number is a raw base-unit string; the
 * two honest nulls — network fee and compute budget — are slots this layer
 * cannot fill without building the transaction, which belongs to the devnet
 * lifecycle package, and each carries its reason instead of a guess.
 */
export const SplTransferPreflightSchema = z
  .object({
    schema: z.literal("ryntra.solana.spl-transfer-preflight"),
    schemaVersion: z.literal("0.1.0"),
    network: Network,
    mint: z.string().regex(BASE58),
    sender: z.string().regex(BASE58),
    recipient: z.string().regex(BASE58),
    amountRequestedRaw: z.string().regex(RAW_AMOUNT),
    /** The fee the mint's own TransferFeeConfig dictates for this amount. */
    transferFee: z
      .object({
        feeRaw: z.string().regex(RAW_AMOUNT),
        basisPoints: z.number().int().min(0).max(10_000),
        maximumFeeRaw: z.string().regex(RAW_AMOUNT),
        capApplied: z.boolean(),
        /** Which epoch config produced the number, and on what basis. */
        configUsed: z.enum(["NEWER", "OLDER", "NONE"]),
        epochBasis: z.string().regex(RAW_AMOUNT).nullable(),
      })
      .strict(),
    estimatedReceivedRaw: z.string().regex(RAW_AMOUNT),
    expectedBalanceDeltas: z
      .array(
        z
          .object({
            account: z.string().regex(BASE58),
            mint: z.string().regex(BASE58),
            rawDelta: z.string().regex(RAW_DELTA),
          })
          .strict(),
      )
      .min(1)
      .max(4),
    /** Withheld by the mint on the recipient account, not a network fee. */
    feeWithheldRaw: z.string().regex(RAW_AMOUNT),
    hookProgramId: z.string().regex(BASE58).nullable(),
    /** Structural facts of the mint that doom or gate the transfer. */
    structuralBlockers: z.array(
      z.enum(["NON_TRANSFERABLE", "PAUSED", "DEFAULT_ACCOUNT_STATE_FROZEN"]),
    ),
    unsupportedKinds: z.array(z.string()),
    networkFeeLamports: z.string().regex(RAW_AMOUNT).nullable(),
    computeBudget: z.string().regex(RAW_AMOUNT).nullable(),
    unfilledReason: z.string().min(1),
    simulation: z.discriminatedUnion("status", [
      z.object({ status: z.literal("SKIPPED"), reason: z.string().min(1) }).strict(),
      z
        .object({
          status: z.literal("PRESENT"),
          succeeded: z.boolean(),
          error: z.string().nullable(),
          unitsConsumed: z.string().regex(RAW_AMOUNT).nullable(),
        })
        .strict(),
    ]),
    observedAt: z.string(),
  })
  .strict();

export type SplTransferPreflight = z.output<typeof SplTransferPreflightSchema>;

/**
 * The owner's policy — versioned, explicit, and evaluated deterministically.
 * `"ANY"` is a stated decision, never a default: an empty allowlist means
 * nobody, and omitting a field is not possible on a strict schema.
 */
export const SolanaOwnerPolicySchema = z
  .object({
    schema: z.literal("ryntra.solana.owner-policy"),
    schemaVersion: z.literal("0.1.0"),
    allowedNetworks: z.array(Network).min(1),
    allowedMints: z.union([z.literal("ANY"), z.array(z.string().regex(BASE58))]),
    allowedTokenPrograms: z.array(z.enum(["SPL_TOKEN", "TOKEN_2022"])).min(1),
    acceptPermanentDelegate: z.boolean(),
    transferHookAllowlist: z.union([z.literal("NONE_ALLOWED"), z.array(z.string().regex(BASE58))]),
    maxFeeBasisPoints: z.number().int().min(0).max(10_000).nullable(),
    maxFeeRaw: z.string().regex(RAW_AMOUNT).nullable(),
    recipientAllowlist: z.union([z.literal("ANY"), z.array(z.string().regex(BASE58))]),
    maxAmountRaw: z.string().regex(RAW_AMOUNT).nullable(),
    maxEvidenceAgeSeconds: z.number().int().min(1),
    acceptDefaultFrozenAccounts: z.boolean(),
    requireHumanApproval: z.boolean(),
  })
  .strict();

export type SolanaOwnerPolicy = z.output<typeof SolanaOwnerPolicySchema>;

export const POLICY_RULE_IDS = [
  "NETWORK_ALLOWED",
  "MINT_ALLOWED",
  "TOKEN_PROGRAM_ALLOWED",
  "NOT_STRUCTURALLY_DOOMED",
  "PERMANENT_DELEGATE_ACCEPTED",
  "TRANSFER_HOOK_ALLOWLISTED",
  "FEE_WITHIN_CAP",
  "RECIPIENT_ALLOWED",
  "AMOUNT_WITHIN_LIMIT",
  "DEFAULT_FROZEN_ACCEPTED",
  "EVIDENCE_FRESH",
  "EXTENSIONS_UNDERSTOOD",
  "HUMAN_APPROVAL",
] as const;

export const POLICY_OUTCOMES = ["ALLOWED", "REVIEW_REQUIRED", "BLOCKED", "INCOMPLETE"] as const;

/** The closed verdict vocabulary. Never "SAFE" — that word does not exist here. */
export const POLICY_VERDICTS = [
  "NO_KNOWN_BLOCKER",
  "REVIEW_REQUIRED",
  "BLOCKED",
  "INCOMPLETE",
] as const;

export const SolanaPolicyVerdictSchema = z
  .object({
    schema: z.literal("ryntra.solana.policy-verdict"),
    schemaVersion: z.literal("0.1.0"),
    verdict: z.enum(POLICY_VERDICTS),
    findings: z
      .array(
        z
          .object({
            rule: z.enum(POLICY_RULE_IDS),
            outcome: z.enum(POLICY_OUTCOMES),
            detail: z.string().min(1),
          })
          .strict(),
      )
      .min(1),
    evaluatedAt: z.string(),
  })
  .strict();

export type SolanaPolicyVerdict = z.output<typeof SolanaPolicyVerdictSchema>;

/** Ref → schema, the exact set the published JSON Schema files are generated
 * from. A parity test regenerates and compares byte-for-byte. */
export const PUBLISHED_CONTRACTS = {
  "solana-asset-passport": SolanaAssetPassportSchema,
  "spl-transfer-preflight": SplTransferPreflightSchema,
  "solana-owner-policy": SolanaOwnerPolicySchema,
  "solana-policy-verdict": SolanaPolicyVerdictSchema,
} as const;
