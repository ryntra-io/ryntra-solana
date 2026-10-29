/**
 * Payment requests — one payment on its way per request (MC-1; audit 24.10, B9).
 *
 * Before MC-1 a retry after a lost answer built a second transaction with a fresh blockhash: the payer signed again and
 * could pay twice. Now a request holds one attempt, written before its bytes are broadcast, with the payer's own
 * signature («sent, the result unknown»), the same way partner payouts arm before they send. While that attempt can
 * still land — until its bytes' last block height is behind the chain, with a margin — no other transaction is built or
 * sent for the request; the page follows the signature. A send the node refused before it took the bytes (preflight)
 * releases the attempt at once; anything else — a timeout, a dropped answer — waits for the chain to decide.
 *
 * One versioned row per request in `paymentAttempts`, compare-and-set: two tabs or two devices cannot both arm.
 */

import { getBase58Decoder, getTransactionDecoder } from "@solana/kit";

import { withBoundedCasRetry, type GuardStore } from "../guard/store.ts";
import { SolanaSubmitRpcError } from "../solana/submit-rpc.ts";

const ATTEMPTS = "paymentAttempts" as const;

/** Past the bytes' own life, how long a sent attempt is still waited for before it is called dead. */
export const ATTEMPT_GRACE_MS = 90_000;

export type PaymentAttempt = Readonly<{
  version: number;
  requestId: string;
  intentId: string;
  /** The payer's signature on the bytes sent: the transaction's id on chain. */
  signature: string;
  /** SUBMITTED_UNKNOWN until the chain decides; RELEASED when the node refused before it took the bytes. */
  state: "SUBMITTED_UNKNOWN" | "RELEASED";
  armedAt: string;
  /** Their intent's life plus `ATTEMPT_GRACE_MS`: the earliest moment the chain may be asked whether the bytes can still
      land. The clock alone never says they cannot (supervisor 25.10). */
  deadAt: string;
}>;

export type ArmResult =
  | Readonly<{ ok: true; attempt: PaymentAttempt }>
  | Readonly<{ ok: false; code: "ALREADY_SUBMITTED" | "PAYMENT_IN_FLIGHT"; signature: string }>;

/** The payer's signature on signed wire bytes, base58; null when the bytes carry none for the payer. */
export function payerSignatureOf(signedWireBase64: string, payer: string): string | null {
  try {
    const transaction = getTransactionDecoder().decode(Buffer.from(signedWireBase64, "base64"));
    const signature = (transaction.signatures as Record<string, Uint8Array | null>)[payer];
    return signature && signature.some((byte) => byte !== 0) ? getBase58Decoder().decode(signature) : null;
  } catch {
    return null;
  }
}

export async function readPaymentAttempt(store: GuardStore, requestId: string): Promise<PaymentAttempt | null> {
  return (await store.versioned<PaymentAttempt>(ATTEMPTS).get(requestId)) ?? null;
}

/**
 * Whether an attempt may still land: sent and not yet seen. Only the chain may say a sent payment is dead — block height
 * or `isBlockhashValid` on two independent nodes (`lib/solana/blockhash-life.ts`, row AG-1), not built here yet — and a
 * clock never does: a slow or halted network keeps old bytes valid past any wall-clock margin, and a request payable
 * again then is a second payment. So a sent attempt stays in flight until it is seen or the node refused it (supervisor
 * 25.10, critic MAJOR on PR #889); `_now` stays for the chain check that will use `deadAt`.
 */
export function attemptInFlight(attempt: PaymentAttempt | null, _now: Date): boolean {
  return attempt !== null && attempt.state === "SUBMITTED_UNKNOWN";
}

/**
 * Arms the request's one attempt before its bytes are broadcast. Refused when an attempt is already in flight — the
 * same intent's (`ALREADY_SUBMITTED`) or another's (`PAYMENT_IN_FLIGHT`) — so a second payment never leaves.
 */
export async function armPaymentAttempt(
  store: GuardStore,
  input: Readonly<{ requestId: string; intentId: string; signature: string; intentExpiresAt: string; now: Date }>,
): Promise<ArmResult> {
  const attempts = store.versioned<PaymentAttempt>(ATTEMPTS);
  return withBoundedCasRetry(async () => {
    const current = (await attempts.get(input.requestId)) ?? null;
    if (current && current.intentId === input.intentId && current.state === "SUBMITTED_UNKNOWN") return { ok: false, code: "ALREADY_SUBMITTED", signature: current.signature } as const;
    if (current && attemptInFlight(current, input.now)) return { ok: false, code: "PAYMENT_IN_FLIGHT", signature: current.signature } as const;
    const next: PaymentAttempt = {
      version: (current?.version ?? 0) + 1,
      requestId: input.requestId,
      intentId: input.intentId,
      signature: input.signature,
      state: "SUBMITTED_UNKNOWN",
      armedAt: input.now.toISOString(),
      deadAt: new Date(Date.parse(input.intentExpiresAt) + ATTEMPT_GRACE_MS).toISOString(),
    };
    return (await attempts.compareAndSet(input.requestId, current?.version ?? null, next)) ? ({ ok: true, attempt: next } as const) : false;
  });
}

/** Releases an armed attempt the node refused before it took the bytes; another state is left as it is. */
export async function releasePaymentAttempt(store: GuardStore, attempt: PaymentAttempt): Promise<boolean> {
  return store.versioned<PaymentAttempt>(ATTEMPTS).compareAndSet(attempt.requestId, attempt.version, { ...attempt, version: attempt.version + 1, state: "RELEASED" });
}

/**
 * Whether a failed `sendTransaction` certainly did not take the bytes: the node's own refusal before broadcast — the
 * preflight's simulation (-32002), a signature it could not verify (-32003), parameters it would not read (-32602) —
 * or an HTTP 401, 403, 413 or 429 before any JSON-RPC answer. A timeout, a dropped connection, a 408, a 499 or a 5xx
 * may have been taken by a proxy that forwarded the bytes: unknown.
 */
export function sendCertainlyRefused(failure: unknown): boolean {
  /* A preflight that says the transaction was already processed has landed it, not refused it. */
  if (failure instanceof SolanaSubmitRpcError) return ["-32002", "-32003", "-32602"].includes(failure.rpcCode) && !/AlreadyProcessed/i.test(JSON.stringify(failure.rpcData ?? null) + failure.message);
  return failure instanceof Error && /answered HTTP (401|403|413|429) to sendTransaction/.test(failure.message);
}

/**
 * The operator's stop for payments through Ryntra (audit 24.10, B9: there was none): `RYNTRA_PAY_STATE=PAUSED` stops
 * every build and every send; following a payment already sent goes on. Unset is open — as /pay was before MC-1.
 */
export function payPaused(env: Readonly<Record<string, string | undefined>>): boolean {
  return env.RYNTRA_PAY_STATE?.trim().toUpperCase() === "PAUSED";
}
