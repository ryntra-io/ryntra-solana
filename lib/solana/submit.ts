/**
 * The one place a Solana transaction leaves this product.
 *
 * It takes the **cleared verdict**, not bytes. Anything that skipped the
 * comparison in `signature.ts` has no way in, because there is no argument
 * shape that expresses "submit these bytes" — the caller must hand over a
 * check that says `CLEARED`, and the bytes travel inside it. The Stellar
 * lifecycle arrived at the same signature for the same reason: a submit
 * function that accepts a payload will eventually be handed an unverified one
 * by a caller in a hurry.
 *
 * Outside the public evidence kit, like everything else that writes.
 */

import {
  withRpcDiscipline,
  type SolanaRpcHandle,
} from "./rpc.ts";
import { sendTransactionOnce, SolanaSubmitRpcError } from "./submit-rpc.ts";
import type { SignedTransferCheck } from "./signature.ts";
import { claimIntent, intentKey, rememberIntent } from "./submit-once.ts";
import type { TransferPlan } from "./transaction.ts";

export type SubmitFailure = Readonly<{
  ok: false;
  code:
    | "NOT_CLEARED"
    | "REJECTED"
    | "AMBIGUOUS"
    | "SIGNATURE_MISMATCH"
    | "NOT_CONFIRMED"
    | "DUPLICATE";
  reason: string;
  /** Present when the network accepted the transaction but it did not confirm. */
  signature: string | null;
}>;

export type SubmitSuccess = Readonly<{
  ok: true;
  signature: string;
  submittedAt: string;
  /** What the cluster said when asked whether it landed. */
  confirmation: Readonly<{ slot: string; status: "confirmed" | "finalized"; err: string | null }>;
}>;

export type SubmitResult = SubmitSuccess | SubmitFailure;

const CONFIRM_ATTEMPTS = 30;
const CONFIRM_INTERVAL_MS = 1_000;
const CONFIRM_DEADLINE_MS = 20_000;
const MAX_CONFIRM_DEADLINE_MS = 45_000;

const DEADLINE = Symbol("confirmation-deadline");

async function withinDeadline<T>(pending: Promise<T>, remainingMs: number): Promise<T | typeof DEADLINE> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<typeof DEADLINE>((resolve) => {
        timer = setTimeout(() => resolve(DEADLINE), Math.max(1, remainingMs));
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function confirm(
  handle: SolanaRpcHandle,
  signature: string,
  options: Readonly<{ deadlineMs: number; intervalMs: number }>,
): Promise<SubmitSuccess["confirmation"] | null> {
  const deadlineAt = Date.now() + options.deadlineMs;
  for (let attempt = 0; attempt < CONFIRM_ATTEMPTS; attempt += 1) {
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) return null;
    try {
      const response = await withinDeadline(
        withRpcDiscipline(handle, (abortSignal) =>
          handle.rpc
            .getSignatureStatuses([signature as never], { searchTransactionHistory: true })
            .send({ abortSignal }),
        ),
        remaining,
      );
      if (response === DEADLINE) return null;
      const status = response.value[0];
      if (status && (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized")) {
        return {
          slot: String(status.slot),
          status: status.confirmationStatus,
          /* A confirmed transaction that failed on chain is still confirmed.
             The error travels with it rather than being turned into a throw,
             because "it landed and failed" is the outcome the receipt has to
             carry honestly. */
          err: status.err === null ? null : JSON.stringify(status.err),
        };
      }
    } catch {
      /* A transient status read is not an answer about the transaction. */
    }
    const waitMs = Math.min(options.intervalMs, Math.max(0, deadlineAt - Date.now()));
    if (waitMs <= 0) return null;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  return null;
}

/**
 * Submit a transfer whose signature has already been verified over the exact
 * bytes that were built. Never throws.
 */
export async function submitClearedTransfer(args: {
  handle: SolanaRpcHandle;
  plan: TransferPlan;
  check: SignedTransferCheck;
  signedWireBase64: string;
  now?: Date;
  confirmationDeadlineMs?: number;
  confirmationPollIntervalMs?: number;
  operationDeadlineAt?: number;
}): Promise<SubmitResult> {
  const { handle, check } = args;

  if (check.verdict !== "CLEARED" || check.signature.value === null) {
    return {
      ok: false,
      code: "NOT_CLEARED",
      reason: `This transfer is ${check.verdict}, so it is not submitted. ${check.detail}`,
      signature: null,
    };
  }

  const key = intentKey({ network: args.plan.network, messageHash: args.plan.fingerprint.messageHash });
  const claimed = claimIntent(key, args.now?.toISOString());
  if (!claimed.ok) {
    return {
      ok: false,
      code: "DUPLICATE",
      reason: `This transfer was already submitted${claimed.record.signature ? ` as ${claimed.record.signature}` : ""}. It is not sent again.`,
      signature: claimed.record.signature,
    };
  }

  /* The verified first signature is the Solana transaction id. Persist it
     before request bytes leave the process: a timeout after acceptance cannot
     take away the only identifier recovery can safely read. */
  const localSignature = check.signature.value;
  rememberIntent({ key, signature: localSignature, at: args.now?.toISOString() });

  let accepted: string;
  try {
    accepted = await sendTransactionOnce({
      handle,
      signedWireBase64: args.signedWireBase64,
      deadlineAt: args.operationDeadlineAt,
    });
  } catch (failure) {
    const message = failure instanceof Error ? failure.message : String(failure);
    if (failure instanceof SolanaSubmitRpcError) {
      return {
        ok: false,
        code: "REJECTED",
        reason: message,
        signature: null,
      };
    }
    return {
      ok: false,
      code: "AMBIGUOUS",
      reason: `The submit transport ended without an RPC answer. The transaction may have reached the cluster; recover ${localSignature} and never submit these bytes again. ${message}`,
      signature: localSignature,
    };
  }

  if (accepted !== localSignature) {
    return {
      ok: false,
      code: "SIGNATURE_MISMATCH",
      reason: `The RPC returned ${accepted}, but the locally verified transaction id is ${localSignature}. Recover the local id; never resubmit these bytes.`,
      signature: localSignature,
    };
  }

  const routeRemainingMs = args.operationDeadlineAt === undefined
    ? MAX_CONFIRM_DEADLINE_MS
    : Math.max(0, args.operationDeadlineAt - Date.now() - 2_000);
  const confirmationDeadlineMs = Math.max(
    0,
    Math.min(
      args.confirmationDeadlineMs ?? CONFIRM_DEADLINE_MS,
      MAX_CONFIRM_DEADLINE_MS,
      routeRemainingMs,
    ),
  );
  if (confirmationDeadlineMs === 0) {
    return {
      ok: false,
      code: "NOT_CONFIRMED",
      reason: `The request deadline left no safe confirmation window after ${localSignature} was submitted. Recover the preserved signature; never resubmit these bytes.`,
      signature: localSignature,
    };
  }
  const confirmation = await confirm(handle, localSignature, {
    deadlineMs: confirmationDeadlineMs,
    intervalMs: Math.max(1, args.confirmationPollIntervalMs ?? CONFIRM_INTERVAL_MS),
  });
  if (!confirmation) {
    return {
      ok: false,
      code: "NOT_CONFIRMED",
      reason: `The cluster accepted ${localSignature} but it had not confirmed inside the ${confirmationDeadlineMs}ms route-safe deadline. The signature is real and can be read back later; nothing here decides what happened to it.`,
      signature: localSignature,
    };
  }

  return {
    ok: true,
    signature: localSignature,
    submittedAt: (args.now ?? new Date()).toISOString(),
    confirmation,
  };
}
