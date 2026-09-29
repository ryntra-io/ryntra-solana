/**
 * The exact transfer preview — what will actually happen, computed from the
 * mint's own on-chain configuration before anything is signed.
 *
 * Pure over its inputs: the same decoded mint, the same proposal and the
 * same epoch always produce the same preview, which is what lets golden
 * tests pin the fee math and lets a verifier recompute it later. The two
 * numbers this layer refuses to invent — network fee and compute budget —
 * exist as honest nulls with one shared reason: they belong to transaction
 * building, which is the devnet-lifecycle package's job.
 */

import type { Extension } from "@solana-program/token-2022";

import type { SplTransferInput } from "../agent-control/adapters/solana-token-2022.ts";
import type { SplTransferPreflight } from "./contracts.ts";
import type { MintReadSuccess } from "./mint.ts";
import type { SolanaAssetPassport } from "./types.ts";

/** AccountState.Frozen in the token programs' own vocabulary. */
const ACCOUNT_STATE_FROZEN = 2;

const UNFILLED_REASON =
  "Network fee and compute budget are known only when the transaction is built; this read-only kit builds no transaction, so neither is available here.";

export type PreflightSimulation = SplTransferPreflight["simulation"];

export type PreflightFailure = Readonly<{
  ok: false;
  code: "INPUT_MINT_MISMATCH" | "MINT_NOT_INITIALIZED" | "ZERO_AMOUNT" | "SENDER_RECIPIENT_SAME";
  reason: string;
}>;

export type PreflightResult = Readonly<{ ok: true; preflight: SplTransferPreflight }> | PreflightFailure;

function extensionsOf(read: MintReadSuccess): readonly Extension[] {
  return read.decoded.extensions.__option === "Some" ? read.decoded.extensions.value : [];
}

function findExtension<K extends Extension["__kind"]>(
  extensions: readonly Extension[],
  kind: K,
): Extract<Extension, { __kind: K }> | null {
  const found = extensions.find((extension) => extension.__kind === kind);
  return (found as Extract<Extension, { __kind: K }> | undefined) ?? null;
}

type FeeComputation = SplTransferPreflight["transferFee"];

/**
 * Token-2022 transfer-fee math, to the program's own rule: basis points of
 * the amount, capped at `maximumFee`, with the epoch choosing which of the
 * two configs applies. No epoch given → the newer config, and the choice is
 * recorded as data rather than hidden in a default.
 */
export function computeTransferFee(
  extensions: readonly Extension[],
  amountRaw: bigint,
  epoch: bigint | null,
): FeeComputation {
  const config = findExtension(extensions, "TransferFeeConfig");
  if (!config) {
    return {
      feeRaw: "0",
      basisPoints: 0,
      maximumFeeRaw: "0",
      capApplied: false,
      configUsed: "NONE",
      epochBasis: epoch === null ? null : epoch.toString(),
    };
  }
  const useOlder = epoch !== null && epoch < config.newerTransferFee.epoch;
  const chosen = useOlder ? config.olderTransferFee : config.newerTransferFee;
  const basisPoints = chosen.transferFeeBasisPoints;
  const maximumFee = chosen.maximumFee;
  /* spl-token-2022 uses ceiling division: a fractional base-unit fee must not
     be rounded down in the reviewed expectation. */
  const uncapped = (amountRaw * BigInt(basisPoints) + 9_999n) / 10_000n;
  const capApplied = uncapped > maximumFee;
  const feeRaw = capApplied ? maximumFee : uncapped;
  return {
    feeRaw: feeRaw.toString(),
    basisPoints,
    maximumFeeRaw: maximumFee.toString(),
    capApplied,
    configUsed: useOlder ? "OLDER" : "NEWER",
    epochBasis: epoch === null ? null : epoch.toString(),
  };
}

/** Build the preview. Never throws; refusals are values with reasons. */
export function buildTransferPreflight(args: {
  read: MintReadSuccess;
  passport: SolanaAssetPassport;
  input: SplTransferInput;
  /** Current epoch when the caller knows it; null is recorded, not hidden. */
  epoch?: bigint | null;
  simulation?: PreflightSimulation;
  /** Exact base fee priced from the built message; omitted by the read-only kit. */
  networkFeeLamports?: string | null;
  now?: Date;
}): PreflightResult {
  const { read, passport, input } = args;

  if (input.mint !== read.raw.mint) {
    return {
      ok: false,
      code: "INPUT_MINT_MISMATCH",
      reason: `The proposal names mint ${input.mint} but the evidence was read from ${read.raw.mint}; a preview over the wrong mint would be exact about the wrong thing.`,
    };
  }
  if (!read.decoded.isInitialized) {
    return {
      ok: false,
      code: "MINT_NOT_INITIALIZED",
      reason: `Mint ${input.mint} exists but is not initialized; no transfer semantics exist yet.`,
    };
  }
  if (input.amountRaw === "0") {
    return {
      ok: false,
      code: "ZERO_AMOUNT",
      reason: "A zero-value transfer is not a Send action and cannot be previewed.",
    };
  }
  if (input.sender === input.recipient) {
    return {
      ok: false,
      code: "SENDER_RECIPIENT_SAME",
      reason: "The sender and recipient are the same account, so this cannot be a transfer.",
    };
  }

  const extensions = extensionsOf(read);
  const amount = BigInt(input.amountRaw);
  const transferFee = computeTransferFee(extensions, amount, args.epoch ?? null);
  const fee = BigInt(transferFee.feeRaw);
  const received = amount - fee;

  const structuralBlockers: SplTransferPreflight["structuralBlockers"] = [];
  if (findExtension(extensions, "NonTransferable")) structuralBlockers.push("NON_TRANSFERABLE");
  const pausable = findExtension(extensions, "PausableConfig");
  if (pausable?.paused === true) structuralBlockers.push("PAUSED");
  const defaultState = findExtension(extensions, "DefaultAccountState");
  if (defaultState?.state === ACCOUNT_STATE_FROZEN) {
    structuralBlockers.push("DEFAULT_ACCOUNT_STATE_FROZEN");
  }

  /* The hook program is a plain address in the account layout; "no program"
     is the all-zero key, exactly as the token program itself stores it. */
  const ZERO_ADDRESS = "11111111111111111111111111111111";
  const hook = findExtension(extensions, "TransferHook");
  const hookAddress = hook ? String(hook.programId) : null;
  const hookProgramId = hookAddress !== null && hookAddress !== ZERO_ADDRESS ? hookAddress : null;

  const preflight: SplTransferPreflight = {
    schema: "ryntra.solana.spl-transfer-preflight",
    schemaVersion: "0.1.0",
    network: input.network,
    mint: input.mint,
    sender: input.sender,
    recipient: input.recipient,
    amountRequestedRaw: input.amountRaw,
    transferFee,
    estimatedReceivedRaw: received.toString(),
    expectedBalanceDeltas: [
      { account: input.sender, mint: input.mint, rawDelta: (-amount).toString() },
      { account: input.recipient, mint: input.mint, rawDelta: received.toString() },
    ],
    feeWithheldRaw: transferFee.feeRaw,
    hookProgramId,
    structuralBlockers,
    unsupportedKinds: [...passport.unsupportedKinds],
    networkFeeLamports: args.networkFeeLamports ?? null,
    computeBudget:
      args.simulation?.status === "PRESENT" && args.simulation.unitsConsumed
        ? args.simulation.unitsConsumed
        : null,
    unfilledReason:
      args.networkFeeLamports === undefined || args.networkFeeLamports === null
        ? UNFILLED_REASON
        : "The exact base fee is priced from the reviewed message; no priority-fee instruction is present.",
    simulation: args.simulation ?? {
      status: "SKIPPED",
      reason: "This kit builds no transaction, so there is nothing to simulate.",
    },
    observedAt: passport.observedAt,
  };

  return { ok: true, preflight };
}
