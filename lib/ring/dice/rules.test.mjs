// Run from repo root: node --test lib/ring/dice/rules.test.mjs
import "../../world/testing/hooks.mjs";
import assert from "node:assert/strict";
import { describe, test } from "node:test";

const { RULES, TOOLS, checkBid, compareBids, countFace, nextBid, settleChallenge } = await import("./index.ts");
const { assertMatch } = await import("./testing/helpers.mjs");

describe("ruleset", () => {
  test("is classic two-player Liar's Dice without wild ones", () => {
    assert.deepEqual(RULES, { id: "liars-dice/1", players: 2, dicePerPlayer: 5, faces: 6, onesWild: false });
  });

  test("orders bids by count, then face", () => {
    assert.ok(compareBids({ count: 3, face: 2 }, { count: 2, face: 6 }) > 0);
    assert.ok(compareBids({ count: 3, face: 5 }, { count: 3, face: 4 }) > 0);
    assert.equal(compareBids({ count: 3, face: 4 }, { count: 3, face: 4 }), 0);
    assert.ok(compareBids({ count: 2, face: 6 }, { count: 3, face: 1 }) < 0);
  });

  test("accepts only bids that rise and stay in range", () => {
    assert.equal(checkBid({ count: 1, face: 1 }, null, 10), null);
    assert.equal(checkBid({ count: 3, face: 5 }, { count: 3, face: 4 }, 10), null);
    assert.equal(checkBid({ count: 4, face: 1 }, { count: 3, face: 6 }, 10), null);
    assert.equal(checkBid({ count: 3, face: 4 }, { count: 3, face: 4 }, 10), "not_higher");
    assert.equal(checkBid({ count: 2, face: 6 }, { count: 3, face: 1 }, 10), "not_higher");
    assert.equal(checkBid({ count: 11, face: 2 }, null, 10), "count_out_of_range");
    assert.equal(checkBid({ count: 0, face: 2 }, null, 10), "count_out_of_range");
    assert.equal(checkBid({ count: 2, face: 7 }, null, 10), "face_out_of_range");
    assert.equal(checkBid({ count: 2.5, face: 3 }, null, 10), "count_out_of_range");
  });

  test("walks every bid in order up to the ceiling, then leaves only a challenge", () => {
    const seen = [];
    for (let bid = nextBid(null, 3); bid; bid = nextBid(bid, 3)) seen.push(bid);
    assert.equal(seen.length, 3 * 6);
    assert.deepEqual(seen[0], { count: 1, face: 1 });
    assert.deepEqual(seen.at(-1), { count: 3, face: 6 });
    for (let i = 1; i < seen.length; i++) assert.ok(compareBids(seen[i], seen[i - 1]) > 0);
  });

  test("lets an exact count stand and punishes the challenger", () => {
    const hands = [
      [2, 2, 5, 6, 1],
      [2, 3, 3, 4, 4],
    ];
    assert.equal(countFace(hands, 2), 3);
    assert.deepEqual(settleChallenge(hands, { count: 3, face: 2 }, 0), { actual: 3, bidStands: true, loser: 1 });
    assert.deepEqual(settleChallenge(hands, { count: 4, face: 2 }, 0), { actual: 3, bidStands: false, loser: 0 });
    // Ones are not wild: the 1 does not count towards twos.
    assert.deepEqual(settleChallenge(hands, { count: 2, face: 1 }, 1), { actual: 1, bidStands: false, loser: 1 });
  });

  test("describes every tool with a JSON schema", () => {
    assert.deepEqual(TOOLS.map((t) => t.name), ["commit", "reveal", "bid", "challenge"]);
    const bid = TOOLS.find((t) => t.name === "bid");
    assertMatch(bid.inputSchema, { type: "object", required: ["count", "face"], additionalProperties: false });
  });
});
