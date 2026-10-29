import { randomUUID } from "node:crypto";

import { z } from "zod";

import { withBoundedCasRetry, type GuardAtomicVersionedWrite, type GuardStore } from "../guard/store.ts";
import type { ClaimReconciliation, ClaimSignatureStatus } from "../rewards/claim-settlement.ts";
import { REWARD_MINIMUM_CLAIM_USD_MICROS } from "../rewards/model.ts";
import { NETWORK_RULES_HISTORY, type NetworkRules } from "../rewards/network-rules.ts";
import { consumeReserve, freeReserveUsdMicros, holdReserve, readReserveLedger, releaseReserve } from "../rewards/reserve.ts";
import { lineAvailability, lineKey, type NetworkEntry, poolKey } from "./network.ts";
import { readPartnerEntries, readPartnerNetwork } from "./network-store.ts";
import { PARTNER_NETWORKS, type PartnerNetwork } from "./partner.ts";
import { POOL_SHARE_SOURCES } from "./pool-share.ts";
import { walletHold } from "./review-store.ts";

/**
 * Paying a creator partner what their pools made available — the same path a
 * cashback claim takes, from the same Rewards treasury, held against the same
 * reserve, signed by the same key (`lib/rewards/treasury.server.ts`).
 *
 * ## One slot, one receipt
 *
 * A partner has one claim slot per network (`growthPartnerPayouts`), compare-and-set
 * like `rewardClaims`: `CLAIMING` → `SUBMITTED_UNKNOWN` (the signature is stored
 * before any broadcast) → `PAID` or `FAILED`, and nothing opens while one is
 * unresolved. A paid payout writes its receipt (`growthPartnerReceipts`) in the
 * same atomic write as the slot's `PAID`, so what was paid is exactly the sum of
 * the receipts and never a figure of its own. The receipt is fixed when the
 * payout opens: one line per line of the shadow ledger it pays — the pool, the
 * rules version the line was earned under, the claim transaction Ryntra took
 * the money out of the pool in, the amount — and, once paid, the payout's own
 * transaction.
 *
 * ## What a payout takes
 *
 * Per line: what its hold let go, less what receipts already paid of it. Only
 * from pools that may pay now (`payable`: checked, not blocked, creator
 * activated, no review holding or closing it, within the reviewer's amount).
 * A reversal after a payout leaves a line paid above what it holds: that
 * difference is a debt, taken from any pool — under review or not — and netted
 * on the next payout as a negative line of its receipt. Money already paid is
 * never taken back from a wallet; it is only not paid twice.
 *
 * ## The canary
 *
 * Automatic payouts open only after the canary: one payout of $1–2 to a
 * voluntary test wallet the owner names, started by the owner in the admin
 * with a fresh second factor. Its paid receipt writes the gate
 * (`gate:<network>`), in the same atomic write, and from then on a partner's
 * claim is automatic, as cashback's is. Before it, the shadow ledger is shown
 * and nothing is paid.
 *
 * The owner may pause partner payouts at any time (`pause:<network>`, from the
 * admin, with a reason) without touching cashback; a payout already running
 * still settles. Before a payout the partner's wallet is screened for
 * sanctions: an address the source lists is held for review,
 * never paid — a screening that did not answer pays, as a sanctions source
 * outage must not stop every payout.
 *
 * Payouts exist on Solana only. A pool on the other network pays on its own
 * network once a share Ryntra actually claimed there exists (audit GR-00, R6);
 * until then its figures are shown and not paid.
 */

export const PARTNER_PAYOUT_COLLECTION = "growthPartnerPayouts" as const;
export const PARTNER_RECEIPT_COLLECTION = "growthPartnerReceipts" as const;

/** $1, as in Rewards. */
export const PARTNER_PAYOUT_MINIMUM_USD_MICROS = REWARD_MINIMUM_CLAIM_USD_MICROS;
export const CANARY_MIN_USD_MICROS = 1_000_000n;
export const CANARY_MAX_USD_MICROS = 2_000_000n;

/** The most lines one receipt carries; what is left is paid by the next payout. */
export const MAX_RECEIPT_LINES = 400;

/** The networks partner payouts exist on. */
export const PAYOUT_NETWORKS = ["solana"] as const;
export type PayoutNetwork = (typeof PAYOUT_NETWORKS)[number];

export const PAYOUT_STATES = ["CLAIMING", "SUBMITTED_UNKNOWN", "PAID", "FAILED"] as const;
export type PayoutState = (typeof PAYOUT_STATES)[number];
export const PAYOUT_KINDS = ["PARTNER", "CANARY"] as const;
export type PayoutKind = (typeof PAYOUT_KINDS)[number];

const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const POSITIVE = /^[1-9][0-9]*$/;
const SIGNED_NONZERO = /^-?[1-9][0-9]*$/;
const AT = z.string().datetime({ offset: true });
/** How long a prepared payout may wait for its broadcast, as a cashback claim's. */
const PREPARATION_MS = 120_000;

export const ReceiptLineSchema = z
  .object({
    network: z.enum(PARTNER_NETWORKS),
    pool: z.string().min(32).max(66),
    rulesVersion: z.string().regex(/^network-[0-9]+\.[0-9]+\.[0-9]+$/),
    /** The claim of the pool-share journal the line comes from. */
    claim: z.object({ tx: z.string().min(1).max(120), index: z.string().regex(/^[0-9]+(?:\.[0-9]+)?$/), source: z.enum(POOL_SHARE_SOURCES), at: AT }).strict(),
    /** Paid of the line by this payout; negative — a debt the line carried, netted here. */
    usdMicros: z.string().regex(SIGNED_NONZERO),
  })
  .strict();
export type ReceiptLine = z.output<typeof ReceiptLineSchema>;

const linesAddUp = (value: { kind: PayoutKind; usdMicros: string; lines: readonly ReceiptLine[] }) =>
  value.kind === "CANARY" ? value.lines.length === 0 : value.lines.reduce((sum, line) => sum + BigInt(line.usdMicros), 0n) === BigInt(value.usdMicros);
const canaryInRange = (value: { kind: PayoutKind; usdMicros: string }) =>
  value.kind !== "CANARY" || (BigInt(value.usdMicros) >= CANARY_MIN_USD_MICROS && BigInt(value.usdMicros) <= CANARY_MAX_USD_MICROS);

export const PartnerPayoutSchema = z
  .object({
    schema: z.literal(1),
    claimId: z.string().min(1).max(80),
    kind: z.enum(PAYOUT_KINDS),
    network: z.enum(PAYOUT_NETWORKS),
    /** Who is paid: the partner's own proven wallet, or the canary's test wallet. */
    wallet: z.string().regex(SOLANA_ADDRESS),
    state: z.enum(PAYOUT_STATES),
    usdMicros: z.string().regex(POSITIVE),
    lines: z.array(ReceiptLineSchema).max(MAX_RECEIPT_LINES),
    /** The canary's reason, as the owner wrote it; null for a partner's payout. */
    basis: z.string().min(1).max(200).nullable(),
    /** Who started the canary (the admin session); null for a partner's own claim. */
    requestedBy: z.string().min(1).max(120).nullable(),
    destination: z.string().min(32).max(64).nullable(),
    signature: z.string().min(1).max(120).nullable(),
    openedAt: AT,
    resolvedAt: AT.nullable(),
    /** Operator-facing. Never shown to a partner as-is. */
    note: z.string().max(400).nullable(),
    version: z.number().int().min(0),
    preparationExpiresAt: AT,
    blockhash: z.string().min(32).max(64).optional(),
    lastValidBlockHeight: z.string().regex(/^[0-9]+$/).optional(),
  })
  .strict()
  .refine(linesAddUp, "a payout's lines add up to it; the canary's has none")
  .refine(canaryInRange, "the canary is $1–2");
export type PartnerPayout = z.output<typeof PartnerPayoutSchema>;

export const PartnerReceiptSchema = z
  .object({
    schema: z.literal(1),
    claimId: z.string().min(1).max(80),
    kind: z.enum(PAYOUT_KINDS),
    network: z.enum(PAYOUT_NETWORKS),
    wallet: z.string().regex(SOLANA_ADDRESS),
    usdMicros: z.string().regex(POSITIVE),
    lines: z.array(ReceiptLineSchema).max(MAX_RECEIPT_LINES),
    basis: z.string().min(1).max(200).nullable(),
    requestedBy: z.string().min(1).max(120).nullable(),
    /** The USDC account paid, and the payout's transaction. */
    destination: z.string().min(32).max(64),
    signature: z.string().min(1).max(120),
    openedAt: AT,
    paidAt: AT,
    version: z.literal(0),
  })
  .strict()
  .refine(linesAddUp, "a receipt's lines add up to it; the canary's has none");
export type PartnerReceipt = z.output<typeof PartnerReceiptSchema>;

/** Written once, by the canary's paid receipt: partner payouts on the network are open from then on. */
export const PayoutGateSchema = z
  .object({ schema: z.literal(1), network: z.enum(PAYOUT_NETWORKS), claimId: z.string().min(1).max(80), wallet: z.string().regex(SOLANA_ADDRESS), usdMicros: z.string().regex(POSITIVE), signature: z.string().min(1).max(120), paidAt: AT, version: z.literal(0) })
  .strict();
export type PayoutGate = z.output<typeof PayoutGateSchema>;

export const payoutSlotKey = (network: PayoutNetwork, wallet: string) => `${network}:${wallet}`;
export const canarySlotKey = (network: PayoutNetwork) => `canary:${network}`;
export const payoutGateKey = (network: PayoutNetwork) => `gate:${network}`;
export const payoutPauseKey = (network: PayoutNetwork) => `pause:${network}`;
export const receiptKey = (network: PayoutNetwork, wallet: string, claimId: string) => `${network}:${wallet}:${claimId}`;
const receiptPrefix = (network: PayoutNetwork, wallet: string) => `${network}:${wallet}:`;

/* ------------------------------------------------------------------------------------------------
 * The plan: what a payout takes, line by line
 * --------------------------------------------------------------------------------------------- */

export type PoolPayability = Readonly<{ network: PartnerNetwork; pool: string; payable: boolean }>;

export type PayoutPlan = Readonly<{
  /** What may be paid now, after every debt, before the reserve. Never negative. */
  claimableUsdMicros: bigint;
  /** What reversals after payouts left owed back — already netted in the claimable, or carried while it exceeds it. */
  debtUsdMicros: bigint;
  /** The receipt's lines for `targetUsdMicros`: every debt, then lines oldest first. */
  lines: readonly ReceiptLine[];
  /** What these lines pay: the claimable, or less when `limitUsdMicros` (the free reserve) is less. */
  targetUsdMicros: bigint;
}>;

const receiptLineKey = (line: Pick<ReceiptLine, "network" | "pool" | "claim">) => lineKey(line.network, poolKey(line.pool), line.claim.tx, line.claim.index);

/**
 * The lines one payout on `network` takes, from the partner's entries, their pools' payability and what was paid.
 *
 * `paid` — the lines of every paid receipt of the partner (and of an unresolved payout: its money is spoken for).
 * Pure, so the rule the money follows is tested without a store or a chain.
 */
export function planPartnerPayout(
  args: Readonly<{
    network: PayoutNetwork;
    entries: readonly NetworkEntry[];
    pools: readonly PoolPayability[];
    paid: readonly ReceiptLine[];
    now: string;
    history?: readonly NetworkRules[];
    limitUsdMicros?: bigint;
  }>,
): PayoutPlan {
  const payable = new Set(args.pools.filter((pool) => pool.network === args.network && pool.payable).map((pool) => poolKey(pool.pool)));
  const available = lineAvailability(args.entries.filter((entry) => entry.network === args.network), args.now, args.history ?? NETWORK_RULES_HISTORY);
  const paidBy = new Map<string, { amount: bigint; line: ReceiptLine }>();
  for (const line of args.paid) {
    if (line.network !== args.network) continue;
    const key = receiptLineKey(line);
    const held = paidBy.get(key);
    paidBy.set(key, { amount: (held?.amount ?? 0n) + BigInt(line.usdMicros), line: held?.line ?? line });
  }
  type Open = { key: string; at: string; unpaid: bigint; line: Omit<ReceiptLine, "usdMicros"> };
  const open: Open[] = [];
  const seen = new Set<string>();
  for (const line of available) {
    const key = lineKey(line.network, poolKey(line.pool), line.line.tx, line.line.index);
    seen.add(key);
    const unpaid = line.availableUsdMicros - (paidBy.get(key)?.amount ?? 0n);
    /* A pool that may not pay now gives nothing — but what it owes back after a reversal is owed all the same. */
    const counted = payable.has(poolKey(line.pool)) ? unpaid : unpaid < 0n ? unpaid : 0n;
    if (counted !== 0n) open.push({ key, at: line.line.at, unpaid: counted, line: { network: line.network, pool: line.pool, rulesVersion: line.rulesVersion, claim: line.line } });
  }
  /* A paid line the entries no longer hold at all (never expected: entries are append-only) is owed back whole. */
  for (const [key, { amount, line }] of paidBy) {
    if (seen.has(key) || amount <= 0n) continue;
    open.push({ key, at: line.claim.at, unpaid: -amount, line: { network: line.network, pool: line.pool, rulesVersion: line.rulesVersion, claim: line.claim } });
  }
  open.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.key.localeCompare(b.key));
  const debts = open.filter((item) => item.unpaid < 0n);
  const credits = open.filter((item) => item.unpaid > 0n);
  const owed = debts.reduce((sum, item) => sum + item.unpaid, 0n);
  const total = credits.reduce((sum, item) => sum + item.unpaid, 0n) + owed;
  const claimable = total > 0n ? total : 0n;
  const limit = args.limitUsdMicros ?? claimable;
  const target = claimable < limit ? claimable : limit > 0n ? limit : 0n;
  const debt = -owed;
  if (target === 0n) return { claimableUsdMicros: claimable, debtUsdMicros: debt, lines: [], targetUsdMicros: 0n };
  /* Every debt first, then the oldest lines until the target is reached; the last one may be paid in part. One receipt
     carries at most MAX_RECEIPT_LINES: what does not fit is paid by the next payout. */
  const lines: ReceiptLine[] = debts.slice(0, MAX_RECEIPT_LINES).map((item) => ({ ...item.line, usdMicros: item.unpaid.toString() }));
  let left = target - lines.reduce((sum, line) => sum + BigInt(line.usdMicros), 0n);
  for (const item of credits) {
    if (left <= 0n || lines.length >= MAX_RECEIPT_LINES) break;
    const part = item.unpaid < left ? item.unpaid : left;
    lines.push({ ...item.line, usdMicros: part.toString() });
    left -= part;
  }
  const paidNow = lines.reduce((sum, line) => sum + BigInt(line.usdMicros), 0n);
  if (paidNow <= 0n) return { claimableUsdMicros: claimable, debtUsdMicros: debt, lines: [], targetUsdMicros: 0n };
  lines.sort((a, b) => Date.parse(a.claim.at) - Date.parse(b.claim.at) || receiptLineKey(a).localeCompare(receiptLineKey(b)));
  return { claimableUsdMicros: claimable, debtUsdMicros: debt, lines, targetUsdMicros: paidNow };
}

/* ------------------------------------------------------------------------------------------------
 * Reads
 * --------------------------------------------------------------------------------------------- */

export async function readPayoutSlot(store: GuardStore, key: string): Promise<PartnerPayout | null> {
  const raw = await store.versioned<PartnerPayout>(PARTNER_PAYOUT_COLLECTION).get(key);
  if (raw === undefined || raw === null) return null;
  /* A slot that cannot be read is never "no payout": nothing opens over it. */
  return PartnerPayoutSchema.parse(raw);
}

export function payoutUnresolved(payout: PartnerPayout | null): boolean {
  return payout !== null && (payout.state === "CLAIMING" || payout.state === "SUBMITTED_UNKNOWN");
}

/** A wallet's receipts on a network, oldest first. One that cannot be read throws — paid is never read too low. */
export async function readReceipts(store: GuardStore, network: PayoutNetwork, wallet: string): Promise<PartnerReceipt[]> {
  const rows = await store.collection<unknown>(PARTNER_RECEIPT_COLLECTION).valuesWithPrefix(receiptPrefix(network, wallet));
  return rows.map((row) => PartnerReceiptSchema.parse(row)).filter((row) => row.wallet === wallet).sort((a, b) => a.paidAt.localeCompare(b.paidAt));
}

/** Every receipt on a network, for the owner's view. */
export async function readAllReceipts(store: GuardStore, network: PayoutNetwork): Promise<PartnerReceipt[]> {
  const rows = await store.collection<unknown>(PARTNER_RECEIPT_COLLECTION).valuesWithPrefix(`${network}:`);
  return rows.map((row) => PartnerReceiptSchema.parse(row)).sort((a, b) => a.paidAt.localeCompare(b.paidAt));
}

/** The gate, or null: closed. A gate that cannot be read is closed — payouts never open on a damaged row. */
export async function readPayoutGate(store: GuardStore, network: PayoutNetwork): Promise<PayoutGate | null> {
  const raw = await store.versioned<PayoutGate>(PARTNER_PAYOUT_COLLECTION).get(payoutGateKey(network));
  const parsed = PayoutGateSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export const PayoutPauseSchema = z
  .object({ schema: z.literal(1), network: z.enum(PAYOUT_NETWORKS), paused: z.boolean(), note: z.string().min(1).max(400), by: z.string().min(1).max(120), at: AT, version: z.number().int().min(0) })
  .strict();
export type PayoutPause = z.output<typeof PayoutPauseSchema>;

/** Whether the owner paused partner payouts. A pause row that cannot be read pauses — money never moves on a damaged row. */
export async function readPayoutPause(store: GuardStore, network: PayoutNetwork): Promise<Readonly<{ paused: boolean; record: PayoutPause | null }>> {
  const raw = await store.versioned<PayoutPause>(PARTNER_PAYOUT_COLLECTION).get(payoutPauseKey(network));
  if (raw === undefined || raw === null) return { paused: false, record: null };
  const parsed = PayoutPauseSchema.safeParse(raw);
  return parsed.success ? { paused: parsed.data.paused, record: parsed.data } : { paused: true, record: null };
}

/** Pause or resume partner payouts, with a reason and who did it. Cashback is not touched. */
export async function setPayoutPause(store: GuardStore, args: Readonly<{ network: PayoutNetwork; paused: boolean; note: string; by: string; at: string }>): Promise<boolean> {
  const note = args.note.trim().slice(0, 400);
  const by = args.by.trim().slice(0, 120);
  if (!note || !by) return false;
  const rows = store.versioned<PayoutPause>(PARTNER_PAYOUT_COLLECTION);
  return withBoundedCasRetry<boolean>(async () => {
    const current = await rows.get(payoutPauseKey(args.network));
    const version = typeof current?.version === "number" ? current.version : null;
    const next = PayoutPauseSchema.parse({ schema: 1, network: args.network, paused: args.paused, note, by, at: args.at, version: (version ?? -1) + 1 });
    return (await rows.compareAndSet(payoutPauseKey(args.network), version, next)) ? true : false;
  });
}

/** Partner payouts still deciding, for the owner: a slot stuck here is read back from the chain, never resent. */
export async function readOpenPayouts(store: GuardStore, network: PayoutNetwork): Promise<PartnerPayout[]> {
  const rows = await store.collection<unknown>(PARTNER_PAYOUT_COLLECTION).valuesWithPrefix(`${network}:`);
  return rows
    .map((row) => PartnerPayoutSchema.safeParse(row))
    .filter((row) => row.success)
    .map((row) => row.data!)
    .filter((row) => payoutUnresolved(row))
    .sort((a, b) => a.openedAt.localeCompare(b.openedAt));
}

/* ------------------------------------------------------------------------------------------------
 * The slot's machine — `lib/rewards/claim.ts`, for a partner
 * --------------------------------------------------------------------------------------------- */

export type OpenPayoutResult =
  | Readonly<{ ok: true; payout: PartnerPayout }>
  | Readonly<{ ok: false; code: "ALREADY_RUNNING" | "CONTENDED" }>;

export async function openPayout(
  store: GuardStore,
  args: Readonly<{
    key: string;
    kind: PayoutKind;
    network: PayoutNetwork;
    wallet: string;
    usdMicros: bigint;
    lines: readonly ReceiptLine[];
    basis?: string | null;
    requestedBy?: string | null;
    now: string;
    /** The slot's version the plan was read at: a payout that resolved meanwhile changed what was paid. */
    expectedVersion: number | null;
    claimId?: string;
  }>,
): Promise<OpenPayoutResult> {
  if (args.usdMicros <= 0n) throw new Error("A payout must be for a positive amount.");
  const slots = store.versioned<PartnerPayout>(PARTNER_PAYOUT_COLLECTION);
  return withBoundedCasRetry<OpenPayoutResult>(async () => {
    const current = await readPayoutSlot(store, args.key);
    if ((current?.version ?? null) !== args.expectedVersion) return { ok: false, code: "CONTENDED" };
    if (payoutUnresolved(current)) return { ok: false, code: "ALREADY_RUNNING" };
    const payout = PartnerPayoutSchema.parse({
      schema: 1,
      claimId: args.claimId ?? randomUUID(),
      kind: args.kind,
      network: args.network,
      wallet: args.wallet,
      state: "CLAIMING",
      usdMicros: args.usdMicros.toString(),
      lines: args.lines,
      basis: args.basis ?? null,
      requestedBy: args.requestedBy ?? null,
      destination: null,
      signature: null,
      openedAt: args.now,
      resolvedAt: null,
      note: null,
      version: (current?.version ?? -1) + 1,
      preparationExpiresAt: new Date(Date.parse(args.now) + PREPARATION_MS).toISOString(),
    });
    return (await slots.compareAndSet(args.key, current?.version ?? null, payout)) ? { ok: true, payout } : false;
  });
}

/** One winner stores the transaction's identity before its caller may broadcast. */
export async function armPayout(
  store: GuardStore,
  args: Readonly<{ key: string; claimId: string; signature: string; destination: string; blockhash: string; lastValidBlockHeight: string; at: string }>,
): Promise<boolean> {
  const slots = store.versioned<PartnerPayout>(PARTNER_PAYOUT_COLLECTION);
  const result = await withBoundedCasRetry<Readonly<{ ok: boolean }>>(async () => {
    const current = await readPayoutSlot(store, args.key);
    if (!current || current.claimId !== args.claimId || current.state !== "CLAIMING" || current.signature || Date.parse(current.preparationExpiresAt) <= Date.parse(args.at)) return { ok: false };
    const next = PartnerPayoutSchema.parse({ ...current, state: "SUBMITTED_UNKNOWN", signature: args.signature, destination: args.destination, blockhash: args.blockhash, lastValidBlockHeight: args.lastValidBlockHeight, version: current.version + 1 });
    return (await slots.compareAndSet(args.key, current.version, next)) ? { ok: true } : false;
  });
  return result.ok;
}

/** Close a payout that certainly sent nothing: its build failed, or it was never armed. Only from `CLAIMING`. */
export async function failPayout(store: GuardStore, args: Readonly<{ key: string; claimId: string; at: string; note: string }>): Promise<boolean> {
  const slots = store.versioned<PartnerPayout>(PARTNER_PAYOUT_COLLECTION);
  const result = await withBoundedCasRetry<Readonly<{ ok: boolean }>>(async () => {
    const current = await readPayoutSlot(store, args.key);
    if (!current || current.claimId !== args.claimId || current.state !== "CLAIMING" || current.signature) return { ok: false };
    const next = PartnerPayoutSchema.parse({ ...current, state: "FAILED", resolvedAt: args.at, note: args.note.slice(0, 400), version: current.version + 1 });
    return (await slots.compareAndSet(args.key, current.version, next)) ? { ok: true } : false;
  });
  return result.ok;
}

export type PayoutChainReads = Readonly<{
  readStatus: (signature: string) => Promise<ClaimSignatureStatus | null>;
  blockhashValid?: (blockhash: string) => Promise<boolean | null>;
}>;

/**
 * Read the chain and settle the slot — `reconcileRewardClaim` for a partner. A confirmed success writes `PAID` and the
 * receipt (and, for the canary, the gate) in one atomic write; a failure seen on chain, or a prepared payout that
 * expired unsent, writes `FAILED`. Anything less certain stays open. This cannot build or send.
 */
export async function reconcilePayout(store: GuardStore, key: string, payout: PartnerPayout, deps: PayoutChainReads & Readonly<{ now: string }>): Promise<ClaimReconciliation> {
  const pending = { stillOpen: true, state: payout.state };
  try {
    if (payout.state === "PAID") {
      await consumeReserve(store, payout.claimId, deps.now);
      return { stillOpen: false, state: "PAID" };
    }
    if (payout.state === "FAILED") {
      await releaseReserve(store, payout.claimId, deps.now);
      return { stillOpen: false, state: "FAILED" };
    }
    let outcome: "PAID" | "FAILED" | null = null;
    const confirmed = (status: ClaimSignatureStatus | null) => status?.seen && (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized");
    if (!payout.signature) {
      if (payout.state !== "CLAIMING" || Date.parse(deps.now) < Date.parse(payout.preparationExpiresAt)) return pending;
      outcome = "FAILED";
    } else {
      let status = await deps.readStatus(payout.signature);
      if (!status) return pending;
      if (!status.seen && payout.blockhash && deps.blockhashValid && (await deps.blockhashValid(payout.blockhash)) === false) {
        /* A status read made before the blockhash expired cannot close an unknown payout: read again. */
        status = await deps.readStatus(payout.signature);
        if (!status) return pending;
        if (!status.seen) outcome = "FAILED";
      }
      if (confirmed(status)) {
        if (status!.err === null) outcome = "PAID";
        else if (status!.err !== undefined) outcome = "FAILED";
      }
      if (!outcome) return pending;
    }
    const settled = await withBoundedCasRetry<ClaimReconciliation>(async () => {
      const current = await readPayoutSlot(store, key);
      if (!current || current.claimId !== payout.claimId) return pending;
      if (current.state === "PAID" || current.state === "FAILED") return { stillOpen: false, state: current.state };
      if (current.signature !== payout.signature || current.state !== payout.state) return pending;
      const next = PartnerPayoutSchema.parse({ ...current, state: outcome, resolvedAt: deps.now, version: current.version + 1 });
      const writes: GuardAtomicVersionedWrite[] = [{ collection: PARTNER_PAYOUT_COLLECTION, key, expectedVersion: current.version, next }];
      if (outcome === "PAID") {
        const receipt = PartnerReceiptSchema.parse({
          schema: 1,
          claimId: current.claimId,
          kind: current.kind,
          network: current.network,
          wallet: current.wallet,
          usdMicros: current.usdMicros,
          lines: current.lines,
          basis: current.basis,
          requestedBy: current.requestedBy,
          destination: current.destination,
          signature: current.signature,
          openedAt: current.openedAt,
          paidAt: deps.now,
          version: 0,
        });
        writes.push({ collection: PARTNER_RECEIPT_COLLECTION, key: receiptKey(current.network, current.wallet, current.claimId), expectedVersion: null, next: receipt });
        /* A gate row of any kind already there — even one this build cannot read — is never written over. */
        const gateRow = await store.versioned<PayoutGate>(PARTNER_PAYOUT_COLLECTION).get(payoutGateKey(current.network));
        if (current.kind === "CANARY" && (gateRow === undefined || gateRow === null)) {
          writes.push({
            collection: PARTNER_PAYOUT_COLLECTION,
            key: payoutGateKey(current.network),
            expectedVersion: null,
            next: PayoutGateSchema.parse({ schema: 1, network: current.network, claimId: current.claimId, wallet: current.wallet, usdMicros: current.usdMicros, signature: current.signature, paidAt: deps.now, version: 0 }),
          });
        }
      }
      return (await store.compareAndSetMany(writes)) ? { stillOpen: false, state: outcome! } : false;
    });
    if (!settled.stillOpen) {
      if (settled.state === "PAID") await consumeReserve(store, payout.claimId, deps.now);
      else await releaseReserve(store, payout.claimId, deps.now);
    }
    return settled;
  } catch {
    return pending;
  }
}

/* ------------------------------------------------------------------------------------------------
 * The flows — a partner's claim and the canary
 * --------------------------------------------------------------------------------------------- */

/** What `payRewardClaim` answers, as these flows read it. */
export type PayResult =
  | Readonly<{ ok: true; signature: string; destination: string }>
  | Readonly<{ ok: false; code: string; reason: string; signature?: string; destination?: string }>;

export type PayoutDeps = PayoutChainReads &
  Readonly<{
    /** The treasury's balance, read off the chain just before a hold; null — it could not be read. */
    readTreasuryUsdMicros: () => Promise<bigint | null>;
    /** `payRewardClaim`: builds, calls `beforeSubmit` with the exact signature, then broadcasts once. */
    pay: (args: Readonly<{ wallet: string; usdMicros: bigint; beforeSubmit: (prepared: Readonly<{ signature: string; destination: string; blockhash: string; lastValidBlockHeight: string }>) => Promise<boolean> }>) => Promise<PayResult>;
    /** The server's clock; tests alone pass their own. */
    clock?: () => number;
    /** The sanctions screening of the wallet to be paid (the source's own words); absent — not screened. */
    screen?: (wallet: string) => Promise<string>;
  }>;

export type PayoutOutcome = Readonly<{
  /** The answer a route gives: `PAID`, `SUBMITTED_UNKNOWN`, `CLAIMING`, `FAILED` — or why nothing opened. */
  state:
    | PayoutState
    | "NOT_OPEN"
    | "ALREADY_OPEN"
    | "ON_REVIEW"
    | "STOPPED"
    | "NOT_CLAIMABLE"
    | "RESERVE_SHORT"
    | "RESERVE_UNAVAILABLE"
    | "ALREADY_RUNNING"
    | "PAUSED"
    | "INVALID";
  usdMicros?: string;
  signature?: string | null;
}>;

const iso = (deps: PayoutDeps) => new Date((deps.clock ?? Date.now)()).toISOString();

/** Open, hold, pay and settle one payout whose amount and lines are decided. */
async function sendPayout(
  store: GuardStore,
  deps: PayoutDeps,
  args: Readonly<{ key: string; kind: PayoutKind; wallet: string; usdMicros: bigint; lines: readonly ReceiptLine[]; treasuryUsdMicros: bigint; basis?: string; requestedBy?: string; expectedVersion: number | null }>,
): Promise<PayoutOutcome> {
  const opened = await openPayout(store, { key: args.key, kind: args.kind, network: "solana", wallet: args.wallet, usdMicros: args.usdMicros, lines: args.lines, basis: args.basis ?? null, requestedBy: args.requestedBy ?? null, now: iso(deps), expectedVersion: args.expectedVersion });
  if (!opened.ok) return { state: "ALREADY_RUNNING" };
  const { claimId } = opened.payout;
  const held = await holdReserve(store, { claimId, wallet: args.wallet, usdMicros: args.usdMicros, treasuryUsdMicros: args.treasuryUsdMicros, now: iso(deps) });
  if (!held.ok) {
    await failPayout(store, { key: args.key, claimId, at: iso(deps), note: held.reason });
    return { state: "RESERVE_SHORT" };
  }
  const paid = await deps.pay({
    wallet: args.wallet,
    usdMicros: args.usdMicros,
    beforeSubmit: (prepared) => armPayout(store, { key: args.key, claimId, ...prepared, at: iso(deps) }),
  });
  if (!paid.ok && paid.code !== "SUBMIT_UNKNOWN") {
    /* Nothing left the treasury unless the arm was written — then only the chain decides. */
    if (await failPayout(store, { key: args.key, claimId, at: iso(deps), note: paid.reason })) {
      await releaseReserve(store, claimId, iso(deps));
      return { state: "FAILED", usdMicros: args.usdMicros.toString() };
    }
  }
  const current = await readPayoutSlot(store, args.key);
  if (!current || current.claimId !== claimId) return { state: "SUBMITTED_UNKNOWN", usdMicros: args.usdMicros.toString() };
  const settled = await reconcilePayout(store, args.key, current, { ...deps, now: iso(deps) });
  return { state: settled.state as PayoutState, usdMicros: args.usdMicros.toString(), signature: current.signature };
}

/** A wallet the sanctions source lists. A screening that failed is not a listing. */
async function screenedOut(deps: PayoutDeps, wallet: string): Promise<boolean> {
  if (!deps.screen) return false;
  return (await deps.screen(wallet).catch(() => "unavailable")) === "sanctioned";
}

/** Settle an unresolved slot first; tells whether the caller must stop there. */
async function settleSlot(store: GuardStore, deps: PayoutDeps, key: string): Promise<Readonly<{ slot: PartnerPayout | null; stop: PayoutOutcome | null }>> {
  const slot = await readPayoutSlot(store, key);
  if (!slot) return { slot: null, stop: null };
  const settled = await reconcilePayout(store, key, slot, { ...deps, now: iso(deps) });
  if (settled.stillOpen) return { slot, stop: { state: slot.state, usdMicros: slot.usdMicros, signature: slot.signature } };
  /* Checking an old payout never starts another in the same request when it just resolved as paid: the page shows it. */
  if (payoutUnresolved(slot)) return { slot, stop: { state: settled.state as PayoutState, usdMicros: slot.usdMicros, signature: slot.signature } };
  return { slot: await readPayoutSlot(store, key), stop: null };
}

/**
 * A partner's claim on Solana: everything payable, net of debts, from the free reserve — automatic, as cashback's,
 * and only once the canary has opened payouts. The payout goes to the partner's own proven wallet and nowhere else.
 */
export async function claimPartnerPayout(store: GuardStore, deps: PayoutDeps, args: Readonly<{ wallet: string; history?: readonly NetworkRules[] }>): Promise<PayoutOutcome> {
  const key = payoutSlotKey("solana", args.wallet);
  const settled = await settleSlot(store, deps, key);
  if (settled.stop) return settled.stop;
  if (!(await readPayoutGate(store, "solana"))) return { state: "NOT_OPEN" };
  if ((await readPayoutPause(store, "solana")).paused) return { state: "PAUSED" };
  /* A wallet the review froze, holds or stopped opens no payout; an unresolved one above still settles. */
  const hold = await walletHold(store, args.wallet, iso(deps));
  if (hold === "STOPPED") return { state: "STOPPED" };
  if (hold !== "NONE") return { state: "ON_REVIEW" };
  if (await screenedOut(deps, args.wallet)) return { state: "ON_REVIEW" };
  const now = iso(deps);
  const [view, entries, receipts, treasury, ledger] = await Promise.all([
    readPartnerNetwork(store, args.wallet, { now, history: args.history }),
    readPartnerEntries(store, args.wallet),
    readReceipts(store, "solana", args.wallet),
    deps.readTreasuryUsdMicros(),
    readReserveLedger(store),
  ]);
  const paid = receipts.filter((receipt) => receipt.kind === "PARTNER").flatMap((receipt) => receipt.lines);
  const pools = view.pools.map((pool) => ({ network: pool.network, pool: pool.pool, payable: pool.payable }));
  const whole = planPartnerPayout({ network: "solana", entries, pools, paid, now, history: args.history });
  if (whole.claimableUsdMicros < PARTNER_PAYOUT_MINIMUM_USD_MICROS) return { state: "NOT_CLAIMABLE", usdMicros: whole.claimableUsdMicros.toString() };
  if (treasury === null) return { state: "RESERVE_UNAVAILABLE" };
  const free = freeReserveUsdMicros({ treasuryUsdMicros: treasury, ledger, now });
  /* The reserve bounds a payout in whole cents, as the page offers it. */
  const plan = planPartnerPayout({ network: "solana", entries, pools, paid, now, history: args.history, limitUsdMicros: free - (free % 10_000n) });
  if (plan.targetUsdMicros < PARTNER_PAYOUT_MINIMUM_USD_MICROS) return { state: "RESERVE_SHORT", usdMicros: whole.claimableUsdMicros.toString() };
  return sendPayout(store, deps, { key, kind: "PARTNER", wallet: args.wallet, usdMicros: plan.targetUsdMicros, lines: plan.lines, treasuryUsdMicros: treasury, expectedVersion: settled.slot?.version ?? null });
}

/**
 * The canary: $1–2 to a voluntary test wallet, started by the owner. Once, ever, per network: its paid receipt opens
 * partner payouts and no second canary starts after it. One slot for it, so two cannot run at once.
 */
export async function sendCanaryPayout(
  store: GuardStore,
  deps: PayoutDeps,
  args: Readonly<{ wallet: string; usdMicros: bigint; basis: string; requestedBy: string; forbidden?: ReadonlySet<string> }>,
): Promise<PayoutOutcome> {
  if (!SOLANA_ADDRESS.test(args.wallet) || args.usdMicros < CANARY_MIN_USD_MICROS || args.usdMicros > CANARY_MAX_USD_MICROS || !args.basis.trim() || !args.requestedBy.trim()) return { state: "INVALID" };
  /* The treasury itself, or any address of the attribution registry, would "pay" without money leaving Ryntra. */
  if (args.forbidden?.has(args.wallet)) return { state: "INVALID" };
  const key = canarySlotKey("solana");
  const settled = await settleSlot(store, deps, key);
  if (settled.stop) return settled.stop;
  /* Any gate row at all — even one this build cannot read — means the canary was paid: never a second one over it. */
  const gateRow = await store.versioned<PayoutGate>(PARTNER_PAYOUT_COLLECTION).get(payoutGateKey("solana"));
  if (gateRow !== undefined && gateRow !== null) return { state: "ALREADY_OPEN" };
  if (await screenedOut(deps, args.wallet)) return { state: "ON_REVIEW" };
  const treasury = await deps.readTreasuryUsdMicros();
  if (treasury === null) return { state: "RESERVE_UNAVAILABLE" };
  const free = freeReserveUsdMicros({ treasuryUsdMicros: treasury, ledger: await readReserveLedger(store), now: iso(deps) });
  if (free < args.usdMicros) return { state: "RESERVE_SHORT", usdMicros: args.usdMicros.toString() };
  return sendPayout(store, deps, { key, kind: "CANARY", wallet: args.wallet, usdMicros: args.usdMicros, lines: [], treasuryUsdMicros: treasury, basis: args.basis.trim().slice(0, 200), requestedBy: args.requestedBy.trim().slice(0, 120), expectedVersion: settled.slot?.version ?? null });
}

/** Observe and settle a slot without ever opening one — for polling. */
export async function observePayout(store: GuardStore, deps: PayoutChainReads & Readonly<{ clock?: () => number }>, key: string): Promise<PartnerPayout | null> {
  const slot = await readPayoutSlot(store, key);
  if (slot) await reconcilePayout(store, key, slot, { ...deps, now: new Date((deps.clock ?? Date.now)()).toISOString() });
  return readPayoutSlot(store, key);
}
