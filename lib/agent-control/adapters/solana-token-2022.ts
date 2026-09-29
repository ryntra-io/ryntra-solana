/**
 * The Solana Token-2022 adapter — the second real network, entering Agent
 * Control the way the registry promised a network would: as one module plus
 * registry definitions, with zero edits to the central artifact schemas.
 *
 * This file owns three things and nothing else:
 *
 * 1. the registry **definitions** (one adapter, one action subtype) that the
 *    neutral manifest in `./index.ts` feeds into the shipped registry;
 * 2. the **input schema** for the one action — what an exact SPL transfer
 *    proposal must state before anything can evaluate it;
 * 3. the **observation schema** — what an independent read-back of that
 *    transfer must carry before a reconciliation can compare anything.
 *
 * The evidence itself (mint identity, Token-2022 extensions, provenance)
 * lives in `lib/solana`; this module is the contract surface that binds that
 * core to the artifact lifecycle. Preflight and policy live in their own
 * modules and are deliberately absent here.
 */

import { z } from "zod";

import { BASE58_PUBKEY } from "../../solana/address.ts";
import { SOLANA_NETWORKS } from "../../solana/rpc.ts";

export const SOLANA_TOKEN_2022_ADAPTER_REF = "adapter:solana-token-2022@1";
export const SPL_TRANSFER_ACTION_REF = "action:solana-token-2022/spl-transfer@1";
/** Native SOL is a System Program transfer, not an SPL movement. Own action type, same adapter. */
export const NATIVE_SOL_TRANSFER_ACTION_REF = "action:solana-token-2022/native-sol-transfer@1";

/**
 * CAIP-2 chain references. The Solana namespace identifies a chain by the
 * first 32 characters of its genesis blockhash — a fact about the chain, not
 * a name someone can squat.
 */
export const SOLANA_CAIP2 = {
  mainnet: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
  devnet: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
} as const;

/**
 * Registry definitions, as data. Plain literals on purpose: the registry's
 * own schema validates them at build time, and importing the registry here
 * would create the exact central coupling this module exists to avoid.
 */
export const SOLANA_TOKEN_2022_DEFINITIONS = [
  {
    kind: "ADAPTER",
    ref: SOLANA_TOKEN_2022_ADAPTER_REF,
    displayName: "Solana Token-2022",
    capability: "READ_ONLY",
    chainRefs: [SOLANA_CAIP2.mainnet, SOLANA_CAIP2.devnet],
    status: "ALLOWED",
  },
  {
    kind: "ACTION_SCHEMA",
    ref: SPL_TRANSFER_ACTION_REF,
    displayName: "SPL transfer",
    adapterRef: SOLANA_TOKEN_2022_ADAPTER_REF,
    /* Moving tokens from one holder to another is the closed class
       VALUE_TRANSFER — a verifier that has never heard of Solana still reads
       that this action moves value. */
    canonicalClass: "VALUE_TRANSFER",
    budget: "OPTIONAL",
    status: "ALLOWED",
  },
  {
    kind: "ACTION_SCHEMA",
    ref: NATIVE_SOL_TRANSFER_ACTION_REF,
    displayName: "Native SOL transfer",
    adapterRef: SOLANA_TOKEN_2022_ADAPTER_REF,
    canonicalClass: "VALUE_TRANSFER",
    budget: "OPTIONAL",
    status: "ALLOWED",
  },
] as const;

const BASE58_SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
/**
 * A bare `.regex()` reports zod's default `Invalid`, which names neither the
 * shape the field wants nor what was wrong with the value it got. The schema is
 * the *first* refusal any caller meets and therefore the most frequent one, and
 * this product's whole claim is that a refusal carries its exact reason — so
 * these state one instead of leaving the caller to guess.
 */
const BASE58_PUBKEY_SHAPE =
  "must be a base58 Solana address — 32 to 44 characters, and never 0, O, I or l";
/** Raw base units as a decimal string. Never a float: 64-bit amounts do not
 * survive JavaScript numbers, and a lossy amount is a wrong amount. */
const RAW_AMOUNT = /^(0|[1-9]\d*)$/;
const RAW_DELTA = /^-?(0|[1-9]\d*)$/;
const POSITIVE_RAW_AMOUNT = z
  .string()
  .regex(RAW_AMOUNT, "The amount must be a whole number of base units — no decimal point, sign or separator.")
  .refine((amountRaw) => amountRaw !== "0", "The amount must be greater than zero base units.");

/**
 * What an SPL transfer proposal must state — exactly, before evaluation.
 *
 * `amountRaw` is the amount in base units. The human number is derived from
 * the mint's on-chain decimals by the evidence core; carrying both would
 * create two values that must agree, and this repository knows how that ends.
 */
export const SplTransferInputSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    actionRef: z.literal(SPL_TRANSFER_ACTION_REF),
    network: z.enum(SOLANA_NETWORKS),
    mint: z.string().regex(BASE58_PUBKEY, `The mint ${BASE58_PUBKEY_SHAPE}.`),
    sender: z.string().regex(BASE58_PUBKEY, `The sender ${BASE58_PUBKEY_SHAPE}.`),
    recipient: z.string().regex(BASE58_PUBKEY, `The recipient ${BASE58_PUBKEY_SHAPE}.`),
    amountRaw: POSITIVE_RAW_AMOUNT,
  })
  .strict()
  .refine(({ sender, recipient }) => sender !== recipient, {
    path: ["recipient"],
    message: "The recipient must be different from the sender.",
  });

export type SplTransferInput = z.output<typeof SplTransferInputSchema>;

export const NativeSolTransferInputSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    actionRef: z.literal(NATIVE_SOL_TRANSFER_ACTION_REF),
    network: z.enum(SOLANA_NETWORKS),
    sender: z.string().regex(BASE58_PUBKEY, `The sender ${BASE58_PUBKEY_SHAPE}.`),
    recipient: z.string().regex(BASE58_PUBKEY, `The recipient ${BASE58_PUBKEY_SHAPE}.`),
    amountRaw: POSITIVE_RAW_AMOUNT,
  })
  .strict()
  .refine(({ sender, recipient }) => sender !== recipient, {
    path: ["recipient"],
    message: "The recipient must be different from the sender.",
  });

export type NativeSolTransferInput = z.output<typeof NativeSolTransferInputSchema>;

export const SendTransferInputSchema = z.discriminatedUnion("actionRef", [
  SplTransferInputSchema,
  NativeSolTransferInputSchema,
]);

export type SendTransferInput = z.output<typeof SendTransferInputSchema>;

/**
 * What an independent read-back of the executed transfer must carry.
 *
 * Balance deltas are signed raw base units per (account, mint): the form a
 * reconciliation can compare against an authorized plan without trusting the
 * screen that submitted it. At least one source names where every number was
 * read from — an observation without provenance is a claim, not evidence.
 */
export const SplTransferObservationSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    actionRef: z.union([
      z.literal(SPL_TRANSFER_ACTION_REF),
      z.literal(NATIVE_SOL_TRANSFER_ACTION_REF),
    ]),
    network: z.enum(SOLANA_NETWORKS),
    signature: z.string().regex(BASE58_SIGNATURE),
    slot: z.string().regex(RAW_AMOUNT),
    /** ISO-8601 when the RPC reported a block time; null when it did not. */
    blockTime: z.string().datetime({ offset: true }).nullable(),
    /** Network fee in lamports, raw string for the same reason as amounts. */
    feeLamports: z.string().regex(RAW_AMOUNT),
    /**
     * Zero deltas is a legal observation, and the reason is the whole point of
     * this product: a transaction that landed and failed moved nothing, and a
     * schema that demands at least one movement cannot express it. The first
     * draft required `.min(1)`, which made a failed transfer unrepresentable —
     * found by a test that fed a real `InstructionError` reply through the
     * normaliser. An empty array here means "the chain was read and nothing
     * moved", which is different from an observation that was never made; the
     * latter is the absence of an observation, not an empty one.
     */
    balanceDeltas: z
      .array(
        z
          .object({
            account: z.string().regex(BASE58_PUBKEY),
            mint: z.string().regex(BASE58_PUBKEY),
            rawDelta: z.string().regex(RAW_DELTA),
          })
          .strict(),
      )
      .max(16),
    /** Raw account lamport movement from this transaction's pre/post balances. */
    lamportBalanceDeltas: z
      .array(
        z
          .object({
            account: z.string().regex(BASE58_PUBKEY),
            rawDelta: z.string().regex(RAW_DELTA),
          })
          .strict(),
      )
      .max(64),
    sources: z
      .array(z.object({ ref: z.string().min(1).max(256), label: z.string().min(1).max(128) }).strict())
      .min(1)
      .max(8),
    observedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type SplTransferObservation = z.output<typeof SplTransferObservationSchema>;
