// Run from repo root: node --test city/lib/districts/predict/place.test.mjs
import "../../../../lib/world/testing/hooks.mjs";
import assert from "node:assert/strict";
import test from "node:test";

const { BOARD, BOARD_FACING, BOARD_SPOT, clearances } = await import("./place.ts");

test("the billboard stands on open water: off the island, off the terrace, clear of the Vault", () => {
  const { shore, terrace, vault } = clearances();
  assert.ok(shore >= 4, `${shore} from the island's shore`);
  assert.ok(terrace >= 8, `${terrace} from the terrace`);
  assert.ok(vault >= 60, `${vault} from the Vault`);
});

test("its face turns to the establishing shot and stands high enough to be seen over the water", () => {
  const toCamera = Math.atan2(0 - BOARD_SPOT.x, 172 - BOARD_SPOT.z);
  assert.equal(BOARD_FACING, toCamera);
  assert.ok(BOARD.y - BOARD.height / 2 > 6, "the board's foot is above the waves");
});
