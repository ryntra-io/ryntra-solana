// Run from repo root: node --test lib/domain/capability.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dataTone,
  neverSafe,
  capabilityTone,
  orderbookAllowed,
  freshnessOf,
  combineDataStates,
} from "./capability.ts";

test("INVARIANT: stale / unknown / conflicting are never green or safe", () => {
  for (const state of ["stale", "unknown", "conflicting"]) {
    assert.notEqual(dataTone(state), "ok", `${state} must not tone as ok`);
    assert.equal(neverSafe(state), true, `${state} must be neverSafe`);
  }
  assert.equal(dataTone("fresh"), "ok");
  assert.equal(neverSafe("fresh"), false);
  assert.equal(dataTone("conflicting"), "danger"); // conflict is worse than a gap
});

const cap = (over) => ({
  protocol: "live",
  ryntra: "live",
  user: "available",
  verifiedAt: "2026-07-12",
  source: "live-probe",
  ...over,
});

test("INVARIANT: capability is green ONLY when protocol+ryntra live, user available, source verified", () => {
  assert.equal(capabilityTone(cap({})), "ok");
  assert.equal(capabilityTone(cap({ source: "official-docs" })), "ok");
  // each single degradation kills the green
  assert.notEqual(capabilityTone(cap({ protocol: "beta" })), "ok");
  assert.notEqual(capabilityTone(cap({ protocol: "unavailable" })), "ok");
  assert.notEqual(capabilityTone(cap({ ryntra: "read-only" })), "ok");
  assert.notEqual(capabilityTone(cap({ ryntra: "paper" })), "ok");
  assert.notEqual(capabilityTone(cap({ ryntra: "planned" })), "ok");
  assert.notEqual(capabilityTone(cap({ ryntra: "blocked" })), "ok");
  assert.notEqual(capabilityTone(cap({ user: "restricted" })), "ok");
  assert.notEqual(capabilityTone(cap({ user: "unknown" })), "ok");
  assert.notEqual(capabilityTone(cap({ source: "unverified" })), "ok");
});

test("capability tones: hard states read danger, roadmap reads neutral, gaps read caution", () => {
  assert.equal(capabilityTone(cap({ ryntra: "blocked" })), "danger");
  assert.equal(capabilityTone(cap({ protocol: "unavailable" })), "danger");
  assert.equal(capabilityTone(cap({ user: "restricted" })), "danger");
  assert.equal(capabilityTone(cap({ ryntra: "planned" })), "neutral");
  assert.equal(capabilityTone(cap({ ryntra: "planned", source: "unverified", user: "unknown" })), "neutral");
  assert.equal(capabilityTone(cap({ user: "unknown" })), "caution");
  assert.equal(capabilityTone(cap({ source: "unverified" })), "caution");
  assert.equal(capabilityTone(cap({ ryntra: "read-only" })), "neutral");
  assert.equal(capabilityTone(cap({ ryntra: "paper" })), "neutral");
});

test("INVARIANT: order-book visualizations only for CLOB — no fabricated DOM on RFQ/AMM/oracle", () => {
  assert.equal(orderbookAllowed("clob"), true);
  assert.equal(orderbookAllowed("rfq"), false);
  assert.equal(orderbookAllowed("amm"), false);
  assert.equal(orderbookAllowed("oracle-execution"), false);
});

test("freshnessOf: unmeasured is unknown, within threshold fresh, beyond stale", () => {
  const now = 1_000_000;
  assert.equal(freshnessOf(null, now, 60_000), "unknown");
  assert.equal(freshnessOf(undefined, now, 60_000), "unknown");
  assert.equal(freshnessOf(0, now, 60_000), "unknown");
  assert.equal(freshnessOf(NaN, now, 60_000), "unknown");
  assert.equal(freshnessOf(now - 30_000, now, 60_000), "fresh");
  assert.equal(freshnessOf(now - 60_001, now, 60_000), "stale");
});

test("combineDataStates: worst state dominates; empty input is unknown, not fresh", () => {
  assert.equal(combineDataStates([]), "unknown");
  assert.equal(combineDataStates(["fresh", "fresh"]), "fresh");
  assert.equal(combineDataStates(["fresh", "stale"]), "stale");
  assert.equal(combineDataStates(["stale", "unknown"]), "unknown");
  assert.equal(combineDataStates(["unknown", "conflicting"]), "conflicting");
  assert.equal(combineDataStates(["fresh", "conflicting", "stale"]), "conflicting");
});
