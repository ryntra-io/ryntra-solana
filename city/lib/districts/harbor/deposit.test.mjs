import { test } from "node:test";
import assert from "node:assert/strict";

import { addBody, claimBody, depositTiles, exitBody, spendable, splitDeposit, startTile, toUnits, yWeight } from "./deposit.ts";
import { defaultRange, harborPools } from "./pools.ts";
import { CATALOG, OWNER, POSITION, USDC, WSOL } from "./test-fixtures.mjs";

const [SOL_USDC] = harborPools(CATALOG);
const DAMM = harborPools(CATALOG).at(-1);

const holdings = (sol, usdc, complete = true) => ({
  owner: OWNER,
  sol: sol === null ? null : { spendableRaw: sol, decimals: 9 },
  tokens: new Map(usdc === null ? [] : [[USDC, { spendableRaw: usdc, decimals: 6 }]]),
  complete,
});

test("base units are never rounded up", () => {
  assert.equal(toUnits(1.23456789, 6), "1234567");
  assert.equal(toUnits(0.1, 9), "100000000");
  assert.equal(toUnits(2, 12), "2000000000000");
  assert.equal(toUnits(0, 6), "0");
  assert.equal(toUnits(-1, 6), "0");
  assert.equal(toUnits(Number.NaN, 6), "0");
});

test("a dollar amount goes in as two coins of equal value at the pool's own price", () => {
  const split = splitDeposit(SOL_USDC, 50);
  const inUsdc = 50 / SOL_USDC.y.priceUsd;
  assert.equal(split.y, toUnits(inUsdc / 2, 6));
  assert.equal(split.x, toUnits(inUsdc / 2 / SOL_USDC.price, 9));
  // Value of each side, at the pool's price, is half.
  const xValue = (Number(split.x) / 1e9) * SOL_USDC.price * SOL_USDC.y.priceUsd;
  assert.ok(Math.abs(xValue - 25) < 0.01, `${xValue}`);
  assert.match(split.xShown, /^0\.24/);
  assert.match(split.yShown, /^25/);
});

test("without a dollar price for either coin the card does not size money", () => {
  const unpriced = { ...SOL_USDC, x: { ...SOL_USDC.x, priceUsd: null }, y: { ...SOL_USDC.y, priceUsd: null } };
  assert.equal(splitDeposit(unpriced, 50), null);
  // One priced coin is enough: the other is read through the pool's price.
  const half = { ...SOL_USDC, y: { ...SOL_USDC.y, priceUsd: null } };
  assert.ok(splitDeposit(half, 50));
});

test("a DAMM v2 band takes the coins as its curve does: one coin only outside it", () => {
  const band = defaultRange(DAMM);
  const w = yWeight(DAMM, band);
  assert.ok(w > 0 && w < 0.5, `${w}`);
  // Below the band a position holds only the first coin; above it, only the second.
  assert.equal(yWeight({ ...DAMM, price: 60 }, band), 0);
  assert.equal(yWeight({ ...DAMM, price: 500 }, band), 1);
  assert.equal(yWeight(DAMM, { kind: "curve" }), 0.5);
  assert.equal(yWeight(SOL_USDC, defaultRange(SOL_USDC)), 0.5);
});

test("the SOL side is native SOL; an unknown balance is not zero", () => {
  assert.equal(spendable(holdings("5", "7"), WSOL), 5n);
  assert.equal(spendable(holdings("5", "7"), USDC), 7n);
  assert.equal(spendable(holdings(null, null), USDC), 0n);
  assert.equal(spendable(holdings(null, null, false), USDC), null);
  assert.equal(spendable(null, USDC), null);
});

test("tiles say which coin is short and which amounts the engine admits", () => {
  const rich = depositTiles(SOL_USDC, holdings("10000000000", "1000000000"), null);
  assert.deepEqual(rich.map((tile) => tile.usd), [10, 25, 50, 100]);
  assert.ok(rich.every((tile) => tile.fits && !tile.overCeiling));
  const noUsdc = depositTiles(SOL_USDC, holdings("10000000000", "0"), null);
  assert.ok(noUsdc.every((tile) => !tile.fits && tile.short === "USDC"));
  const littleSol = depositTiles(SOL_USDC, holdings("100000000", "1000000000"), null);
  assert.deepEqual(littleSol.map((tile) => tile.fits), [true, false, false, false]);
  assert.equal(littleSol[1].short, "SOL");
  // A live check's ceiling of five dollars: every tile is above it.
  assert.ok(depositTiles(SOL_USDC, null, 5).every((tile) => tile.overCeiling && tile.fits));
  assert.ok(depositTiles(SOL_USDC, null, 25).filter((tile) => !tile.overCeiling).length === 2);
});

test("the card starts on the first tile that fits", () => {
  assert.equal(startTile(depositTiles(SOL_USDC, holdings("10000000000", "1000000000"), null)), 0);
  assert.equal(startTile(depositTiles(SOL_USDC, holdings("10000000000", "0"), null)), 0);
  assert.equal(startTile([{ split: {}, fits: false, overCeiling: false }, { split: {}, fits: true, overCeiling: false }]), 1);
});

test("an add asks the engine for bins around the price on DLMM, and for the pool's range on DAMM v2", () => {
  const split = splitDeposit(SOL_USDC, 25);
  assert.deepEqual(addBody(SOL_USDC, OWNER, split), {
    action: "add",
    venue: "meteora-dlmm",
    request: { pool: SOL_USDC.address, owner: OWNER, amountX: split.x, amountY: split.y, shape: "spot", slippageBps: 100 },
    range: { place: "around", half: 34 },
  });
  const dammSplit = splitDeposit(DAMM, 25);
  const body = addBody(DAMM, OWNER, dammSplit);
  assert.equal(body.venue, "meteora-damm2");
  assert.equal(body.range, undefined);
  assert.equal(body.request.shape, undefined);
});

test("taking fees keeps the position; exiting takes everything and closes it", () => {
  assert.deepEqual(claimBody("meteora-dlmm", POSITION, OWNER), { action: "claim", venue: "meteora-dlmm", request: { position: POSITION, owner: OWNER } });
  assert.deepEqual(exitBody("meteora-damm2", POSITION, OWNER), {
    action: "remove",
    venue: "meteora-damm2",
    request: { position: POSITION, owner: OWNER, shareBps: 10_000, close: true, slippageBps: 100 },
  });
});
