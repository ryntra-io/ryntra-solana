// CITY-225 · test-only: the made-up engine with one step that never ends — a single long synchronous step that the
// sandbox's between-steps time check cannot interrupt. Only the worker's hard wall stops it (`../worker.ts`).
import "../../../../../../lib/world/testing/hooks.mjs";

const toy = await import("../../sandbox/toy.ts");

export default function hangingEngine() {
  const engine = toy.createToyEngine();
  return {
    ...engine,
    execute() {
      // Block this thread without spinning: only `worker.terminate()` ends it.
      const cell = new Int32Array(new SharedArrayBuffer(4));
      for (;;) Atomics.wait(cell, 0, 0, 60_000);
    },
  };
}
