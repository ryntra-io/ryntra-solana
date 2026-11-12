// CITY-225 · the sandbox worker's entry. One job per worker: the backend (`worker.ts`) starts a worker with the whole job
// in `workerData`, this script plays it and posts the result once, then the backend terminates the worker.
//
// A worker has its own globals and its own module registry, so the offline wall (`../sandbox/offline.ts`) swaps this
// thread's `fetch`, sockets and child processes — never the routes process's. The engine and the order's checks come in
// as module paths (a function does not cross a worker boundary); the snapshot as data; the stamp key as PEM. Nothing is
// fetched: the copy is the snapshot, a lookup.
//
// The world's TypeScript hooks are registered first so this thread loads the sandbox's `.ts` as the tests and the stand
// do. A deployment that builds the runner may pass its own entry (`WorkerBackendConfig.workerEntry`).
import "../../../../../lib/world/testing/hooks.mjs";
import { createPublicKey } from "node:crypto";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { parentPort, workerData } from "node:worker_threads";

const toUrl = (specifier) => (typeof specifier === "string" && isAbsolute(specifier) ? pathToFileURL(specifier).href : String(specifier));

async function play() {
  const { enginePath, invariantsPath, invariantsArg, snapshot, attempt, prove, stamp } = workerData;
  const sb = await import("../sandbox/index.ts");
  const judgeLib = await import("../../../../../lib/ring/judge/index.ts");
  const engineModule = await import(toUrl(enginePath));
  const invariantsModule = await import(toUrl(invariantsPath));
  const engine = engineModule.default;
  const makeInvariants = invariantsModule.default;
  if (typeof engine !== "function") throw new TypeError("the engine module's default export is an EngineFactory");
  if (typeof makeInvariants !== "function") throw new TypeError("the checks module's default export builds the order's checks");
  const invariants = makeInvariants(snapshot, invariantsArg);

  const sandbox = sb.createHackSandbox({
    engine,
    // A lookup in what was carried in — never a fetch.
    snapshot: (pin) => (sb.snapshotMatches(snapshot, pin) ? snapshot : null),
    invariants,
    now: () => Date.now(),
  });

  const run = sandbox.run(attempt);
  if (!prove || !stamp) return { ok: true, run, proof: null };
  const context = {
    stamp: judgeLib.createStamper(stamp.secretPem),
    verifyStamp: judgeLib.stampVerifier([judgeLib.signerOf(createPublicKey(stamp.publicPem))]),
    at: prove.at,
    window: prove.window,
    costMicroUsd: prove.costMicroUsd,
  };
  return { ok: true, run, proof: sandbox.prove(run, context) };
}

play().then(
  (message) => parentPort?.postMessage(message),
  (error) => parentPort?.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) }),
);
