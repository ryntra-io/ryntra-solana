import { test } from "node:test";
import assert from "node:assert/strict";

import {
  areaOf,
  carryRect,
  docked,
  fitRect,
  FULL_MARGIN,
  fullRect,
  GAP,
  gridRects,
  INSET,
  MIN,
  moveRect,
  openRect,
  popOutRect,
  resizeBoxes,
  seamOf,
  SNAP,
  stuck,
  windowed,
} from "./geometry.ts";

const DESK = { width: 1440, height: 860 };
const AREA = areaOf(DESK);
const right = (r) => r.x + r.width;
const bottom = (r) => r.y + r.height;
const inside = (r, area) => r.x >= area.x && r.y >= area.y && right(r) <= right(area) && bottom(r) <= bottom(area);
const overlap = (a, b) => a.x < right(b) && b.x < right(a) && a.y < bottom(b) && b.y < bottom(a);
const box = (id, rect, min = MIN) => ({ id, rect, min });

/** Macet M2: the chart large at the top left, the swap and the spot stacked on the right, the futures along the bottom. */
function m2() {
  const [chart, swap, spot, futures] = gridRects(4, AREA);
  return [box("chart", chart), box("swap", swap), box("spot", spot), box("futures", futures)];
}

test("windows float from 900 px of width; below it, the phone's bottom sheet", () => {
  assert.equal(windowed({ width: 899, height: 800 }), false);
  assert.equal(windowed({ width: 900, height: 800 }), true);
  assert.equal(windowed({ width: 390, height: 844 }), false);
});

test("the workspace is the screen under the top bar and above the dock", () => {
  assert.deepEqual(AREA, { x: INSET.left, y: INSET.top, width: 1440 - INSET.left - INSET.right, height: 860 - INSET.top - INSET.bottom });
  assert.deepEqual(areaOf({ width: 10, height: 10 }), { x: INSET.left, y: INSET.top, width: 0, height: 0 });
});

test("the whole screen leaves the city a thin frame and covers the top bar and the dock", () => {
  const full = fullRect(DESK);
  assert.deepEqual(full, { x: FULL_MARGIN, y: FULL_MARGIN, width: DESK.width - 2 * FULL_MARGIN, height: DESK.height - 2 * FULL_MARGIN });
  // The top bar starts 12 px down and the dock ends 14 px up: both stand inside the window.
  assert.ok(full.y <= 12 && full.y + full.height >= DESK.height - 14);
  assert.ok(full.y < AREA.y && full.height > AREA.height && full.width > AREA.width);
  assert.deepEqual(fullRect({ width: 10, height: 10 }), { x: FULL_MARGIN, y: FULL_MARGIN, width: 0, height: 0 });
});

test("dragged past any edge of the workspace, a window stops at it, whole", () => {
  const start = { x: 400, y: 200, width: 500, height: 400 };
  assert.deepEqual(moveRect(start, -5000, -5000, [], AREA).rect, { ...start, x: AREA.x, y: AREA.y });
  const far = moveRect(start, 5000, 5000, [], AREA).rect;
  assert.equal(right(far), right(AREA));
  assert.equal(bottom(far), bottom(AREA));
  for (const [dx, dy] of [[-900, 300], [2000, -40], [37, 1200]]) assert.ok(inside(moveRect(start, dx, dy, [], AREA).rect, AREA));
});

test("a window bigger than the workspace shrinks into it, never below its least unless the screen is smaller still", () => {
  assert.deepEqual(fitRect({ x: -50, y: -50, width: 5000, height: 5000 }, AREA), AREA);
  assert.deepEqual(fitRect({ x: 100, y: 100, width: 10, height: 10 }, AREA), { x: 100, y: 100, width: MIN.width, height: MIN.height });
  const tiny = { x: 0, y: 0, width: 200, height: 100 };
  assert.deepEqual(fitRect({ x: 30, y: 30, width: 50, height: 50 }, tiny), tiny);
});

test("near the workspace's edge a window sticks to it, with a guide along that edge", () => {
  const start = { x: 400, y: 300, width: 500, height: 300 };
  const { rect, guides } = moveRect(start, -(400 - AREA.x) + SNAP - 2, 0, [], AREA);
  assert.equal(rect.x, AREA.x);
  assert.deepEqual(guides, [{ axis: "x", at: AREA.x, from: rect.y, to: bottom(rect) }]);
  // Out of the pull: no sticking, no guide.
  const free = moveRect(start, -(400 - AREA.x) + SNAP + 6, 0, [], AREA);
  assert.equal(free.rect.x, AREA.x + SNAP + 6);
  assert.deepEqual(free.guides, []);
});

test("near another window a window sticks a seam away from it, and the guide runs down the seam", () => {
  const other = { x: 100, y: 120, width: 400, height: 400 };
  const start = { x: 700, y: 140, width: 300, height: 300 };
  // Dropped 10 px short of the seam: it is pulled the rest of the way.
  const dx = right(other) + GAP + 10 - start.x;
  const { rect, guides } = moveRect(start, dx, 0, [other], AREA);
  assert.equal(rect.x, right(other) + GAP);
  assert.ok(stuck(rect, other));
  assert.ok(guides.some((g) => g.axis === "x" && g.at === right(other) + GAP / 2 && g.from === other.y && g.to === bottom(other)));
});

test("corners meet: a window sticks beside another and in line with its top at once", () => {
  const other = { x: 100, y: 120, width: 400, height: 400 };
  const start = { x: 700, y: 300, width: 300, height: 200 };
  const { rect, guides } = moveRect(start, right(other) + GAP + 6 - start.x, other.y - 9 - start.y, [other], AREA);
  assert.deepEqual([rect.x, rect.y], [right(other) + GAP, other.y]);
  assert.ok(guides.some((g) => g.axis === "x") && guides.some((g) => g.axis === "y" && g.at === other.y));
});

test("a window far across does not pull, however close its edge's line", () => {
  const other = { x: 100, y: 120, width: 400, height: 120 };
  const start = { x: 700, y: 560, width: 300, height: 150 };
  const { rect, guides } = moveRect(start, right(other) + GAP + 6 - start.x, 0, [other], AREA);
  assert.equal(rect.x, right(other) + GAP + 6);
  assert.deepEqual(guides, []);
});

test("the grid of four is macet M2 and fills the workspace exactly: seams between, no overlap, nothing outside", () => {
  const rects = gridRects(4, AREA);
  const [chart, swap, spot, futures] = rects;
  assert.ok(chart.width > swap.width && chart.height > swap.height);
  assert.equal(swap.x, spot.x);
  assert.equal(futures.width, AREA.width);
  assert.ok(stuck(chart, swap) && stuck(chart, spot) && stuck(swap, spot) && stuck(chart, futures) && stuck(spot, futures));
  for (const r of rects) assert.ok(inside(r, AREA));
  for (let i = 0; i < rects.length; i += 1) for (let j = i + 1; j < rects.length; j += 1) assert.ok(!overlap(rects[i], rects[j]));
  // Covered area plus seams is the whole workspace.
  const covered = rects.reduce((sum, r) => sum + r.width * r.height, 0);
  const seams = GAP * chart.height + GAP * (swap.width) + GAP * AREA.width;
  assert.equal(covered + seams, AREA.width * AREA.height);
  for (const n of [1, 2, 3, 5, 6, 7, 9]) {
    const g = gridRects(n, AREA);
    assert.equal(g.length, n);
    for (const r of g) assert.ok(inside(r, AREA), `${n}: ${JSON.stringify(r)}`);
    for (let i = 0; i < g.length; i += 1) for (let j = i + 1; j < g.length; j += 1) assert.ok(!overlap(g[i], g[j]), `${n}`);
  }
  assert.deepEqual(gridRects(0, AREA), []);
  assert.deepEqual(gridRects(1, AREA), [AREA]);
});

test("the seam behind an edge gathers every window along it, on both sides", () => {
  const boxes = m2();
  // The upright seam: the chart on its left, the swap and the spot on its right.
  assert.deepEqual(seamOf(boxes, "chart", "e"), { near: ["chart"], far: ["swap", "spot"] });
  assert.deepEqual(seamOf(boxes, "spot", "w"), { near: ["spot", "swap"], far: ["chart"] });
  // The long level seam: the chart and the spot above it, the futures below.
  const level = seamOf(boxes, "chart", "s");
  assert.deepEqual(level.near.sort(), ["chart", "spot"]);
  assert.deepEqual(level.far, ["futures"]);
  // The short level seam between the swap and the spot only.
  assert.deepEqual(seamOf(boxes, "swap", "s"), { near: ["swap"], far: ["spot"] });
  // The workspace's edge is no seam.
  assert.deepEqual(seamOf(boxes, "chart", "w"), { near: ["chart"], far: [] });
});

test("pulling a shared edge stretches one window and shrinks the other; the seam stays a seam", () => {
  const boxes = m2();
  const before = Object.fromEntries(boxes.map((b) => [b.id, b.rect]));
  const { rects, guides } = resizeBoxes(boxes, AREA, "chart", "e", -120, 0);
  const chart = rects.get("chart");
  const swap = rects.get("swap");
  const spot = rects.get("spot");
  assert.equal(chart.width, before.chart.width - 120);
  assert.equal(swap.x, before.swap.x - 120);
  assert.equal(swap.width, before.swap.width + 120);
  assert.equal(spot.width, before.spot.width + 120);
  assert.equal(right(swap), right(before.swap));
  assert.ok(stuck(chart, swap) && stuck(chart, spot));
  assert.ok(!rects.has("futures"));
  assert.ok(guides.some((g) => g.axis === "x" && g.at === right(chart) + GAP / 2));
});

test("the long level seam moves the chart, the spot and the futures together", () => {
  const boxes = m2();
  const before = Object.fromEntries(boxes.map((b) => [b.id, b.rect]));
  const { rects } = resizeBoxes(boxes, AREA, "futures", "n", -30, -30);
  assert.equal(rects.get("chart").height, before.chart.height - 30);
  assert.equal(rects.get("spot").height, before.spot.height - 30);
  assert.equal(rects.get("futures").y, before.futures.y - 30);
  assert.equal(rects.get("futures").height, before.futures.height + 30);
  assert.ok(stuck(rects.get("chart"), rects.get("futures")) && stuck(rects.get("spot"), rects.get("futures")));
  // Further up, the spot — the shorter window above the seam — stops the seam at its least.
  const far = resizeBoxes(boxes, AREA, "futures", "n", 0, -200).rects;
  assert.equal(far.get("spot").height, MIN.height);
  assert.equal(far.get("chart").height, before.chart.height - (before.spot.height - MIN.height));
  // An edge handle pulls only across its own axis.
  assert.equal(rects.get("futures").x, before.futures.x);
  assert.ok(!rects.has("swap"));
});

test("the corner where four windows meet pulls both seams at once", () => {
  const boxes = m2();
  const before = Object.fromEntries(boxes.map((b) => [b.id, b.rect]));
  const { rects } = resizeBoxes(boxes, AREA, "chart", "se", 80, 40);
  assert.equal(rects.get("chart").width, before.chart.width + 80);
  assert.equal(rects.get("chart").height, before.chart.height + 40);
  assert.equal(rects.get("spot").x, before.spot.x + 80);
  assert.equal(rects.get("spot").height, before.spot.height + 40);
  assert.equal(rects.get("futures").y, before.futures.y + 40);
  assert.equal(rects.get("swap").x, before.swap.x + 80);
});

test("no window on either side of a seam goes below its least", () => {
  const boxes = m2().map((b) => (b.id === "swap" ? { ...b, min: { width: 360, height: 200 } } : b));
  const before = Object.fromEntries(boxes.map((b) => [b.id, b.rect]));
  // Far to the right: the swap and the spot stop at the swap's least.
  const wide = resizeBoxes(boxes, AREA, "chart", "e", 5000, 0).rects;
  assert.equal(wide.get("swap").width, 360);
  assert.equal(right(wide.get("swap")), right(before.swap));
  // Far to the left: the chart stops at its own least.
  const narrow = resizeBoxes(boxes, AREA, "chart", "e", -5000, 0).rects;
  assert.equal(narrow.get("chart").width, MIN.width);
  // Up and down the long seam: the futures and the windows above it each keep their least.
  assert.equal(resizeBoxes(boxes, AREA, "futures", "n", 0, 5000).rects.get("futures").height, MIN.height);
  const up = resizeBoxes(boxes, AREA, "futures", "n", 0, -5000).rects;
  assert.equal(Math.min(up.get("chart").height, up.get("spot").height), MIN.height);
});

test("a free window stretches by any edge and corner within its least and the workspace", () => {
  const start = { x: 400, y: 200, width: 500, height: 400 };
  const one = [box("w", start)];
  assert.deepEqual(resizeBoxes(one, AREA, "w", "se", 60, 40).rects.get("w"), { x: 400, y: 200, width: 560, height: 440 });
  const nw = resizeBoxes(one, AREA, "w", "nw", -100, -50).rects.get("w");
  assert.deepEqual(nw, { x: 300, y: 150, width: 600, height: 450 });
  assert.equal(resizeBoxes(one, AREA, "w", "w", 5000, 0).rects.get("w").width, MIN.width);
  // Pulled past the workspace's edge, it stops at it.
  const big = resizeBoxes(one, AREA, "w", "ne", 5000, -5000).rects.get("w");
  assert.equal(right(big), right(AREA));
  assert.equal(big.y, AREA.y);
  assert.ok(inside(big, AREA));
  for (const handle of ["n", "s", "e", "w", "ne", "nw", "se", "sw"]) {
    for (const [dx, dy] of [[-3000, -3000], [3000, 3000], [-3000, 3000], [3000, -3000]]) {
      const r = resizeBoxes(one, AREA, "w", handle, dx, dy).rects.get("w");
      assert.ok(inside(r, AREA), `${handle} ${dx} ${dy}`);
      assert.ok(r.width >= MIN.width && r.height >= MIN.height, `${handle} ${dx} ${dy}`);
    }
  }
});

test("a free edge stretched near another window sticks to it", () => {
  const other = box("other", { x: 900, y: 200, width: 300, height: 300 });
  const start = box("w", { x: 300, y: 220, width: 500, height: 300 });
  const { rects, guides } = resizeBoxes([start, other], AREA, "w", "e", other.rect.x - GAP - right(start.rect) - 9, 0);
  assert.equal(right(rects.get("w")), other.rect.x - GAP);
  assert.ok(stuck(rects.get("w"), other.rect));
  assert.ok(!rects.has("other"));
  assert.ok(guides.length > 0);
});

test("docked: sticking to another window or to the workspace's edge; a popped-out window sticks to nothing", () => {
  const [chart, swap, spot, futures] = gridRects(4, AREA);
  assert.ok(docked(swap, [chart, spot, futures], AREA));
  assert.ok(!docked({ x: 300, y: 200, width: 300, height: 200 }, [chart], AREA) || overlap({ x: 300, y: 200, width: 300, height: 200 }, chart));
  const out = popOutRect(swap, [chart, spot, futures], AREA);
  assert.ok(!docked(out, [chart, spot, futures], AREA));
  assert.ok(inside(out, AREA));
  assert.ok(out.width >= MIN.width && out.height >= MIN.height);
  assert.ok(out.width <= swap.width);
});

test("a remembered place is carried onto another workspace: edges at its edge stay there, seams stay seams", () => {
  const rects = gridRects(4, AREA);
  for (const to of [areaOf({ width: 1024, height: 700 }), areaOf({ width: 2560, height: 1440 }), areaOf({ width: 1441, height: 861 })]) {
    const carried = rects.map((r) => carryRect(r, AREA, to));
    const [chart, swap, spot, futures] = carried;
    assert.ok(stuck(chart, swap) && stuck(chart, spot) && stuck(swap, spot) && stuck(chart, futures) && stuck(spot, futures), JSON.stringify(to));
    assert.equal(chart.x, to.x);
    assert.equal(chart.y, to.y);
    assert.equal(right(swap), right(to));
    assert.equal(bottom(futures), bottom(to));
    for (const r of carried) assert.ok(inside(r, to));
  }
  const same = rects.map((r) => carryRect(r, AREA, AREA));
  assert.deepEqual(same, rects);
});

test("new windows open near the middle, each a step from the last, whole in the workspace", () => {
  const first = openRect({ width: 560, height: 440 }, MIN, AREA, 0);
  const second = openRect({ width: 560, height: 440 }, MIN, AREA, 1);
  assert.equal(second.x - first.x, 32);
  assert.equal(second.y - first.y, 32);
  assert.ok(inside(first, AREA) && inside(second, AREA));
  const huge = openRect({ width: 5000, height: 5000 }, MIN, AREA, 0);
  assert.ok(inside(huge, AREA) && huge.width < AREA.width);
  const small = openRect({ width: 10, height: 10 }, { width: 360, height: 300 }, AREA, 0);
  assert.deepEqual([small.width, small.height], [360, 300]);
});
