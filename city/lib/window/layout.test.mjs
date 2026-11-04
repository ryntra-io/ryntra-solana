import { test } from "node:test";
import assert from "node:assert/strict";

import { areaOf, FLOOR, GAP, MIN, stuck } from "./geometry.ts";
import {
  carryIn,
  closeIn,
  dockedIn,
  emptyLayout,
  exitFullIn,
  fullIn,
  gridIn,
  gridRoomIn,
  moveIn,
  openIn,
  placed,
  popOutIn,
  raiseIn,
  resizeIn,
  seamsIn,
  togetherIn,
  top,
} from "./layout.ts";

const DESK = { width: 1440, height: 860 };
const right = (r) => r.x + r.width;
const bottom = (r) => r.y + r.height;
const inside = (r, area) => r.x >= area.x && r.y >= area.y && right(r) <= right(area) && bottom(r) <= bottom(area);

const FOUR = [
  { id: "chart", min: { width: 420, height: 300 } },
  { id: "swap", min: { width: 340, height: 200 } },
  { id: "spot", min: { width: 340, height: 200 } },
  { id: "futures", min: { width: 520, height: 180 } },
];

function four() {
  return FOUR.reduce((layout, ask) => openIn(layout, ask), emptyLayout(DESK));
}

test("windows open near the middle, each a step from the last, the newest in front", () => {
  const layout = four();
  assert.deepEqual(layout.windows.map((w) => w.id), ["chart", "swap", "spot", "futures"]);
  assert.equal(top(layout).id, "futures");
  for (const w of layout.windows) assert.ok(inside(w.rect, layout.area));
  assert.equal(placed(layout, "swap").rect.x - placed(layout, "chart").rect.x, 32);
  // The least a window asks for is kept, and the default fills in what it does not ask for.
  assert.deepEqual(placed(layout, "chart").min, { width: 420, height: 300 });
  assert.deepEqual(openIn(emptyLayout(DESK), { id: "x" }).windows[0].min, MIN);
  assert.deepEqual(openIn(emptyLayout(DESK), { id: "x", min: { width: 500 } }).windows[0].min, { width: 500, height: MIN.height });
});

test("opening an open window brings it to the front instead of a second one", () => {
  const layout = openIn(four(), { id: "chart" });
  assert.equal(layout.windows.length, 4);
  assert.equal(top(layout).id, "chart");
  assert.equal(raiseIn(layout, "chart"), layout);
  assert.equal(raiseIn(layout, "nothing"), layout);
});

test("closing takes the window away; closing the one on the whole screen gives the screen back", () => {
  const full = fullIn(four(), "swap");
  assert.equal(full.full, "swap");
  const closed = closeIn(full, "swap");
  assert.equal(closed.full, null);
  assert.deepEqual(closed.windows.map((w) => w.id), ["chart", "spot", "futures"]);
  assert.equal(closeIn(closed, "swap"), closed);
});

test("full screen: one window at a time, in front; back from it, the window is where it was", () => {
  const before = four();
  const full = fullIn(before, "chart");
  assert.equal(full.full, "chart");
  assert.equal(top(full).id, "chart");
  assert.deepEqual(placed(full, "chart").rect, placed(before, "chart").rect);
  // Another window on the whole screen takes the place of the first.
  assert.equal(fullIn(full, "spot").full, "spot");
  // Bringing another window to the front gives the screen up.
  assert.equal(raiseIn(full, "spot").full, null);
  const back = exitFullIn(full);
  assert.equal(back.full, null);
  assert.deepEqual(placed(back, "chart").rect, placed(before, "chart").rect);
  assert.equal(exitFullIn(back), back);
  assert.equal(fullIn(back, "nothing"), back);
});

test("the grid sticks every window together in the order they opened (macet M2), leaving the city its share", () => {
  const grid = gridIn(fullIn(four(), "spot"));
  assert.equal(grid.full, null);
  const [chart, swap, spot, futures] = ["chart", "swap", "spot", "futures"].map((id) => placed(grid, id).rect);
  // The room: the workspace's whole height, 60 % of the screen's width in its middle (CITY-84).
  const room = gridRoomIn(four());
  assert.deepEqual(room, { x: grid.area.x + (grid.area.width - 864) / 2, y: grid.area.y, width: 864, height: grid.area.height });
  assert.ok(chart.width > swap.width && swap.x === spot.x && futures.width === room.width && futures.x === room.x);
  assert.ok(stuck(chart, swap) && stuck(swap, spot) && stuck(spot, futures));
  for (const id of ["chart", "swap", "spot", "futures"]) assert.ok(dockedIn(grid, id));
  assert.ok(togetherIn(grid));
  assert.ok(!togetherIn(four()));
  assert.ok(togetherIn(emptyLayout(DESK)) && togetherIn(openIn(emptyLayout(DESK), { id: "one" })));
  assert.ok(!togetherIn(popOutIn(grid, "futures")));
  // The grid's seams, each once, for the grips.
  const seams = seamsIn(grid);
  assert.equal(seams.length, 5);
  assert.ok(seams.some((s) => s.axis === "x" && s.at === right(chart) + GAP / 2));
  assert.ok(seams.some((s) => s.axis === "y" && s.at === bottom(chart) + GAP / 2));
});

test("pop out: out of the grid the window floats free, in front, sticking to nothing", () => {
  const grid = gridIn(four());
  const out = popOutIn(grid, "swap");
  assert.equal(top(out).id, "swap");
  assert.ok(!dockedIn(out, "swap"));
  assert.ok(inside(placed(out, "swap").rect, out.area));
  // The others stay stuck where they were.
  for (const id of ["chart", "spot", "futures"]) assert.deepEqual(placed(out, id).rect, placed(grid, id).rect);
  // A window that already floats stays where it is.
  assert.deepEqual(placed(popOutIn(out, "swap"), "swap").rect, placed(out, "swap").rect);
});

test("pop out from the whole screen: the screen given back, the window floating free", () => {
  const full = fullIn(gridIn(four()), "chart");
  const out = popOutIn(full, "chart");
  assert.equal(out.full, null);
  assert.equal(top(out).id, "chart");
  assert.ok(!dockedIn(out, "chart"));
});

test("dragging a window out of the grid moves it alone; the seam it leaves stays with the others", () => {
  const grid = gridIn(four());
  const start = placed(grid, "spot").rect;
  const { layout } = moveIn(grid, "spot", start, -300, -200);
  assert.deepEqual(placed(layout, "spot").rect, { ...start, x: start.x - 300, y: start.y - 200 });
  for (const id of ["chart", "swap", "futures"]) assert.deepEqual(placed(layout, id).rect, placed(grid, id).rect);
  // Dragged back near its old place, it sticks back in.
  const back = moveIn(layout, "spot", placed(layout, "spot").rect, 300 - 5, 200 + 6);
  assert.deepEqual(placed(back.layout, "spot").rect, start);
  assert.ok(back.guides.length > 0);
});

test("stretching a seam in the grid keeps every window stuck and at least its least", () => {
  const grid = gridIn(four());
  for (const [id, handle, dx, dy] of [
    ["chart", "e", -2000, 0],
    ["chart", "e", 2000, 0],
    ["futures", "n", 0, -2000],
    ["futures", "n", 0, 2000],
    ["chart", "se", 900, 900],
    ["swap", "s", 0, 900],
    ["spot", "nw", -900, -900],
  ]) {
    const { layout } = resizeIn(grid, id, handle, dx, dy);
    const rects = Object.fromEntries(layout.windows.map((w) => [w.id, w.rect]));
    for (const w of layout.windows) {
      assert.ok(w.rect.width >= w.min.width && w.rect.height >= w.min.height, `${id} ${handle}: ${w.id}`);
      assert.ok(inside(w.rect, layout.area), `${id} ${handle}: ${w.id}`);
    }
    assert.ok(stuck(rects.chart, rects.swap) && stuck(rects.swap, rects.spot) && stuck(rects.chart, rects.futures), `${id} ${handle}`);
    assert.equal(seamsIn(layout).length, 5, `${id} ${handle}`);
  }
});

test("off the screen never: a smaller screen carries every window inside, the seams kept", () => {
  const grid = gridIn(four());
  const small = carryIn(grid, { width: 1100, height: 720 });
  assert.deepEqual(small.area, areaOf({ width: 1100, height: 720 }));
  const rects = Object.fromEntries(small.windows.map((w) => [w.id, w.rect]));
  for (const w of small.windows) assert.ok(inside(w.rect, small.area), w.id);
  assert.ok(stuck(rects.chart, rects.swap) && stuck(rects.swap, rects.spot) && stuck(rects.spot, rects.futures));
  // Smaller than the leasts allow (544 px of height for 200 + 200 + 180): stuck and inside first, never below the floor.
  for (const w of small.windows) assert.ok(w.rect.width >= FLOOR.width && w.rect.height >= FLOOR.height, w.id);
  // Back on the first screen the grid is as it was, give or take the rounding of a pixel.
  carryIn(small, DESK).windows.forEach((w, i) => {
    const was = grid.windows[i].rect;
    for (const k of ["x", "y", "width", "height"]) assert.ok(Math.abs(w.rect[k] - was[k]) <= 1, `${w.id}.${k}`);
  });
  assert.equal(carryIn(grid, DESK), grid);
  // A floating window keeps its size and stays whole when the screen narrows.
  const opened = openIn(emptyLayout(DESK), { id: "swap", size: { width: 500, height: 400 } });
  const one = moveIn(opened, "swap", placed(opened, "swap").rect, 300, 0).layout;
  assert.ok(!dockedIn(one, "swap"));
  const narrow = carryIn(one, { width: 960, height: 860 });
  assert.ok(inside(placed(narrow, "swap").rect, narrow.area));
  assert.deepEqual([placed(narrow, "swap").rect.width, placed(narrow, "swap").rect.height], [500, 400]);
});

test("a remembered place opens the window there, carried onto the workspace, and on the whole screen if it was", () => {
  const area = areaOf(DESK);
  const remembered = { rect: { x: area.x, y: area.y, width: 600, height: 400 }, full: false };
  const layout = openIn(emptyLayout(DESK), { id: "swap" }, remembered);
  assert.deepEqual(placed(layout, "swap").rect, remembered.rect);
  const full = openIn(emptyLayout(DESK), { id: "swap" }, { ...remembered, full: true });
  assert.equal(full.full, "swap");
  // A remembered place off this workspace is moved back into it.
  const off = openIn(emptyLayout(DESK), { id: "swap" }, { rect: { x: 5000, y: -300, width: 600, height: 400 }, full: false });
  assert.ok(inside(placed(off, "swap").rect, off.area));
});
