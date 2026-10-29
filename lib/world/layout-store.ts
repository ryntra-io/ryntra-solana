import type { Layout, Piece } from "./layout";
import { WorldStoreUnavailable, type WorldStore } from "./store";
import type { WorldRpc } from "./supabase-store";

/**
 * Where a quarter's free layout is kept (CITY-55). Two stores answer the same way, like the world's own: the database
 * through the server's secret-gated functions, and memory for tests and local work. A save is one atomic step,
 * written only if the layout is still at the version the person saw and only by the quarter's owner.
 */

export type CommitLayout = { residentId: string; quarterId: string; version: number; pieces: Piece[]; now: Date };

export type CommitLayoutResult =
  | { ok: true; layout: Layout }
  | { ok: false; error: "version"; layout: Layout }
  | { ok: false; error: "not_found" | "not_owner" };

export interface LayoutStore {
  /** The layout of a quarter; version 0 and no pieces while nothing was saved; null when there is no such quarter. */
  layout(quarterId: string): Promise<Layout | null>;
  commitLayout(input: CommitLayout): Promise<CommitLayoutResult>;
}

const empty = (quarterId: string): Layout => ({ quarterId, pieces: [], version: 0, updatedAt: null });

/** Layouts in memory, next to a memory world that knows the quarters and their owners. */
export class MemoryLayoutStore implements LayoutStore {
  private readonly rows = new Map<string, Layout>();
  private readonly world: WorldStore;

  constructor(world: WorldStore) {
    this.world = world;
  }

  async layout(quarterId: string): Promise<Layout | null> {
    if (!(await this.world.quarter(quarterId))) return null;
    return structuredClone(this.rows.get(quarterId) ?? empty(quarterId));
  }

  async commitLayout(input: CommitLayout): Promise<CommitLayoutResult> {
    const state = await this.world.quarter(input.quarterId);
    if (!state) return { ok: false, error: "not_found" };
    if (state.quarter.ownerId !== input.residentId) return { ok: false, error: "not_owner" };
    const current = this.rows.get(input.quarterId) ?? empty(input.quarterId);
    if (current.version !== input.version) return { ok: false, error: "version", layout: structuredClone(current) };
    const next: Layout = { quarterId: input.quarterId, pieces: structuredClone(input.pieces), version: current.version + 1, updatedAt: input.now.toISOString() };
    this.rows.set(input.quarterId, next);
    return { ok: true, layout: structuredClone(next) };
  }
}

type Answer = Record<string, unknown> & { ok?: unknown; error?: unknown };

/** Layouts in the database: `public.world_layout` and `public.world_commit_layout`, each one transaction. */
export class SupabaseLayoutStore implements LayoutStore {
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

  async layout(quarterId: string): Promise<Layout | null> {
    const data = await this.call("world_layout", { p_quarter_id: quarterId });
    if (data.ok === true) return data.layout as Layout;
    if (data.error === "not_found") return null;
    throw new WorldStoreUnavailable(`world_layout: ${String(data.error)}`);
  }

  async commitLayout(input: CommitLayout): Promise<CommitLayoutResult> {
    const data = await this.call("world_commit_layout", {
      p_resident_id: input.residentId, p_quarter_id: input.quarterId, p_version: input.version,
      p_pieces: input.pieces, p_now: input.now.toISOString(),
    });
    if (data.ok === true) return { ok: true, layout: data.layout as Layout };
    if (data.error === "version") return { ok: false, error: "version", layout: data.layout as Layout };
    if (data.error === "not_found" || data.error === "not_owner") return { ok: false, error: data.error };
    throw new WorldStoreUnavailable(`world_commit_layout: ${String(data.error)}`);
  }
}
