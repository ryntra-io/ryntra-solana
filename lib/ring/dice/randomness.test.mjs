// Run from repo root: node --test lib/ring/dice/randomness.test.mjs
import "../../world/testing/hooks.mjs";
import assert from "node:assert/strict";
import { describe, test } from "node:test";

const {
  DRAND_QUICKNET,
  HashRng,
  checkBeaconRound,
  combineSeeds,
  commitmentFor,
  createMockBeacon,
  drawOpener,
  latestRound,
  mockBeaconRound,
  randomSeed,
  rollHands,
  roundTime,
  sha256Hex,
} = await import("./index.ts");

describe("sha256", () => {
  test("matches the standard test vector", () => {
    assert.equal(sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("commitments", () => {
  test("bind the seed to the match and the seat", () => {
    const seed = sha256Hex("seed");
    const c = commitmentFor("duel-1", 0, seed);
    assert.match(c, /^[0-9a-f]{64}$/);
    assert.equal(c, sha256Hex(`ryntra-dice/commit/v1|duel-1|0|${seed}`));
    assert.notEqual(commitmentFor("duel-1", 1, seed), c);
    assert.notEqual(commitmentFor("duel-2", 0, seed), c);
  });

  test("come with fresh 32-byte seeds", () => {
    const a = randomSeed();
    assert.match(a, /^[0-9a-f]{64}$/);
    assert.notEqual(randomSeed(), a);
  });
});

describe("beacon", () => {
  test("numbers rounds like drand: round 1 at genesis", () => {
    const info = DRAND_QUICKNET;
    assert.equal(latestRound(info, info.genesisTime - 1), 0);
    assert.equal(latestRound(info, info.genesisTime), 1);
    assert.equal(latestRound(info, info.genesisTime + 2_999), 1);
    assert.equal(latestRound(info, info.genesisTime + 3_000), 2);
    assert.equal(roundTime(info, 1), info.genesisTime);
    for (const t of [info.genesisTime, info.genesisTime + 1_234_567]) {
      const r = latestRound(info, t);
      assert.ok(roundTime(info, r) <= t);
      assert.ok(roundTime(info, r + 1) > t);
    }
  });

  test("checks that randomness is sha256(signature) and the round is the one asked for", async () => {
    const value = await createMockBeacon().get(42);
    assert.equal(checkBeaconRound(value, 42), null);
    assert.match(checkBeaconRound(value, 43), /expected round 43/);
    assert.match(checkBeaconRound({ ...value, randomness: sha256Hex("forged") }, 42), /sha256\(signature\)/);
    assert.match(checkBeaconRound({ ...value, signature: "xyz" }, 42), /hex/);
  });

  test("mock rounds depend on the round and the salt", () => {
    assert.notEqual(mockBeaconRound(1).randomness, mockBeaconRound(2).randomness);
    assert.notEqual(mockBeaconRound(1, "a").randomness, mockBeaconRound(1, "b").randomness);
    assert.deepEqual(mockBeaconRound(7), mockBeaconRound(7));
  });
});

describe("dice stream", () => {
  const seeds = [sha256Hex("a"), sha256Hex("b")];
  const matchSeed = combineSeeds("duel-1", seeds, mockBeaconRound(100));

  test("is deterministic and changes with every input", () => {
    assert.equal(combineSeeds("duel-1", seeds, mockBeaconRound(100)), matchSeed);
    assert.notEqual(combineSeeds("duel-1", [seeds[1], seeds[0]], mockBeaconRound(100)), matchSeed);
    assert.notEqual(combineSeeds("duel-1", seeds, mockBeaconRound(101)), matchSeed);
    assert.notEqual(combineSeeds("duel-2", seeds, mockBeaconRound(100)), matchSeed);
    assert.deepEqual(rollHands(matchSeed, 1, [5, 5]), rollHands(matchSeed, 1, [5, 5]));
    assert.notDeepEqual(rollHands(matchSeed, 1, [5, 5]), rollHands(matchSeed, 2, [5, 5]));
    assert.ok([0, 1].includes(drawOpener(matchSeed)));
  });

  test("rolls the requested number of dice with faces 1..6", () => {
    const [a, b] = rollHands(matchSeed, 3, [4, 2]);
    assert.equal(a.length, 4);
    assert.equal(b.length, 2);
    for (const d of [...a, ...b]) assert.ok(d >= 1 && d <= 6);
  });

  test("is close to uniform", () => {
    const rng = new HashRng(sha256Hex("uniformity"));
    const counts = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 60_000; i++) counts[rng.int(6)] += 1;
    for (const c of counts) assert.ok(Math.abs(c - 10_000) < 400, `count ${c}`);
  });

  test("rejects impossible ranges", () => {
    const rng = new HashRng(sha256Hex("range"));
    assert.throws(() => rng.int(0), RangeError);
    assert.throws(() => rng.int(1.5), RangeError);
    assert.equal(rng.int(1), 0);
  });
});
