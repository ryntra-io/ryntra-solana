/**
 * What the server and the machine with no network say to each other (CITY-238). One job in, one answer out, both plain
 * JSON in files — a machine has no socket to speak through.
 *
 *   run    — play an attempt on the range that holds its pin (`../ranges/range.ts`): the machine's own recorded state
 *            and checks, never the job's. The answer is the run as the harness wrote it.
 *   prove  — judge a run the server has stamped. The stamp key never comes here: the server signs the log's hash in its
 *            own process and sends the stamp, a signature; the machine checks it against the server's public signer,
 *            replays the log on a fresh copy and gives the verdict.
 *
 * So the machine holds no secret at all: it gets bytes to play and a signature to check (spec «Як працює пісочниця»:
 * «машина без мережі й без секретів»).
 *
 * A machine that finds it can reach a network does not play (`NETWORK_REACHABLE`), and one that holds another build
 * than the server's says so (`PROTOCOL`) — both are the deployment's faults, never the agent's.
 *
 * Types and constants only.
 */

import type { Judgement, Stamp } from "../../../../../lib/ring/judge/index.ts";
import type { HackProof } from "../rules.ts";
import type { HackAttempt, HackRun } from "../sandbox/index.ts";

/** Raised when the two sides must be rebuilt together: a job of another number is refused. */
export const MACHINE_PROTOCOL = 1;

export type RunJob = { readonly v: typeof MACHINE_PROTOCOL; readonly phase: "run"; readonly attempt: HackAttempt };

export type ProveJob = {
  readonly v: typeof MACHINE_PROTOCOL;
  readonly phase: "prove";
  /** The run the machine played, as it answered it. The judge replays it; a changed byte is a divergence. */
  readonly run: Extract<HackRun, { ok: true }>;
  /** When the harness stamped the log (unix ms), the order's window, and the agent's model spend. */
  readonly at: number;
  readonly window: { readonly opensAt: number; readonly closesAt: number };
  readonly costMicroUsd: number;
  /** The server's stamp over the log's hash, and the public signer it is checked against. No key. */
  readonly stamp: Stamp;
  readonly signer: string;
};

export type MachineJob = RunJob | ProveJob;

/** Why a machine did not play: the deployment's own faults. */
export type MachineFault =
  /** The machine can reach a network: it refuses to play at all. */
  | "NETWORK_REACHABLE"
  /** Another protocol number, or a runtime too old to load the sandbox. */
  | "PROTOCOL"
  /** The job does not read. */
  | "BAD_JOB"
  /** The engine or the ranges did not load. */
  | "BROKEN";

export type MachineAnswer =
  | { readonly v: typeof MACHINE_PROTOCOL; readonly ok: true; readonly phase: "run"; readonly run: HackRun; readonly engine: { readonly id: string; readonly version: string } }
  | { readonly v: typeof MACHINE_PROTOCOL; readonly ok: true; readonly phase: "prove"; readonly proof: { readonly proof: HackProof; readonly judgement: Judgement } | null }
  | { readonly v: typeof MACHINE_PROTOCOL; readonly ok: false; readonly fault: MachineFault; readonly detail: string };

/** One machine, open for a while: jobs go in one at a time. */
export type MachineSession = {
  /** Plays one job; the machine's process is killed past `wallMs`. Rejects when the machine cannot be reached or does not answer. */
  play(job: MachineJob, wallMs: number): Promise<MachineAnswer>;
  /** Stops the machine. Safe to call more than once. */
  close(): Promise<void>;
};

/** Where machines come from. */
export type MachineDriver = {
  readonly name: string;
  /**
   * `true` when the machine has no network by the way it is made — a firewall that denies everything, a network
   * namespace with no interface — never by anything the run's own process does. Production plays only on such a one.
   */
  readonly isolated: boolean;
  open(): Promise<MachineSession>;
};

/** The hard wall a driver did not hold: the session is closed and the run is the seat's loss. */
export class MachineTimeout extends Error {
  override name = "MachineTimeout";
}

/** The machine answered a fault, or not at all: the run voids and is played again. */
export class MachineFailed extends Error {
  override name = "MachineFailed";
  readonly fault: MachineFault | "UNREACHABLE";
  constructor(fault: MachineFault | "UNREACHABLE", detail: string) {
    super(`${fault}: ${detail}`.slice(0, 300));
    this.fault = fault;
  }
}
