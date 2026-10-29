/**
 * «План угоди й критик» in the Guard store (AI-11) — one collection,
 * `assistantPlans`, no DDL.
 *
 * `plan:solana:mainnet:<wallet>:<id>` — a person's trade plan: every version
 * with its critic (a version is never rewritten; a change appends one), the
 * state, the journal of what happened and when, and the person's Trading
 * Plan once they approved. Written by compare-and-set on the record's own
 * revision, so the page and a second tab never write over each other.
 */

import { randomBytes } from "node:crypto";

import { z } from "zod";

import { ASSISTANT_PLAN_EVENTS, ASSISTANT_PLAN_ID, ASSISTANT_PLAN_REASONS, ASSISTANT_PLAN_STATES, ASSISTANT_PLAN_VERSIONS_LIMIT, AssistantPlanVersionSchema, PLAN_ID, type AssistantPlanState, type AssistantPlanVersion } from "../../api/v1/contract.ts";
import type { GuardStore } from "../../guard/store.ts";

export const PLANS_COLLECTION = "assistantPlans" as const;
/** A wallet keeps this many plans; an ended one is removed by nothing — the person's record stays. */
export const PLANS_PER_WALLET = 20;
export const JOURNAL_LIMIT = 200;

const Wallet = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const Iso = z.string().datetime({ offset: true });

export const PlanJournalRowSchema = z.object({ at: Iso, event: z.enum(ASSISTANT_PLAN_EVENTS), version: z.number().int().min(1), note: z.string().max(240).nullable() }).strict();
export type PlanJournalRow = z.infer<typeof PlanJournalRowSchema>;

export const AssistantPlanRecordSchema = z
  .object({
    schema: z.literal("ryntra.assistant.plan"),
    /** The store's revision — every write moves it; the product version is the last entry of `versions`. */
    version: z.number().int().min(1),
    id: z.string().regex(ASSISTANT_PLAN_ID),
    owner: Wallet,
    mint: Wallet,
    symbol: z.string().min(1).max(32),
    state: z.enum(ASSISTANT_PLAN_STATES),
    stateReason: z.enum(ASSISTANT_PLAN_REASONS).nullable(),
    versions: z.array(AssistantPlanVersionSchema).min(1).max(ASSISTANT_PLAN_VERSIONS_LIMIT),
    journal: z.array(PlanJournalRowSchema).min(1).max(JOURNAL_LIMIT),
    /** The person's Trading Plan once approved, and the version of it this plan last mirrored. */
    tradingPlan: z.object({ id: z.string().regex(PLAN_ID), version: z.number().int().min(1) }).strict().nullable(),
    locale: z.enum(["en", "uk"]),
    createdAt: Iso,
    updatedAt: Iso,
  })
  .strict();
export type AssistantPlanRecord = z.infer<typeof AssistantPlanRecordSchema>;

type Versioned = { version: number };
const rows = (store: GuardStore) => store.versioned<Versioned & Record<string, unknown>>(PLANS_COLLECTION);

export const planKey = (owner: string, id: string): string => `plan:solana:mainnet:${owner}:${id}`;
const planPrefix = (owner: string): string => `plan:solana:mainnet:${owner}:`;

export function newAssistantPlanId(): string {
  return `apl_${randomBytes(12).toString("hex")}`;
}

function parsePlan(raw: unknown): AssistantPlanRecord | null {
  const parsed = AssistantPlanRecordSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** The wallet's plan by id; another wallet's id is simply not found. */
export async function readAssistantPlan(store: GuardStore, owner: string, id: string): Promise<AssistantPlanRecord | null> {
  if (!ASSISTANT_PLAN_ID.test(id)) return null;
  const found = parsePlan(await rows(store).get(planKey(owner, id)));
  return found && found.owner === owner ? found : null;
}

/** A wallet's plans, the newest changed first; a record this code cannot read is skipped. */
export async function listAssistantPlans(store: GuardStore, owner: string): Promise<AssistantPlanRecord[]> {
  const found = (await rows(store).valuesWithPrefix(planPrefix(owner))).flatMap((row) => {
    const parsed = parsePlan(row);
    return parsed && parsed.owner === owner ? [parsed] : [];
  });
  return found.sort((a, b) => (a.updatedAt > b.updatedAt ? -1 : a.updatedAt < b.updatedAt ? 1 : a.id < b.id ? -1 : 1));
}

/** Write over the revision read (null — create); false when someone else wrote first. */
export async function writeAssistantPlan(store: GuardStore, next: AssistantPlanRecord, expected: number | null): Promise<boolean> {
  return rows(store).compareAndSet(planKey(next.owner, next.id), expected, AssistantPlanRecordSchema.parse(next) as Versioned & Record<string, unknown>);
}

export const currentVersion = (record: AssistantPlanRecord): AssistantPlanVersion => record.versions[record.versions.length - 1]!;

/** A journal that keeps its newest rows: the first («created») always stays. */
export function withJournal(record: AssistantPlanRecord, row: PlanJournalRow): PlanJournalRow[] {
  const next = [...record.journal, row];
  return next.length <= JOURNAL_LIMIT ? next : [next[0]!, ...next.slice(next.length - JOURNAL_LIMIT + 1)];
}

/** The ended states: nothing moves a plan out of them. */
export const ENDED_STATES: ReadonlySet<AssistantPlanState> = new Set(["done", "cancelled", "broken"]);
