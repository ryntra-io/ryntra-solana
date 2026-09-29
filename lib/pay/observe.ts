/**
 * Payment requests — observing the reference on chain.
 *
 * The one question this file answers is "did a transaction carrying *this*
 * request's reference key credit the recipient in the requested token, and
 * how much?". It reads signatures for the reference, hands each transaction
 * to the Send lane's `observeTransfer` (the same balance-delta reader every
 * settlement in this product relies on), reduces the deltas to what the
 * recipient was credited, and lets the pure `matchPayment` decide.
 *
 * It never looks at the recipient's balance history for an amount that
 * "looks right": a payment without the reference is somebody else's payment.
 */

import {
  NATIVE_SOL_TRANSFER_ACTION_REF,
  SPL_TRANSFER_ACTION_REF,
} from "../agent-control/adapters/solana-token-2022.ts";
import type { GuardStore } from "../guard/store.ts";
import { recordSolanaAction } from "../solana/action-ledger.ts";
import { observeTransfer } from "../solana/observe.ts";
import type { ObservedPayment } from "../solana/payment-request.ts";
import { withRpcDiscipline, type SolanaRpcHandle } from "../solana/rpc.ts";
import {
  emptySettlement,
  settlementAfterFailedRead,
  settlementFromMatch,
  type PaymentRequestRecord,
  type PaymentRequestSettlement,
} from "./model.ts";
import { readPaymentSettlement, writePaymentSettlement } from "./store.ts";

/** A successful read younger than this is reused rather than repeated. */
export const OBSERVATION_FRESH_MS = 8_000;
/** How many signatures under one reference are read. One is the normal case. */
const SIGNATURE_LIMIT = 8;

export type ObservedReferencePayment = ObservedPayment & { payer: string | null; blockTime: string | null };

type SignatureRow = Readonly<{ signature: string; err: unknown; blockTime: number | bigint | null }>;

/**
 * Read every confirmed transaction that carries the reference and reduce it
 * to what the recipient was credited. Failed transactions are skipped: a
 * transfer that did not land credited nobody.
 */
export async function readReferencePayments(
  handle: SolanaRpcHandle,
  request: Pick<PaymentRequestRecord, "reference" | "recipient" | "mint">,
): Promise<Readonly<{ ok: true; payments: readonly ObservedReferencePayment[] }> | Readonly<{ ok: false; reason: string }>> {
  let rows: readonly SignatureRow[];
  try {
    const response = await withRpcDiscipline(handle, (abortSignal) =>
      handle.rpc
        .getSignaturesForAddress(request.reference as never, { limit: SIGNATURE_LIMIT, commitment: "confirmed" })
        .send({ abortSignal }),
    );
    rows = response as unknown as readonly SignatureRow[];
  } catch (failure) {
    return { ok: false, reason: failure instanceof Error ? failure.message : String(failure) };
  }

  /* Oldest first: the first payment that satisfies the request settles it. */
  const ordered = [...rows].reverse();
  const payments: ObservedReferencePayment[] = [];
  for (const row of ordered) {
    if (row.err !== null && row.err !== undefined) continue;
    const observed = await observeTransfer(handle, row.signature, {
      actionRef: request.mint === null ? NATIVE_SOL_TRANSFER_ACTION_REF : SPL_TRANSFER_ACTION_REF,
    });
    if (!observed.ok) {
      /* One unreadable transaction makes the whole read incomplete. Reporting
         "nothing arrived" on a partial read is how a paid request stays
         Awaiting, and reporting "paid" on one is worse. */
      return { ok: false, reason: `${row.signature}: ${observed.reason}` };
    }
    if (!observed.transactionSucceeded) continue;
    const credited = creditedToRecipient(observed, request);
    const payer = observed.observation.lamportBalanceDeltas[0]?.account ?? null;
    payments.push({
      signature: row.signature,
      creditedRaw: credited.amountRaw,
      mint: credited.mint,
      payer,
      blockTime: observed.observation.blockTime,
    });
  }
  return { ok: true, payments };
}

/**
 * What one transaction credited the recipient, in the requested mint when
 * that is what moved, or in whatever moved when it was something else (so
 * `matchPayment` can say WRONG_TOKEN rather than "nothing").
 */
export function creditedToRecipient(
  observed: Awaited<ReturnType<typeof observeTransfer>> & { ok: true },
  request: Pick<PaymentRequestRecord, "recipient" | "mint">,
): Readonly<{ amountRaw: string; mint: string | null }> {
  if (request.mint === null) {
    const delta = observed.observation.lamportBalanceDeltas.find((entry) => entry.account === request.recipient);
    const raw = delta ? BigInt(delta.rawDelta) : 0n;
    if (raw > 0n) return { amountRaw: raw.toString(), mint: null };
  }
  /* Token side: the recipient's own token accounts, by owner, any mint. */
  const owned = observed.postTokenAccounts.filter((account) => account.owner === request.recipient);
  const inRequested = request.mint === null ? [] : owned.filter((account) => account.mint === request.mint);
  const candidates = inRequested.length > 0 ? inRequested : owned;
  let best: { amountRaw: bigint; mint: string } | null = null;
  for (const account of candidates) {
    const delta = observed.observation.balanceDeltas.find((entry) => entry.account === account.account && entry.mint === account.mint);
    if (!delta) continue;
    const raw = BigInt(delta.rawDelta);
    if (raw <= 0n) continue;
    if (!best || raw > best.amountRaw) best = { amountRaw: raw, mint: account.mint };
  }
  if (best) return { amountRaw: best.amountRaw.toString(), mint: best.mint };
  if (request.mint !== null) {
    const lamports = observed.observation.lamportBalanceDeltas.find((entry) => entry.account === request.recipient);
    const raw = lamports ? BigInt(lamports.rawDelta) : 0n;
    if (raw > 0n) return { amountRaw: raw.toString(), mint: null };
  }
  return { amountRaw: "0", mint: request.mint };
}

/**
 * Refresh the settlement for one request and persist it.
 *
 * Final states are never re-read: a paid request stays paid. A fresh read is
 * reused. A failed read counts as a failure and keeps the previous verdict.
 * When the request turns Paid, the recipient's Activity gets one `RECEIVE`
 * row keyed by the reference — public chain facts only.
 */
export async function refreshPaymentSettlement(args: {
  store: GuardStore;
  handle: SolanaRpcHandle;
  request: PaymentRequestRecord;
  now?: Date;
  force?: boolean;
}): Promise<PaymentRequestSettlement> {
  const now = args.now ?? new Date();
  const nowIso = now.toISOString();
  const previous = (await readPaymentSettlement(args.store, args.request.id)) ?? emptySettlement(args.request.id, nowIso);

  if (previous.state === "PAID" || previous.state === "OVERPAID") return previous;
  const expired = now.getTime() >= Date.parse(args.request.expiresAt);
  const lastRead = previous.observedAt ? Date.parse(previous.observedAt) : null;
  if (!args.force && lastRead !== null && now.getTime() - lastRead < OBSERVATION_FRESH_MS) return previous;
  /* An expired request with nothing pending is not re-read on every visit:
     the last observation stands. A pending submit is still followed up. */
  if (expired && previous.state !== "PENDING" && lastRead !== null && !args.force) return previous;

  const read = await readReferencePayments(args.handle, args.request);
  const next = read.ok
    ? settlementFromMatch({ previous, request: args.request, observed: read.payments, now })
    : settlementAfterFailedRead(previous, now, read.reason);
  await writePaymentSettlement(args.store, next);

  /* `previous` cannot be paid here — a paid settlement returned above — so a
     paid `next` is the transition, and the one moment Activity is written. */
  const becamePaid = next.state === "PAID" || next.state === "OVERPAID";
  if (becamePaid && next.signature && next.creditedRaw) {
    await recordSolanaAction(args.store, {
      network: "mainnet",
      wallet: args.request.recipient,
      actionId: `receive:${args.request.reference}`,
      lane: "RECEIVE",
      outcome: "DONE",
      in: { mint: args.request.mint, amountRaw: next.creditedRaw, decimals: args.request.decimals, symbol: args.request.symbol },
      out: null,
      destination: "SOLANA",
      signature: next.signature,
      now: nowIso,
    });
  }
  return next;
}
