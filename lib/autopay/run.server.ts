/**
 * One autopay payment, the executor's way: build the transaction (`./enable.ts` `paymentInstructions`), have
 * the executor's signer read it and sign it (`./signer.server.ts`), write the signature into the book under the claim's
 * attempt (`./store.server.ts` `sign`) — and only then hand it to the network, once. The window was claimed in the book
 * before the build, so whatever happens here that window is never paid twice:
 *
 * - nothing left the executor (the blockhash, the key or the journal did not answer) — `retry`: the window goes back to
 *   the queue after a pause and is tried again while it is open;
 * - the book did not take the signature — nothing is sent (`fenced` when another attempt holds the window);
 * - the executor's signer or the program refused — final for the window;
 * - sent, or perhaps sent (a cut connection says nothing) — `sent`: the pass reads the chain for the signature; one the
 *   chain never saw is given back only once its blockhash is past, so it can never land after a second try.
 *
 * No step waits on the chain: every call has its own deadline, and the pass keeps its own budget between payments.
 */

import { type Connection } from "@solana/web3.js";
import { getBase58Decoder } from "@solana/kit";

import { MAX_TRANSACTION_BYTES, unsignedTransaction, wireSize } from "../mandate/human.ts";
import { refusalOf } from "../mandate/ssa.ts";
import { paymentInstructions, type Autopay } from "./enable.ts";
import { AutopaySignerRefused, type AutopaySigner, type PaymentRequest } from "./signer.server.ts";

export type PaymentOutcome =
  | Readonly<{ status: "retry"; reason: string }>
  | Readonly<{ status: "fenced" }>
  | Readonly<{ status: "refused-by-executor"; reason: string }>
  | Readonly<{ status: "refused-in-simulation"; signature: string; reason: string }>
  | Readonly<{ status: "sent"; signature: string }>;

/** The longest one call to the network may take inside a pass. */
export const CALL_DEADLINE_MS = 5_000;

/** The promise, or a rejection once `ms` have passed. */
export function within<T>(ms: number, promise: Promise<T>, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} took longer than ${ms} ms`)), ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

/** The program's own refusal in a failed send's logs; null when the node said no such thing (a passing failure). */
export function programRefusal(error: unknown): string | null {
  const logs = (error as { logs?: unknown } | null)?.logs;
  if (!Array.isArray(logs) || !logs.length) return null;
  const lines = logs.map(String);
  const refusal = refusalOf(lines);
  if (refusal) return refusal.reason;
  return lines.some((line) => / failed: /.test(line)) ? "the program refused the payment" : null;
}

const reasonOf = (error: unknown) => (error instanceof Error ? error.message.split("\n")[0]!.slice(0, 160) : "failed");

/**
 * Pay one window: the request names the window and the moment, the signer checks both against the schedule; `record`
 * writes the signature and its last valid block height into the book, true — written for this attempt.
 */
export async function payWindow(
  input: Readonly<{
    connection: Connection;
    autopay: Autopay;
    signer: AutopaySigner;
    request: PaymentRequest;
    record: (signature: string, validHeight: number) => Promise<boolean>;
    deadlineMs?: number;
  }>,
): Promise<PaymentOutcome> {
  const { connection, autopay } = input;
  const deadline = input.deadlineMs ?? CALL_DEADLINE_MS;
  let blockhash: string;
  let lastValidBlockHeight: number;
  try {
    ({ blockhash, lastValidBlockHeight } = await within(deadline, connection.getLatestBlockhash("confirmed"), "the blockhash"));
  } catch (error) {
    return { status: "retry", reason: reasonOf(error) };
  }
  const tx = unsignedTransaction(autopay.terms.agent, paymentInstructions(autopay), blockhash, []);
  const size = wireSize(tx);
  if (size > MAX_TRANSACTION_BYTES) return { status: "refused-by-executor", reason: `the payment is ${size} bytes, over the ${MAX_TRANSACTION_BYTES}-byte limit` };
  let signature: Uint8Array;
  try {
    signature = await within(deadline, input.signer.signMessage(tx.message.serialize(), input.request), "the executor's key");
  } catch (error) {
    if (error instanceof AutopaySignerRefused) return { status: "refused-by-executor", reason: error.reason };
    /* The key or the journal did not answer: nothing was signed that can leave. */
    return { status: "retry", reason: reasonOf(error) };
  }
  tx.addSignature(autopay.terms.agent, signature);
  const id = getBase58Decoder().decode(signature);
  let written: boolean;
  try {
    written = await input.record(id, lastValidBlockHeight);
  } catch (error) {
    /* Not known to be in the book — not sent. Should it be there after all, the chain never sees it and it goes back. */
    return { status: "retry", reason: reasonOf(error) };
  }
  if (!written) return { status: "fenced" };
  try {
    /* Preflight on: the node simulates first, and a payment the program refuses never costs a fee. */
    await within(deadline, connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 }), "the send");
  } catch (error) {
    const refusal = programRefusal(error);
    if (refusal) return { status: "refused-in-simulation", signature: id, reason: refusal };
    /* A cut connection, a timeout, a 429 say nothing of whether the node took it: the signature is read back. */
  }
  return { status: "sent", signature: id };
}
