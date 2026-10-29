import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_RETURN_PATH, RESET_PATH, safeReturnPath, withAuthMarker } from "./return-path.ts";

test("only first-party application paths come back from a round trip", () => {
  assert.equal(safeReturnPath("/app/plans?draft=1#top"), "/app/plans?draft=1#top");
  assert.equal(safeReturnPath("/solana/workspace/swap"), "/solana/workspace/swap");
  /* The app's Ukrainian addresses — on ryntra.io and on app.ryntra.io. */
  assert.equal(safeReturnPath("/uk/app/home"), "/uk/app/home");
  assert.equal(safeReturnPath("/uk/solana/markets?tab=crypto"), "/uk/solana/markets?tab=crypto");
  assert.equal(safeReturnPath("/uk/admin"), "/app");
  assert.equal(safeReturnPath("/uk//evil.example"), "/app");
  assert.equal(safeReturnPath("/admin/users?filter=errors_7d"), "/admin/users?filter=errors_7d");
  assert.equal(safeReturnPath(RESET_PATH), RESET_PATH);
  for (const bad of [
    "https://evil.example/app",
    "//evil.example/app",
    "/\\evil.example",
    "/api/admin/users",
    "/beta",
    "javascript:alert(1)",
    "/app/ with space",
    "",
    null,
    undefined,
    "/app/" + "x".repeat(600),
  ]) {
    assert.equal(safeReturnPath(bad), DEFAULT_RETURN_PATH, String(bad));
  }
  assert.equal(safeReturnPath("nope", "/admin"), "/admin");
});

test("the auth marker is one query key the client reads once, and never a free-text reason", () => {
  assert.equal(withAuthMarker("/app/plans", "ok"), "/app/plans?auth=ok");
  assert.equal(withAuthMarker("/app/plans?draft=1#top", "cancel"), "/app/plans?draft=1&auth=cancel#top");
  assert.equal(withAuthMarker("/app", "error", "telegram_claimed"), "/app?auth=error&reason=telegram_claimed");
  assert.equal(withAuthMarker("/app", "error", "<script>alert(1)</script>"), "/app?auth=error&reason=scriptalert1script");
  assert.equal(withAuthMarker("/app?auth=error&reason=x", "ok"), "/app?auth=ok");
});
