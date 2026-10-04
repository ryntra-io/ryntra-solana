/**
 * Trading plans — one row per plan, in the Guard store.
 *
 * The cabinet belongs to the wallet, so a plan is keyed by the wallet that
 * proved itself when it was written and read back only through that proof —
 * the `rw` cookie in a browser, the native bearer on a phone. The stored
 * record is the contract's `TradingPlan` with three additions that never
 * leave the server as a whole: `history`, every version in full, because a
 * version's rules are read by number and never rewritten; `reviews`, the
 * Strategy blocks the order route judged for this plan, each written before
 * the wallet signed anything; and the Review kept on each execution, so Plan
 * vs Actual reads what stood before the signature.
 *
 * **Two counters, on purpose.** `planVersion` is the product's version — the
 * number a person edits into, the `ifVersion` a client must name. `version`
 * is the store's revision, bumped by every write, and it is what
 * compare-and-set compares: a Review recorded, an execution appended and a
 * status change are writes that make no new version, and on one counter two
 * of them at once would silently overwrite each other. On two, a lost race
 * is a refusal (`PLAN_VERSION_CONFLICT`) or a bounded retry, never a plan
 * that forgot an execution.
 */

import { z } from "zod";

import {
  PLAN_EXECUTIONS_LIMIT,
  PLAN_ID,
  PLAN_JOURNAL_LIMIT,
  PLAN_LIST_LIMIT,
  PLAN_VERSIONS_LIMIT,
  PlanAssetSchema,
  PlanExecutionRefSchema,
  PlanJournalEntrySchema,
  PlanReviewSchema,
  PlanVersionSchema,
  PLAN_SIDES,
  PLAN_STATUSES,
  NETWORK,
  type PlanExecutionRef,
  type PlanReview,
  type TradingPlan,
} from "../api/v1/contract.ts";
import type { GuardStore } from "../guard/store.ts";

const COLLECTION = "tradingPlans" as const;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** How many Reviews a plan keeps; an execution keeps its own copy, so eviction loses nothing that was signed. */
export const PLAN_REVIEWS_KEPT = 50;

/** An execution as the plan keeps it: the contract's ref plus the Strategy block that stood before the signature. */
export const StoredPlanExecutionSchema = PlanExecutionRefSchema.extend({ review: PlanReviewSchema.nullable().default(null) }).strict();
export type StoredPlanExecution = z.output<typeof StoredPlanExecutionSchema>;

export const TradingPlanRecordSchema = z
  .object({
    schema: z.literal("ryntra.trading-plan"),
    schemaVersion: z.literal("1.1.0"),
    id: z.string().regex(PLAN_ID),
    owner: z.string().regex(BASE58),
    network: z.literal(NETWORK),
    status: z.enum(PLAN_STATUSES),
    side: z.enum(PLAN_SIDES),
    asset: PlanAssetSchema,
    /** The store's revision — the compare-and-set counter, bumped by every write. */
    version: z.number().int().min(1),
    /** The current version's number — the product's counter, bumped only by an edit. */
    planVersion: z.number().int().min(1),
    /** Every version in full, oldest first; `history[planVersion - 1]` is the current one. */
    history: z.array(PlanVersionSchema).min(1).max(PLAN_VERSIONS_LIMIT),
    journal: z.array(PlanJournalEntrySchema).min(1).max(PLAN_JOURNAL_LIMIT),
    executions: z.array(StoredPlanExecutionSchema).max(PLAN_EXECUTIONS_LIMIT),
    /** The Strategy blocks judged for this plan, oldest first, the last `PLAN_REVIEWS_KEPT`. */
    reviews: z.array(PlanReviewSchema).max(PLAN_REVIEWS_KEPT).default([]),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type TradingPlanRecord = z.output<typeof TradingPlanRecordSchema>;

export function tradingPlanKey(owner: string, planId: string): string {
  return `solana:mainnet:${owner}:${planId}`;
}

/** The trailing colon keeps a scan for one wallet from reading a wallet whose address starts the same way. */
export function tradingPlanPrefix(owner: string): string {
  return `solana:mainnet:${owner}:`;
}

export function currentVersionOf(record: TradingPlanRecord): TradingPlanRecord["history"][number] {
  return record.history[record.history.length - 1];
}

/** The status a read reports: an active plan whose entry validity has passed reads as expired — a projection, not a write. */
export function projectedStatus(record: TradingPlanRecord, nowMs: number): TradingPlan["status"] {
  const validUntil = currentVersionOf(record).rules.entry.validUntil;
  const expired = record.status === "active" && validUntil !== null && Date.parse(validUntil) <= nowMs;
  return expired ? "expired" : record.status;
}

/** The contract's execution ref — the stored copy of the Review stays on the server. */
export function projectExecution(execution: StoredPlanExecution): PlanExecutionRef {
  const { review: _review, ...ref } = execution;
  return ref;
}

/** The record as the contract states a plan: the current version in full, the rest as summaries. */
export function projectTradingPlan(record: TradingPlanRecord, nowMs: number): TradingPlan {
  const current = currentVersionOf(record);
  return {
    id: record.id,
    owner: record.owner,
    network: record.network,
    status: projectedStatus(record, nowMs),
    side: record.side,
    asset: record.asset,
    version: record.planVersion,
    current,
    versions: record.history.map((entry) => ({ version: entry.version, createdAt: entry.createdAt, reason: entry.reason })),
    journal: record.journal,
    executions: record.executions.map(projectExecution),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** The Review a plan kept under this id — on an execution first, then in the kept list. */
export function findStoredReview(record: TradingPlanRecord, reviewId: string): PlanReview | null {
  const onExecution = record.executions.find((entry) => entry.reviewId === reviewId && entry.review !== null);
  if (onExecution?.review) return onExecution.review;
  return record.reviews.find((review) => review.reviewId === reviewId) ?? null;
}

function versioned(store: GuardStore) {
  return store.versioned<TradingPlanRecord>(COLLECTION);
}

export async function readTradingPlan(store: GuardStore, owner: string, planId: string): Promise<TradingPlanRecord | null> {
  if (!BASE58.test(owner) || !PLAN_ID.test(planId)) return null;
  const raw = await versioned(store).get(tradingPlanKey(owner, planId));
  if (raw === undefined || raw === null) return null;
  const parsed = TradingPlanRecordSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * Every plan of the wallet, newest updated first — for a reader that must see
 * each one (Нагляд's positions take every bought plan's exit), never a page a
 * person scrolls; that is `listTradingPlans`.
 */
export async function listAllTradingPlans(store: GuardStore, owner: string): Promise<readonly TradingPlanRecord[]> {
  if (!BASE58.test(owner)) return [];
  const values = await versioned(store).valuesWithPrefix(tradingPlanPrefix(owner));
  return values
    .map((value) => TradingPlanRecordSchema.safeParse(value))
    .filter((parsed): parsed is { success: true; data: TradingPlanRecord } => parsed.success)
    .map((parsed) => parsed.data)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

/** The wallet's plans, newest updated first, and how many there are in all. */
export async function listTradingPlans(store: GuardStore, owner: string): Promise<Readonly<{ records: readonly TradingPlanRecord[]; total: number }>> {
  const records = await listAllTradingPlans(store, owner);
  return { records: records.slice(0, PLAN_LIST_LIMIT), total: records.length };
}

/** Create: succeeds only when the key is absent. */
export async function insertTradingPlan(store: GuardStore, record: TradingPlanRecord): Promise<boolean> {
  return versioned(store).compareAndSet(tradingPlanKey(record.owner, record.id), null, TradingPlanRecordSchema.parse(record));
}

/**
 * Replace the record only while it still stands at the revision it was read
 * at; the written record carries the next revision.
 */
export async function replaceTradingPlan(store: GuardStore, read: TradingPlanRecord, next: Omit<TradingPlanRecord, "version">): Promise<boolean> {
  const record = TradingPlanRecordSchema.parse({ ...next, version: read.version + 1 });
  return versioned(store).compareAndSet(tradingPlanKey(record.owner, record.id), read.version, record);
}
