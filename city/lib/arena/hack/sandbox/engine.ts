/**
 * The engine a Hack run drives (CITY-224): one copy of the chain, in memory, loaded from a recorded snapshot. The
 * sandbox owns the run — the pin, the limits, the log, the wall against the network — and the engine only executes.
 * In production and on the stand it is LiteSVM with mainnet's program bytes (the fork bench of CITY-70/204/219; the
 * adapter is `docs/research/city-224-hack-sandbox/harness/litesvm.mjs`); the library's own tests use a tiny engine
 * (`toy.ts`) so they run anywhere, with no binary.
 *
 * What an engine promises:
 *   • synchronous: a step runs to its end before anything else in the process (the judge's replay needs it, and the
 *     offline wall depends on it);
 *   • deterministic: the same snapshot and the same transactions give the same results, units, logs and state hash;
 *   • a copy only: nothing is fetched — an account the snapshot does not hold does not exist in the copy;
 *   • signatures checked: a transaction is only what its real signatures allow, so a finding is the program's fault and
 *     never a forged signature;
 *   • a compute budget per transaction it enforces itself.
 */

import type { AccountState, EngineRef, Snapshot } from "./pin.ts";

/** The outcome of one transaction in the copy. */
export type ExecResult = {
  readonly ok: boolean;
  /** The engine's error, short; `null` when the transaction landed. */
  readonly err: string | null;
  /** Compute units consumed (at most the budget the engine was given). */
  readonly units: number;
  readonly logs: readonly string[];
};

export type ForkEngine = EngineRef & {
  /** A fresh copy: the snapshot's programs, accounts and clock. Signatures checked; no network; nothing loaded lazily. */
  load(snapshot: Snapshot): void;
  /** One transaction's wire bytes, with this compute budget. Never throws for a transaction the copy rejects. */
  execute(tx: Uint8Array, cuLimit: number): ExecResult;
  /** Moves the copy's clock forward by whole slots (and its unix time with them). */
  warp(slots: number): void;
  clock(): { slot: number; unixTimestamp: number };
  /** An account of the copy, or `null` when it does not exist. */
  read(address: string): AccountState | null;
  /** Gives a system account lamports — for the agent's own fee payers, never for an account of the snapshot. */
  fund(address: string, lamports: bigint): void;
  /** `accountsHash` over every account the copy knows: the snapshot's, the funded ones and every one a run touched. */
  stateHash(): string;
};

/** A fresh engine for each run and each replay. */
export type EngineFactory = () => ForkEngine;
