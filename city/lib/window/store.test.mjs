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

test("layout('grid') sticks the open frames together, and the device remembers it across a reload", () => {
  reload();
  for (const spec of FOUR) openWindow(spec);
  const grid = Object.fromEntries(layout("grid").map((p) => [p.id, p.rect]));
  // The first two stood in the bays; the next two joined the bay in front as its tabs (CITY-84). With both bays taken
  // the grid has no room the city can spare: the bays stay as they are.
  const area = useWindows.getState().layout.area;
  assert.equal(grid.chart.x + grid.chart.width, area.x + area.width);
  assert.equal(grid.swap.x, area.x);
  assert.deepEqual(grid.spot, grid.swap);
  assert.deepEqual(grid.futures, grid.swap);
  void stuck;
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

// ---------- CITY-84: the bays, the tray and the layouts through the store ----------

const { DESKS_KEY } = await import("./desks.ts");
const WALLET = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const OTHER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const spec = (id, extra = {}) => ({ id, title: id, render, ...extra });
/** A first visit: nothing remembered on the device. */
function fresh() {
  items.clear();
  reload();
}

test("the first windows stand in the bays; a held window never folds; folded, it closes and its chip opens it again in place", () => {
  fresh();
  let closed = 0;
  openWindow(spec("spot", { onClose: () => (closed += 1) }));
  openWindow(spec("money", { held: true }));
  const places = Object.fromEntries(useWindows.getState().layout.windows.map((w) => [w.id, w.bay]));
  assert.deepEqual(places, { spot: "right", money: "left" });
  useWindows.getState().fold("money", {});
  assert.ok(useWindows.getState().layout.windows.some((w) => w.id === "money"), "a signature keeps it in sight");
  assert.deepEqual(useWindows.getState().chips, []);
  // Folded: closed as its own «Close» closes it — the owner hears of it — and its chip keeps what it showed.
  useWindows.getState().fold("spot", { tower: "So11111111111111111111111111111111111111112" });
  assert.ok(!useWindows.getState().layout.windows.some((w) => w.id === "spot"));
  assert.equal(closed, 1);
  assert.deepEqual(useWindows.getState().chips.map((c) => [c.id, c.title, c.params.tower]), [["spot", "spot", "So11111111111111111111111111111111111111112"]]);
  // The layout in use is not changed by a fold, and a chip goes when its window opens — however it was asked for.
  openWindow(spec("spot"));
  assert.deepEqual(useWindows.getState().chips, []);
  assert.equal(useWindows.getState().layout.windows.find((w) => w.id === "spot").bay, "right", "where it stood");
  useWindows.getState().fold("spot", {});
  useWindows.getState().dropChip("spot");
  assert.deepEqual(useWindows.getState().chips, []);
  useWindows.getState().fold("nothing", {});
  assert.deepEqual(useWindows.getState().chips, []);
});

test("a drag let go over a place to land docks the frame or makes it a tab; over nothing it settles where it is", () => {
  fresh();
  openWindow(spec("spot"));
  openWindow(spec("money"));
  const st = useWindows.getState();
  const right = st.layout.windows.find((w) => w.id === "spot").rect;
  useWindows.getState().drop("money", { kind: "tab", id: "spot", rect: right });
  const after = useWindows.getState().layout;
  assert.equal(after.windows.find((w) => w.id === "money").stack, after.windows.find((w) => w.id === "spot").stack);
  assert.equal(useWindows.getState().landing, null);
  assert.equal(useWindows.getState().moving, false);
  // A tab that cannot land (onto its own frame) settles instead, and is remembered.
  const before = items.get(LAYOUT_KEY);
  useWindows.getState().drag(after, [], { kind: "tab", id: "spot", rect: right });
  assert.equal(useWindows.getState().moving, true);
  useWindows.getState().drop("money", { kind: "tab", id: "spot", rect: right });
  assert.equal(useWindows.getState().moving, false);
  assert.ok(items.get(LAYOUT_KEY) !== undefined && before !== undefined);
});

test("a preset puts its windows in their bays: the open ones move, the others are planned for their owners, the rest close", () => {
  fresh();
  const closed = [];
  openWindow(spec("chart", { onClose: () => closed.push("chart") }));
  openWindow(spec("exchange", { held: true, onClose: () => closed.push("exchange") }));
  openWindow(spec("money", { onClose: () => closed.push("money") }));
  const { later, wanted } = useWindows.getState().applyDesk("trader", () => true);
  assert.deepEqual([...wanted].sort(), ["money", "spot"]);
  // Money is in Trader: it moves to the left bay. The chart is not: it closes as its «Close» would. The held Exchange stays.
  assert.deepEqual(closed, ["chart"]);
  const now = useWindows.getState().layout;
  assert.deepEqual(now.windows.map((w) => w.id).sort(), ["exchange", "money"]);
  assert.equal(now.windows.find((w) => w.id === "money").bay, "left");
  // The trade card is still to open: its owner opens it and it stands where planned.
  assert.deepEqual(later.map((p) => p.id), ["spot"]);
  openWindow(spec("spot"));
  assert.equal(useWindows.getState().layout.windows.find((w) => w.id === "spot").bay, "right");
  assert.equal(useWindows.getState().plan.spot, undefined, "a plan is used once");
  assert.equal(useWindows.getState().desks.active, "trader");
  // A preset whose windows cannot open here opens nothing new.
  assert.deepEqual(useWindows.getState().applyDesk("futures", (id) => id !== "exchange" && id !== "chart").later, []);
});

test("the person's layouts: an empty place keeps the windows as they stand; the one in use keeps every change; per wallet", () => {
  fresh();
  useWindows.getState().setOwner(WALLET);
  openWindow(spec("spot"));
  openWindow(spec("chart", { detach: { tower: "So11111111111111111111111111111111111111112" } }));
  useWindows.getState().keepDesk(0);
  let own = useWindows.getState().desks;
  assert.equal(own.active, 0);
  assert.deepEqual(own.slots[0].windows.map((w) => w.id).sort(), ["chart", "spot"]);
  assert.deepEqual(own.slots[0].windows.find((w) => w.id === "chart").params, { tower: "So11111111111111111111111111111111111111112" });
  // A change the person makes is kept in the layout in use, by itself.
  openWindow(spec("money"));
  own = useWindows.getState().desks;
  assert.deepEqual(own.slots[0].windows.map((w) => w.id).sort(), ["chart", "money", "spot"]);
  assert.ok(JSON.parse(items.get(DESKS_KEY)).owners[WALLET]);
  // Another wallet has its own four: none of these.
  useWindows.getState().setOwner(OTHER);
  assert.equal(useWindows.getState().desks.slots[0], null);
  openWindow(spec("predict"));
  assert.equal(useWindows.getState().desks.slots[0], null, "no place in use, nothing kept");
  // Back to the first wallet after a reload: its layout is there, not in use — the first window opened leaves it as it
  // was — and a tap puts the windows back.
  reload();
  useWindows.getState().setOwner(WALLET);
  assert.equal(useWindows.getState().desks.active, null);
  openWindow(spec("earn", { onClose: () => {} }));
  assert.deepEqual(useWindows.getState().desks.slots[0].windows.map((w) => w.id).sort(), ["chart", "money", "spot"]);
  const { later } = useWindows.getState().applyDesk(0, () => true);
  assert.deepEqual(later.map((p) => p.id).sort(), ["chart", "money", "spot"]);
  assert.ok(!useWindows.getState().layout.windows.some((w) => w.id === "earn"), "a window the layout does not have closes");
  // Forgotten: the place is empty and no longer in use.
  useWindows.getState().clearDesk(0);
  assert.equal(useWindows.getState().desks.slots[0], null);
  assert.equal(useWindows.getState().desks.active, null);
  // An empty place tapped with nothing on the screen is put in use; the windows opened next fill it.
  useWindows.getState().keepDesk(2);
  assert.equal(useWindows.getState().desks.slots[2], null);
  openWindow(spec("chart"));
  assert.deepEqual(useWindows.getState().desks.slots[2].windows.map((w) => w.id), ["chart"]);
});

test("a window remembered in a bay whose frame waits on a signature stands elsewhere, never as a tab hiding it", () => {
  fresh();
  openWindow(spec("spot"));
  openWindow(spec("money"));
  // Money is remembered in the left bay; then the left bay is the spot card's, held by a signature.
  useWindows.getState().dismiss("money");
  useWindows.getState().drop("spot", { kind: "bay", bay: "left", rect: useWindows.getState().layout.windows[0].rect });
  openWindow(spec("spot", { held: true }));
  openWindow(spec("money"));
  const now = useWindows.getState().layout;
  const spot = now.windows.find((w) => w.id === "spot");
  const money = now.windows.find((w) => w.id === "money");
  assert.equal(spot.bay, "left");
  assert.notEqual(money.stack, spot.stack, "the held card stays in sight");
  assert.equal(money.bay, "right");
});

test("the layout in use keeps what a run closed through its owner, and lets go what the person closed", () => {
  fresh();
  useWindows.getState().setOwner(WALLET);
  openWindow(spec("spot"));
  openWindow(spec("money"));
  openWindow(spec("chart", { onClose: () => {} }));
  useWindows.getState().keepDesk(1);
  // A run: the owners close the chart and Money; after it, Money stands again — the chart is still in the layout.
  closeWindow("chart");
  closeWindow("money");
  openWindow(spec("money"));
  assert.deepEqual(useWindows.getState().desks.slots[1].windows.map((w) => w.id).sort(), ["chart", "money", "spot"]);
  // Folding is not closing it either.
  useWindows.getState().fold("money", {});
  openWindow(spec("predict"));
  assert.deepEqual(useWindows.getState().desks.slots[1].windows.map((w) => w.id).sort(), ["chart", "money", "predict", "spot"]);
  // «Close» in the frame is the person's: the window leaves the layout.
  useWindows.getState().dismiss("predict");
  assert.deepEqual(useWindows.getState().desks.slots[1].windows.map((w) => w.id).sort(), ["chart", "money", "spot"]);
});
