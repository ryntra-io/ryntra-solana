import { test } from "node:test";
import assert from "node:assert/strict";

// The API the windows of CITY-62, 5a, 5d and 63 plug into, over a browser stand-in: a screen and a storage.
const items = new Map();
globalThis.window = {
  innerWidth: 1440,
  innerHeight: 860,
  localStorage: { getItem: (k) => items.get(k) ?? null, setItem: (k, v) => items.set(k, v) },
};

const { closeWindow, forgetMemoryForTests, layout, openWindow, updateWindow, useWindows } = await import("./store.ts");
const { LAYOUT_KEY } = await import("./memory.ts");
const { stuck } = await import("./geometry.ts");
const { emptyLayout } = await import("./layout.ts");

const render = () => null;
const FOUR = [
  { id: "chart", title: "Chart", render, min: { width: 420, height: 300 } },
  { id: "swap", title: "Swap", render, min: { width: 340, height: 220 } },
  { id: "spot", title: "Spot", render, min: { width: 340, height: 200 } },
  { id: "futures", title: "Futures", render, min: { width: 520, height: 180 } },
];

/** A page loaded again: nothing open, the device's memory read afresh. */
function reload() {
  forgetMemoryForTests();
  const first = emptyLayout({ width: 1440, height: 860 });
  useWindows.setState({ layout: first, base: first, specs: {}, guides: [], viewport: { width: 1440, height: 860 }, desk: true });
}

test("one line opens a window; opening it again brings it to the front with its new title", () => {
  reload();
  for (const spec of FOUR) openWindow(spec);
  assert.deepEqual(layout().map((p) => p.id), ["chart", "swap", "spot", "futures"]);
  assert.equal(layout().at(-1).front, true);
  openWindow({ ...FOUR[0], title: "Chart · BONK/USDC" });
  assert.equal(layout().length, 4);
  assert.equal(layout().at(-1).id, "chart");
  assert.equal(useWindows.getState().specs.chart.title, "Chart · BONK/USDC");
  closeWindow("swap");
  closeWindow("swap");
  assert.deepEqual(layout().map((p) => p.id).sort(), ["chart", "futures", "spot"]);
  assert.equal(useWindows.getState().specs.swap, undefined);
});

test("layout('grid') sticks the open windows together, and the device remembers it across a reload", () => {
  reload();
  for (const spec of FOUR) openWindow(spec);
  const grid = Object.fromEntries(layout("grid").map((p) => [p.id, p.rect]));
  assert.ok(stuck(grid.chart, grid.swap) && stuck(grid.swap, grid.spot) && stuck(grid.spot, grid.futures));
  assert.ok(items.has(LAYOUT_KEY));
  reload();
  for (const spec of [...FOUR].reverse()) openWindow(spec);
  const again = Object.fromEntries(layout().map((p) => [p.id, p.rect]));
  assert.deepEqual(again, grid);
});

test("full screen and back, remembered; a smaller screen carries the layout and the same screen gives it back exactly", () => {
  reload();
  for (const spec of FOUR) openWindow(spec);
  const grid = layout("grid");
  useWindows.getState().full("swap");
  assert.equal(layout().find((p) => p.id === "swap").full, true);
  reload();
  openWindow(FOUR[1]);
  assert.equal(layout()[0].full, true);
  useWindows.getState().exitFull();
  assert.deepEqual(layout()[0].rect, grid.find((p) => p.id === "swap").rect);
  for (const spec of FOUR) openWindow(spec);
  const set = layout().map((p) => p.rect);
  // A narrower browser for a moment, many sizes on the way, then back: not a pixel lost.
  for (let w = 1440; w >= 960; w -= 37) useWindows.getState().setViewport({ width: w, height: 860 - (1440 - w) / 4 });
  assert.equal(useWindows.getState().desk, true);
  useWindows.getState().setViewport({ width: 390, height: 844 });
  assert.equal(useWindows.getState().desk, false);
  useWindows.getState().setViewport({ width: 1440, height: 860 });
  assert.deepEqual(layout().map((p) => p.rect), set);
});

test("a drag draws without remembering; settling remembers and drops the guides", () => {
  reload();
  openWindow(FOUR[1]);
  const before = items.get(LAYOUT_KEY);
  const state = useWindows.getState();
  const moved = { ...state.layout, windows: state.layout.windows.map((w) => ({ ...w, rect: { ...w.rect, x: w.rect.x + 40 } })) };
  state.drag(moved, [{ axis: "x", at: 100, from: 0, to: 100 }]);
  assert.equal(useWindows.getState().guides.length, 1);
  assert.equal(items.get(LAYOUT_KEY), before);
  useWindows.getState().settle();
  assert.equal(useWindows.getState().guides.length, 0);
  assert.notEqual(items.get(LAYOUT_KEY), before);
  assert.equal(JSON.parse(items.get(LAYOUT_KEY)).places.swap.rect.x, moved.windows[0].rect.x);
});

test("a held window waits: «Close» in its frame does nothing until it is let go; the owner hears of a close", () => {
  reload();
  let closed = 0;
  const spec = { id: "swap", title: "Swap", render, held: true, onClose: () => (closed += 1) };
  openWindow(spec);
  useWindows.getState().dismiss("swap");
  assert.equal(layout().length, 1);
  assert.equal(closed, 0);
  openWindow({ ...spec, held: false });
  useWindows.getState().dismiss("swap");
  assert.equal(layout().length, 0);
  assert.equal(closed, 1);
  // closeWindow is the owner's own call: it closes even a held window and does not call back.
  openWindow(spec);
  closeWindow("swap");
  assert.equal(layout().length, 0);
  assert.equal(closed, 1);
});

test("updateWindow changes an open window's title and hold where it stands, and never opens a closed one", () => {
  reload();
  for (const spec of FOUR) openWindow(spec);
  const before = layout();
  updateWindow({ ...FOUR[0], title: "Chart · SOL", held: true });
  assert.deepEqual(layout(), before, "the chart stays at its depth and place");
  assert.equal(useWindows.getState().specs.chart.title, "Chart · SOL");
  // A held window: «Close» in its frame waits, and lets go once the hold is lifted.
  useWindows.getState().dismiss("chart");
  assert.ok(layout().some((p) => p.id === "chart"));
  updateWindow({ ...FOUR[0], held: false });
  useWindows.getState().dismiss("chart");
  assert.ok(!layout().some((p) => p.id === "chart"));
  updateWindow({ id: "money", title: "Money", render });
  assert.ok(!layout().some((p) => p.id === "money"));
  assert.equal(useWindows.getState().specs.money, undefined);
});
