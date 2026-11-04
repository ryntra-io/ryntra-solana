import { test } from "node:test";
import assert from "node:assert/strict";

import { PIER_CANARY_CEILING_USD, PIER_CEILING_USD, admitPierAdd, admitPierExit, checkPierAdd, isSolPair, pierMode, pierStates, pierStopped, withinCeiling } from "./pier-gate.ts";

const OWNER = "4EeXyPQ1u3bWMZ3C3BaG2Tn9z8W1E6uN9rT5aS8dPGWw";
const OTHER = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const on = { status: "on" };
const later = { status: "later" };
const engineOpen = { add: on, remove: on, claim: on, maxDepositUsd: null };

test("the Harbor's switch has three states; anything else is closed", () => {
  assert.equal(pierMode(undefined), "closed");
  assert.equal(pierMode(""), "closed");
  assert.equal(pierMode("yes"), "closed");
  assert.equal(pierMode(" Canary "), "canary");
  assert.equal(pierMode("OPEN"), "open");
});

test("closed admits nobody; canary only its own wallet, up to five dollars", () => {
  assert.deepEqual(admitPierAdd(OWNER, "meteora-dlmm", {}), { ok: false, code: "PIER_CLOSED" });
  const canary = { NEXT_PUBLIC_RYNTRA_CITY_HARBOR: "canary", RYNTRA_CITY_HARBOR_CANARY_WALLET: OWNER };
  assert.deepEqual(admitPierAdd(OWNER, "meteora-dlmm", canary), { ok: true, mode: "canary", ceilingUsd: PIER_CANARY_CEILING_USD });
  assert.deepEqual(admitPierAdd(OTHER, "meteora-dlmm", canary), { ok: false, code: "PIER_CLOSED" });
  assert.deepEqual(admitPierAdd(null, "meteora-dlmm", canary), { ok: false, code: "PIER_CLOSED" });
  // A canary with no wallet configured admits nobody.
  assert.deepEqual(admitPierAdd(OWNER, "meteora-dlmm", { NEXT_PUBLIC_RYNTRA_CITY_HARBOR: "canary" }), { ok: false, code: "PIER_CLOSED" });
});

test("open admits everyone up to the venue's ceiling; a venue without one takes no add", () => {
  const open = { NEXT_PUBLIC_RYNTRA_CITY_HARBOR: "open" };
  assert.deepEqual(admitPierAdd(OTHER, "meteora-dlmm", open), { ok: true, mode: "open", ceilingUsd: PIER_CEILING_USD["meteora-dlmm"] });
  assert.deepEqual(admitPierAdd(OTHER, "meteora-damm2", open), { ok: false, code: "PIER_VENUE" });
  assert.deepEqual(admitPierAdd(OTHER, "__proto__", open), { ok: false, code: "PIER_VENUE" });
});

test("the stop holds new money at once and never holds anyone's money in", () => {
  assert.equal(pierStopped({}), false);
  assert.equal(pierStopped({ RYNTRA_CITY_HARBOR_STOP: "0" }), false);
  assert.equal(pierStopped({ RYNTRA_CITY_HARBOR_STOP: "off" }), false);
  assert.equal(pierStopped({ RYNTRA_CITY_HARBOR_STOP: "1" }), true);
  const stopped = { NEXT_PUBLIC_RYNTRA_CITY_HARBOR: "open", RYNTRA_CITY_HARBOR_STOP: "stop" };
  assert.deepEqual(admitPierAdd(OTHER, "meteora-dlmm", stopped), { ok: false, code: "PIER_STOPPED" });
  assert.equal(admitPierExit(OTHER, stopped), true);
  // A stranger under a stopped canary still hears «closed», not «stopped».
  const canary = { NEXT_PUBLIC_RYNTRA_CITY_HARBOR: "canary", RYNTRA_CITY_HARBOR_CANARY_WALLET: OWNER, RYNTRA_CITY_HARBOR_STOP: "1" };
  assert.deepEqual(admitPierAdd(OTHER, "meteora-dlmm", canary), { ok: false, code: "PIER_CLOSED" });
  assert.equal(admitPierExit(OWNER, canary), true);
  assert.equal(admitPierExit(OTHER, canary), false);
  assert.equal(admitPierExit(OWNER, {}), false);
});

test("a deposit without a price is never within the ceiling", () => {
  assert.equal(withinCeiling(4.99, 5), true);
  assert.equal(withinCeiling(5.01, 5), false);
  assert.equal(withinCeiling(null, 5), false);
  assert.equal(withinCeiling(0, 5), false);
  assert.equal(withinCeiling(Number.NaN, 5), false);
});

test("the window's states join the city's word with the engine's: both on, the lower ceiling", () => {
  const open = { NEXT_PUBLIC_RYNTRA_CITY_HARBOR: "open" };
  assert.deepEqual(pierStates(OTHER, open, engineOpen), { add: "on", exit: "on", ceilingUsd: 1_000, stopped: false });
  assert.deepEqual(pierStates(OTHER, open, { ...engineOpen, maxDepositUsd: 5 }), { add: "on", exit: "on", ceilingUsd: 5, stopped: false });
  assert.deepEqual(pierStates(OTHER, open, { add: later, remove: later, claim: later, maxDepositUsd: null }), { add: "off", exit: "off", ceilingUsd: null, stopped: false });
  assert.deepEqual(pierStates(OTHER, {}, engineOpen), { add: "off", exit: "off", ceilingUsd: null, stopped: false });
  assert.deepEqual(pierStates(OTHER, { ...open, RYNTRA_CITY_HARBOR_STOP: "1" }, engineOpen), { add: "off", exit: "on", ceilingUsd: null, stopped: true });
});

const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const JITOSOL = "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn";
const HYPE = "HYPEhypehypehypehypehypehypehypehypehypehype";

test("the city builds only SOL against USDC or an LST", () => {
  assert.equal(isSolPair(SOL, USDC), true);
  assert.equal(isSolPair(JITOSOL, SOL), true);
  assert.equal(isSolPair(SOL, HYPE), false);
  assert.equal(isSolPair(USDC, JITOSOL), false);
  assert.equal(isSolPair(SOL, SOL), false);
});

test("an add is held to its ceiling by the most it can put in, at the venue's prices", () => {
  const pool = { x: { mint: SOL, decimals: 9, priceUsd: 180 }, y: { mint: USDC, decimals: 6, priceUsd: 1 } };
  // 0.01 SOL + 1.8 USDC = $3.60.
  assert.deepEqual(checkPierAdd({ amountX: "10000000", amountY: "1800000" }, pool, 5), { ok: true, usd: 3.6 });
  assert.deepEqual(checkPierAdd({ amountX: "100000000", amountY: "18000000" }, pool, 5), { ok: false, code: "PIER_CEILING" });
  assert.deepEqual(checkPierAdd({ amountX: "10000000", amountY: "1800000" }, { ...pool, y: { ...pool.y, priceUsd: null } }, 5), { ok: false, code: "PIER_UNPRICED" });
  assert.deepEqual(checkPierAdd({ amountX: "1", amountY: "1" }, { ...pool, y: { mint: HYPE, decimals: 6, priceUsd: 30 } }, 5), { ok: false, code: "PIER_PAIR" });
  assert.deepEqual(checkPierAdd({ amountX: "1", amountY: "1" }, null, 5), { ok: false, code: "PIER_PAIR" });
});
