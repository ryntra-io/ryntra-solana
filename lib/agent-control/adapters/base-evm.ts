/**
 * The Base Sepolia EVM adapter — the second real network to enter Agent
 * Control through the manifest rather than through the centre, and the one
 * that proves the pattern was not a Solana-shaped accident.
 *
 * This file owns three things and nothing else:
 *
 * 1. the registry **definitions** (one adapter, one action subtype) that the
 *    neutral manifest in `./index.ts` feeds into the shipped registry;
 * 2. the **input schema** for the one action — what an exact ERC-20 transfer
 *    proposal must state before anything can evaluate it;
 * 3. the **observation schema** — what an independent read-back of that
 *    transfer must carry before a reconciliation can compare anything.
 *
 * There is no RPC client here, no signer, and no policy. The adapter entry
 * says `READ_ONLY` because that is the literal truth of this repository: it
 * observes a transfer somebody else submitted and reconciles it against what
 * was authorized. Preflight and execution are separate decisions with their
 * own packets.
 */

import { z } from "zod";

/**
 * CAIP-2 chain reference. The `eip155` namespace identifies a chain by its
 * numeric chain id, which is the value a wallet signs over — so a mismatch
 * here is the same mismatch a replayed transaction would hit on chain.
 *
 * **Base mainnet — `eip155:8453` — is deliberately absent, and its absence is
 * the decision, not an omission.** Founder decision FD-02 (2026-08-21,
 * `docs/agent-control/README.md`, "Founder decisions taken") makes Base
 * Sepolia the default execution rail, testnet only, no mainnet execution this
 * phase, and states that projection work does not by itself enable an
 * execution adapter. A chain reference is what a policy matches on, so adding
 * the mainnet id here would not be a wider list — it would be an execution
 * rail no decision opened. Opening it is a founder decision plus its own
 * packet, and then this constant grows by one line.
 */
export const BASE_SEPOLIA_CAIP2 = "eip155:84532";

export const BASE_EVM_ADAPTER_REF = "adapter:base-evm@1";
export const ERC20_TRANSFER_ACTION_REF = "action:base-evm/erc20-transfer@1";

/**
 * Registry definitions, as data. Plain literals on purpose: the registry's
 * own schema validates them at build time, and importing the registry here
 * would create the exact central coupling this module exists to avoid.
 */
export const BASE_EVM_DEFINITIONS = [
  {
    kind: "ADAPTER",
    ref: BASE_EVM_ADAPTER_REF,
    displayName: "Base Sepolia EVM",
    capability: "READ_ONLY",
    chainRefs: [BASE_SEPOLIA_CAIP2],
    status: "ALLOWED",
  },
  {
    kind: "ACTION_SCHEMA",
    ref: ERC20_TRANSFER_ACTION_REF,
    displayName: "ERC-20 transfer",
    adapterRef: BASE_EVM_ADAPTER_REF,
    /* Moving tokens from one holder to another is the closed class
       VALUE_TRANSFER — a verifier that has never heard of Base still reads
       that this action moves value. */
    canonicalClass: "VALUE_TRANSFER",
    budget: "OPTIONAL",
    status: "ALLOWED",
  },
] as const;

/**
 * A 20-byte account, hex, either case.
 *
 * **EIP-55 checksum casing is deliberately not required.** The checksum is a
 * display-layer hint derived from the same twenty bytes; it carries no
 * information the address does not already carry, and enforcing it would
 * refuse the all-lowercase form that JSON-RPC replies, block explorers and
 * half the tooling in this space emit — a correct account refused for a
 * typographic reason. The refusal that actually matters is "this is not the
 * account you authorized", and that is a comparison against the mandate, not
 * a rule about letter case.
 */
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const TRANSACTION_HASH = /^0x[0-9a-fA-F]{64}$/;

/**
 * A bare `.regex()` reports zod's default `Invalid`, which names neither the
 * shape the field wants nor what was wrong with the value it got. The schema
 * is the *first* refusal any caller meets and therefore the most frequent
 * one, and this product's whole claim is that a refusal carries its exact
 * reason — so these state one instead of leaving the caller to guess.
 */
const EVM_ADDRESS_SHAPE =
  "must be a 0x-prefixed 20-byte hex address — 42 characters in total, any letter case";

/** Raw base units as a decimal string. Never a float: a 256-bit ERC-20 amount
 * does not survive a JavaScript number, and a lossy amount is a wrong amount.
 * Leading zeroes are refused too, so one amount has exactly one spelling and
 * two artifacts over the same transfer canonicalise identically. */
const RAW_AMOUNT = /^(0|[1-9]\d*)$/;
const RAW_DELTA = /^-?(0|[1-9]\d*)$/;

/**
 * What an ERC-20 transfer proposal must state — exactly, before evaluation.
 *
 * `amountRaw` is the amount in the token's base units. The human number is
 * derived from the token's on-chain `decimals()` by whatever reads the chain;
 * carrying both here would create two values that must agree, and this
 * repository knows how that ends.
 */
export const Erc20TransferInputSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    actionRef: z.literal(ERC20_TRANSFER_ACTION_REF),
    /* A literal, not an enum of one: the adapter declares exactly one chain,
       and a proposal naming any other is refused by the schema before a
       policy has to have an opinion about it. */
    chainRef: z.literal(BASE_SEPOLIA_CAIP2),
    token: z.string().regex(EVM_ADDRESS, `The token contract ${EVM_ADDRESS_SHAPE}.`),
    from: z.string().regex(EVM_ADDRESS, `The sender ${EVM_ADDRESS_SHAPE}.`),
    to: z.string().regex(EVM_ADDRESS, `The recipient ${EVM_ADDRESS_SHAPE}.`),
    amountRaw: z
      .string()
      .regex(RAW_AMOUNT, "The amount must be a whole number of base units — no decimal point, sign or separator."),
  })
  .strict();

export type Erc20TransferInput = z.output<typeof Erc20TransferInputSchema>;

/**
 * What an independent read-back of the executed transfer must carry.
 *
 * Balance deltas are signed raw base units per (account, token): the form a
 * reconciliation can compare against an authorized plan without trusting the
 * screen that submitted it. At least one source names where every number was
 * read from — an observation without provenance is a claim, not evidence.
 */
export const Erc20TransferObservationSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    actionRef: z.literal(ERC20_TRANSFER_ACTION_REF),
    chainRef: z.literal(BASE_SEPOLIA_CAIP2),
    transactionHash: z
      .string()
      .regex(TRANSACTION_HASH, "The transaction hash must be 0x followed by 64 hex characters."),
    blockNumber: z.string().regex(RAW_AMOUNT, "The block number must be a decimal string of digits."),
    /**
     * ISO-8601 when the block timestamp was resolved; null when it was not.
     *
     * Null is legal because a receipt does not carry one. `eth_getTransactionReceipt`
     * returns the block number and nothing about time; the timestamp lives in the
     * block header and costs a second call to fetch. An observation forced to
     * invent a time in order to be representable would be a worse record than one
     * that says plainly it does not know yet.
     */
    blockTime: z.string().datetime({ offset: true }).nullable(),
    /** Gas is metered in units and priced in wei; both are raw decimal strings
     * for the same reason amounts are — a wei price overflows a JS number. */
    gasUsed: z.string().regex(RAW_AMOUNT),
    effectiveGasPriceWei: z.string().regex(RAW_AMOUNT),
    /**
     * A closed pair, because those are the only two things a mined EVM
     * transaction can have done. A reverted transaction that landed moved
     * nothing and still cost gas, and a schema that cannot express it would
     * force the most important outcome this product records to be reported as
     * either a success or a missing read — both false. It pairs with the empty
     * `balanceDeltas` below: `REVERTED` says why nothing moved, the empty list
     * says nothing moved, and neither is the absence of an observation.
     */
    status: z.enum(["SUCCEEDED", "REVERTED"]),
    /**
     * Zero deltas is a legal observation, for the same reason `REVERTED` is a
     * legal status: an empty array means "the chain was read and nothing
     * moved", which is a different fact from an observation that was never
     * made. The latter is the absence of an observation, not an empty one.
     */
    balanceDeltas: z
      .array(
        z
          .object({
            account: z.string().regex(EVM_ADDRESS),
            token: z.string().regex(EVM_ADDRESS),
            rawDelta: z.string().regex(RAW_DELTA),
          })
          .strict(),
      )
      .max(16),
    sources: z
      .array(z.object({ ref: z.string().min(1).max(256), label: z.string().min(1).max(128) }).strict())
      .min(1)
      .max(8),
    observedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type Erc20TransferObservation = z.output<typeof Erc20TransferObservationSchema>;
