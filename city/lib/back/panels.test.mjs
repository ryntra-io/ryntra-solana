import assert from "node:assert/strict";
import test from "node:test";

import { closePanel, holdPanel, useBackPanels } from "./panels.ts";

// CITY-150: a panel that keeps its own «open» stands on «Back» while it is open, in the order panels opened.

test("a held panel is listed until released, and Back closes it with its own close", () => {
  let closed = 0;
  const release = holdPanel("search", () => (closed += 1));
  const releaseWallet = holdPanel("wallet", () => {});
  assert.deepEqual(useBackPanels.getState().open, ["search", "wallet"]);
  assert.equal(closePanel("search"), true);
  assert.equal(closed, 1);
  release();
  assert.deepEqual(useBackPanels.getState().open, ["wallet"]);
  assert.equal(closePanel("search"), false, "a released panel is not closed twice");
  releaseWallet();
  assert.deepEqual(useBackPanels.getState().open, []);
});

test("a stale release never drops the panel held again after it", () => {
  const first = holdPanel("tray", () => {});
  const second = holdPanel("tray", () => {});
  first();
  assert.deepEqual(useBackPanels.getState().open, ["tray"]);
  second();
  assert.deepEqual(useBackPanels.getState().open, []);
});
