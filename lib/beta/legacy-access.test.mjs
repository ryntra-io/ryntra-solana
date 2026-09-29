/*
 * The per-account cutoff that makes «вийти всюди» true for stateless cookies.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { legacyAccessClosed } from "./legacy-access.ts";

test("an account that closed legacy access refuses its old stateless cookies", () => {
  assert.equal(legacyAccessClosed({ legacy_closed_at: "2026-09-06T10:00:00Z" }), true);
});

test("an account that never closed it keeps working, migration applied or not", () => {
  /* The field is absent on every deployment before the migration that projects
     it, and absent must mean «never closed» — not «closed» (which would sign
     everyone out) and not a crash. */
  assert.equal(legacyAccessClosed({}), false);
  assert.equal(legacyAccessClosed({ legacy_closed_at: null }), false);
  assert.equal(legacyAccessClosed({ legacy_closed_at: "" }), false);
  assert.equal(legacyAccessClosed({ legacy_closed_at: "   " }), false);
  assert.equal(legacyAccessClosed(null), false);
  assert.equal(legacyAccessClosed(undefined), false);
});
