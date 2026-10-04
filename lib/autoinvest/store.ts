/**
 * Autoinvest rules and the month's budget — in the Guard store.
 *
 * The cabinet belongs to the wallet, so a rule is keyed by the
 * wallet that proved itself when it was written and read back only through
 * that proof — the `rw` cookie in a browser, the native bearer on a phone.
 * The stored record is the contract's rule with the language its reminder is
 * written in and the store's own revision; an occurrence keeps only what the
 * tick decided (`due`, `bought`, `missed`, `held`) — a signed purchase that
 * has not settled is read from History at the moment it is asked about, never
 * stored as a guess. A «Якщо впаде» rule keeps its reference point and whether
 * it is armed; the trigger is computed from them, never stored.
 *
 * `version` is the compare-and-set counter: the tick writing a reminder and
 * the person pausing the rule from the phone are two writes of one row, and
 * on a lost race the loser re-reads and decides again.
 *
 * The budget is one row per wallet: the ceiling, the clock its month is
 * counted on, and the language the note that it is spent is written in. Its
 * spend is never stored — History says it at every read.
 */

import { randomBytes } from "node:crypto";

import { z } from "zod";

import {
  BUDGET_MAXIMUM_USD,
  BUDGET_MINIMUM_USD,
  NETWORK,
  PAYMENT_DIRECTIONS,
  PAYMENT_EVENTS_KEPT,
  PAYMENT_FIXED_MAX_USD,
  PAYMENT_FIXED_MIN_USD,
  PAYMENT_PERCENT_MAX,
  PAYMENT_PERCENT_MIN,
  PlanAssetSchema,
  RULE_DIP_MAX_PCT,
  RULE_DIP_MIN_PCT,
  RULE_ID,
  RULE_KINDS,
  RULE_OCCURRENCES_KEPT,
  RULE_PAYMENT_MODES,
  RULE_STATUSES,
  RuleConditionCheckSchema,
  RulePriceConditionSchema,
  RuleScheduleSchema,
  RuleTriggerSchema,
} from "../api/v1/contract.ts";
import type { GuardStore } from "../guard/store.ts";
import { PAYMENT_QUEUE_LISTED } from "./limits.ts";

const COLLECTION = "autoinvestRules" as const;
const BUDGETS = "autoinvestBudgets" as const;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const Iso = z.string().datetime({ offset: true });
/** Every rule of every wallet starts so; a wallet's own rows add the wallet and a colon. */
const ALL_RULES = "solana:mainnet:";

/** An occurrence as the rule keeps it: what the tick decided. `pending` is read from History, never stored. */
export const StoredOccurrenceSchema = z
  .object({
    dueAt: Iso,
    openUntil: Iso,
    /** `deferred` (1.18.0): the price condition held the purchase back; the tick judges it again while the occurrence is open. */
    state: z.enum(["due", "bought", "missed", "held", "deferred"]),
    remindedAt: Iso.nullable(),
    signature: z.string().min(64).max(128).nullable(),
    spentUsd: z.number().nonnegative().nullable(),
    boughtAt: Iso.nullable(),
    /** A «Якщо впаде» occurrence's price and reference point (1.13.0); absent on every occurrence written before them. */
    trigger: RuleTriggerSchema.nullable().default(null),
    /** The price condition's judgement that opened or deferred it (1.18.0); absent on every occurrence written before it. */
    condition: RuleConditionCheckSchema.nullable().default(null),
    /** A «З кожної оплати» occurrence's own sum and how many events gathered it (1.19.0); null — the rule's sum — on every other. */
    amountUsd: z.number().finite().positive().nullable().default(null),
    events: z.number().int().min(0).nullable().default(null),
  })
  .strict();
export type StoredOccurrence = z.output<typeof StoredOccurrenceSchema>;

/**
 * One event a «З кожної оплати» rule counted (1.19.0): the watch's number for
 * it, the transaction, the movement and the rule's share in cents, when it
 * happened, its Solana Pay label, and the reminder that took it — null while
 * it waits.
 */
export const StoredPaymentEventSchema = z
  .object({
    seq: z.number().int().min(1),
    signature: z.string().min(64).max(128),
    direction: z.enum(PAYMENT_DIRECTIONS),
    amountUsd: z.number().finite().nonnegative(),
    addCents: z.number().int().min(0),
    at: Iso,
    label: z.string().max(80).nullable(),
    dueAt: Iso.nullable(),
  })
  .strict();
export type StoredPaymentEvent = z.output<typeof StoredPaymentEventSchema>;

/**
 * A «З кожної оплати» rule's state as stored (1.19.0): the terms, the instant
 * it counts from, the last watch number it took, what waits (in cents and
 * events) and the events it lists — every waiting one up to
 * `PAYMENT_QUEUE_LISTED`, and the last `PAYMENT_EVENTS_KEPT` a reminder took.
 */
export const StoredPaymentsSchema = z
  .object({
    mode: z.enum(RULE_PAYMENT_MODES),
    roundToUsd: z.number().positive().nullable(),
    fixedUsd: z.number().min(PAYMENT_FIXED_MIN_USD).max(PAYMENT_FIXED_MAX_USD).nullable(),
    percent: z.number().int().min(PAYMENT_PERCENT_MIN).max(PAYMENT_PERCENT_MAX).nullable(),
    timeZone: z.string().min(1).max(64),
    since: Iso,
    lastSeq: z.number().int().min(0),
    gatheredCents: z.number().int().min(0),
    gatheredCount: z.number().int().min(0),
    events: z.array(StoredPaymentEventSchema).max(PAYMENT_QUEUE_LISTED + PAYMENT_EVENTS_KEPT),
  })
  .strict();
export type StoredPayments = z.output<typeof StoredPaymentsSchema>;

/** A «Якщо впаде» rule's state as stored: the wire's `dip` without the trigger, which is computed. */
export const StoredDipSchema = z
  .object({
    dropPct: z.number().int().min(RULE_DIP_MIN_PCT).max(RULE_DIP_MAX_PCT),
    timeZone: z.string().min(1).max(64),
    anchorUsd: z.number().finite().positive(),
    anchorAt: Iso,
    anchorFrom: z.enum(["enabled", "purchase"]),
    armed: z.boolean(),
    heldAt: Iso.nullable(),
  })
  .strict();
export type StoredDip = z.output<typeof StoredDipSchema>;

export const AutoinvestRuleRecordSchema = z
  .object({
    schema: z.literal("ryntra.autoinvest-rule"),
    schemaVersion: z.literal("1.0.0"),
    id: z.string().regex(RULE_ID),
    owner: z.string().regex(BASE58),
    network: z.literal(NETWORK),
    kind: z.enum(RULE_KINDS),
    asset: PlanAssetSchema,
    name: z.string().min(1).max(128),
    amountUsd: z.number().finite().positive(),
    /** A «Регулярно» rule's; null on a «Якщо впаде» rule. */
    schedule: RuleScheduleSchema.nullable(),
    /** A «Якщо впаде» rule's (1.13.0); absent — null — on every rule written before it. */
    dip: StoredDipSchema.nullable().default(null),
    /** A «З кожної оплати» rule's (1.19.0); absent — null — on every rule written before it. */
    payments: StoredPaymentsSchema.nullable().default(null),
    /** «Умова ціни» (1.18.0); absent — null, no condition — on every rule written before it. */
    priceCondition: RulePriceConditionSchema.nullable().default(null),
    status: z.enum(RULE_STATUSES),
    /** The language a one-language channel (Telegram) carries the reminder in: the one the rule was written in. */
    locale: z.enum(["en", "uk"]),
    nextDueAt: Iso.nullable(),
    /** Oldest first, the last `RULE_OCCURRENCES_KEPT`. */
    occurrences: z.array(StoredOccurrenceSchema).max(RULE_OCCURRENCES_KEPT),
    /** The store's revision — the compare-and-set counter, bumped by every write. */
    version: z.number().int().min(1),
    createdAt: Iso,
    updatedAt: Iso,
  })
  .strict()
  .refine(
    (record) =>
      record.kind === "schedule"
        ? record.schedule !== null && record.dip === null && record.payments === null
        : record.kind === "dip"
          ? record.dip !== null && record.schedule === null && record.payments === null
          : record.payments !== null && record.schedule === null && record.dip === null,
    { message: "A «Регулярно» rule keeps a schedule, a «Якщо впаде» rule its reference point, a «З кожної оплати» rule its payments — one of them only." },
  );
export type AutoinvestRuleRecord = z.output<typeof AutoinvestRuleRecordSchema>;
export type AutoinvestRuleDraft = Omit<AutoinvestRuleRecord, "version">;

export function newRuleId(): string {
  return `rule_${randomBytes(16).toString("hex")}`;
}

export function ruleKey(owner: string, ruleId: string): string {
  return `solana:mainnet:${owner}:${ruleId}`;
}

/** The trailing colon keeps a scan for one wallet from reading a wallet whose address starts the same way. */
export function rulePrefix(owner: string): string {
  return `solana:mainnet:${owner}:`;
}

function versioned(store: GuardStore) {
  return store.versioned<AutoinvestRuleRecord>(COLLECTION);
}

function parsed(values: readonly unknown[]): AutoinvestRuleRecord[] {
  return values
    .map((value) => AutoinvestRuleRecordSchema.safeParse(value))
    .filter((read): read is { success: true; data: AutoinvestRuleRecord } => read.success)
    .map((read) => read.data);
}

export async function readRule(store: GuardStore, owner: string, ruleId: string): Promise<AutoinvestRuleRecord | null> {
  if (!BASE58.test(owner) || !RULE_ID.test(ruleId)) return null;
  const raw = await versioned(store).get(ruleKey(owner, ruleId));
  if (raw === undefined || raw === null) return null;
  const read = AutoinvestRuleRecordSchema.safeParse(raw);
  return read.success ? read.data : null;
}

/** The wallet's rules, newest written first. */
export async function listRuleRecords(store: GuardStore, owner: string): Promise<readonly AutoinvestRuleRecord[]> {
  if (!BASE58.test(owner)) return [];
  const rows = parsed(await versioned(store).valuesWithPrefix(rulePrefix(owner)));
  return rows.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

/** Every wallet's rules — the tick's scan. */
export async function listAllRuleRecords(store: GuardStore): Promise<readonly AutoinvestRuleRecord[]> {
  return parsed(await versioned(store).valuesWithPrefix(ALL_RULES));
}

/** Create: succeeds only when the key is absent. */
export async function insertRule(store: GuardStore, record: AutoinvestRuleRecord): Promise<boolean> {
  return versioned(store).compareAndSet(ruleKey(record.owner, record.id), null, AutoinvestRuleRecordSchema.parse(record));
}

/** Replace the row only while it still stands at the revision it was read at; the written row carries the next one. */
export async function replaceRule(store: GuardStore, read: AutoinvestRuleRecord, next: AutoinvestRuleDraft): Promise<boolean> {
  const record = AutoinvestRuleRecordSchema.parse({ ...next, version: read.version + 1 });
  return versioned(store).compareAndSet(ruleKey(record.owner, record.id), read.version, record);
}

export async function removeRule(store: GuardStore, owner: string, ruleId: string): Promise<void> {
  await versioned(store).delete(ruleKey(owner, ruleId));
}

/* ------------------------------------------------------------ the month's budget (1.13.0) */

export const AutoinvestBudgetRecordSchema = z
  .object({
    schema: z.literal("ryntra.autoinvest-budget"),
    schemaVersion: z.literal("1.0.0"),
    owner: z.string().regex(BASE58),
    network: z.literal(NETWORK),
    capUsd: z.number().finite().min(BUDGET_MINIMUM_USD).max(BUDGET_MAXIMUM_USD),
    /** The clock the month is counted on: the person's own. */
    timeZone: z.string().min(1).max(64),
    /** The language a one-language channel carries the note that the budget is spent in. */
    locale: z.enum(["en", "uk"]),
    version: z.number().int().min(1),
    createdAt: Iso,
    updatedAt: Iso,
  })
  .strict();
export type AutoinvestBudgetRecord = z.output<typeof AutoinvestBudgetRecordSchema>;

export function budgetKey(owner: string): string {
  return `solana:mainnet:${owner}`;
}

function budgets(store: GuardStore) {
  return store.versioned<AutoinvestBudgetRecord>(BUDGETS);
}

export async function readBudgetRecord(store: GuardStore, owner: string): Promise<AutoinvestBudgetRecord | null> {
  if (!BASE58.test(owner)) return null;
  const raw = await budgets(store).get(budgetKey(owner));
  if (raw === undefined || raw === null) return null;
  const read = AutoinvestBudgetRecordSchema.safeParse(raw);
  return read.success ? read.data : null;
}

/** Write the ceiling: a new row, or the row as it stood when read — the loser of a race re-reads. */
export async function writeBudgetRecord(store: GuardStore, read: AutoinvestBudgetRecord | null, next: Omit<AutoinvestBudgetRecord, "version">): Promise<boolean> {
  const record = AutoinvestBudgetRecordSchema.parse({ ...next, version: (read?.version ?? 0) + 1 });
  return budgets(store).compareAndSet(budgetKey(record.owner), read?.version ?? null, record);
}

export async function removeBudgetRecord(store: GuardStore, owner: string): Promise<void> {
  await budgets(store).delete(budgetKey(owner));
}
