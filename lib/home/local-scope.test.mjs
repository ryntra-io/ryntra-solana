import assert from "node:assert/strict";
import test from "node:test";

import { homeLocalOwnerRef } from "./local-scope.ts";

test("the browser namespace is stable, opaque and different per account", () => {
  const first = homeLocalOwnerRef({
    proofCode: "RYNTRA-A1B2",
    createdAt: "2026-08-01T00:00:00.000Z",
  });
  const again = homeLocalOwnerRef({
    proofCode: "RYNTRA-A1B2",
    createdAt: "2026-08-01T00:00:00.000Z",
  });
  const other = homeLocalOwnerRef({
    proofCode: "RYNTRA-C3D4",
    createdAt: "2026-08-01T00:00:00.000Z",
  });

  assert.equal(first, again);
  assert.notEqual(first, other);
  assert.match(first, /^owner_[0-9a-f]{32}$/);
  assert.doesNotMatch(first, /RYNTRA|A1B2|2026/);
});

test("invalid source identity cannot create a shared browser namespace", () => {
  for (const input of [
    { proofCode: "", createdAt: "2026-08-01T00:00:00.000Z" },
    { proofCode: "bad\u0000code", createdAt: "2026-08-01T00:00:00.000Z" },
    { proofCode: "RYNTRA-A1B2", createdAt: "not-a-time" },
  ]) {
    assert.throws(() => homeLocalOwnerRef(input), /invalid Home owner scope/);
  }
});
