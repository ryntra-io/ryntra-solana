import assert from "node:assert/strict";
import test from "node:test";

import {
  getCapabilityFreshness,
  getCapabilityTruthTone,
  productCapabilityById,
} from "./capabilities.ts";
import { buildPublicCapabilityFeatureList } from "./landing-structured-data.ts";

function project(capability, now) {
  return {
    id: capability.id,
    label: capability.publicLabel,
    maturity: capability.maturity,
    mode: capability.mode,
    scopeLabel: capability.scope.route ?? "Ryntra product layer",
    lastVerifiedAt: capability.lastVerifiedAt,
    freshness: getCapabilityFreshness(capability, now),
    truthTone: getCapabilityTruthTone(capability, now, "available"),
    limitation: capability.limitation,
  };
}

test("a real live capability expires out of public structured data when its evidence becomes stale", () => {
  const spot = productCapabilityById("arcus-spot-rfq");
  const freshCard = project(spot, new Date(`${spot.lastVerifiedAt}T12:00:00.000Z`));
  assert.equal(freshCard.freshness, "fresh");
  assert.equal(freshCard.truthTone, "positive");
  assert.deepEqual(
    buildPublicCapabilityFeatureList({ capabilities: [freshCard], loopStages: [] }),
    [freshCard.label + ". " + freshCard.limitation],
  );

  const staleCard = project(spot, new Date(new Date(`${spot.lastVerifiedAt}T12:00:00.000Z`).getTime() + 44 * 24 * 60 * 60 * 1000));
  assert.equal(staleCard.freshness, "stale");
  assert.notEqual(staleCard.truthTone, "positive");
  assert.deepEqual(
    buildPublicCapabilityFeatureList({ capabilities: [staleCard], loopStages: [] }),
    [],
  );
});
