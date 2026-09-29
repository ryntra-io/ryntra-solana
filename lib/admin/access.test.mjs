import assert from "node:assert/strict";
import test from "node:test";

import {
  accessReasonOk,
  isAccessMutation,
  nextAccessState,
  resolveUserAccess,
} from "./access.ts";

test("legacy verified join is ACTIVE until a control row exists", () => {
  assert.equal(
    resolveUserAccess({ control: null, legacyJoin: "verified" }),
    "ACTIVE",
  );
  assert.equal(
    resolveUserAccess({ control: null, legacyJoin: null }),
    "REQUESTED",
  );
  assert.equal(
    resolveUserAccess({ control: null, legacyJoin: "pending" }),
    "REQUESTED",
  );
});

test("a stored control is the product model, not telegram_join", () => {
  assert.equal(
    resolveUserAccess({
      control: { state: "PAUSED", expiresAt: null },
      legacyJoin: "verified",
    }),
    "PAUSED",
  );
  assert.equal(
    resolveUserAccess({
      control: { state: "REVOKED", expiresAt: null },
      legacyJoin: "verified",
    }),
    "REVOKED",
  );
});

test("REVOKED does not expire into ACTIVE", () => {
  assert.equal(
    resolveUserAccess({
      control: { state: "REVOKED", expiresAt: "2000-01-01T00:00:00.000Z" },
      legacyJoin: "verified",
      now: new Date("2026-08-29T00:00:00.000Z"),
    }),
    "REVOKED",
  );
});

test("a past expiry on a non-revoked control becomes EXPIRED", () => {
  assert.equal(
    resolveUserAccess({
      control: { state: "ACTIVE", expiresAt: "2026-01-01T00:00:00.000Z" },
      legacyJoin: "verified",
      now: new Date("2026-08-29T00:00:00.000Z"),
    }),
    "EXPIRED",
  );
});

test("grant pause revoke map to canonical states and require a reason", () => {
  assert.equal(nextAccessState("grant"), "ACTIVE");
  assert.equal(nextAccessState("pause"), "PAUSED");
  assert.equal(nextAccessState("revoke"), "REVOKED");
  assert.equal(isAccessMutation("grant"), true);
  assert.equal(isAccessMutation("broadcast"), false);
  assert.equal(accessReasonOk("ok"), false);
  assert.equal(accessReasonOk("beta pause after support thread"), true);
});
