import { isLive, KEEP_FINISHED_MS, type EngineStop } from "./model.ts";

/**
 * What the engine keeps of stops (CITY-149): each wallet's stops, and for the cron the watched ones and the reached
 * ones not yet told. A deployment keeps them in the database (`supabase-store.ts`,
 * `supabase/migrations/*_spot_stops_v1.sql`) so every server instance and every cron pass sees the same rows and a
 * stop is reached once. This file also has the memory store — for tests and a developer's machine only: it lives as
 * long as one warm instance, so production never opens stops on it (`ready.ts`). Nothing here is money: a stop is an
 * intent, and only the person's wallet signs its sale.
 */

export type CreateOutcome = Readonly<{ ok: true }> | Readonly<{ ok: false; reason: "limit" | "taken" }>;

export interface StopsStore {
  /** True for a store every server instance shares (the database); false for one instance's memory. */
  readonly durable: boolean;
  /** A wallet's stops, the newest first: the live ones and the finished ones of the last thirty days. */
  list(owner: string, now: number): Promise<EngineStop[]>;
  /** Keeps a new stop, unless the wallet already has `max` live ones. Atomic for one wallet. */
  create(stop: EngineStop, max: number, now: number): Promise<CreateOutcome>;
  /** Lets a live stop go; a finished one stays as it is. Null when the wallet has no such stop. */
  cancel(owner: string, id: string, now: number): Promise<EngineStop | null>;
  /** A reached stop's sale settled. Null when the wallet has no such stop. */
  finish(owner: string, id: string, now: number): Promise<EngineStop | null>;
  /** Up to `limit` watched stops not past their time, the longest unchecked first; each is marked checked now. */
  due(now: number, limit: number): Promise<EngineStop[]>;
  /** Writes «reached» once: true only for the one call that turned a watched stop into a reached one. */
  reach(id: string, outRaw: string, now: number): Promise<boolean>;
  /** Reached stops whose person has not been told yet, the oldest first. */
  untold(limit: number): Promise<EngineStop[]>;
  /** The person was told of this reached stop (the note is written; its deliveries are queued). */
  told(id: string, now: number): Promise<void>;
  /** Watched and reached stops past their time become expired; how many did. */
  expire(now: number, limit: number): Promise<number>;
}

/** The store could not be reached or answered in a way the engine does not read: nothing it was asked is known. */
export class StopsStoreUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StopsStoreUnavailable";
  }
}

type Row = { stop: EngineStop; checkedAt: number | null; toldAt: number | null };

/** One instance's memory: for tests and a developer's machine. Never what a deployment opens on. */
export function createMemoryStopsStore(): StopsStore {
  const rows = new Map<string, Row>();
  const set = (row: Row, change: Partial<EngineStop>, now: number) => {
    row.stop = { ...row.stop, ...change, updatedAt: now };
    return row.stop;
  };
  const own = (owner: string, id: string) => {
    const row = rows.get(id);
    return row && row.stop.owner === owner ? row : null;
  };

  return {
    durable: false,
    async list(owner, now) {
      return [...rows.values()]
        .map((row) => row.stop)
        .filter((stop) => stop.owner === owner && stop.state !== "cancelled" && (isLive(stop, now) || now - stop.updatedAt <= KEEP_FINISHED_MS))
        .sort((a, b) => b.createdAt - a.createdAt);
    },
    async create(stop, max, now) {
      // Count and write in one turn of the event loop: two at once never both slip under the limit.
      if (rows.has(stop.id)) return { ok: false, reason: "taken" };
      const live = [...rows.values()].filter((row) => row.stop.owner === stop.owner && isLive(row.stop, now)).length;
      if (live >= max) return { ok: false, reason: "limit" };
      rows.set(stop.id, { stop, checkedAt: null, toldAt: null });
      return { ok: true };
    },
    async cancel(owner, id, now) {
      const row = own(owner, id);
      if (!row) return null;
      return row.stop.state === "watching" || row.stop.state === "reached" ? set(row, { state: "cancelled" }, now) : row.stop;
    },
    async finish(owner, id, now) {
      const row = own(owner, id);
      if (!row) return null;
      return row.stop.state === "reached" ? set(row, { state: "done" }, now) : row.stop;
    },
    async due(now, limit) {
      const picked = [...rows.values()]
        .filter((row) => row.stop.state === "watching" && (row.stop.expiresAt === null || row.stop.expiresAt > now))
        .sort((a, b) => (a.checkedAt ?? -1) - (b.checkedAt ?? -1) || a.stop.createdAt - b.stop.createdAt)
        .slice(0, limit);
      for (const row of picked) row.checkedAt = now;
      return picked.map((row) => row.stop);
    },
    async reach(id, outRaw, now) {
      const row = rows.get(id);
      if (!row || row.stop.state !== "watching" || (row.stop.expiresAt !== null && row.stop.expiresAt <= now)) return false;
      set(row, { state: "reached", reachedAt: now, reachedOutRaw: outRaw }, now);
      return true;
    },
    async untold(limit) {
      return [...rows.values()]
        .filter((row) => row.stop.state === "reached" && row.toldAt === null)
        .sort((a, b) => (a.stop.reachedAt ?? 0) - (b.stop.reachedAt ?? 0))
        .slice(0, limit)
        .map((row) => row.stop);
    },
    async told(id, now) {
      const row = rows.get(id);
      if (row && row.toldAt === null) row.toldAt = now;
    },
    async expire(now, limit) {
      let count = 0;
      for (const row of rows.values()) {
        if (count >= limit) break;
        if ((row.stop.state === "watching" || row.stop.state === "reached") && row.stop.expiresAt !== null && row.stop.expiresAt <= now) {
          set(row, { state: "expired" }, now);
          count += 1;
        }
      }
      return count;
    },
  };
}
