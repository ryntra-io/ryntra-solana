/**
 * Recovery reads signature status before anything else.
 *
 * An undetermined submit is not retried from here. This module classifies.
 */

import { describeChainError } from "./chain-error.ts";
import { classifySendOutcome, type RecoveryFacts, type SendState, type SignatureStatusRead } from "./send-lifecycle.ts";
import { withRpcDiscipline, type SolanaRpcHandle } from "./rpc.ts";

export type SignatureStatusRpcRead =
  | Readonly<{ state: "READ"; status: SignatureStatusRead }>
  | Readonly<{ state: "UNKNOWN"; status: SignatureStatusRead; reason: string }>;

export type RecoveryFactsWithStatusRead = RecoveryFacts &
  Readonly<{ statusRead: SignatureStatusRpcRead }>;

export type EffectReadback<T> =
  | Readonly<{ state: "NOT_REQUESTED" }>
  | Readonly<{ state: "READ"; value: T }>
  | Readonly<{ state: "UNKNOWN"; reason: string }>;

export type RecoverSendResult<T = never> = Readonly<{
  state: SendState;
  facts: RecoveryFactsWithStatusRead;
  effectReadback: EffectReadback<T>;
}>;

export async function readSignatureStatus(
  handle: SolanaRpcHandle,
  signature: string,
): Promise<SignatureStatusRpcRead> {
  try {
    const response = await withRpcDiscipline(handle, (abortSignal) =>
      handle.rpc
        .getSignatureStatuses([signature as never], { searchTransactionHistory: true })
        .send({ abortSignal }),
    );
    const status = response.value[0];
    if (!status) {
      return {
        state: "READ",
        status: { confirmationStatus: null, err: null, seen: false, slot: null },
      };
    }
    const confirmation =
      status.confirmationStatus === "processed" ||
      status.confirmationStatus === "confirmed" ||
      status.confirmationStatus === "finalized"
        ? status.confirmationStatus
        : null;
    /* The error carries the chain's integers as BigInt. A plain stringify threw
       inside this try, and a status that had been read — landed, failed —
       came back as an unavailable operator, forever. */
    return {
      state: "READ",
      status: {
        confirmationStatus: confirmation,
        err: status.err === null || status.err === undefined ? null : describeChainError(status.err),
        seen: true,
        slot: status.slot === undefined || status.slot === null ? null : String(status.slot),
      },
    };
  } catch (failure) {
    return {
      state: "UNKNOWN",
      status: { confirmationStatus: null, err: null, seen: false, slot: null },
      reason: failure instanceof Error ? failure.message : String(failure),
    };
  }
}

export async function recoverSend<T = never>(args: {
  handle: SolanaRpcHandle;
  signature: string;
  lastValidBlockHeight: string;
  /** Independent effect reader supplied by the settlement layer. It observes;
      it never receives signed bytes and therefore cannot resubmit. */
  readEffects?: (signature: string) => Promise<T>;
}): Promise<RecoverSendResult<T>> {
  const statusRead = await readSignatureStatus(args.handle, args.signature);
  let blockHeight: string | null = null;
  /* An unavailable status RPC is not an unseen transaction. Do not ask height
     and manufacture EXPIRED from two unrelated facts. */
  if (statusRead.state === "READ") {
    try {
      const height = await withRpcDiscipline(args.handle, (abortSignal) =>
        args.handle.rpc.getBlockHeight({ commitment: "confirmed" }).send({ abortSignal }),
      );
      blockHeight = String(height);
    } catch {
      blockHeight = null;
    }
  }
  const facts: RecoveryFactsWithStatusRead = {
    signature: args.signature,
    status: statusRead.status,
    statusRead,
    blockHeight,
    lastValidBlockHeight: args.lastValidBlockHeight,
  };
  const state = statusRead.state === "UNKNOWN" ? "UNKNOWN" : classifySendOutcome(facts);

  let effectReadback: EffectReadback<T> = { state: "NOT_REQUESTED" };
  if (args.readEffects) {
    try {
      effectReadback = { state: "READ", value: await args.readEffects(args.signature) };
    } catch (failure) {
      effectReadback = {
        state: "UNKNOWN",
        reason: failure instanceof Error ? failure.message : String(failure),
      };
    }
  }
  return { state, facts, effectReadback };
}
