/**
 * Where creators' sets are kept: the database's `private.launch_sets` and `private.launch_set_uses`, read and
 * written only through the three `public.launch_set*` functions (`supabase/migrations/20261120190000_launch_sets_v1.sql`).
 *
 * The transport is handed in — the server's usual RPC (`./store.server.ts`), a test's own. Any answer that is not the
 * function's own — no database here, a migration not yet applied, a timeout — is `null`: the read then stands on
 * Ryntra's own sets alone, and a save says the store is not there. Nothing here builds, signs or moves value.
 */

import { RYNTRA_SET_PREFIX, setTermsOf, termsKey, type CurveSet, type SetTerms } from "./set.ts";

export type StoreNetwork = "devnet" | "mainnet";

/** One RPC call: the function's JSON answer, or null for anything else. */
export type SetRpc = (fn: string, args: Record<string, unknown>) => Promise<unknown>;

export type TopRead = Readonly<{ sets: readonly CurveSet[]; ryntraUses: Readonly<Record<string, number>> }>;

export type SaveRefusal = "NAME_TAKEN" | "SAME_TERMS" | "AUTHOR_FULL" | "BAD_REQUEST";
export type SaveAnswer = Readonly<{ ok: true; set: CurveSet }> | Readonly<{ ok: false; code: SaveRefusal }>;

export type SetSaveRow = Readonly<{ name: string; author: string; terms: SetTerms; message: string; signature: string }>;

export type SetStore = Readonly<{
  /** Creators' sets, the most used first, and the launches made from each of Ryntra's own; null — no store here. */
  top(network: StoreNetwork, limit: number): Promise<TopRead | null>;
  /** A creator's set kept; null — no store here. */
  save(network: StoreNetwork, row: SetSaveRow): Promise<SaveAnswer | null>;
  /** One landed launch counted for one set, once; null — no store here. */
  use(network: StoreNetwork, setId: string, mint: string, terms: SetTerms): Promise<Readonly<{ counted: boolean }> | null>;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const objectOf = (value: unknown): Record<string, unknown> | null => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null);

/** A stored row as a set; null for one that does not read as a creator's set — it is left out, never guessed. */
export function storedSetOf(value: unknown): CurveSet | null {
  const row = objectOf(value);
  if (!row) return null;
  const terms = setTermsOf(row.terms);
  const uses = typeof row.uses === "number" && Number.isFinite(row.uses) ? Math.max(0, Math.floor(row.uses)) : 0;
  const createdAt = typeof row.created_at === "string" && Number.isFinite(Date.parse(row.created_at)) ? new Date(Date.parse(row.created_at)).toISOString() : null;
  if (typeof row.id !== "string" || !UUID.test(row.id) || typeof row.name !== "string" || !row.name || typeof row.author !== "string" || !BASE58_ADDRESS.test(row.author) || !terms) return null;
  return { id: row.id, name: row.name, names: null, author: row.author, terms, uses, createdAt };
}

/** Whether an id names a set at all: Ryntra's own or a stored one. */
export const isSetId = (id: string): boolean => UUID.test(id) || (id.startsWith(RYNTRA_SET_PREFIX) && /^[a-z-]{8,32}$/.test(id));

const SAVE_REFUSALS: Readonly<Record<string, SaveRefusal>> = { name_taken: "NAME_TAKEN", same_terms: "SAME_TERMS", author_full: "AUTHOR_FULL", bad_request: "BAD_REQUEST" };

export function createSetStore(rpc: SetRpc): SetStore {
  const ask = async (fn: string, args: Record<string, unknown>) => objectOf(await rpc(fn, args).catch(() => null));
  return {
    async top(network, limit) {
      const answer = await ask("launch_sets_top", { p_network: network, p_limit: Math.max(1, Math.min(100, Math.floor(limit))) });
      if (answer?.ok !== true) return null;
      const sets = (Array.isArray(answer.sets) ? answer.sets : []).map(storedSetOf).filter((set): set is CurveSet => set !== null);
      const ryntraUses: Record<string, number> = {};
      for (const entry of Array.isArray(answer.ryntra) ? answer.ryntra : []) {
        const row = objectOf(entry);
        if (row && typeof row.id === "string" && row.id.startsWith(RYNTRA_SET_PREFIX) && typeof row.uses === "number" && Number.isFinite(row.uses)) ryntraUses[row.id] = Math.max(0, Math.floor(row.uses));
      }
      return { sets, ryntraUses };
    },
    async save(network, row) {
      const answer = await ask("launch_set_save", {
        p_network: network,
        p_name: row.name,
        p_author: row.author,
        p_terms: row.terms,
        p_terms_key: termsKey(row.terms),
        p_message: row.message,
        p_signature: row.signature,
      });
      if (!answer || typeof answer.ok !== "boolean") return null;
      if (!answer.ok) return { ok: false, code: SAVE_REFUSALS[String(answer.error)] ?? "BAD_REQUEST" };
      const set = storedSetOf(answer.set);
      return set ? { ok: true, set } : null;
    },
    async use(network, setId, mint, terms) {
      const answer = await ask("launch_set_use", { p_network: network, p_set: setId, p_mint: mint, p_terms_key: termsKey(terms) });
      if (!answer || typeof answer.ok !== "boolean") return null;
      return { counted: answer.ok && answer.counted === true };
    },
  };
}
