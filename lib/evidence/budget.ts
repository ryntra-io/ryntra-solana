/**
 * The credit governor — no paid call without budget, and every call counted
 * where the next instance can read it.
 *
 * Two ledger records per provider, both in the configured Guard store and
 * both advanced by compare-and-set: one for the UTC day and one for the
 * longer period — the whole packet for a provider whose credits are bought
 * as a packet (Nansen), the UTC month for one whose allowance resets monthly
 * (DD.xyz). A call **reserves** its expected cost before it is made — if
 * either ceiling would be crossed the call is refused and nothing is sent —
 * and **settles** after the answer on the provider's own cost headers
 * (`X-Nansen-Credits-Used` and `-Remaining`; `x-webacy-cu`). A missing
 * header is not a free call: the settlement then books the expected cost, so
 * an unknown price never becomes zero. Requests, successes, failures (by
 * kind), retries, cache hits and the last success are counted beside the
 * credits, so the usage the admin reads is what happened and reconciles with
 * the provider's dashboard by arithmetic rather than by memory.
 *
 * The ceilings come from the environment and are absent by default. Absent
 * means paid calls are off — a budget nobody agreed is no budget. The daily
 * ceiling stops new spend at the ceiling; nothing here tops up, purchases or
 * retries a refused reservation.
 *
 * Fail closed: a ledger that cannot be reached refuses the call. A governor
 * that allows when it cannot count is not a governor, and the cost of a
 * refused read is a card that says *not available right now*, which is the
 * truth.
 */

import { z } from "zod";

import { GUARD_CAS_MAX_ATTEMPTS, withBoundedCasRetry, type GuardStore, type GuardVersionedCollection } from "../guard/store.ts";
import type { CreditGovernor, GovernorSettlement } from "./governor.ts";
import { EVIDENCE_PROVIDERS, type EvidenceProvider } from "./metrics.ts";

/** The longer period a `total` ceiling covers: the whole credit packet, or the UTC month for an allowance that resets monthly. */
export type EvidenceBudgetPeriod = "packet" | "month";

export type EvidenceBudgetPolicy = Readonly<{ dailyCredits: number; totalCredits: number; totalPeriod: EvidenceBudgetPeriod }>;

/**
 * The ceilings from the environment. Both must be positive integers for
 * paid calls to be on; either missing or malformed and the answer is `null`,
 * which every caller reads as *no budget, no call*. The longer ceiling is
 * `RYNTRA_<PROVIDER>_MONTHLY_CREDITS` (the UTC month) where the provider's
 * allowance resets monthly, else `RYNTRA_<PROVIDER>_TOTAL_CREDITS` (the
 * packet); the monthly figure wins when both are set.
 */
export function resolveEvidenceBudget(env: Readonly<Record<string, string | undefined>>, provider: EvidenceProvider = "nansen"): EvidenceBudgetPolicy | null {
  const prefix = `RYNTRA_${provider.toUpperCase()}`;
  const daily = Number(env[`${prefix}_DAILY_CREDITS`]);
  const monthly = Number(env[`${prefix}_MONTHLY_CREDITS`]);
  const packet = Number(env[`${prefix}_TOTAL_CREDITS`]);
  if (!Number.isInteger(daily) || daily <= 0) return null;
  if (Number.isInteger(monthly) && monthly > 0) return { dailyCredits: daily, totalCredits: monthly, totalPeriod: "month" };
  if (Number.isInteger(packet) && packet > 0) return { dailyCredits: daily, totalCredits: packet, totalPeriod: "packet" };
  return null;
}

export const EvidenceLedgerRecordSchema = z
  .object({
    version: z.number().int().nonnegative(),
    provider: z.enum(EVIDENCE_PROVIDERS),
    scope: z.enum(["day", "total"]),
    /** The UTC date for a day record; `packet` or the UTC month (`2026-09`) for the total. */
    period: z.string().min(1).max(16),
    /** The sum of expected costs reserved before calls. */
    reservedCredits: z.number().int().nonnegative(),
    /** The sum the provider reported as deducted, or the expected cost where it reported nothing. */
    usedCredits: z.number().int().nonnegative(),
    requests: z.number().int().nonnegative(),
    succeeded: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    retries: z.number().int().nonnegative(),
    cacheHits: z.number().int().nonnegative(),
    /** The balance the provider last reported after a request; null until the first answer. */
    remainingReported: z.number().int().nullable(),
    lastRequestId: z.string().max(128).nullable(),
    updatedAt: z.string().datetime({ offset: true }),
    /** Failures by the client's kind (auth, plan, rate, timeout, …); absent on records written before the field existed. */
    failures: z.record(z.string().max(32), z.number().int().nonnegative()).default({}),
    /** When the provider last answered a call successfully; null until it has. */
    lastSucceededAt: z.string().datetime({ offset: true }).nullable().default(null),
  })
  .strict();
export type EvidenceLedgerRecord = z.output<typeof EvidenceLedgerRecordSchema>;

export type BudgetRefusal = Readonly<{ ok: false; code: "NO_BUDGET" | "BUDGET_EXHAUSTED" | "LEDGER_UNAVAILABLE"; message: string }>;
export type BudgetReservation = Readonly<{ ok: true; day: EvidenceLedgerRecord; total: EvidenceLedgerRecord }>;

/** The provider's own answer about the cost — the contract's shape (`governor.ts`). */
export type EvidenceSettlement = GovernorSettlement;

export function utcDay(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

export function utcMonth(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 7);
}

/** The period name of a `total` record under a policy: the credit packet, or the UTC month. */
export function totalPeriodOf(policy: EvidenceBudgetPolicy | null, nowMs: number): string {
  return policy?.totalPeriod === "month" ? utcMonth(nowMs) : "packet";
}

function ledgerKey(provider: EvidenceProvider, scope: "day" | "total", period: string): string {
  return `${provider}:${scope}:${period}`;
}

function opened(provider: EvidenceProvider, scope: "day" | "total", period: string, nowMs: number): EvidenceLedgerRecord {
  return EvidenceLedgerRecordSchema.parse({
    version: 0,
    provider,
    scope,
    period,
    reservedCredits: 0,
    usedCredits: 0,
    requests: 0,
    succeeded: 0,
    failed: 0,
    retries: 0,
    cacheHits: 0,
    remainingReported: null,
    lastRequestId: null,
    updatedAt: new Date(nowMs).toISOString(),
    failures: {},
    lastSucceededAt: null,
  });
}

/** The spend a ceiling is judged on: what was reserved or what was booked, whichever is larger. */
export function spentOf(record: EvidenceLedgerRecord): number {
  return Math.max(record.reservedCredits, record.usedCredits);
}

/** The shared-ledger governor: the contract every adapter speaks, plus what the product's admin reads. */
export type EvidenceBudgetGovernor = CreditGovernor &
  Readonly<{
    reserve(input: { expectedCredits: number; nowMs: number }): Promise<BudgetReservation | BudgetRefusal>;
    countCacheHit(nowMs: number): Promise<void>;
    read(nowMs: number): Promise<Readonly<{ policy: EvidenceBudgetPolicy | null; day: EvidenceLedgerRecord; total: EvidenceLedgerRecord }>>;
  }>;

export function createEvidenceBudgetGovernor(input: { store: GuardStore; provider: EvidenceProvider; policy: EvidenceBudgetPolicy | null }): EvidenceBudgetGovernor {
  const { store, provider, policy } = input;

  function ledger(): GuardVersionedCollection<EvidenceLedgerRecord> {
    return store.versioned<EvidenceLedgerRecord>("evidenceLedger");
  }

  /** Read both records, opening either that is missing; the loser of an open race re-reads and joins. */
  async function readBoth(nowMs: number): Promise<Readonly<{ day: EvidenceLedgerRecord; total: EvidenceLedgerRecord }>> {
    const collection = ledger();
    const dayKey = ledgerKey(provider, "day", utcDay(nowMs));
    const totalPeriod = totalPeriodOf(policy, nowMs);
    const totalKey = ledgerKey(provider, "total", totalPeriod);
    let day = await collection.get(dayKey);
    if (!day) {
      const fresh = opened(provider, "day", utcDay(nowMs), nowMs);
      day = (await collection.insertIfAbsent(dayKey, fresh)) ? fresh : await collection.get(dayKey);
    }
    let total = await collection.get(totalKey);
    if (!total) {
      const fresh = opened(provider, "total", totalPeriod, nowMs);
      total = (await collection.insertIfAbsent(totalKey, fresh)) ? fresh : await collection.get(totalKey);
    }
    if (!day || !total) throw new Error("the ledger records could not be opened");
    return { day, total };
  }

  async function advance(nowMs: number, change: (day: EvidenceLedgerRecord, total: EvidenceLedgerRecord) => Readonly<{ day: EvidenceLedgerRecord; total: EvidenceLedgerRecord }> | null): Promise<Readonly<{ day: EvidenceLedgerRecord; total: EvidenceLedgerRecord }> | null> {
    return withBoundedCasRetry(async () => {
      const current = await readBoth(nowMs);
      const next = change(current.day, current.total);
      if (next === null) return null;
      const written = await store.compareAndSetMany([
        { collection: "evidenceLedger", key: ledgerKey(provider, "day", current.day.period), expectedVersion: current.day.version, next: next.day },
        { collection: "evidenceLedger", key: ledgerKey(provider, "total", current.total.period), expectedVersion: current.total.version, next: next.total },
      ]);
      return written ? next : false;
    }, GUARD_CAS_MAX_ATTEMPTS);
  }

  return {
    async reserve({ expectedCredits, nowMs }) {
      if (!policy) return { ok: false, code: "NO_BUDGET", message: "No credit budget is configured for this provider; paid calls are off." };
      if (!Number.isInteger(expectedCredits) || expectedCredits <= 0) return { ok: false, code: "BUDGET_EXHAUSTED", message: "A call with no known price is not made." };
      let exhausted: string | null = null;
      try {
        const result = await advance(nowMs, (day, total) => {
          if (spentOf(day) + expectedCredits > policy.dailyCredits) {
            exhausted = `The day's ceiling of ${policy.dailyCredits} credits would be crossed (${spentOf(day)} spent).`;
            return null;
          }
          if (spentOf(total) + expectedCredits > policy.totalCredits) {
            exhausted = `The packet's ceiling of ${policy.totalCredits} credits would be crossed (${spentOf(total)} spent).`;
            return null;
          }
          const at = new Date(nowMs).toISOString();
          return {
            day: { ...day, version: day.version + 1, reservedCredits: day.reservedCredits + expectedCredits, updatedAt: at },
            total: { ...total, version: total.version + 1, reservedCredits: total.reservedCredits + expectedCredits, updatedAt: at },
          };
        });
        if (result === null) return { ok: false, code: "BUDGET_EXHAUSTED", message: exhausted ?? "The credit ceiling is reached." };
        return { ok: true, day: result.day, total: result.total };
      } catch (error) {
        /* Fail closed, and say so where an operator reads: a governor that cannot count makes no call. */
        console.error(`evidence ledger: reservation refused for ${provider}: ${error instanceof Error ? error.message : String(error)}`);
        return { ok: false, code: "LEDGER_UNAVAILABLE", message: error instanceof Error ? error.message : "The credit ledger could not be reached; no call is made." };
      }
    },

    async settle({ expectedCredits, settlement, nowMs }) {
      /* A missing header books the expected cost; a reported figure books the
         figure. A rejected call the provider priced at 0 books 0 — its
         reservation still stands in `reservedCredits`, which is the
         conservative side. */
      const booked = settlement.creditsUsed === null ? expectedCredits : Math.max(0, Math.round(settlement.creditsUsed));
      try {
        await advance(nowMs, (day, total) => {
          const at = new Date(nowMs).toISOString();
          const kind = settlement.failureKind ?? "unknown";
          const bump = (record: EvidenceLedgerRecord): EvidenceLedgerRecord => ({
            ...record,
            version: record.version + 1,
            usedCredits: record.usedCredits + booked,
            requests: record.requests + 1,
            succeeded: record.succeeded + (settlement.succeeded ? 1 : 0),
            failed: record.failed + (settlement.succeeded ? 0 : 1),
            retries: record.retries + (settlement.retried ? 1 : 0),
            remainingReported: settlement.creditsRemaining ?? record.remainingReported,
            lastRequestId: settlement.requestId ?? record.lastRequestId,
            updatedAt: at,
            /* Records written before the two fields existed carry neither; they are read as empty and absent. */
            failures: settlement.succeeded ? (record.failures ?? {}) : { ...(record.failures ?? {}), [kind]: ((record.failures ?? {})[kind] ?? 0) + 1 },
            lastSucceededAt: settlement.succeeded ? at : (record.lastSucceededAt ?? null),
          });
          return { day: bump(day), total: bump(total) };
        });
      } catch (error) {
        /* The call was made and the money spent; a settlement that cannot be
           written is logged, never swallowed silently and never retried into
           a second call. The reservation already counts the expected cost. */
        console.error(`evidence ledger: settlement not written for ${provider}: ${error instanceof Error ? error.message : String(error)}`);
      }
    },

    async countCacheHit(nowMs) {
      try {
        await advance(nowMs, (day, total) => {
          const at = new Date(nowMs).toISOString();
          return {
            day: { ...day, version: day.version + 1, cacheHits: day.cacheHits + 1, updatedAt: at },
            total: { ...total, version: total.version + 1, cacheHits: total.cacheHits + 1, updatedAt: at },
          };
        });
      } catch {
        /* Metering, not control: a lost count under contention is tolerated. */
      }
    },

    async read(nowMs) {
      const both = await readBoth(nowMs);
      return { policy, ...both };
    },
  };
}
