// How much of a DLMM Pro limit order has filled — on the worked example of Meteora's own documentation.
import assert from "node:assert/strict";
import test from "node:test";

const { collectPayoutOf, orderFillOf, orderSummaryOf, xForY, yForX } = await import("./orders.ts");

const Q64 = 1n << 64n;
/** A tick at price exactly 1.0. */
const tickAt = (state) => ({ tickId: 0, sqrtPrice: Q64, orderAge: 0n, openOrderAmount: 0n, totalProcessingOrderAmount: 0n, processedOrderRemainingAmount: 0n, fulfilledOrderAmountX: 0n, fulfilledOrderAmountY: 0n, limitOrderFeeAskSide: 0n, limitOrderFeeBidSide: 0n, ...state });
const ask = (amount, age) => ({ tickId: 0, isAsk: true, amount, age });

/*
 * «How Orders Fill» (docs.meteora.ag, DLMM Pro · Limit Orders): asks A (1 000 000 X) and B (3 000 000 X) rest at a
 * tick of price 1.0 with a 0.30 % fee; swap 1 pays 2 500 000 Y; C (2 000 000 X) is placed; swap 2 pays 2 000 000 Y.
 */
const A = ask(1_000_000n, 0n);
const B = ask(3_000_000n, 0n);
const C = ask(2_000_000n, 1n);

test("orders rest until a swap reaches their tick", () => {
  const tick = tickAt({ openOrderAmount: 4_000_000n });
  for (const order of [A, B]) {
    const fill = orderFillOf(order, tick);
    assert.equal(fill.state, "resting");
    assert.equal(fill.unfilledRaw, order.amount);
    assert.equal(fill.filledRaw, 0n);
    assert.equal(fill.proceedsRaw, 0n);
    assert.equal(fill.feeShareRaw, 0n);
  }
});

test("after swap 1 the batch of A and B is partly filled, pro rata, the unfilled part rounded up", () => {
  /* The batch is 4 000 000; 2 500 000 was filled and 1 500 000 is left; the makers' pool holds 3 750 X. */
  const tick = tickAt({ orderAge: 1n, totalProcessingOrderAmount: 4_000_000n, processedOrderRemainingAmount: 1_500_000n, fulfilledOrderAmountX: 2_500_000n, limitOrderFeeAskSide: 3_750n });
  const a = orderFillOf(A, tick);
  assert.equal(a.state, "partial");
  assert.equal(a.unfilledRaw, 375_000n);
  assert.equal(a.filledRaw, 625_000n);
  assert.equal(a.proceedsRaw, 625_000n, "at price 1.0 a filled coin pays one of the other");
  assert.equal(a.feeShareRaw, 937n, "⌊3 750 × 625 000 / 2 500 000⌋");
  const b = orderFillOf(B, tick);
  assert.equal(b.unfilledRaw, 1_125_000n);
  assert.equal(b.filledRaw, 1_875_000n);
  /* C was placed after the batch started: it waits for the next one. */
  const c = orderFillOf(C, tickAt({ ...tick, openOrderAmount: 2_000_000n }));
  assert.equal(c.state, "resting");
  assert.equal(c.filledRaw, 0n);
});

test("a share that does not divide: the unfilled part is rounded up, so what is filled — and paid — is rounded down", () => {
  /* Of a batch of 3 000 001, 1 000 000 is left: an order of 1 000 001 keeps ⌈1 000 001 × 1 000 000 / 3 000 001⌉ = 333 334 unfilled. */
  const tick = tickAt({ orderAge: 1n, totalProcessingOrderAmount: 3_000_001n, processedOrderRemainingAmount: 1_000_000n, fulfilledOrderAmountX: 2_000_001n, limitOrderFeeAskSide: 3_000n });
  const fill = orderFillOf(ask(1_000_001n, 0n), tick);
  assert.equal((1_000_001n * 1_000_000n) % 3_000_001n !== 0n, true, "the share does not divide");
  assert.equal(fill.unfilledRaw, 333_334n, "rounded up — a floor would say 333 333");
  assert.equal(fill.filledRaw, 666_667n);
  assert.equal(fill.feeShareRaw, 1_000n, "⌊3 000 × 666 667 / 2 000 001⌋ = ⌊1 000.0005⌋");
  /* The other order of the batch: the two unfilled parts add up to one more than the batch has left — never to less. */
  const other = orderFillOf(ask(2_000_000n, 0n), tick);
  assert.equal(other.unfilledRaw, 666_667n);
  assert.equal(fill.unfilledRaw + other.unfilledRaw, 1_000_001n);
});

test("an order's side is the side of what is left of it", () => {
  /* The program empties a collected tick — its side too: the order's is read from a tick that is live, and an order collected whole has none. */
  const collected = { tickId: 0, side: "bid", state: "collected", amountRaw: 0n, filledRaw: 0n, unfilledRaw: 0n, proceedsRaw: 0n, feeShareRaw: 0n };
  const live = orderFillOf(ask(1_000n, 0n), tickAt({ openOrderAmount: 1_000n }));
  assert.equal(orderSummaryOf([collected, live]).side, "ask");
  assert.equal(orderSummaryOf([collected]).side, null, "with nothing live, no side — not whatever an emptied entry says");
  assert.equal(orderSummaryOf([]).side, null);
});

test("after swap 2 the first batch is finished and C's is being filled", () => {
  /* Swap 2 finished A and B (1 500 000) and started C's batch, filling 500 000 of its 2 000 000; the pool holds 6 750 X against 4 500 000 filled. */
  const tick = tickAt({ orderAge: 2n, totalProcessingOrderAmount: 2_000_000n, processedOrderRemainingAmount: 1_500_000n, fulfilledOrderAmountX: 4_500_000n, limitOrderFeeAskSide: 6_750n });
  const a = orderFillOf(A, tick);
  assert.equal(a.state, "filled");
  assert.equal(a.filledRaw, 1_000_000n);
  assert.equal(a.unfilledRaw, 0n);
  assert.equal(a.feeShareRaw, 1_500n);
  const c = orderFillOf(C, tick);
  assert.equal(c.state, "partial");
  assert.equal(c.unfilledRaw, 1_500_000n);
  assert.equal(c.filledRaw, 500_000n);

  /* Each collect takes its share and shrinks the pool and the total by what it took: A 1 500, then B 4 500, then C 750. */
  const afterA = { ...tick, fulfilledOrderAmountX: 3_500_000n, limitOrderFeeAskSide: 5_250n };
  assert.equal(orderFillOf(B, afterA).feeShareRaw, 4_500n);
  const afterB = { ...tick, fulfilledOrderAmountX: 500_000n, limitOrderFeeAskSide: 750n };
  assert.equal(orderFillOf(C, afterB).feeShareRaw, 750n);

  /* On a pool that collects in the coin a swap pays out, an ask's fee is in X; on an «only Y» pool, in Y. */
  assert.deepEqual(collectPayoutOf([a], false), { xRaw: 1_500n, yRaw: 1_000_000n });
  assert.deepEqual(collectPayoutOf([a], true), { xRaw: 0n, yRaw: 1_001_500n });
  /* C's share is the same 750 whether it collects first or last: the pool and the total shrink together. */
  assert.equal(c.feeShareRaw, 750n, "⌊6 750 × 500 000 / 4 500 000⌋");
  assert.deepEqual(collectPayoutOf([c], false), { xRaw: 1_500_000n + 750n, yRaw: 500_000n }, "the unfilled coins back, the fee in X, the proceeds in Y");
});

test("a bid is the mirror: Y rests, X is paid at the tick's price, the fee in Y", () => {
  /* A tick at price 4.0: the square root is 2. */
  const tick = tickAt({ tickId: 5, sqrtPrice: 2n * Q64, orderAge: 3n, fulfilledOrderAmountY: 800n, limitOrderFeeBidSide: 40n });
  const fill = orderFillOf({ tickId: 5, isAsk: false, amount: 801n, age: 1n }, { ...tick, fulfilledOrderAmountY: 801n });
  assert.equal(fill.side, "bid");
  assert.equal(fill.state, "filled");
  assert.equal(fill.proceedsRaw, 200n, "⌊801 / 4⌋ of token X");
  assert.deepEqual(collectPayoutOf([fill], false), { xRaw: 200n, yRaw: 40n });
  assert.deepEqual(collectPayoutOf([fill], true), { xRaw: 200n, yRaw: 40n }, "a bid's fee is in Y on either kind of pool");
  assert.equal(yForX(801n, 2n * Q64), 3_204n);
  assert.equal(xForY(3_204n, 2n * Q64), 801n);
  assert.equal(xForY(3_207n, 2n * Q64), 801n, "rounded down: the pool never pays out more than it took in");
});

test("a collected tick stays in the order, empty; an order of collected ticks only can be closed", () => {
  const collected = orderFillOf(ask(0n, 0n), tickAt({ orderAge: 9n }));
  assert.equal(collected.state, "collected");
  const live = orderFillOf({ ...A, tickId: 0 }, tickAt({ openOrderAmount: 1_000_000n }));
  assert.equal(orderSummaryOf([collected, live]).closable, false);
  assert.equal(orderSummaryOf([collected, live]).live, 1);
  assert.equal(orderSummaryOf([collected, live]).unfilledRaw, 1_000_000n);
  assert.equal(orderSummaryOf([collected]).closable, true);
  assert.equal(orderSummaryOf([]).closable, false, "an order with no ticks is not an order");
  assert.deepEqual(collectPayoutOf([collected], false), { xRaw: 0n, yRaw: 0n });
});

test("what cannot be read is refused, never guessed", () => {
  assert.throws(() => orderFillOf(ask(10n, 5n), tickAt({ orderAge: 4n })), /ahead of its tick/);
  assert.throws(() => orderFillOf({ ...A, tickId: 100 }, tickAt({})), /is not the tick/);
  assert.throws(() => xForY(1n, 0n), /price is zero/);
});
