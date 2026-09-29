import assert from "node:assert/strict";
import test from "node:test";

import { decideAdminAuthority, parseOperatorLookup } from "./operators.ts";

test("unmigrated authority keeps the live channel check so production is not locked out", () => {
  assert.deepEqual(decideAdminAuthority({ status: "unmigrated" }, true), {
    allow: true,
    bootstrap: false,
    source: "legacy_channel",
  });
  assert.deepEqual(decideAdminAuthority({ status: "unmigrated" }, false), {
    allow: false,
    bootstrap: false,
    source: "denied",
  });
});

test("an empty operator table bootstraps a live channel admin once", () => {
  assert.deepEqual(decideAdminAuthority({ status: "empty" }, true), {
    allow: true,
    bootstrap: true,
    source: "bootstrap",
  });
  assert.deepEqual(decideAdminAuthority({ status: "empty" }, false), {
    allow: false,
    bootstrap: false,
    source: "denied",
  });
});

test("once any operator exists, channel membership is not authority", () => {
  assert.deepEqual(
    decideAdminAuthority({ status: "operator", active: true, role: "OWNER" }, false),
    { allow: true, bootstrap: false, source: "operators" },
  );
  assert.deepEqual(
    decideAdminAuthority({ status: "operator", active: false, role: "OWNER" }, true),
    { allow: false, bootstrap: false, source: "denied" },
  );
  assert.deepEqual(decideAdminAuthority({ status: "unknown" }, true), {
    allow: false,
    bootstrap: false,
    source: "denied",
  });
});

test("RPC shapes map onto the decision vocabulary", () => {
  assert.equal(parseOperatorLookup({ kind: "none", operator_count: 0 }).status, "empty");
  assert.equal(parseOperatorLookup({ kind: "operator", active: true }).status, "operator");
  assert.equal(parseOperatorLookup(null).status, "unknown");
});
