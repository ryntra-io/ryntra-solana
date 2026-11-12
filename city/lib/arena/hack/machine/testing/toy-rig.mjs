// CITY-238 · test-only: a rig for `../entry.mjs` with no LiteSVM — the made-up engine and the made-up range of the
// sandbox's own fixtures (`../../sandbox/fixtures.mjs`). The library's tests run the machine's entry through it, on any
// computer. `rigOver(engine)` builds the same rig over another engine (one that hangs, one that reaches out).
const f = await import("../../sandbox/fixtures.mjs");

export const rigOver = (engine) => async () => {
  const snapshot = f.makeSnapshot();
  return { engine, forPin: (pin) => (f.sb.snapshotMatches(snapshot, pin) ? { snapshot, invariants: [f.CHECK] } : null) };
};

export default rigOver(f.toy.createToyEngine);
