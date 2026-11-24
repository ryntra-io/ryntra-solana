/* The copy's rule changes no mandate that lives today: every shape the engine writes (regular buys, the
   trading agent's buys, a coin she sells, a coin the agent keeps — the bots' shapes among them, on Jupiter and devnet's
   pool, Token and Token-2022) gives the very bytes it gave on `master` before the rule: its policies, its enable, stop
   and withdraw transactions (`fixtures/policies-golden-376.json`, written by `golden-376.mjs --write` before the change). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { SHAPES, shapeBytes } from "./golden-376.mjs";

const golden = JSON.parse(readFileSync(new URL("./fixtures/policies-golden-376.json", import.meta.url), "utf8"));

test("every mandate shape of today is in the golden record, and nothing else", () => {
  assert.deepEqual(Object.keys(SHAPES).sort(), Object.keys(golden).sort());
});

for (const [name, shape] of Object.entries(SHAPES)) {
  test(`${name}: policies, enable, stop and withdraw — byte for byte as before the copy's rule`, () => {
    assert.deepEqual(shapeBytes(shape), golden[name]);
  });
}
