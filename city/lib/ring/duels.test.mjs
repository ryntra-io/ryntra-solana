// Run from repo root: node --test city/lib/ring/duels.test.mjs
import "../../../lib/world/testing/hooks.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";

const { HOUSE, HOUSE_BODY, DUEL_FORMATS, duelsOpen } = await import("./duels.ts");
const { HOUSE_FORMAT, DUEL_FORMATS: ENGINE_FORMATS } = await import("../../../lib/ring/duel/index.ts");

test("the duels open only when both the Ring's switch and their own say open", () => {
  assert.equal(duelsOpen("open", "open"), true);
  assert.equal(duelsOpen("open", undefined), false);
  assert.equal(duelsOpen(undefined, "open"), false);
  assert.equal(duelsOpen(" open ", "open "), true);
  assert.equal(duelsOpen("open", "closed"), false);
});

test("the window's formats and house partners are the engine's own", () => {
  assert.deepEqual([...DUEL_FORMATS], [...ENGINE_FORMATS]);
  for (const format of DUEL_FORMATS) for (const house of HOUSE[format]) {
    assert.equal(HOUSE_FORMAT[house], format);
    assert.ok(HOUSE_BODY[house]);
  }
});
