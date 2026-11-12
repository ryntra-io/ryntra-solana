/**
 * The worker backend of the step runner (CITY-225, sandbox README «Межі (рев'ю наглядача 9.11)»). The sandbox's `run`
 * and `prove` belong off the routes process: while a run executes, the offline wall (`../sandbox/offline.ts`) swaps the
 * process globals (`fetch`, sockets, child processes), and a single long synchronous step cannot be interrupted
 * between steps. So each run goes to a `worker_threads` worker that:
 *
 *   • imports the engine and the order's checks by module path (functions do not cross a worker boundary) and builds
 *     the sandbox over the snapshot carried in — a lookup, never a fetch;
 *   • runs, and proves when asked, inside the offline wall, so the routes process never swaps its own globals;
 *   • is held to a hard wall-clock limit here: past `limits.ms + grace` the worker is terminated, and a run that will
 *     not return is the seat's loss, not a hung request.
 *
 * This is the second wall's companion, not the first: a `worker_threads` worker shares the process's network namespace,
 * so it is no substitute for the machine with no network the run belongs on (the deployment's part). It keeps the
 * global swap and the hard time wall out of the routes event loop.
 *
 * The stamp key is the harness's: it is handed in as PEM and the stamper and verifier are built inside the worker
 * (`signerOf`/`createStamper`), so no key crosses as a function and the proof comes back as plain data.
 */

import { Worker } from "node:worker_threads";
import type { Judgement } from "../../../../../lib/ring/judge/index.ts";
import type { HackProof } from "../rules.ts";
import type { HackAttempt, HackRun, Snapshot } from "../sandbox/index.ts";
import type { ProveArgs, SandboxBackend, SandboxExecution } from "./backend.ts";

/** The harness's stamp key pair as PEM — the public one lets the worker's judge check its own stamp. */
export type StampPem = { readonly secretPem: string; readonly publicPem: string };

export type WorkerBackendConfig = {
  /**
   * A module whose default export is an `EngineFactory` (`() => ForkEngine`). The library's tests point it at the
   * made-up engine (`testing/toy-engine.mjs`); the deployment points it at LiteSVM.
   */
  readonly enginePath: string;
  /**
   * A module whose default export builds the order's checks: `(snapshot, arg) => Invariant[]`. The checks are code
   * that only reads the copy; a store holds them per order (CITY-226).
   */
  readonly invariantsPath: string;
  /** An argument the checks module needs (e.g. the vault address) — plain data only. */
  readonly invariantsArg?: unknown;
  /** The recorded copy the runs play on. Carried into the worker; a run loads it, nothing is fetched. */
  readonly snapshot: Snapshot;
  /** The harness's stamp. Without it, a `prove` run comes back unsealed (`proof: null`), as in-process does. */
  readonly stamp?: StampPem;
  /** Grace over `limits.ms` before the worker is terminated. Default 2 000 ms. */
  readonly graceMs?: number;
  /** The worker entry module; defaults to the one beside this file. A deployment may pass its own built entry. */
  readonly workerEntry?: string | URL;
};

type WorkerMessage =
  | { readonly ok: true; readonly run: HackRun; readonly proof: { readonly proof: HackProof; readonly judgement: Judgement } | null }
  | { readonly ok: false; readonly error: string };

const DEFAULT_GRACE_MS = 2_000;

/** A backend that runs each attempt in a fresh no-network worker under a hard time wall. */
export function createWorkerBackend(config: WorkerBackendConfig): SandboxBackend {
  const entry = config.workerEntry ?? new URL("./worker-entry.mjs", import.meta.url);
  const live = new Set<Worker>();

  function execute({ attempt, prove }: { attempt: HackAttempt; prove: ProveArgs | null }): Promise<SandboxExecution> {
    return new Promise<SandboxExecution>((resolve, reject) => {
      const worker = new Worker(entry, {
        workerData: {
          enginePath: config.enginePath,
          invariantsPath: config.invariantsPath,
          invariantsArg: config.invariantsArg ?? null,
          snapshot: config.snapshot,
          attempt,
          prove,
          stamp: config.stamp ?? null,
        },
      });
      live.add(worker);
      let settled = false;
      const wall = Math.max(1_000, (attempt.limits?.ms ?? 30_000) + (config.graceMs ?? DEFAULT_GRACE_MS));

      const done = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        live.delete(worker);
        void worker.terminate();
        fn();
      };

      const timer = setTimeout(() => {
        // The hard time wall: a run that will not come back is stopped here, and it is the seat's loss.
        done(() =>
          resolve({
            run: {
              ok: false,
              runId: attempt.runId,
              refusal: "ENGINE",
              detail: `hard-timeout: the run was stopped after ${wall} ms (CITY-225 worker wall)`,
            } as HackRun,
            proof: null,
          }),
        );
      }, wall);
      if (typeof timer === "object" && typeof (timer as { unref?: () => void }).unref === "function") (timer as { unref: () => void }).unref();

      worker.on("message", (message: WorkerMessage) => {
        if (message && message.ok === true) done(() => resolve({ run: message.run, proof: message.proof }));
        else done(() => reject(new Error(message?.error ? String(message.error).slice(0, 300) : "the sandbox worker failed")));
      });
      worker.on("error", (error) => done(() => reject(error instanceof Error ? error : new Error(String(error)))));
      worker.on("exit", (code) => {
        if (!settled) done(() => reject(new Error(`the sandbox worker exited early (${code})`)));
      });
    });
  }

  return {
    execute,
    async close() {
      for (const worker of live) void worker.terminate();
      live.clear();
    },
  };
}
