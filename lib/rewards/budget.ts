import { z } from "zod";

import { withBoundedCasRetry, type GuardAtomicVersionedWrite, type GuardStore } from "../guard/store.ts";

/**
 * The growth budget's journal (rules `2.1.0`, the decision of 2026-10-17): **$300 a month**, and when it is spent
 * the budget stops until the next month — it never goes below zero and never borrows from the next one.
 *
 * ## What it may pay for, and what it never pays for
 *
 * Only two things: prizes of a season for actions that do not depend on profit or volume, and paid work
 * of ambassadors. **Never a bonus, never money for a place** — by the rules, so there is no purpose to write one
 * under. The shares of the fee (cashback, friends, «First $10 back», partners) are paid from the fee Ryntra received
 * and never touch this journal (`fundedBy: "fee"` on their rows).
 *
 * ## Who spends
 *
 * Nobody automatically. A line is written for an approved spend (`approvedBy`); the payout itself is a person's act,
 * as every prize is. The journal is what keeps the month's limit: a line that does not fit is
 * refused whole, and nothing is written.
 *
 * ## One month, one record
 *
 * The month's record holds the limit, what was spent and the references of its lines, and is written in the same
 * atomic batch as each line — so the month's total is always the sum of its lines, and two spends at once cannot
 * both take the last dollars. A line repeated under its reference writes nothing a second time.
 */

export const GROWTH_BUDGET_COLLECTION = "rewardBudget" as const;
export const GROWTH_BUDGET_LINE_COLLECTION = "rewardBudgetEntries" as const;

/** The monthly limit, USD micro-units. A new limit is a new version of the rules. */
export const GROWTH_BUDGET_MONTHLY_USD_MICROS = 300_000_000n;

/** The only things the budget pays for. No bonus, no money for a place. */
export const GROWTH_BUDGET_PURPOSES = ["SEASON_PRIZE", "AMBASSADOR_WORK"] as const;
export type GrowthBudgetPurpose = (typeof GROWTH_BUDGET_PURPOSES)[number];

const MICROS = z.string().regex(/^(?:0|[1-9][0-9]*)$/);
const MONTH = z.string().regex(/^[0-9]{4}-(?:0[1-9]|1[0-2])$/);
const REF = z.string().regex(/^[A-Za-z0-9:_-]{1,120}$/);
const AT = z.string().datetime({ offset: true });

export const GrowthBudgetMonthSchema = z
  .object({
    version: z.number().int().nonnegative(),
    month: MONTH,
    limitUsdMicros: MICROS,
    spentUsdMicros: MICROS,
    refs: z.array(REF).max(2000),
  })
  .strict()
  .refine((month) => BigInt(month.spentUsdMicros) <= BigInt(month.limitUsdMicros), "a month never spends past its limit");
export type GrowthBudgetMonth = z.output<typeof GrowthBudgetMonthSchema>;

export const GrowthBudgetLineSchema = z
  .object({
    version: z.number().int().nonnegative(),
    ref: REF,
    month: MONTH,
    purpose: z.enum(GROWTH_BUDGET_PURPOSES),
    usdMicros: z.string().regex(/^[1-9][0-9]*$/),
    /** Who is paid, when it is one wallet; null for work paid outside a wallet listed here. */
    wallet: z.string().min(32).max(64).nullable(),
    /** What it is for, as it was approved: the season and the prize, or the work. */
    note: z.string().min(1).max(400),
    /** Who approved the spend. */
    approvedBy: z.string().min(1).max(120),
    fundedBy: z.literal("budget"),
    at: AT,
  })
  .strict();
export type GrowthBudgetLine = z.output<typeof GrowthBudgetLineSchema>;

export function budgetMonthOf(at: string): string {
  return new Date(Date.parse(at)).toISOString().slice(0, 7);
}

function lineKey(month: string, ref: string): string {
  return `${month}:${ref}`;
}

export type GrowthBudgetSpend = Readonly<{
  ref: string;
  purpose: GrowthBudgetPurpose;
  usdMicros: bigint;
  wallet?: string | null;
  note: string;
  approvedBy: string;
  /** When it is spent: the month it counts in. */
  at: string;
}>;

export type GrowthBudgetSpendOutcome =
  | Readonly<{ state: "SPENT"; line: GrowthBudgetLine; leftUsdMicros: bigint }>
  | Readonly<{ state: "EXISTING"; line: GrowthBudgetLine }>
  /** The month's budget cannot carry it: nothing was written, and nothing will be until the next month. */
  | Readonly<{ state: "STOPPED"; leftUsdMicros: bigint }>
  | Readonly<{ state: "REFUSED"; reason: string }>;

/** Write one approved spend into its month, or refuse it whole. */
export async function spendGrowthBudget(store: GuardStore, spend: GrowthBudgetSpend): Promise<GrowthBudgetSpendOutcome> {
  if (!(GROWTH_BUDGET_PURPOSES as readonly string[]).includes(spend.purpose)) {
    return { state: "REFUSED", reason: "The growth budget pays only season prizes and ambassadors' work — never a bonus or money for a place." };
  }
  if (typeof spend.usdMicros !== "bigint" || spend.usdMicros <= 0n) return { state: "REFUSED", reason: "A spend is a positive amount." };
  if (!Number.isFinite(Date.parse(spend.at))) return { state: "REFUSED", reason: "A spend needs its moment." };
  const month = budgetMonthOf(spend.at);
  const draft = GrowthBudgetLineSchema.safeParse({
    version: 0,
    ref: spend.ref,
    month,
    purpose: spend.purpose,
    usdMicros: spend.usdMicros.toString(),
    wallet: spend.wallet ?? null,
    note: spend.note.trim(),
    approvedBy: spend.approvedBy.trim(),
    fundedBy: "budget",
    at: new Date(Date.parse(spend.at)).toISOString(),
  });
  if (!draft.success) return { state: "REFUSED", reason: "The spend is not a well-formed line of the journal." };
  const line = draft.data;
  const months = store.versioned<GrowthBudgetMonth>(GROWTH_BUDGET_COLLECTION);
  const lines = store.versioned<GrowthBudgetLine>(GROWTH_BUDGET_LINE_COLLECTION);
  return withBoundedCasRetry<GrowthBudgetSpendOutcome>(async () => {
    const existing = GrowthBudgetLineSchema.safeParse(await lines.get(lineKey(month, line.ref)));
    if (existing.success) return { state: "EXISTING", line: existing.data };
    const current = GrowthBudgetMonthSchema.safeParse(await months.get(month));
    const record: GrowthBudgetMonth = current.success
      ? current.data
      : { version: -1, month, limitUsdMicros: GROWTH_BUDGET_MONTHLY_USD_MICROS.toString(), spentUsdMicros: "0", refs: [] };
    const left = BigInt(record.limitUsdMicros) - BigInt(record.spentUsdMicros);
    if (spend.usdMicros > left) return { state: "STOPPED", leftUsdMicros: left > 0n ? left : 0n };
    const next = GrowthBudgetMonthSchema.parse({
      ...record,
      version: record.version + 1,
      spentUsdMicros: (BigInt(record.spentUsdMicros) + spend.usdMicros).toString(),
      refs: [...record.refs, line.ref],
    });
    const writes: GuardAtomicVersionedWrite[] = [
      { collection: GROWTH_BUDGET_COLLECTION, key: month, expectedVersion: current.success ? record.version : null, next },
      { collection: GROWTH_BUDGET_LINE_COLLECTION, key: lineKey(month, line.ref), expectedVersion: null, next: line },
    ];
    if (!(await store.compareAndSetMany(writes))) return false;
    return { state: "SPENT", line, leftUsdMicros: left - spend.usdMicros };
  });
}

export type GrowthBudgetRead = Readonly<{
  month: string;
  limitUsdMicros: bigint;
  spentUsdMicros: bigint;
  leftUsdMicros: bigint;
  lines: readonly GrowthBudgetLine[];
  /** The month's total is the sum of its lines, and every line it names is there. */
  reconciled: boolean;
}>;

/** One month of the journal, and whether its total still equals the sum of its lines. */
export async function readGrowthBudget(store: GuardStore, month: string): Promise<GrowthBudgetRead> {
  const record = GrowthBudgetMonthSchema.safeParse(await store.versioned<GrowthBudgetMonth>(GROWTH_BUDGET_COLLECTION).get(month));
  const limit = record.success ? BigInt(record.data.limitUsdMicros) : GROWTH_BUDGET_MONTHLY_USD_MICROS;
  const spent = record.success ? BigInt(record.data.spentUsdMicros) : 0n;
  const rows = await store.collection<unknown>(GROWTH_BUDGET_LINE_COLLECTION).valuesWithPrefix(`${month}:`);
  const lines = rows.flatMap((row) => {
    const parsed = GrowthBudgetLineSchema.safeParse(row);
    return parsed.success && parsed.data.month === month ? [parsed.data] : [];
  }).sort((a, b) => a.at.localeCompare(b.at) || a.ref.localeCompare(b.ref));
  const sum = lines.reduce((total, line) => total + BigInt(line.usdMicros), 0n);
  const refs = new Set(record.success ? record.data.refs : []);
  const reconciled = sum === spent && lines.length === refs.size && lines.every((line) => refs.has(line.ref)) && rows.length === lines.length;
  return { month, limitUsdMicros: limit, spentUsdMicros: spent, leftUsdMicros: limit - spent > 0n ? limit - spent : 0n, lines, reconciled };
}
