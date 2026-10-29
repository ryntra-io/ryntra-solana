import { test } from "node:test";
import assert from "node:assert/strict";

import { orderRows, positionRows } from "./account.ts";
import { levelStrip, perpLayers } from "./layers.ts";
import { account, MARKETS } from "./test-fixtures.mjs";

const rows = () => positionRows(account(), MARKETS.markets);

test("a position's layers: its entry, Phoenix's liquidation, its TP and SL, and the plain orders resting beside it", () => {
  const layers = perpLayers("SOL", rows(), orderRows(account()));
  assert.deepEqual(
    layers.map((layer) => [layer.kind, layer.price, layer.tone, layer.dashed]),
    [
      ["tp", 165, "mint", true],
      ["entry", 147.2, "ice", false],
      ["sl", 140, "warm", true],
      ["order", 138, "violet", true],
      ["liquidation", 118.4, "flare", true],
    ],
  );
  // The TP order itself is the position's take profit, not a second line.
  assert.equal(layers.filter((layer) => layer.price === 165).length, 1);
  assert.equal(layers.find((layer) => layer.kind === "entry").label, "Long entry");
});

test("only this market's layers, and none for a price Phoenix did not send", () => {
  assert.deepEqual(perpLayers("BTC", rows(), orderRows(account())), []);
  const bare = positionRows(account({ positions: [{ symbol: "SOL", subaccount: 0, side: "short", size: 1, entryPrice: null }], orders: [], margin: null }), MARKETS.markets);
  assert.deepEqual(perpLayers("sol", bare, []), []);
});

test("the level strip places each level and the mark between the lowest and the highest, moving none", () => {
  const strip = levelStrip(perpLayers("SOL", rows(), []), 150);
  const at = Object.fromEntries(strip.marks.map((mark) => [mark.kind, mark.at]));
  assert.equal(at.liquidation, 0);
  assert.equal(at.tp, 1);
  assert.ok(Math.abs(strip.markAt - (150 - 118.4) / (165 - 118.4)) < 1e-9);
  assert.deepEqual(strip.marks.map((mark) => mark.price), [165, 147.2, 140, 118.4]);
  assert.deepEqual(levelStrip([], 150), { marks: [], markAt: null });
  const one = levelStrip(perpLayers("SOL", positionRows(account({ positions: [{ symbol: "SOL", subaccount: 0, side: "long", size: 1, entryPrice: 150 }], margin: null }), MARKETS.markets), []), 150);
  assert.equal(one.marks[0].at, 0.5);
});
