/**
 * An agent's run on an order, as the server keeps it (CITY-238): the journal the harness writes turn by turn
 * (`../runner/brain.ts`, `TurnRecord[]`), how it ended, the finding it filed — and what its models may spend and did
 * spend, so the day's ceiling on Hack's models holds across every server instance.
 *
 * One interface, two stores: memory on a developer's machine and in tests (`memory.ts`), the database wherever a
 * deployment runs (`supabase.ts`, over `supabase/migrations/20261110120000_hack_v2_runs.sql`). The rules each keeps,
 * under one lock:
 *
 *   • a run starts only for an agent that took the order (its attacker's or defender's take, by the same owner);
 *   • one run of an agent on an order at a time; a run that ended void — the machine's or the network's fault, never
 *     the agent's — may be played again, `RUN_ATTEMPTS` times at most, and every attempt's spend still counts;
 *   • the day's ceiling: a live run holds the most it may spend, a finished one what it spent; a start that would go
 *     over the ceiling, or over one owner's part of it, is refused and nothing is written;
 *   • a run is written only while the store still holds it as running: a run a reader voided as stalled stays void.
 *
 * No money moves here: the ceiling is on what Ryntra's models cost, not a prize (CITY-229 is the money).
 */

import type { AgentResult, TurnRecord } from "../runner/brain.ts";
import type { HackRole } from "../store/contract.ts";

export type RunRecord = {
  readonly order: string;
  readonly hunter: string;
  /** The hunter's owner wallet — whose take it runs on. */
  readonly owner: string;
  readonly role: HackRole;
  /** 1 for the first run of this agent on this order; a void run played again is the next. */
  readonly attempt: number;
  readonly status: "running" | "done";
  /** The most brain turns the run may take. */
  readonly maxTurns: number;
  /** The harness's journal so far. */
  readonly history: readonly TurnRecord[];
  /** How it ended; `null` while it runs. */
  readonly result: AgentResult | null;
  /** One line on how it ended — for the owners' «Details», never a rule. */
  readonly detail: string;
  /** The finding it filed, when the store kept one. */
  readonly finding: string | null;
  /** Micro-dollars: the most its models may spend (held against the day's ceiling while it runs), what they spent once over. */
  readonly cost: { readonly reserved: number; readonly spent: number | null };
  readonly startedAt: number;
  readonly updatedAt: number;
};

/** What a start is held to, checked with the write in one step. */
export type RunCeiling = {
  /** The UTC day's start. */
  readonly day: number;
  /** The day's ceiling on Hack's models, micro-dollars. */
  readonly cap: number;
};

export type RunStarted = { ok: true; attempt: number } | { ok: false; reason: "EXISTS" | "NOT_TAKEN" | "DAILY_CAP" };

export interface RunStore {
  /** `true` when every server instance reads the same store. Production runs agents only on one. */
  readonly durable: boolean;
  /** A new run, if the agent took the order, no run of it is live or finished, and the day's ceiling lets it start. */
  start(record: RunRecord, ceiling: RunCeiling): Promise<RunStarted>;
  /** The run as it goes on, written only while the store holds this attempt as running; `false` once it is over there. */
  put(record: RunRecord): Promise<boolean>;
  /** The agent's latest run on the order. */
  get(order: string, hunter: string): Promise<RunRecord | null>;
  /** What the runs started since a moment spent on models, the live ones at their most. */
  spent(since: number): Promise<number>;
}

/** How many times a run that ended void may be started in all. */
export const RUN_ATTEMPTS = 3;

/** The most turns of a journal a store keeps, and the most bytes of one turn's result (a read's data is cut before). */
export const HISTORY_MAX = 40;

/**
 * One owner's part of the day's ceiling: a quarter of it, or its first run whatever that costs — so one owner's agents
 * never leave Hack shut for everyone else (the Ring's rule, `lib/ring/duel/service.ts`).
 */
export const OWNER_SHARE_OF_CAP = 4;
export function ownerOverShare(ownerSpent: number, reserved: number, cap: number): boolean {
  return ownerSpent > 0 && ownerSpent + reserved > Math.floor(cap / OWNER_SHARE_OF_CAP);
}

/** The store could not be reached, or answered in a way Hack does not read. */
export class RunStoreUnavailable extends Error {
  override name = "RunStoreUnavailable";
}
