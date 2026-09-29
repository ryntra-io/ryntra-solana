/**
 * The watch over a wallet's USDC — one record per wallet in the Guard store
 * (`RYN-PAY-TRIGGERS-001`, canon v5.5 В38) — the events every «З кожної
 * оплати» rule of the wallet reads.
 *
 * Every five minutes, while the wallet has a rule of that kind turned on, the
 * monitoring tick reads the transactions that touched the wallet's USDC
 * account after the last one it read (`./payments-chain.server.ts`), keeps
 * the payments and the money that came in (`./payments.ts`), leaves out
 * Ryntra's own swaps, cross-swaps and bridges by their signatures in History,
 * and numbers each kept event once. A rule remembers the last number it took,
 * so an event is counted once by each rule and never twice by one.
 *
 * The watch keeps the person's own other accounts too — the ones they named
 * «це мій рахунок» — and no transfer to or from them is counted by any rule of
 * the wallet from then on.
 *
 * Nothing here moves money, builds an order or names a shop.
 */

import { z } from "zod";

import { withBoundedCasRetry, type GuardStore } from "../guard/store.ts";
import type { SolanaWalletAction } from "../solana/action-ledger.ts";
import { associatedTokenAccount } from "../solana/token-account.ts";
import { PAYMENT_OWN_ACCOUNTS_LIMIT } from "./limits.ts";
import { classifyMovement, PAYMENT_DIRECTIONS, PAYMENTS_USDC_MINT } from "./payments.ts";
import { readUsdcMovements, type ChainTransport, type MovementsRead } from "./payments-chain.server.ts";

const COLLECTION = "autoinvestPaymentWatch" as const;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,128}$/;
const Iso = z.string().datetime({ offset: true });
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

/** How many kept events the watch holds — more than any rule waits on between two passes. */
export const WATCH_EVENTS_KEPT = 50;
/** How many read signatures the watch remembers, kept or not, so no transaction is read twice. */
const WATCH_SEEN_KEPT = 120;

/** `ok` the last read proved itself · `partial` it could not prove every transaction was read · `unavailable` no endpoint answered. */
export const WATCH_READ_STATES = ["ok", "partial", "unavailable"] as const;
export type WatchReadState = (typeof WATCH_READ_STATES)[number];

export const PaymentWatchEventSchema = z
  .object({
    /** The watch's own number for the event: every rule counts events above the last number it took. */
    seq: z.number().int().min(1),
    signature: z.string().regex(SIGNATURE),
    slot: z.number().int().min(0),
    /** The block's time. */
    at: Iso,
    direction: z.enum(PAYMENT_DIRECTIONS),
    /** The wallet's USDC that left or arrived, in micro-dollars. */
    amountMicro: z.string().regex(/^\d+$/),
    /** The other side — never shown, only matched against the person's own accounts. */
    counterparty: z.string().regex(BASE58).nullable(),
    /** The Solana Pay label the transfer carried, cleaned; null without one. */
    memo: z.string().max(80).nullable(),
  })
  .strict();
export type PaymentWatchEvent = z.output<typeof PaymentWatchEventSchema>;

export const PaymentWatchRecordSchema = z
  .object({
    schema: z.literal("ryntra.autoinvest-payment-watch"),
    schemaVersion: z.literal("1.0.0"),
    owner: z.string().regex(BASE58),
    network: z.literal("solana:mainnet"),
    /** The wallet's USDC account — the associated account the chain derives for it. */
    account: z.string().regex(BASE58),
    /** The newest transaction read; the next read starts after it. Null before the first read. */
    cursor: z.object({ signature: z.string().regex(SIGNATURE), slot: z.number().int().min(0) }).strict().nullable(),
    /** The account's balance after the cursor's transaction, raw — where the next read's chain of balances starts. */
    balanceRaw: z.string().regex(/^\d+$/).nullable(),
    nextSeq: z.number().int().min(1),
    /** Oldest first, the last `WATCH_EVENTS_KEPT`. */
    events: z.array(PaymentWatchEventSchema).max(WATCH_EVENTS_KEPT),
    /** Signatures already read, kept or not — the newest `WATCH_SEEN_KEPT`. */
    seen: z.array(z.string().regex(SIGNATURE)).max(WATCH_SEEN_KEPT),
    /** The accounts the person named as their own: a transfer to or from one never counts. */
    ownAccounts: z.array(z.string().regex(BASE58)).max(PAYMENT_OWN_ACCOUNTS_LIMIT),
    readAt: Iso.nullable(),
    readState: z.enum(WATCH_READ_STATES),
    version: z.number().int().min(1),
    createdAt: Iso,
    updatedAt: Iso,
  })
  .strict();
export type PaymentWatchRecord = z.output<typeof PaymentWatchRecordSchema>;
type PaymentWatchDraft = Omit<PaymentWatchRecord, "version">;

export function paymentWatchKey(owner: string): string {
  return `solana:mainnet:${owner}`;
}

function watches(store: GuardStore) {
  return store.versioned<PaymentWatchRecord>(COLLECTION);
}

export async function readPaymentWatch(store: GuardStore, owner: string): Promise<PaymentWatchRecord | null> {
  if (!BASE58.test(owner)) return null;
  const raw = await watches(store).get(paymentWatchKey(owner));
  if (raw === undefined || raw === null) return null;
  const read = PaymentWatchRecordSchema.safeParse(raw);
  return read.success ? read.data : null;
}

/** Write the watch only while it still stands as it was read — the loser of a race re-reads. */
export async function writePaymentWatch(store: GuardStore, read: PaymentWatchRecord | null, next: PaymentWatchDraft): Promise<boolean> {
  const record = PaymentWatchRecordSchema.parse({ ...next, version: (read?.version ?? 0) + 1 });
  return watches(store).compareAndSet(paymentWatchKey(record.owner), read?.version ?? null, record);
}

/** The wallet's USDC account: the associated account of the classic token program. */
export async function usdcAccountOf(owner: string): Promise<string> {
  return associatedTokenAccount({ owner, mint: PAYMENTS_USDC_MINT, tokenProgram: TOKEN_PROGRAM });
}

/** A watch that has read nothing yet. */
export function freshWatch(owner: string, account: string, nowMs: number): PaymentWatchDraft {
  const at = new Date(nowMs).toISOString();
  return {
    schema: "ryntra.autoinvest-payment-watch",
    schemaVersion: "1.0.0",
    owner,
    network: "solana:mainnet",
    account,
    cursor: null,
    balanceRaw: null,
    nextSeq: 1,
    events: [],
    seen: [],
    ownAccounts: [],
    readAt: null,
    readState: "ok",
    createdAt: at,
    updatedAt: at,
  };
}

/** The lanes of History that are Ryntra's own operations on the chain — a purchase or a sale, a cross-chain swap, a bridge — never a payment. */
const RYNTRA_OWN_LANES = new Set(["SWAP", "CROSS_SWAP", "BRIDGE"]);

export function ryntraSignaturesOf(rows: readonly SolanaWalletAction[]): ReadonlySet<string> {
  return new Set(rows.filter((row) => RYNTRA_OWN_LANES.has(row.lane) && row.signature !== null).map((row) => row.signature as string));
}

function draftOf(record: PaymentWatchRecord): PaymentWatchDraft {
  const { version: _version, ...rest } = record;
  return rest;
}

/**
 * Fold one read of the chain into the watch: the kept events numbered from
 * `nextSeq`, the read signatures remembered, the cursor and the balance moved
 * on. Pure — the tests feed it reads.
 */
export function foldMovements(watch: PaymentWatchDraft, read: MovementsRead, ryntra: ReadonlySet<string> | null, nowMs: number): PaymentWatchDraft {
  const at = new Date(nowMs).toISOString();
  if (!read.ok) return { ...watch, readAt: at, readState: "unavailable", updatedAt: at };
  const known = new Set([...watch.seen, ...watch.events.map((event) => event.signature)]);
  let nextSeq = watch.nextSeq;
  const events = [...watch.events];
  const seen = [...watch.seen];
  for (const tx of read.transactions) {
    if (known.has(tx.signature)) continue;
    known.add(tx.signature);
    seen.push(tx.signature);
    /* History could not be read: Ryntra's own operations are swaps anyway, and the classification leaves swaps out. */
    if (ryntra?.has(tx.signature)) continue;
    const verdict = classifyMovement(tx, watch.owner, watch.account);
    if (!verdict.counted || tx.blockTime === null) continue;
    events.push({
      seq: nextSeq,
      signature: tx.signature,
      slot: tx.slot,
      at: new Date(tx.blockTime * 1000).toISOString(),
      direction: verdict.movement.direction,
      amountMicro: verdict.movement.amountMicro.toString(),
      counterparty: verdict.movement.counterparty,
      memo: verdict.movement.memo,
    });
    nextSeq += 1;
  }
  return {
    ...watch,
    cursor: read.cursor,
    balanceRaw: read.balanceRaw,
    nextSeq,
    events: events.slice(-WATCH_EVENTS_KEPT),
    seen: seen.slice(-WATCH_SEEN_KEPT),
    readAt: at,
    readState: read.complete ? "ok" : "partial",
    updatedAt: at,
  };
}

export type WatchDeps = Readonly<{
  /** The chain; the tests pass a fake. */
  transport?: ChainTransport;
  /** The read itself; the tests may replace it whole. */
  readMovements?: typeof readUsdcMovements;
  /** The wallet's USDC account; the tests pass one. */
  accountOf?: (owner: string) => Promise<string>;
}>;

/**
 * Read the chain for one wallet and keep what it says. `sinceMs` is the
 * earliest instant any of its rules counts from — a wallet's first read looks
 * no further back. `ryntraRows` is History, read only when something new was
 * read. Returns the watch as written, or as it stood when the write lost every
 * race; null when the store could not be read at all.
 */
export async function refreshPaymentWatch(
  store: GuardStore,
  owner: string,
  nowMs: number,
  input: Readonly<{ sinceMs: number; ryntraRows: () => Promise<readonly SolanaWalletAction[] | null>; deadlineMs?: number }>,
  deps: WatchDeps = {},
): Promise<PaymentWatchRecord | null> {
  const read = await readPaymentWatch(store, owner);
  const account = read?.account ?? (await (deps.accountOf ?? usdcAccountOf)(owner));
  const base = read ? draftOf(read) : freshWatch(owner, account, nowMs);
  const chain = await (deps.readMovements ?? readUsdcMovements)(
    { account, cursor: base.cursor, balanceRaw: base.balanceRaw, sinceSec: Math.floor(input.sinceMs / 1000), seen: new Set(base.seen), deadlineMs: input.deadlineMs },
    deps.transport,
  ).catch((failure: unknown): MovementsRead => ({ ok: false, reason: failure instanceof Error ? failure.message : String(failure) }));
  const ryntra = chain.ok && chain.transactions.length > 0 ? await input.ryntraRows().then((rows) => (rows ? ryntraSignaturesOf(rows) : null)).catch(() => null) : null;
  let written: PaymentWatchRecord | null = null;
  await withBoundedCasRetry(async () => {
    const current = await readPaymentWatch(store, owner);
    /* Another writer moved the watch meanwhile: what it wrote stands, and this read — made from the old cursor — is not folded in. */
    if ((current?.version ?? null) !== (read?.version ?? null)) {
      written = current;
      return true;
    }
    const next = foldMovements(current ? draftOf(current) : base, chain, ryntra, nowMs);
    if (!(await writePaymentWatch(store, current, next))) return false;
    written = { ...next, version: (current?.version ?? 0) + 1 };
    return true;
  }).catch(() => null);
  return written ?? (await readPaymentWatch(store, owner).catch(() => null));
}

/**
 * The person names an event's other side as their own account: no transfer
 * to or from it counts from now on. Returns the account named, or null when
 * the event is not the watch's.
 */
export async function markOwnAccount(store: GuardStore, owner: string, signature: string, nowMs: number): Promise<Readonly<{ ok: true; account: string; watch: PaymentWatchRecord }> | Readonly<{ ok: false; code: "EVENT_NOT_FOUND" | "UNAVAILABLE" }>> {
  const outcome = await withBoundedCasRetry<Readonly<{ account: string; watch: PaymentWatchRecord }> | "missing">(async () => {
    const current = await readPaymentWatch(store, owner);
    const event = current?.events.find((candidate) => candidate.signature === signature) ?? null;
    if (!current || !event || !event.counterparty) return "missing";
    if (current.ownAccounts.includes(event.counterparty)) return { account: event.counterparty, watch: current };
    const at = new Date(nowMs).toISOString();
    const next: PaymentWatchDraft = { ...draftOf(current), ownAccounts: [...current.ownAccounts, event.counterparty].slice(-PAYMENT_OWN_ACCOUNTS_LIMIT), updatedAt: at };
    if (!(await writePaymentWatch(store, current, next))) return false;
    return { account: event.counterparty, watch: { ...next, version: current.version + 1 } };
  }).catch(() => null);
  if (outcome === null) return { ok: false, code: "UNAVAILABLE" };
  if (outcome === "missing") return { ok: false, code: "EVENT_NOT_FOUND" };
  return { ok: true, ...outcome };
}
