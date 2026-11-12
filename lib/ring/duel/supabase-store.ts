import type { RingRpc } from "../supabase-store.ts";
import { RingStoreUnavailable } from "../store.ts";
import { isDuelFormat } from "./harness.ts";
import type { DuelRecord, DuelStore, OpenLimits, Opened } from "./service.ts";

/**
 * The duels in the database (CITY-217): one call to one `public.ring_duel_*` function per question, each gated by the
 * app secret and each one transaction (`supabase/migrations/20261108120100_ring_v2_arena.sql`). Every server instance
 * reads the same duels, so a duel started on one instance is watched from another, and the day's limits — starts per
 * account, duels per agent, the models' spend under the ceiling — are checked and written under one lock.
 */

type Answer = Record<string, unknown>;

const iso = (ms: number) => new Date(ms).toISOString();
const isRecord = (value: unknown): value is Answer => !!value && typeof value === "object" && !Array.isArray(value);
const STATUSES: readonly DuelRecord["status"][] = ["live", "done", "void"];

/** A duel as the server wrote it; one that does not read as one is unavailable, never guessed at. */
export function duelOf(value: unknown, fn: string): DuelRecord {
  if (!isRecord(value)) throw new RingStoreUnavailable(`${fn}: no duel`);
  const { id, format, owner, status, seats, rules, log, secrets, createdAt, updatedAt } = value;
  const ok =
    typeof id === "string" &&
    isDuelFormat(format) &&
    typeof owner === "string" &&
    STATUSES.includes(status as DuelRecord["status"]) &&
    Array.isArray(seats) &&
    seats.length === 2 &&
    isRecord(rules) &&
    isRecord(log) &&
    Array.isArray(secrets) &&
    Number.isFinite(createdAt) &&
    Number.isFinite(updatedAt);
  if (!ok) throw new RingStoreUnavailable(`${fn}: unreadable duel`);
  const cost = isRecord(value.cost) ? value.cost : {};
  return {
    ...(value as unknown as DuelRecord),
    cost: { reserved: Number.isSafeInteger(cost.reserved) ? (cost.reserved as number) : 0, spent: Number.isSafeInteger(cost.spent) ? (cost.spent as number) : null },
  };
}

export function createSupabaseDuelStore(rpc: RingRpc): DuelStore {
  async function call(fn: string, args: Answer): Promise<Answer> {
    const answer = await rpc(fn, args);
    if (!answer.ok) throw new RingStoreUnavailable(`${fn}: ${answer.error}`);
    if (!isRecord(answer.data)) throw new RingStoreUnavailable(`${fn}: no answer`);
    if (answer.data.ok !== true) throw new RingStoreUnavailable(`${fn}: ${String(answer.data.error ?? "refused")}`);
    return answer.data;
  }

  return {
    durable: true,

    async open(record: DuelRecord, limits: OpenLimits): Promise<Opened> {
      const data = await call("ring_duel_open", {
        p_id: record.id,
        p_owner: record.owner,
        p_seat_a: record.seats[0].id,
        p_seat_b: record.seats[1].id,
        p_format: record.format,
        p_record: record,
        p_reserved: record.cost.reserved,
        p_agents: limits.agents,
        p_since: iso(limits.since),
        p_day: iso(limits.day),
        p_per_owner: limits.perOwner,
        p_per_agent: limits.perAgent,
        p_cap: limits.cap,
        p_now: iso(record.createdAt),
      });
      if (data.opened === true) return { ok: true };
      if (data.error === "rate_limited") return { ok: false, reason: "RATE_LIMITED" };
      if (data.error === "daily_cap") return { ok: false, reason: "DAILY_CAP" };
      if (data.error === "exists") return { ok: false, reason: "EXISTS" };
      throw new RingStoreUnavailable(`ring_duel_open: ${String(data.error ?? "unreadable")}`);
    },

    async put(record: DuelRecord): Promise<boolean> {
      const data = await call("ring_duel_put", { p_id: record.id, p_status: record.status, p_record: record, p_spent: record.cost.spent, p_now: iso(record.updatedAt) });
      if (typeof data.written !== "boolean") throw new RingStoreUnavailable("ring_duel_put: unreadable");
      return data.written;
    },

    async get(id: string): Promise<DuelRecord | null> {
      const data = await call("ring_duel_get", { p_id: id });
      return data.record === null || data.record === undefined ? null : duelOf(data.record, "ring_duel_get");
    },

    async recent(limit: number): Promise<DuelRecord[]> {
      const data = await call("ring_duel_recent", { p_limit: limit });
      if (!Array.isArray(data.records)) throw new RingStoreUnavailable("ring_duel_recent: unreadable");
      return data.records.map((row) => duelOf(row, "ring_duel_recent"));
    },

    async count(filter: { owner?: string; agent?: string; since: number }): Promise<number> {
      const data = await call("ring_duel_count", { p_owner: filter.owner ?? null, p_agent: filter.agent ?? null, p_since: iso(filter.since) });
      if (!Number.isSafeInteger(data.count)) throw new RingStoreUnavailable("ring_duel_count: unreadable");
      return data.count as number;
    },

    async spent(since: number): Promise<number> {
      const data = await call("ring_duel_spent", { p_since: iso(since) });
      const spent = Number(data.spent);
      if (!Number.isSafeInteger(spent)) throw new RingStoreUnavailable("ring_duel_spent: unreadable");
      return spent;
    },
  };
}
