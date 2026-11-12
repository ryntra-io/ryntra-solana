// CITY-238 · the image checks itself before it becomes a snapshot (`image.mjs`), and a stand before it trusts a
// machine: node is new enough, the engine loads and is the version the ranges are pinned to, and every range the image
// carries loads into the engine and hashes to its own pin. Exit 0 and one line per range, or exit 1 and why.
//
// Whether a range's checks hold in its recorded copy is said, not required: a range may carry a check its own copy
// does not meet.
//
//   node selfcheck.mjs
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 18)) {
  console.error(`node ${process.versions.node}: the sandbox loads on 22.18 or newer`);
  process.exit(1);
}
const sb = await import("../sandbox/index.ts");
const { catalogue } = await import("../ranges/catalogue.ts");
const { RANGE_ENGINE } = await import("../ranges/range.ts");
const { default: rig } = await import("./rig.mjs");
const { engine } = await rig(sb);

let bad = 0;
for (const range of catalogue().list()) {
  const copy = engine();
  if (copy.id !== RANGE_ENGINE.id || copy.version !== RANGE_ENGINE.version) {
    console.error(`engine ${copy.id}@${copy.version}: the ranges are pinned to ${RANGE_ENGINE.id}@${RANGE_ENGINE.version}`);
    process.exit(1);
  }
  copy.load(range.snapshot);
  const same = copy.stateHash() === range.pin.stateHash;
  const checks = range.invariants.map((check) => `${check.id} ${check.holds((address) => copy.read(address)) === true ? "holds" : "does not hold"}`);
  console.log(`${same ? "ok  " : "BAD "} ${range.id} pin ${range.pin.stateHash.slice(0, 16)} · ${checks.join(", ")}`);
  if (!same) bad += 1;
}
console.log(`node ${process.versions.node} · ${RANGE_ENGINE.id}@${RANGE_ENGINE.version} · ${catalogue().list().length} ranges`);
process.exit(bad === 0 ? 0 : 1);
