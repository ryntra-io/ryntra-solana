// CITY-225 · test-only: the made-up engine whose step tries to reach the network. The offline wall inside the worker
// refuses it, and the whole run is refused (`NETWORK`), even though the step swallows the error.
import "../../../../../../lib/world/testing/hooks.mjs";

const toy = await import("../../sandbox/toy.ts");

export default function reachingEngine() {
  const engine = toy.createToyEngine();
  return {
    ...engine,
    execute(bytes, cuLimit) {
      try {
        void globalThis.fetch("https://example.invalid/");
      } catch {
        // Hidden on purpose: the wall remembers the attempt anyway.
      }
      return engine.execute(bytes, cuLimit);
    },
  };
}
