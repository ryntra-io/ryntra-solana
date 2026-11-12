/**
 * The sandbox backend of the step runner (CITY-225, spec `docs/research/city-hack-2026-11-08/SPEC.md`). The runner's
 * tools (`session.ts`) never touch the sandbox directly: they hand an attempt to a `SandboxBackend`, which plays it on
 * a pinned copy and, when asked, proves it. The backend is where the sandbox's offline wall and its heavy compute
 * live, so the brain's model calls (the network) and the sandbox run (no network) stay apart.
 *
 * Two backends keep the same shape:
 *   • `inProcessBackend` — the sandbox in this process, over an injected engine, recorded states and the order's
 *     checks. The library's own tests and the stand use it with the made-up engine (`../sandbox/toy.ts`).
 *   • the worker backend (`worker.ts`) — the same run in a `worker_threads` worker with no network and a hard time
 *     wall, so the routes process never swaps its own globals and a single long synchronous step can be stopped.
 *
 * `prove` carries only numbers across the boundary (`at`, the order's window, the agent's model spend): the stamp key
 * is the harness's, read where the backend runs. The proof the judge gives back is plain data (`HackProof`).
 *
 * Pure contract: no store, no keys, no money here. The money is CITY-229.
 */

import type { Judgement } from "../../../../../lib/ring/judge/index.ts";
import type { HackProof } from "../rules.ts";
import type {
  HackAttempt,
  HackRun,
  HackSandboxDeps,
  ProveContext,
} from "../sandbox/index.ts";
import { createHackSandbox } from "../sandbox/index.ts";

/** The order's window a proof is stamped inside (unix ms). */
export type ProveWindow = { readonly opensAt: number; readonly closesAt: number };

/** What `prove` needs beyond the run, in plain numbers — the stamp key stays with the backend. */
export type ProveArgs = {
  /** When the harness stamps the log (unix ms), inside the window. */
  readonly at: number;
  readonly window: ProveWindow;
  /** The agent's model spend on the run, as the brain measured it; 0 when no model ran. */
  readonly costMicroUsd: number;
};

/** One run, and its proof when the caller asked for one. `proof` is `null` for a run the judge could not seal. */
export type SandboxExecution = {
  readonly run: HackRun;
  readonly proof: { readonly proof: HackProof; readonly judgement: Judgement } | null;
};

/**
 * A backend plays one attempt on a copy and, with `prove`, seals it. Never throws for a copy's own outcome — a bad
 * attempt, a limit, a network try inside the run come back as `run.ok === false`. It may reject only for a backend
 * fault (a worker that would not start): callers treat that as a void, to be played again.
 */
export type SandboxBackend = {
  execute(args: { readonly attempt: HackAttempt; readonly prove: ProveArgs | null }): Promise<SandboxExecution>;
  /** Releases anything the backend holds (a worker). Safe to call more than once. */
  close(): Promise<void>;
};

/** The stamp the in-process backend seals a proof with: the harness's key pair, built outside this module. */
export type Stamp = Pick<ProveContext, "stamp" | "verifyStamp">;

export type InProcessBackendDeps = HackSandboxDeps & {
  /** The harness's stamp — only needed when a caller asks to prove. Without it, `prove` runs come back unsealed. */
  readonly stamp?: Stamp;
};

/** A backend that runs the sandbox here, in this process. For tests and the stand; the routes use the worker backend. */
export function inProcessBackend(deps: InProcessBackendDeps): SandboxBackend {
  const sandbox = createHackSandbox(deps);
  return {
    async execute({ attempt, prove }) {
      const run = sandbox.run(attempt);
      if (prove === null || !deps.stamp) return { run, proof: null };
      const proof = sandbox.prove(run, { ...deps.stamp, at: prove.at, window: prove.window, costMicroUsd: prove.costMicroUsd });
      return { run, proof };
    },
    async close() {
      /* nothing to release in process */
    },
  };
}
