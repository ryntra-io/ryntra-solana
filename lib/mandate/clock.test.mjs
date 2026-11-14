// Run from repo root: node --test lib/mandate/clock.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import { chainSeconds } from "./service.server.ts";

/**
 * CITY-246 — a budget's review was refused when the node had no block yet for its newest slot and threw («Block not
 * available for slot», -32004) where `reviewEnable` only expected a null. A throw is the same «cannot say» as a null
 * now, and the wall clock stands for both, as it already did for a null.
 */

test("the chain's clock when the node has it", async () => {
  let asked = null;
  const connection = { getSlot: async (commitment) => (asked = commitment, 467716437), getBlockTime: async (slot) => (slot === 467716437 ? 1_794_312_822 : null) };
  assert.equal(await chainSeconds(connection), 1_794_312_822);
  assert.equal(asked, "confirmed");
});

test("no block yet for the newest slot is «cannot say», not a refused budget", async () => {
  const missing = Object.assign(new Error("failed to get block time for slot 467716437: Block not available for slot 467716437"), { code: -32004 });
  assert.equal(await chainSeconds({ getSlot: async () => 467716437, getBlockTime: async () => { throw missing; } }), null);
  assert.equal(await chainSeconds({ getSlot: async () => { throw new Error("node down"); }, getBlockTime: async () => 1 }), null);
  assert.equal(await chainSeconds({ getSlot: async () => 1, getBlockTime: async () => null }), null);
});
