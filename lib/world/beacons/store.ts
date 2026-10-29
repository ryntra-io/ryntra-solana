import { WorldStoreUnavailable } from "../store";
import type { WorldRpc } from "../supabase-store";

/**
 * Where the beacons are kept: one row an account — its rules and what the
 * engine remembers of them. Two stores answer alike: the database through the
 * server's secret-gated functions (`world_beacons*`, migration
 * `20261028120000_world_beacons.sql`) and memory for tests and local work.
 *
 * The rules are written only at the revision the person saw (a second tab
 * never overwrites the first without seeing it). The engine's states are
 * written by the server's check only while the rules are still at the
 * revision it checked. A store that cannot answer throws
 * `WorldStoreUnavailable`; a refusal is a value. No money anywhere.
 */

export type BeaconRow = Readonly<{
  accountId: string;
  /** Grows with every write of the rules; 0 before the first. */
  revision: number;
  rules: unknown;
  states: unknown;
  updatedAt: string | null;
}>;

export type WriteBeacons = Readonly<{ accountId: string; revision: number; rules: unknown; states: unknown; now: Date }>;

export type WriteResult = { ok: true; row: BeaconRow } | { ok: false; error: "revision"; row: BeaconRow } | { ok: false; error: "no_account" };

export interface BeaconStore {
  /** The account's row; revision 0 and no rules when it has none yet. */
  read(accountId: string): Promise<BeaconRow>;
  /** Replace the rules and their states, at the revision the person saw. */
  write(input: WriteBeacons): Promise<WriteResult>;
  /** Rows that have rules, by account, after a cursor: the server's check walks them page by page. */
  due(input: { after: string | null; limit: number }): Promise<BeaconRow[]>;
  /** The engine's states after a check; written only while the rules are still at `revision`. */
  step(input: { accountId: string; revision: number; states: unknown; now: Date }): Promise<boolean>;
}

const empty = (accountId: string): BeaconRow => ({ accountId, revision: 0, rules: [], states: {}, updatedAt: null });
const hasRules = (rules: unknown) => Array.isArray(rules) && rules.length > 0;

export class MemoryBeaconStore implements BeaconStore {
  private readonly rows = new Map<string, BeaconRow>();
  /** Accounts that exist, as `public.beta_users` would say; empty means any. */
  readonly accounts = new Set<string>();
  down = false;

  private gate() {
    if (this.down) throw new WorldStoreUnavailable("beacons store down");
  }

  async read(accountId: string): Promise<BeaconRow> {
    this.gate();
    return this.rows.get(accountId) ?? empty(accountId);
  }

  async write(input: WriteBeacons): Promise<WriteResult> {
    this.gate();
    if (this.accounts.size > 0 && !this.accounts.has(input.accountId)) return { ok: false, error: "no_account" };
    const current = this.rows.get(input.accountId) ?? empty(input.accountId);
    if (current.revision !== input.revision) return { ok: false, error: "revision", row: current };
    const row: BeaconRow = { accountId: input.accountId, revision: current.revision + 1, rules: structuredClone(input.rules), states: structuredClone(input.states), updatedAt: input.now.toISOString() };
    this.rows.set(input.accountId, row);
    return { ok: true, row };
  }

  async due(input: { after: string | null; limit: number }): Promise<BeaconRow[]> {
    this.gate();
    return [...this.rows.values()]
      .filter((row) => hasRules(row.rules) && (input.after === null || row.accountId > input.after))
      .sort((a, b) => (a.accountId < b.accountId ? -1 : 1))
      .slice(0, input.limit);
  }

  async step(input: { accountId: string; revision: number; states: unknown; now: Date }): Promise<boolean> {
    this.gate();
    const current = this.rows.get(input.accountId);
    if (!current || current.revision !== input.revision) return false;
    this.rows.set(input.accountId, { ...current, states: structuredClone(input.states) });
    return true;
  }
}

type Answer = Record<string, unknown> & { ok?: unknown; error?: unknown };

const rowOf = (raw: unknown, accountId: string): BeaconRow => {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!r) return empty(accountId);
  return {
    accountId: typeof r.accountId === "string" ? r.accountId : accountId,
    revision: typeof r.revision === "number" && Number.isInteger(r.revision) ? r.revision : 0,
    rules: r.rules ?? [],
    states: r.states ?? {},
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : null,
  };
};

/** The beacons in the database: one call to one `public.world_beacons*` function per question. */
export class SupabaseBeaconStore implements BeaconStore {
  private readonly rpc: WorldRpc;

  constructor(rpc: WorldRpc) {
    this.rpc = rpc;
  }

  private async call(fn: string, args: Record<string, unknown>): Promise<Answer> {
    const answer = await this.rpc(fn, args);
    if (!answer.ok) throw new WorldStoreUnavailable(`${fn}: ${answer.error}`);
    const data = answer.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new WorldStoreUnavailable(`${fn}: no answer`);
    return data as Answer;
  }

  async read(accountId: string): Promise<BeaconRow> {
    const data = await this.call("world_beacons", { p_account_id: accountId });
    if (data.ok !== true) throw new WorldStoreUnavailable(`world_beacons: ${String(data.error)}`);
    return rowOf(data.row, accountId);
  }

  async write(input: WriteBeacons): Promise<WriteResult> {
    const data = await this.call("world_set_beacons", {
      p_account_id: input.accountId, p_revision: input.revision, p_rules: input.rules, p_states: input.states, p_now: input.now.toISOString(),
    });
    if (data.ok === true) return { ok: true, row: rowOf(data.row, input.accountId) };
    if (data.error === "revision") return { ok: false, error: "revision", row: rowOf(data.row, input.accountId) };
    if (data.error === "no_account") return { ok: false, error: "no_account" };
    throw new WorldStoreUnavailable(`world_set_beacons: ${String(data.error)}`);
  }

  async due(input: { after: string | null; limit: number }): Promise<BeaconRow[]> {
    const data = await this.call("world_beacons_due", { p_after: input.after, p_limit: input.limit });
    if (data.ok !== true || !Array.isArray(data.rows)) throw new WorldStoreUnavailable("world_beacons_due: no rows");
    return data.rows.map((row) => rowOf(row, ""));
  }

  async step(input: { accountId: string; revision: number; states: unknown; now: Date }): Promise<boolean> {
    const data = await this.call("world_beacons_step", { p_account_id: input.accountId, p_revision: input.revision, p_states: input.states, p_now: input.now.toISOString() });
    if (data.ok !== true) throw new WorldStoreUnavailable(`world_beacons_step: ${String(data.error)}`);
    return data.written === true;
  }
}
