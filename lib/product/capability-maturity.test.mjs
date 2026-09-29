import assert from "node:assert/strict";
import test from "node:test";

import { PUBLIC_CAPABILITIES } from "./capabilities.ts";
import { REGISTRY_MATURITY } from "./capability-maturity.ts";

/**
 * The landing reads maturity from the generated map rather than the registry,
 * because pulling ~900 lines of registry evidence into a client component cost
 * more bundle than the landing budget allows. That trade is only safe while the
 * two cannot disagree — which is what this gate enforces.
 *
 * If it fails, run `node scripts/gen-capability-maturity.mjs`.
 */
test("the generated maturity map matches the registry exactly", () => {
  const fromRegistry = Object.fromEntries(
    PUBLIC_CAPABILITIES.map((capability) => [capability.id, capability.maturity]),
  );
  assert.deepEqual(
    REGISTRY_MATURITY,
    fromRegistry,
    "capability-maturity.ts has drifted — regenerate it with scripts/gen-capability-maturity.mjs",
  );
});

test("the map carries every registered capability and invents none", () => {
  const registryIds = new Set(PUBLIC_CAPABILITIES.map((capability) => capability.id));
  const mapIds = new Set(Object.keys(REGISTRY_MATURITY));

  for (const id of registryIds) {
    assert.ok(mapIds.has(id), `${id} is registered but missing from the maturity map`);
  }
  for (const id of mapIds) {
    assert.ok(registryIds.has(id), `${id} is in the maturity map but not registered`);
  }
});
