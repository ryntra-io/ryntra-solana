/**
 * Hack's runs in one instance's memory (CITY-238): a developer's machine, the stand and the tests. Rule for rule the
 * database's own steps (`supabase/migrations/20261110120000_hack_v2_runs.sql`); each method's body runs without an
 * `await` between its check and its write, so in one process a step is as atomic as under the database's lock. Not
 * `durable`: production runs no agent on it (`../store/ready.ts`).
 */

import type { Take } from "../store/contract.ts";
import { RUN_ATTEMPTS, ownerOverShare, type RunRecord, type RunStore } from "./contract.ts";

const copy = <T>(value: T): T => structuredClone(value);
const keyOf = (order: string, hunter: string) => `${order}\n${hunter}`;

export type MemoryRunStoreOptions = {
  /** The takes of an order, as the routes' store keeps them: a run starts only on its agent's take. Absent — not asked. */
  takes?: (order: string) => readonly Take[] | Promise<readonly Take[]>;
  /** How many agent-order pairs are kept. */
  keep?: number;
};

export function createMemoryRunStore(options: MemoryRunStoreOptions = {}): RunStore {
  /** Every attempt of an agent on an order, oldest first. */
  const runs = new Map<string, RunRecord[]>();
  const keep = options.keep ?? 500;
  const all = () => [...runs.values()].flat();
  const costOf = (run: RunRecord) => run.cost.spent ?? run.cost.reserved;
  const spent = (since: number, owner?: string) => all().filter((run) => run.startedAt >= since && (owner === undefined || run.owner === owner)).reduce((sum, run) => sum + costOf(run), 0);

  return {
    durable: false,

    async start(record, ceiling) {
      if (options.takes) {
        const taken = (await options.takes(record.order)).some((take) => take.hunter === record.hunter && take.owner === record.owner && take.role === record.role);
        if (!taken) return { ok: false, reason: "NOT_TAKEN" };
      }
      // From here to the write nothing waits: the checks and the write are one step.
      const key = keyOf(record.order, record.hunter);
      const attempts = runs.get(key) ?? [];
      const last = attempts[attempts.length - 1];
      // One run at a time; only a void one is played again, and only so many times.
      if (last && (last.status === "running" || last.result !== "void" || attempts.length >= RUN_ATTEMPTS)) return { ok: false, reason: "EXISTS" };
      if (record.cost.reserved > 0) {
        if (spent(ceiling.day) + record.cost.reserved > ceiling.cap) return { ok: false, reason: "DAILY_CAP" };
        if (ownerOverShare(spent(ceiling.day, record.owner), record.cost.reserved, ceiling.cap)) return { ok: false, reason: "DAILY_CAP" };
      }
      const attempt = attempts.length + 1;
      runs.delete(key);
      runs.set(key, [...attempts, copy({ ...record, attempt, status: "running", result: null, finding: null, cost: { reserved: record.cost.reserved, spent: null } })]);
      while (runs.size > keep) runs.delete(runs.keys().next().value as string);
      return { ok: true, attempt };
    },

    async put(record) {
      const attempts = runs.get(keyOf(record.order, record.hunter));
      const at = attempts?.findIndex((run) => run.attempt === record.attempt) ?? -1;
      if (!attempts || at === -1 || attempts[at]!.status !== "running") return false;
      const over = record.status === "done";
      attempts[at] = copy({ ...record, owner: attempts[at]!.owner, role: attempts[at]!.role, startedAt: attempts[at]!.startedAt, cost: { reserved: attempts[at]!.cost.reserved, spent: over ? (record.cost.spent ?? attempts[at]!.cost.reserved) : null } });
      return true;
    },

    async get(order, hunter) {
      const attempts = runs.get(keyOf(order, hunter));
      return attempts && attempts.length > 0 ? copy(attempts[attempts.length - 1]!) : null;
    },

    async spent(since) {
      return spent(since);
    },
  };
}
