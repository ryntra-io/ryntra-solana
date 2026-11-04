import assert from "node:assert/strict";
import test from "node:test";

import { cityMoment } from "./moments.ts";

const TOKEN = "KiteMint11111111111111111111111111111111111";
const tower = {
  token: TOKEN,
  symbol: "KITE",
  name: "Kite",
  image: null,
  launchedAt: "2026-10-26T12:00:00Z",
  creator: null,
  preset: "protected",
  graduationUsd: 75_000,
  progress: 40,
  migrated: false,
  marketCapUsd: null,
  liquidityUsd: null,
  holders: 12,
  holdersAtLeast: false,
  checks: ["young", "young", "young"],
  phase: "ascent",
  crew: 0,
  ryntraTest: false,
  network: "solana:devnet",
  mine: false,
  hidden: false,
  flow: null,
  awaitingFlow: false,
};

/** A graduation that passed the city's rule (CITY-144): 64 independent buyers after two hours on the curve. */
const PASSED = {
  graduated: true,
  graduatedAt: "2026-10-26T14:00:00Z",
  createdAt: "2026-10-26T12:00:00Z",
  buyers: 64,
  atLeast: false,
  survival: [
    { state: "young", independent: null },
    { state: "young", independent: null },
    { state: "young", independent: null },
  ],
};

test("the move into the skyline at its pool is a moment of the whole city, at the engine's figure", () => {
  const graduated = { ...tower, migrated: true, flow: PASSED, awaitingFlow: false };
  assert.deepEqual(cityMoment({ type: "orbit", id: TOKEN, at: null, payoutUsd: null, signature: null }, graduated), {
    kind: "pump",
    towerId: TOKEN,
    symbol: "KITE",
    title: "Into the skyline",
    value: "$75K · POOL OPEN",
  });
  assert.equal(cityMoment({ type: "orbit", id: TOKEN, at: null, payoutUsd: null, signature: null }, { ...graduated, graduationUsd: null }).value, "POOL OPEN");
});

test("a graduation below the city's rule, or not read yet, is «graduated» — its tower keeps the Docks", () => {
  const orbit = { type: "orbit", id: TOKEN, at: null, payoutUsd: null, signature: null };
  assert.deepEqual(cityMoment(orbit, { ...tower, migrated: true, flow: { ...PASSED, buyers: 12 }, awaitingFlow: false }), { kind: "pump", towerId: TOKEN, symbol: "KITE", title: "Graduated", value: "$75K · POOL OPEN" });
  assert.equal(cityMoment(orbit, { ...tower, migrated: true, flow: { ...PASSED, graduatedAt: "2026-10-26T12:05:00Z" }, awaitingFlow: false }).title, "Graduated");
  assert.equal(cityMoment(orbit, { ...tower, migrated: true, flow: null, awaitingFlow: false }).title, "Graduated");
});

test("the checks of days 7, 30 and 90 it passed are moments; day 90 makes a landmark", () => {
  for (const day of [7, 30, 90]) {
    const moment = cityMoment({ type: "check", id: TOKEN, day, at: null, signature: null }, tower);
    assert.equal(moment.title, `Day ${day} check`);
    assert.equal(moment.value, "STILL TRADING");
  }
  assert.equal(cityMoment({ type: "star", id: TOKEN }, tower).title, "Day 90 landmark");
});

test("a new launch and its climb up the curve", () => {
  assert.equal(cityMoment({ type: "ignite", id: TOKEN, at: null, signature: null }, tower).kind, "launch");
  assert.equal(cityMoment({ type: "booster", id: TOKEN, n: 2 }, tower).value, "50% TO THE SKYLINE");
});

test("nothing plays for history, a quiet check, a trade, a window's clock or another tower", () => {
  assert.equal(cityMoment({ type: "orbit", id: TOKEN, at: null, payoutUsd: null, signature: null, quiet: true }, tower), null);
  assert.equal(cityMoment({ type: "lost", id: TOKEN, day: 7 }, tower), null);
  assert.equal(cityMoment({ type: "buy", id: TOKEN, at: null, usd: 10, altitude: 40, signature: null }, tower), null);
  assert.equal(cityMoment({ type: "countdown", sec: 3, window: "2026-10-26T20:00Z", clock: "20:00" }, tower), null);
  assert.equal(cityMoment({ type: "check", id: "Other111111111111111111111111111111111111111", day: 7, at: null, signature: null }, tower), null);
  assert.equal(cityMoment({ type: "check", id: TOKEN, day: 7, at: null, signature: null }, undefined), null);
});
