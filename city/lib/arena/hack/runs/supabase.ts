/**
 * Hack's runs in the database (CITY-238): one call to one `public.hack_run_*` function per step, each gated by the app
 * secret and each one transaction under its lock (`supabase/migrations/20261110120000_hack_v2_runs.sql`). Every server
 * instance reads the same runs, so a run started on one instance is watched from another, and the day's ceiling on
 * Hack's models is checked and written under one lock.
 *
 * An answer that does not read as a run is `RunStoreUnavailable` — nothing is guessed.
 */

import { isHackRole } from "../store/contract.ts";
import type { HackRpc } from "../store/supabase.ts";
import { RunStoreUnavailable, type RunRecord, type RunStore } from "./contract.ts";

type Answer = Record<string, unknown>;

const iso = (ms: number) => new Date(ms).toISOString();
const isRecord = (value: unknown): value is Answer => !!value && typeof value === "object" && !Array.isArray(value);
const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

/** A run as the database keeps it: the record, with the columns the database decides laid over. */
export function runOf(value: unknown, fn: string): RunRecord {
  if (!isRecord(value) || !isRecord(value.record)) throw new RunStoreUnavailable(`${fn}: no run`);
  const { record, status, result, attempt, reserved, spent, startedAt, updatedAt } = value;
  const ok =
    typeof record.order === "string" &&
    typeof record.hunter === "string" &&
    typeof record.owner === "string" &&
    isHackRole(record.role) &&
    (status === "running" || status === "done") &&
    (result === null || typeof result === "string") &&
    isCount(attempt) &&
    isCount(reserved) &&
    (spent === null || isCount(spent)) &&
    isCount(startedAt) &&
    isCount(updatedAt) &&
    Array.isArray(record.history);
  if (!ok) throw new RunStoreUnavailable(`${fn}: unreadable run`);
  return {
    ...(record as unknown as RunRecord),
    attempt: attempt as number,
    status: status as RunRecord["status"],
    result: result as RunRecord["result"],
    cost: { reserved: reserved as number, spent: spent as number | null },
    startedAt: startedAt as number,
    updatedAt: updatedAt as number,
  };
}

export function createSupabaseRunStore(rpc: HackRpc): RunStore {
  async function call(fn: string, args: Answer): Promise<Answer> {
    const answer = await rpc(fn, args);
    if (!answer.ok) throw new RunStoreUnavailable(`${fn}: ${answer.error}`);
    if (!isRecord(answer.data)) throw new RunStoreUnavailable(`${fn}: no answer`);
    if (answer.data.ok !== true) throw new RunStoreUnavailable(`${fn}: ${String(answer.data.error ?? "refused")}`);
    return answer.data;
  }

  return {
    durable: true,

    async start(record, ceiling) {
      const data = await call("hack_run_start", {
        p_order: record.order,
        p_hunter: record.hunter,
        p_owner: record.owner,
        p_role: record.role,
        p_record: record,
        p_reserved: record.cost.reserved,
        p_day: iso(ceiling.day),
        p_cap: ceiling.cap,
        p_now: iso(record.startedAt),
      });
      if (data.started === true && isCount(data.attempt)) return { ok: true, attempt: data.attempt };
      const reasons = { exists: "EXISTS", not_taken: "NOT_TAKEN", daily_cap: "DAILY_CAP" } as const;
      const reason = reasons[data.error as keyof typeof reasons];
      if (!reason) throw new RunStoreUnavailable(`hack_run_start: ${String(data.error ?? "unreadable")}`);
      return { ok: false, reason };
    },

    async put(record) {
      const data = await call("hack_run_put", {
        p_order: record.order,
        p_hunter: record.hunter,
        p_attempt: record.attempt,
        p_status: record.status,
        p_result: record.result,
        p_record: record,
        p_spent: record.cost.spent,
        p_now: iso(record.updatedAt),
      });
      if (typeof data.written !== "boolean") throw new RunStoreUnavailable("hack_run_put: unreadable");
      return data.written;
    },

    async get(order, hunter) {
      const data = await call("hack_run_get", { p_order: order, p_hunter: hunter });
      return data.run === null || data.run === undefined ? null : runOf(data.run, "hack_run_get");
    },

    async spent(since) {
      const data = await call("hack_run_spent", { p_since: iso(since) });
      const spent = Number(data.spent);
      if (!Number.isSafeInteger(spent) || spent < 0) throw new RunStoreUnavailable("hack_run_spent: unreadable");
      return spent;
    },
  };
}
