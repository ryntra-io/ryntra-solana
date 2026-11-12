/**
 * The sandbox backend on a machine with no network (CITY-238; the first wall of `../sandbox/README.md` and
 * `../runner/README.md` «Межі»). It keeps the runner's `SandboxBackend` shape (`../runner/backend.ts`), so the four
 * tools do not know where a run plays:
 *
 *   • a run goes to a machine a driver opens (`protocol.ts`): Vercel Sandbox with a firewall that denies everything
 *     (`drivers/vercel.ts`), or on a stand a process in a network namespace with no interface (`drivers/process.ts`);
 *   • the machine plays on its own ranges and answers the run as the harness wrote it;
 *   • to prove, the server stamps the log's hash **here**, with the key from its own environment, and sends the machine
 *     the stamp to judge with — the key never crosses;
 *   • a hard wall of time: the machine's process is killed past `limits.ms + grace`, and if even the driver does not
 *     come back the session is closed — a run that will not return is the seat's loss, never a hung request.
 *
 * One machine serves one agent's run: opened at the first attempt, reused until `close()`. A machine that faults (it
 * can reach a network, its build is another, it cannot be reached) rejects: the caller voids the run, to be played
 * again — never the agent's loss.
 */

import { canonicalJson, sha256Hex, type Stamper } from "../../../../../lib/ring/judge/index.ts";
import type { ProveArgs, SandboxBackend, SandboxExecution } from "../runner/backend.ts";
import { ATTACKER_SEAT, type HackAttempt, type HackRun } from "../sandbox/index.ts";
import { MACHINE_PROTOCOL, MachineFailed, MachineTimeout, type MachineAnswer, type MachineDriver, type MachineJob, type MachineSession } from "./protocol.ts";

/** The harness's stamp: the stamper over the server's own key, and the public signer the machine checks it against. */
export type MachineStamp = { readonly stamp: Stamper; readonly signer: string };

export type MachineBackendConfig = {
  readonly driver: MachineDriver;
  /** Without it a `prove` run comes back unsealed (`proof: null`), as the other backends do. */
  readonly stamp?: MachineStamp;
  /** Grace over `limits.ms` before the machine's process is killed. Default 2 000 ms. */
  readonly graceMs?: number;
  /** How long past the wall the backend waits for the driver itself before it closes the session. Default 10 000 ms. */
  readonly driverSlackMs?: number;
  /** How long a machine may take to open before that is a fault. Default 60 000 ms. */
  readonly openMs?: number;
  /** The engine every run must have played on (the ranges'): a machine on another is a fault. */
  readonly engine?: { readonly id: string; readonly version: string };
  /** One line per fault, for the server's log. Never the job, never a key. */
  readonly onFault?: (line: string) => void;
};

const DEFAULT_GRACE_MS = 2_000;
const DEFAULT_SLACK_MS = 10_000;
const DEFAULT_OPEN_MS = 60_000;

/** `work`, or `late` once the time is up — the work itself is left to end on its own. */
function within<T>(work: Promise<T>, ms: number): Promise<T | "late"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"late">((resolve) => {
    timer = setTimeout(() => resolve("late"), ms);
    (timer as { unref?: () => void }).unref?.();
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

const hardTimeout = (attempt: HackAttempt, wall: number): SandboxExecution => ({
  run: { ok: false, runId: typeof attempt?.runId === "string" ? attempt.runId : "", refusal: "ENGINE", detail: `hard-timeout: the run was stopped after ${wall} ms (the machine's wall)` } as HackRun,
  proof: null,
});

export function createMachineBackend(config: MachineBackendConfig): SandboxBackend {
  let session: MachineSession | null = null;
  let closed = false;
  const note = (line: string) => config.onFault?.(line.slice(0, 300));

  /** Lets the machine go. Never waits longer than a moment for it: a driver that hangs must not hang the run. */
  async function drop(): Promise<void> {
    const kept = session;
    session = null;
    if (kept) await within(kept.close().catch(() => undefined), 5_000);
  }

  /** One job on the open machine, under the wall. `null` — the wall: the session is gone and the run is lost. */
  async function play(job: MachineJob, wall: number): Promise<MachineAnswer | null> {
    if (closed) throw new MachineFailed("UNREACHABLE", "the backend is closed");
    if (!session) {
      // A machine that will not open is the deployment's fault, not the agent's — and never a request that hangs.
      const opening = config.driver.open();
      const opened = await within(opening, config.openMs ?? DEFAULT_OPEN_MS).catch((error: unknown) => {
        throw error instanceof MachineFailed ? error : new MachineFailed("UNREACHABLE", error instanceof Error ? error.message : "the machine did not open");
      });
      if (opened === "late") {
        // Should it open after all, it is stopped at once.
        void opening.then((late) => late.close()).catch(() => undefined);
        throw new MachineFailed("UNREACHABLE", "the machine did not open in time");
      }
      session = opened;
    }
    const kept = session;
    try {
      const outcome = await within(kept.play(job, wall), wall + (config.driverSlackMs ?? DEFAULT_SLACK_MS));
      if (outcome === "late") {
        await drop();
        return null;
      }
      return outcome;
    } catch (error) {
      await drop();
      if (error instanceof MachineTimeout) return null;
      throw error instanceof MachineFailed ? error : new MachineFailed("UNREACHABLE", error instanceof Error ? error.message : "the machine did not answer");
    }
  }

  function read<P extends "run" | "prove">(answer: MachineAnswer, phase: P): Extract<MachineAnswer, { ok: true; phase: P }> {
    if (answer === null || typeof answer !== "object" || answer.v !== MACHINE_PROTOCOL) throw new MachineFailed("PROTOCOL", "the machine answered in another protocol");
    if (answer.ok !== true) throw new MachineFailed(answer.fault ?? "BROKEN", answer.detail ?? "the machine refused the job");
    if (answer.phase !== phase) throw new MachineFailed("PROTOCOL", `the machine answered ${String(answer.phase)} to a ${phase} job`);
    return answer as Extract<MachineAnswer, { ok: true; phase: P }>;
  }

  async function execute({ attempt, prove }: { attempt: HackAttempt; prove: ProveArgs | null }): Promise<SandboxExecution> {
    const wall = Math.max(1_000, (attempt?.limits?.ms ?? 30_000) + (config.graceMs ?? DEFAULT_GRACE_MS));
    try {
      const first = await play({ v: MACHINE_PROTOCOL, phase: "run", attempt }, wall);
      if (first === null) return hardTimeout(attempt, wall);
      const played = read(first, "run");
      if (config.engine && (played.engine?.id !== config.engine.id || played.engine?.version !== config.engine.version)) {
        throw new MachineFailed("PROTOCOL", `the machine runs ${played.engine?.id}@${played.engine?.version}, the ranges are pinned to ${config.engine.id}@${config.engine.version}`);
      }
      const run = played.run;
      if (prove === null || !config.stamp || run?.ok !== true) return { run, proof: null };

      // The stamp is made here, in the server's process, over the log the machine wrote. The key stays here.
      const hash = sha256Hex(canonicalJson(run.log));
      const stamp = config.stamp.stamp({ matchId: run.runId, seat: ATTACKER_SEAT, hash }, prove.at);
      const second = await play({ v: MACHINE_PROTOCOL, phase: "prove", run, at: prove.at, window: prove.window, costMicroUsd: prove.costMicroUsd, stamp, signer: config.stamp.signer }, wall);
      if (second === null) return hardTimeout(attempt, wall);
      const judged = read(second, "prove").proof;
      // A verdict for another log than the run's is no verdict.
      if (judged && judged.judgement?.logHash !== undefined && judged.judgement.logHash !== null && judged.judgement.logHash !== run.logHash) {
        throw new MachineFailed("PROTOCOL", "the machine judged another log than it played");
      }
      return { run, proof: judged ?? null };
    } catch (error) {
      if (error instanceof MachineFailed) note(`[hack] machine ${config.driver.name} ${error.message}`);
      throw error;
    }
  }

  return {
    execute,
    async close() {
      closed = true;
      await drop();
    },
  };
}
