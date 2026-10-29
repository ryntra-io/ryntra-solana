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
import { attemptInFlight, readPaymentAttempt } from "./attempt.ts";
import { observeTransfer } from "../solana/observe.ts";
import type { ObservedPayment } from "../solana/payment-request.ts";
import { withRpcDiscipline, type SolanaRpcHandle } from "../solana/rpc.ts";
import { TOKEN_2022_PROGRAM_ID } from "../solana/types.ts";
import {
  emptySettlement,
  settlementAfterFailedRead,
  settlementFromMatch,
  settlementPaid,
  type PaymentRequestRecord,
  type PaymentRequestSettlement,
} from "./model.ts";
import { readPaymentSettlement, writePaymentSettlement } from "./store.ts";

/** A successful read younger than this is reused rather than repeated. */
export const OBSERVATION_FRESH_MS = 8_000;
/** How many signatures one listing call returns at most — the node's own page. */
const SIGNATURE_PAGE = 1_000;
/** How many pages one read lists before it calls the history too long to see whole. */
const SIGNATURE_PAGES_MAX = 10;
/**
 * How many landed transactions one read follows one by one. The reference is
 * public: anyone can land empty transactions carrying it, and a read that kept
 * only the newest few would let them push a real payment out of sight; a read
 * that refused a long history would let them hold the request in «checking»
 * (SEC-1, FIX-PAY-1). With the store, a read takes the next ones after the
 * last it judged, oldest first, so the history is read through over a few
 * visits and nothing is read twice.
 */
export const REFERENCE_TRANSACTIONS_MAX = 32;
/**
 * Credits in the requested mint kept one by one per reference; past it the
 * rest fold into the last entry (summed, `count` of them), so no credit is
 * ever dropped however many are put under a public reference.
 */
const CREDITS_KEPT = 32;

const READS = "paymentReferenceReads" as const;

export type ObservedReferencePayment = ObservedPayment & { payer: string | null; blockTime: string | null };

/** How far one reference was read: the last signature judged (oldest first) and every credit found up to it. */
type ReferenceReadRecord = Readonly<{
  version: number;
  reference: string;
  recipient: string;
  mint: string | null;
  cursor: string | null;
  /** The requested mint's credits (the last may stand for several), and at most one credit in another token. */
  credits: readonly ObservedReferencePayment[];
  /**
   * A listing once ended before the oldest signature (more than the pages
   * reach): something older may never have been read, so no read of this
   * reference calls itself complete again.
   */
  unlisted?: boolean;
}>;

type SignatureRow = Readonly<{ signature: string; err: unknown; blockTime: number | bigint | null }>;

export type ReferencePaymentsRead =
  | Readonly<{
      ok: true;
      /** Every credit found, oldest first. */
      payments: readonly ObservedReferencePayment[];
      /** False while transactions carrying the reference may still be unread: the payments are a lower bound. */
      complete: boolean;
    }>
  | Readonly<{ ok: false; reason: string }>;

/** The facts a credit is read from — what `observeTransfer` reports, or the same read without its bounds. */
export type CreditFacts = Readonly<{
  transactionSucceeded: boolean;
  observation: Readonly<{
    balanceDeltas: readonly Readonly<{ account: string; mint: string; rawDelta: string }>[];
    lamportBalanceDeltas: readonly Readonly<{ account: string; rawDelta: string }>[];
    blockTime: string | null;
  }>;
  postTokenAccounts: readonly Readonly<{ account: string; mint: string; owner: string | null; tokenProgram: string | null }>[];
}>;

/** Newest first, page by page, until the listing ends, the signature `stopAt` shows up, or the pages run out. */
async function listSignatures(
  handle: SolanaRpcHandle,
  request: Pick<PaymentRequestRecord, "reference">,
  stopAt: string | null,
): Promise<Readonly<{ ok: true; rows: readonly SignatureRow[]; whole: boolean; reachedStop: boolean }> | Readonly<{ ok: false; reason: string }>> {
  const rows: SignatureRow[] = [];
  let before: string | undefined;
  for (let page = 0; page < SIGNATURE_PAGES_MAX; page += 1) {
    let batch: readonly SignatureRow[];
    try {
      const response = await withRpcDiscipline(handle, (abortSignal) =>
        handle.rpc
          .getSignaturesForAddress(request.reference as never, { limit: SIGNATURE_PAGE, commitment: "confirmed", ...(before ? { before: before as never } : {}) })
          .send({ abortSignal }),
      );
      batch = response as unknown as readonly SignatureRow[];
    } catch (failure) {
      return { ok: false, reason: failure instanceof Error ? failure.message : String(failure) };
    }
    rows.push(...batch);
    if (stopAt !== null && batch.some((row) => row.signature === stopAt)) return { ok: true, rows, whole: false, reachedStop: true };
    if (batch.length < SIGNATURE_PAGE) return { ok: true, rows, whole: true, reachedStop: false };
    before = batch[batch.length - 1]?.signature;
  }
  return { ok: true, rows, whole: false, reachedStop: false };
}

type RawBalance = Readonly<{ accountIndex: number; mint: string; owner?: string; programId?: string; uiTokenAmount: { amount: string } }>;

/**
 * The credit facts of one transaction read straight from the ledger, without
 * the bounds of the Send lane's observation schema (16 token and 64 lamport
 * movements). A transaction that moves more than those is still a
 * transaction: put under a public reference it must not stop every read
 * after it (FIX-PAY-1). Null when the node has no such transaction or no
 * metadata for it — that read is retried, not judged.
 */
async function readCreditFactsUnbounded(handle: SolanaRpcHandle, signature: string): Promise<CreditFacts | null> {
  const response = (await withRpcDiscipline(handle, (abortSignal) =>
    handle.rpc
      .getTransaction(signature as never, { encoding: "json", commitment: "confirmed", maxSupportedTransactionVersion: 1 } as never)
      .send({ abortSignal }),
  )) as unknown as {
    blockTime?: number | bigint | null;
    meta?: {
      err: unknown;
      preBalances?: readonly (number | bigint)[];
      postBalances?: readonly (number | bigint)[];
      preTokenBalances?: readonly RawBalance[];
      postTokenBalances?: readonly RawBalance[];
      loadedAddresses?: { writable?: readonly unknown[]; readonly?: readonly unknown[] };
    } | null;
    transaction?: { message?: { accountKeys?: readonly unknown[] } };
  } | null;
  if (!response?.meta || !response.transaction?.message?.accountKeys) return null;
  const meta = response.meta;
  const key = (value: unknown) => (typeof value === "object" && value !== null && "pubkey" in value ? String((value as { pubkey: unknown }).pubkey) : String(value));
  const keys = [...response.transaction.message.accountKeys, ...(meta.loadedAddresses?.writable ?? []), ...(meta.loadedAddresses?.readonly ?? [])].map(key);
  const lamportBalanceDeltas = keys
    .map((account, index) => ({ account, rawDelta: (BigInt(meta.postBalances?.[index] ?? 0) - BigInt(meta.preBalances?.[index] ?? 0)).toString() }))
    .filter((entry) => entry.rawDelta !== "0");
  const before = new Map((meta.preTokenBalances ?? []).map((entry) => [`${entry.accountIndex}:${entry.mint}`, entry]));
  const after = new Map((meta.postTokenBalances ?? []).map((entry) => [`${entry.accountIndex}:${entry.mint}`, entry]));
  const balanceDeltas = [];
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    const sample = after.get(id) ?? before.get(id);
    if (!sample) continue;
    const moved = BigInt(after.get(id)?.uiTokenAmount.amount ?? "0") - BigInt(before.get(id)?.uiTokenAmount.amount ?? "0");
    if (moved !== 0n) balanceDeltas.push({ account: keys[sample.accountIndex] ?? `index:${sample.accountIndex}`, mint: sample.mint, rawDelta: moved.toString() });
  }
  return {
    transactionSucceeded: meta.err === null || meta.err === undefined,
    observation: {
      balanceDeltas,
      lamportBalanceDeltas,
      blockTime: response.blockTime === null || response.blockTime === undefined ? null : new Date(Number(response.blockTime) * 1_000).toISOString(),
    },
    postTokenAccounts: (meta.postTokenBalances ?? []).map((entry) => ({
      account: keys[entry.accountIndex] ?? `index:${entry.accountIndex}`,
      mint: entry.mint,
      owner: entry.owner ?? null,
      tokenProgram: entry.programId ?? null,
    })),
  };
}

/**
 * Add one credit to what a reference holds: the requested mint's one by one
 * up to `CREDITS_KEPT`, the rest folded into the last entry (summed, the
 * latest signature, `count` of them); another token only as the first such
 * credit — the evidence for WRONG_TOKEN, never a sum.
 */
function addCredit(
  credits: readonly ObservedReferencePayment[],
  entry: ObservedReferencePayment,
  requestedMint: string | null,
  /** Without a store every credit of one read is returned: a caller keeping its own record (the credits order) sees each. */
  kept: boolean,
): ObservedReferencePayment[] {
  if (credits.some((existing) => existing.signature === entry.signature)) return [...credits];
  if (!kept) return [...credits, entry];
  if (entry.mint !== requestedMint) return credits.some((existing) => existing.mint !== requestedMint) ? [...credits] : [...credits, entry];
  const inMint = credits.filter((existing) => existing.mint === requestedMint);
  if (inMint.length < CREDITS_KEPT) return [...credits, entry];
  const last = inMint[inMint.length - 1];
  const fee = BigInt(last.feeWithheldRaw ?? "0") + BigInt(entry.feeWithheldRaw ?? "0");
  const folded: ObservedReferencePayment = {
    ...entry,
    creditedRaw: (BigInt(last.creditedRaw) + BigInt(entry.creditedRaw)).toString(),
    ...(fee > 0n ? { feeWithheldRaw: fee.toString() } : {}),
    count: (last.count ?? 1) + 1,
  };
  return credits.map((existing) => (existing === last ? folded : existing));
}

/**
 * Read the confirmed transactions that carry the reference and reduce each to
 * what the recipient was credited. Failed transactions are skipped: a transfer
 * that did not land credited nobody. So is one that landed and credited
 * nothing: the reference is public, and anyone can carry it.
 *
 * With `store` the read goes on from where the last one stopped and keeps
 * what it found, so every transaction is read once and the whole history is
 * read in time however much was put under the reference. Without it, the
 * newest `REFERENCE_TRANSACTIONS_MAX` landed transactions are read. Either
 * way `complete: false` says that some may still be unread.
 */
export async function readReferencePayments(
  handle: SolanaRpcHandle,
  request: Pick<PaymentRequestRecord, "reference" | "recipient" | "mint">,
  options: Readonly<{ store?: GuardStore }> = {},
): Promise<ReferencePaymentsRead> {
  const reads = options.store?.versioned<ReferenceReadRecord>(READS) ?? null;
  let saved: ReferenceReadRecord | null = null;
  if (reads) {
    try {
      saved = (await reads.get(request.reference)) ?? null;
    } catch {
      saved = null;
    }
  }
  /* Kept only for the same request's terms: a record about another recipient or mint starts again. */
  const fresh = (record: ReferenceReadRecord | null) => ({ cursor: null, credits: [] as readonly ObservedReferencePayment[], unlisted: false, version: record?.version ?? 0 });
  let base =
    saved && saved.recipient === request.recipient && saved.mint === request.mint
      ? { cursor: saved.cursor, credits: saved.credits, unlisted: saved.unlisted === true, version: saved.version }
      : fresh(saved);

  const listed = await listSignatures(handle, request, base.cursor);
  if (!listed.ok) return listed;
  if (base.cursor && !listed.reachedStop && listed.whole) {
    /* The last signature judged is gone from a whole listing (a fork, or a node that keeps less): read from the start. */
    base = fresh(saved);
  }
  /* A listing that ended before the oldest signature leaves something unlisted, for good. */
  const unlisted = base.unlisted || (!listed.whole && !listed.reachedStop);

  /* Oldest first: the requested mint's credits add up in order, and the one that reaches the asked amount settles it. */
  const ordered = [...listed.rows].reverse();
  const cursorAt = base.cursor ? ordered.findIndex((row) => row.signature === base.cursor) : -1;
  const after = cursorAt >= 0 ? ordered.slice(cursorAt + 1) : ordered;
  const landed = (row: SignatureRow) => row.err === null || row.err === undefined;

  /* Without a place to keep progress, the newest ones: a payment is most likely among them. */
  const queue = reads ? after : after.filter(landed).slice(-REFERENCE_TRANSACTIONS_MAX);
  let credits: ObservedReferencePayment[] = [...base.credits];
  let cursor = base.cursor;
  let followed = 0;
  let stopped = false;
  let failure: string | null = null;
  for (const row of queue) {
    if (!landed(row)) {
      cursor = row.signature;
      continue;
    }
    if (followed >= REFERENCE_TRANSACTIONS_MAX) {
      stopped = true;
      break;
    }
    followed += 1;
    let facts: CreditFacts | null = null;
    const observed = await observeTransfer(handle, row.signature, {
      actionRef: request.mint === null ? NATIVE_SOL_TRANSFER_ACTION_REF : SPL_TRANSFER_ACTION_REF,
    });
    if (observed.ok) facts = observed;
    else if (observed.code === "UNREADABLE") {
      try {
        facts = await readCreditFactsUnbounded(handle, row.signature);
      } catch {
        facts = null;
      }
    }
    if (facts === null) {
      /* One unread transaction makes the read incomplete. Reporting "nothing
         arrived" on a partial read is how a paid request stays Awaiting, and
         reporting "paid" on one is worse. What was judged before it is kept,
         and the next read tries this one again. */
      failure = `${row.signature}: ${observed.ok ? "unreadable" : observed.reason}`;
      break;
    }
    cursor = row.signature;
    if (!facts.transactionSucceeded) continue;
    const credited = creditedToRecipient(facts, request);
    /* Carrying the reference is not paying: a transaction that credited the
       recipient nothing is nobody's payment (SEC-1, FIX-PAY-1). */
    if (BigInt(credited.amountRaw) <= 0n) continue;
    credits = addCredit(
      credits,
      {
        signature: row.signature,
        creditedRaw: credited.amountRaw,
        mint: credited.mint,
        ...(credited.feeWithheldRaw ? { feeWithheldRaw: credited.feeWithheldRaw } : {}),
        payer: facts.observation.lamportBalanceDeltas[0]?.account ?? null,
        blockTime: facts.observation.blockTime,
      },
      request.mint,
      reads !== null,
    );
  }

  if (reads && (cursor !== (saved?.cursor ?? null) || unlisted !== (saved?.unlisted === true) || saved?.recipient !== request.recipient || saved?.mint !== request.mint)) {
    const next: ReferenceReadRecord = {
      version: base.version + 1,
      reference: request.reference,
      recipient: request.recipient,
      mint: request.mint,
      cursor,
      credits,
      ...(unlisted ? { unlisted: true } : {}),
    };
    try {
      /* Lost to another reader: it wrote the same chain facts, or further on. */
      await reads.compareAndSet(request.reference, saved?.version ?? null, next);
    } catch {
      /* Progress not kept: the next read judges these again. */
    }
  }
  if (failure !== null) return { ok: false, reason: failure };
  const unreadBehind = !reads && after.filter(landed).length > REFERENCE_TRANSACTIONS_MAX;
  return { ok: true, payments: credits, complete: !stopped && !unreadBehind && !unlisted };
}

/**
 * What one transaction credited the recipient, in the requested mint when
 * that is what moved, or in whatever moved when it was something else (so
 * `matchPayment` can say WRONG_TOKEN rather than "nothing").
 *
 * A credit is the recipient's own balance going up: the wallet's lamports for
 * SOL, the recipient-owned accounts of the mint for a token (owner as the
 * ledger reports it after the transaction). A transaction that carries the
 * reference and moves nothing to the recipient comes back as "0" — no payment
 * (SEC-1, FIX-PAY-1).
 *
 * For a Token-2022 mint the transfer fee the token withholds is read from the
 * same transaction: the mint's balances across every account fall by exactly
 * what was withheld (a transfer between accounts nets to zero), so a payment
 * short by the fee can be said to be short by the fee.
 */
export function creditedToRecipient(
  observed: CreditFacts,
  request: Pick<PaymentRequestRecord, "recipient" | "mint">,
): Readonly<{ amountRaw: string; mint: string | null; feeWithheldRaw?: string }> {
  const lamportCredit = (): bigint => {
    const delta = observed.observation.lamportBalanceDeltas.find((entry) => entry.account === request.recipient);
    return delta ? BigInt(delta.rawDelta) : 0n;
  };
  const deltaOf = (account: Readonly<{ account: string; mint: string }>): bigint => {
    const delta = observed.observation.balanceDeltas.find((entry) => entry.account === account.account && entry.mint === account.mint);
    return delta ? BigInt(delta.rawDelta) : 0n;
  };

  if (request.mint === null) {
    const raw = lamportCredit();
    if (raw > 0n) return { amountRaw: raw.toString(), mint: null };
  }
  /* Token side: the recipient's own token accounts, by owner. */
  const owned = observed.postTokenAccounts.filter((account) => account.owner === request.recipient);
  if (request.mint !== null) {
    const inRequested = owned.filter((account) => account.mint === request.mint);
    /* Signed: a move between two of the recipient's own accounts is no money in. */
    let credited = 0n;
    for (const account of inRequested) credited += deltaOf(account);
    if (credited > 0n) {
      const token2022 = inRequested.some((account) => account.tokenProgram === TOKEN_2022_PROGRAM_ID);
      const ownAccounts = new Set(inRequested.map((account) => account.account));
      const moved = observed.observation.balanceDeltas.filter((entry) => entry.mint === request.mint);
      const net = moved.reduce((sum, entry) => sum + BigInt(entry.rawDelta), 0n);
      /* The fee is named only where the transaction paid this recipient alone: another account that gained in the
         mint (a batch to others, with fees of its own) would make the fall more than this payment's fee. */
      const alone = moved.every((entry) => ownAccounts.has(entry.account) || BigInt(entry.rawDelta) < 0n);
      const withheld = token2022 && alone && net < 0n ? -net : 0n;
      return withheld > 0n
        ? { amountRaw: credited.toString(), mint: request.mint, feeWithheldRaw: withheld.toString() }
        : { amountRaw: credited.toString(), mint: request.mint };
    }
  }
  /* Nothing in the requested mint: what else reached the recipient, if anything. */
  let best: { amountRaw: bigint; mint: string } | null = null;
  for (const account of owned) {
    if (account.mint === request.mint) continue;
    const raw = deltaOf(account);
    if (raw <= 0n) continue;
    if (!best || raw > best.amountRaw) best = { amountRaw: raw, mint: account.mint };
  }
  if (best) return { amountRaw: best.amountRaw.toString(), mint: best.mint };
  if (request.mint !== null) {
    const raw = lamportCredit();
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

  /* A settlement that called a request paid without a credit (written before FIX-PAY-1, by a transaction that moved
     nothing) is no verdict: it is read again. */
  if (settlementPaid(previous)) return previous;
  const expired = now.getTime() >= Date.parse(args.request.expiresAt);
  const lastRead = previous.observedAt ? Date.parse(previous.observedAt) : null;
  /* A history still being read through goes on at every visit. */
  const partial = previous.partial === true;
  if (!args.force && !partial && lastRead !== null && now.getTime() - lastRead < OBSERVATION_FRESH_MS) return previous;
  /* An expired request with nothing pending is not re-read on every visit:
     the last observation stands. A pending submit is still followed up. */
  if (expired && !partial && previous.state !== "PENDING" && lastRead !== null && !args.force) return previous;

  const read = await readReferencePayments(args.handle, args.request, { store: args.store });
  let next = read.ok
    ? settlementFromMatch({ previous, request: args.request, observed: read.payments, now, partial: !read.complete })
    : settlementAfterFailedRead(previous, now, read.reason);
  /* MC-1: a payment sent and never seen, whose bytes can no longer land (or that the node refused), is no payment —
     the request is payable again. Only a complete read says so; a failed one keeps the wait. */
  if (read.ok && next.state === "PENDING") {
    const attempt = await readPaymentAttempt(args.store, args.request.id);
    if (attempt && !attemptInFlight(attempt, now)) next = { ...next, state: "NONE", signature: null };
  }
  await writePaymentSettlement(args.store, next);

  /* `previous` cannot be paid here — a paid settlement returned above — so a
     paid `next` is the transition, and the one moment Activity is written. */
  const becamePaid = settlementPaid(next);
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
