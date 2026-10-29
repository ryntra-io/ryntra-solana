import { test } from "node:test";
import assert from "node:assert/strict";

import { clearChartLayer, layersOf, mergeLayers, setChartLayer, toggleChartLayer, useChartLayers } from "./layers.ts";
import { fetchMarks, marketLayer, marketMarks, readMarks } from "./marks.ts";

// Layers over a tower's chart: the coin's market marks, «Your entry», and whatever a district adds (CITY-5d's perps
// next). Each is a chip that turns it off and on; the chart takes them all as the core chart's marks and levels.

const POPCAT = "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr";
const SOL = "So11111111111111111111111111111111111111112";
const T = 1_761_600_000;

test("the engine's meme marks in the city's words, oldest first", () => {
  const marks = marketMarks([
    { kind: "creator-sell", t: T + 300, usd: 4_000, pct: 1.234 },
    { kind: "big-buy", t: T + 100, usd: 12_000, pct: null },
    { kind: "big-sell", t: T + 200, usd: 9_000, pct: null },
    { kind: "creator-buy", t: T, usd: 500, pct: null },
    { kind: "dex", t: T + 50, usd: null, pct: null },
    { kind: "liquidity-drop", t: T + 400, usd: null, pct: -34.6 },
    { kind: "creator-sell", t: T + 500, usd: 10, pct: 0.004 },
    { kind: "creator-sell", t: T + 600, usd: 10, pct: 0.5 },
    // A drop without its figure says nothing; a mark without a time is not one.
    { kind: "liquidity-drop", t: T + 700, usd: null, pct: null },
    { kind: "big-buy", t: Number.NaN, usd: 1, pct: null },
  ]);
  assert.deepEqual(
    marks.map((m) => [m.t / 1000 - T, m.kind, m.side, m.label, m.own]),
    [
      [0, "trade", "buy", "Creator bought", false],
      [50, "event", null, "Left the curve", false],
      [100, "trade", "buy", "Large buy", false],
      [200, "trade", "sell", "Large sale", false],
      [300, "trade", "sell", "Creator sold 1.2%", false],
      [400, "event", null, "Liquidity −35%", false],
      [500, "trade", "sell", "Creator sold <0.01%", false],
      [600, "trade", "sell", "Creator sold 0.50%", false],
    ],
  );
  assert.equal(new Set(marks.map((m) => m.id)).size, marks.length, "every mark has its own id");
  assert.deepEqual(marketLayer(POPCAT, marks).id, "market");
  assert.equal(marketLayer(POPCAT, []), null, "a coin with nothing to mark has no chip");
});

test("the overview read: marks, none, or a failure", async () => {
  const ready = readMarks(200, { marks: [{ kind: "big-buy", t: T, usd: 1, pct: null }, { kind: "rug", t: T }, { kind: "dex", t: "soon" }, null], observedAt: "…" });
  assert.equal(ready.kind, "ready");
  assert.deepEqual(ready.marks.map((m) => m.label), ["Large buy"], "only marks the engine knows, whole");
  assert.deepEqual(readMarks(200, { none: { code: "NOT_LISTED", reason: "…" } }), { kind: "ready", marks: [] });
  assert.deepEqual(readMarks(503, { error: {} }), { kind: "failed" });
  assert.deepEqual(readMarks(200, { marks: "x" }), { kind: "failed" });
  assert.deepEqual(readMarks(200, null), { kind: "failed" });
  const asked = [];
  assert.equal((await fetchMarks(POPCAT, async (url) => (asked.push(url), { status: 200, json: async () => ({ marks: [] }) }))).kind, "ready");
  assert.deepEqual(asked, [`/api/spot/token?mint=${POPCAT}&part=overview`]);
  assert.deepEqual(await fetchMarks(POPCAT, async () => Promise.reject(new Error("offline"))), { kind: "failed" });
  assert.deepEqual(await fetchMarks(POPCAT, async () => ({ status: 200, json: async () => JSON.parse("<") })), { kind: "failed" });
});

test("layers merge into the core chart's marks and levels: prefixed, on the price step, the hidden ones left out", () => {
  const layers = [
    { id: "market", label: "Market", mint: POPCAT, marks: [{ id: "a", t: 2_000, side: "buy", label: "Large buy", kind: "trade" }, { id: "b", t: 1_000, side: null, label: "Left the curve", kind: "event" }] },
    { id: "entry", label: "Entry", mint: POPCAT, levels: [{ id: "average", price: 0.451234, label: "Your entry" }] },
    {
      id: "perps",
      label: "Perps",
      mint: POPCAT,
      marks: [{ id: "fill", t: 1_500, side: "sell", label: "Short", price: 0.46, own: true }, { id: "bad", t: Number.NaN, side: null, label: "x" }],
      levels: [
        { id: "liq", price: 0.52, label: "Liquidation", kind: "alert" },
        { id: "zero", price: 0, label: "never" },
        { id: "nan", price: Number.NaN, label: "never" },
      ],
    },
  ];
  const all = mergeLayers(layers, new Set(), "0.0001");
  assert.deepEqual(
    all.marks.map((m) => [m.id, m.t, m.kind, m.price, m.side, m.own]),
    [
      ["market:b", 1_000, "event", null, null, false],
      ["perps:fill", 1_500, "trade", "0.4600", "sell", true],
      ["market:a", 2_000, "trade", null, "buy", false],
    ],
  );
  assert.deepEqual(all.levels, [
    { id: "entry:average", kind: "level", price: "0.4512", basis: { kind: "last", measure: "price", in: "USD", adjustment: "raw", outcome: null }, label: "Your entry" },
    { id: "perps:liq", kind: "alert", price: "0.5200", basis: { kind: "last", measure: "price", in: "USD", adjustment: "raw", outcome: null }, label: "Liquidation" },
  ]);
  const some = mergeLayers(layers, new Set(["market", "perps"]), "0.0001");
  assert.deepEqual(some.marks, []);
  assert.deepEqual(some.levels.map((l) => l.id), ["entry:average"]);
});

test("a district adds, replaces and clears its layer; the person's chip turns it off and on", () => {
  assert.deepEqual(layersOf(useChartLayers.getState().layers, POPCAT), []);
  setChartLayer({ id: "perps", label: "Perps", mint: POPCAT, levels: [{ id: "entry", price: 0.45, label: "Long entry" }] });
  setChartLayer({ id: "vault", label: "Vault", mint: SOL, levels: [{ id: "x", price: 190, label: "SOL level" }] });
  setChartLayer({ id: "empty", label: "Empty", mint: POPCAT, marks: [], levels: [] });
  assert.deepEqual(layersOf(useChartLayers.getState().layers, POPCAT).map((l) => l.id), ["perps"], "a tower shows its own layers that have something to draw");
  // The same id again replaces the layer in its place.
  setChartLayer({ id: "perps", label: "Perps", mint: POPCAT, levels: [{ id: "entry", price: 0.47, label: "Long entry" }] });
  assert.equal(layersOf(useChartLayers.getState().layers, POPCAT)[0].levels[0].price, 0.47);
  toggleChartLayer("perps");
  assert.equal(useChartLayers.getState().hidden.has("perps"), true);
  toggleChartLayer("perps");
  assert.equal(useChartLayers.getState().hidden.has("perps"), false);
  clearChartLayer("perps");
  clearChartLayer("perps");
  clearChartLayer("vault");
  clearChartLayer("empty");
  assert.equal(useChartLayers.getState().layers.size, 0);
});
