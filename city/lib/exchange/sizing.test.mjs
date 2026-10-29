import { test } from "node:test";
import assert from "node:assert/strict";

import { leverageAt, leverageMarks, MARK_GAP, placeOfLeverage, sizeView, fieldDollars } from "./sizing.ts";
import { newDraft, sizeLotsOf } from "./ticket.ts";
import { PUMP, SOL } from "./test-fixtures.mjs";

const draft = (changes = {}) => ({ ...newDraft(), side: "long", ...changes });

test("the leverage slider runs from one to the market's highest, whole numbers only, never past either end", () => {
  assert.equal(leverageAt(0, 20), 1);
  assert.equal(leverageAt(1, 20), 20);
  assert.equal(leverageAt(-3, 20), 1);
  assert.equal(leverageAt(7, 20), 20);
  assert.equal(leverageAt(Number.NaN, 20), 1);
  // A market without a highest offers one times only.
  assert.equal(leverageAt(1, null), 1);
  assert.equal(placeOfLeverage(5, null), 0);
  for (let at = 0; at <= 1; at += 0.001) assert.ok(Number.isInteger(leverageAt(at, 50)), String(at));
});

test("every leverage stands where the slider gives it back: a tap on a mark and a drag land on the same figure", () => {
  for (const max of [5, 10, 20, 25, 50, 100]) {
    for (let leverage = 1; leverage <= max; leverage += 1) assert.equal(leverageAt(placeOfLeverage(leverage, max), max), leverage, `${leverage}× of ${max}`);
  }
  // The log scale gives the careful start room: on a hundred-times market two times is not crushed against one.
  assert.ok(placeOfLeverage(2, 100) > 0.1);
  assert.ok(placeOfLeverage(10, 100) === 0.5);
});

test("the marks under the slider: the usual steps, none crowding another, the market's highest always last", () => {
  assert.deepEqual(
    leverageMarks(20).map((mark) => mark.step),
    [1, 2, 3, 5, 10, 20],
  );
  const hundred = leverageMarks(100);
  assert.deepEqual(
    hundred.map((mark) => mark.step),
    [1, 2, 5, 10, 20, 50, 100],
  );
  for (let index = 1; index < hundred.length; index += 1) assert.ok(hundred[index].at - hundred[index - 1].at >= MARK_GAP);
  assert.equal(hundred.at(-1).at, 1);
  assert.deepEqual(leverageMarks(1), [{ step: 1, at: 0 }]);
  assert.deepEqual(leverageMarks(null), [{ step: 1, at: 0 }]);
});

test("a chip of the free collateral: the slider stands on it and the field shows its dollars, at the engine's price", () => {
  // The engine's most at this leverage is 13 SOL; a quarter is 3.25 SOL, counted at the market long's worst price, $150.75.
  const view = sizeView(draft({ size: { kind: "share", percent: 25 } }), SOL, "13000");
  assert.deepEqual(view, { text: "489.93", percent: 25, chip: 25 });
  assert.deepEqual(sizeView(draft({ size: { kind: "share", percent: 100 } }), SOL, "13000").chip, 100);
  // The slider between chips: no chip is on, the field still says what it comes to.
  assert.deepEqual(sizeView(draft({ size: { kind: "share", percent: 40 } }), SOL, "13000"), { text: "783.90", percent: 40, chip: null });
});

test("a typed sum moves the slider to its part of the most and lights no chip; nothing is guessed before the most is read", () => {
  // $30 is 199 lots of the 13 000: one per cent, rounded down.
  assert.deepEqual(sizeView(draft({ size: { kind: "usd", text: "30" } }), SOL, "13000"), { text: "30", percent: 1, chip: null });
  // Half the most, typed in dollars, stands half way — and still lights no chip: the person typed a sum, not a share.
  assert.deepEqual(sizeView(draft({ size: { kind: "usd", text: "979.875" } }), SOL, "13000"), { text: "979.875", percent: 50, chip: null });
  // More than the most stops the slider at its end.
  assert.equal(sizeView(draft({ size: { kind: "usd", text: "5000" } }), SOL, "13000").percent, 100);
  assert.equal(sizeView(draft({ size: { kind: "usd", text: "" } }), SOL, "13000").percent, 0);
  // $15 is under one per cent of the most: the slider still stands off its start.
  assert.equal(sizeView(draft({ size: { kind: "usd", text: "15" } }), SOL, "13000").percent, 1);
  // The most not read yet: the slider waits, the share's field waits.
  assert.equal(sizeView(draft({ size: { kind: "usd", text: "30" } }), SOL, null).percent, null);
  assert.deepEqual(sizeView(draft({ size: { kind: "share", percent: 50 } }), SOL, null), { text: "", percent: 50, chip: 50 });
});

test("the field's dollars, typed back, never buy more than the share they came from", () => {
  for (const market of [SOL, PUMP]) {
    for (const percent of [7, 25, 50, 75, 100]) {
      const most = market === SOL ? "13000" : "4321";
      const share = draft({ size: { kind: "share", percent } });
      const view = sizeView(share, market, most);
      const typed = sizeLotsOf(draft({ size: { kind: "usd", text: view.text } }), market, most);
      assert.ok(typed === null || typed <= sizeLotsOf(share, market, most), `${market.symbol} ${percent}%`);
    }
  }
  assert.equal(fieldDollars(489_937_500n), "489.93");
  assert.equal(fieldDollars(5_000n), "0.00");
  assert.equal(fieldDollars(12_000_000n), "12.00");
});
