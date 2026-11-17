/**
 * A DLMM Pro pool's liquidity by price, with no network: the walk across the ticks on its own, and the
 * venue's read replayed on moments the earn rehearsal froze — held to the pool's own positions, read one by one: on
 * every step the walk must find exactly the liquidity of the positions that cover it.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { getAmountsFromLiquidity } from "@meteora-ag/dlmm-pro-sdk";
import BN from "bn.js";

import { readFixture, rpcConnection, snapshotSource } from "./fixture-kit.mjs";

const { MAX_STEPS_HALF, walkLiquidity } = await import("./bins.server.ts");
const { createDlmmProVenue } = await import("./venue.server.ts");
const { DlmmProRefusal } = await import("./sdk.server.ts");

const fixture = readFixture(new URL("./fixtures/earn-rehearsal.json.gz", import.meta.url));
const { who, addresses } = fixture;
const lands = () => ({ err: null, logs: [], unitsConsumed: 0, accounts: null, returnData: null });
const at = (moment) => createDlmmProVenue({ connection: rpcConnection(snapshotSource(fixture.snapshots[moment], {}, lands)), referralOwner: who.referral });
const refused = (work) => work().then(() => null, (error) => (error instanceof DlmmProRefusal ? error.code : `not a refusal: ${error}`));

test("the walk adds a crossed tick's change going up and takes it off going down; a broken walk is nothing, never a debt", () => {
  const net = new Map([
    [20, new BN(-300)], // a position ends at 20
    [0, new BN(300)], // … that began at 0
    [-10, new BN(50)], // another begins at -10
    [40, new BN(-50)], // … and ends at 40
  ]);
  const walked = walkLiquidity(0, 10, -3, 4, new BN(350), (tick) => net.get(tick));
  const read = Object.fromEntries([...walked].map(([step, held]) => [step, held.toString()]));
  assert.deepEqual(read, { 0: "350", 1: "350", 2: "50", 3: "50", 4: "0", "-1": "50", "-2": "0", "-3": "0" });
  /* A tick array that did not read leaves a change out: the step is empty, not negative. */
  const broken = walkLiquidity(0, 10, -1, 1, new BN(10), (tick) => (tick === 10 ? new BN(-25) : undefined));
  assert.equal(broken.get(1).toString(), "0");
});

for (const moment of ["poolOpen", "caring", "careTakenBack"]) {
  test(`${moment}: every step holds exactly what the positions covering it hold`, async () => {
    const venue = at(moment);
    const half = 30;
    const steps = await venue.bins.around(addresses.pool, half);
    const pool = await venue.pools.read(addresses.pool);
    assert.equal(steps.tickSpacing, pool.tickSpacing);
    assert.equal(steps.tickId, pool.tickId);
    assert.equal(steps.price, pool.price);
    assert.equal(steps.hereTickId, Math.floor(pool.tickId / pool.tickSpacing) * pool.tickSpacing);
    assert.equal(steps.steps.length, half * 2 + 1);
    assert.deepEqual(steps.steps.map((step) => step.offset), Array.from({ length: half * 2 + 1 }, (_, index) => index - half));

    const { positions } = await venue.holdings.ofPool(addresses.pool);
    assert.ok(positions.length > 0);
    const slots = (await Promise.all(positions.map((nftMint) => venue.positions.read({ pool: addresses.pool, nftMint })))).flatMap((view) => view.slots);
    const sqrtPrice = new BN(pool.sqrtPriceX64);
    let withBoth = 0;
    for (const step of steps.steps) {
      assert.equal(step.tickLowerId, steps.hereTickId + step.offset * steps.tickSpacing);
      assert.equal(step.tickUpperId, step.tickLowerId + steps.tickSpacing);
      const covering = slots.filter((slot) => slot.tickLowerId <= step.tickLowerId && slot.tickUpperId >= step.tickUpperId);
      const held = covering.reduce((sum, slot) => sum.add(new BN(slot.liquidity)), new BN(0));
      const expected = held.isZero()
        ? { amountX: new BN(0), amountY: new BN(0) }
        : getAmountsFromLiquidity({ tickCurrentId: pool.tickId, tickLowerId: step.tickLowerId, tickUpperId: step.tickUpperId, currentSqrtPrice: sqrtPrice, liquidity: held.neg() });
      assert.equal(step.xRaw, expected.amountX.toString(), `X on step ${step.offset}`);
      assert.equal(step.yRaw, expected.amountY.toString(), `Y on step ${step.offset}`);
      /* Under the price a step holds Y alone, over it X alone; both only where the price stands. */
      if (step.offset < 0) assert.equal(step.xRaw, "0");
      if (step.offset > 0) assert.equal(step.yRaw, "0");
      if (step.xRaw !== "0" && step.yRaw !== "0") withBoth += 1;
    }
    assert.ok(withBoth <= 1);
    assert.ok(steps.steps.every((step, index, all) => index === 0 || step.price > all[index - 1].price));
  });
}

test("a width outside one read's bounds, a text that is no address and an address with no pool are refused", async () => {
  const venue = at("poolOpen");
  assert.equal(await refused(() => venue.bins.around(addresses.pool, 0)), "BAD_INPUT");
  assert.equal(await refused(() => venue.bins.around(addresses.pool, MAX_STEPS_HALF + 1)), "BAD_INPUT");
  assert.equal(await refused(() => venue.bins.around("not-an-address", 10)), "BAD_INPUT");
  assert.equal(await refused(() => venue.bins.around(addresses.usdc, 10)), "NO_POOL");
});
