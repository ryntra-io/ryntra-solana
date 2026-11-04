import { test } from "node:test";
import assert from "node:assert/strict";

import { areaOf, BAY, BAY_REACH, bayCap, bayRect, baysOf, CITY_SHARE, HEAD, stuck } from "./geometry.ts";
import {
  bothBaysIn,
  carryIn,
  closeIn,
  dockedIn,
  dockIn,
  dropAt,
  dropIn,
  emptyLayout,
  coverIn,
  coverLimit,
  firstPlace,
  framesIn,
  fullIn,
  gridIn,
  gridRoomIn,
  leanIn,
  liftIn,
  moveIn,
  openIn,
  placed,
  placeIn,
  popOutIn,
  raiseIn,
  resizeIn,
  seamsIn,
  tabIn,
  tabsOf,
  togetherIn,
  top,
} from "./layout.ts";
import { parseMemory, recall, remember, serializeMemory } from "./memory.ts";

// The bays of CITY-84 (helm §4): two sides of the workspace, the city in the middle, at least 40 % of it always in view.

const DESK = { width: 1440, height: 900 };
const right = (r) => r.x + r.width;

/** Opens windows the way the store does the first time: in a free bay, else as a tab of the bay in front. */
function open(layout, id, min) {
  return openIn(layout, { id, min }, firstPlace(layout));
}

function desk(...ids) {
  return ids.reduce((layout, id) => open(layout, id), emptyLayout(DESK));
}

test("the bays leave the city at least 40 % of every computer screen's width, wide or narrow", () => {
  for (let width = 900; width <= 3840; width += 7) {
    const area = areaOf({ width, height: 900 });
    const bays = baysOf(area);
    const cap = bayCap(area);
    assert.ok(cap * bays.length <= (1 - CITY_SHARE) * width + 1e-9, `${width}: ${bays.length} × ${cap}`);
    assert.ok(cap <= BAY.max, `${width}`);
    // From 1200 px both bays at their narrowest fit; below, the right one alone.
    assert.equal(bays.length, width >= 1200 ? 2 : 1, `${width}`);
    if (bays.length === 2) assert.ok(cap >= BAY.min, `${width}`);
    // The two bays never meet: the city stands between them.
    if (bays.length === 2) assert.ok(right(bayRect(area, "left")) < bayRect(area, "right").x, `${width}`);
  }
  // On the 1440 desk: 432 px a bay, the whole height of the workspace, against each side.
  const area = areaOf(DESK);
  assert.deepEqual(bayRect(area, "left"), { x: area.x, y: area.y, width: 432, height: area.height });
  assert.deepEqual(bayRect(area, "right"), { x: right(area) - 432, y: area.y, width: 432, height: area.height });
});

test("a window opens the first time in a free bay, the right one first; with both taken, as a tab of the bay in front", () => {
  const one = desk("spot");
  assert.equal(placed(one, "spot").bay, "right");
  assert.deepEqual(placed(one, "spot").rect, bayRect(one.area, "right"));
  const two = open(one, "money");
  assert.equal(placed(two, "money").bay, "left");
  assert.ok(bothBaysIn(two) && leanIn(two));
  const three = open(two, "predict");
  // The bay in front was the left one (money opened last): predict joins it, shown in front.
  assert.equal(placed(three, "predict").bay, "left");
  assert.equal(placed(three, "predict").stack, placed(three, "money").stack);
  assert.deepEqual(tabsOf(three, "predict").map((w) => w.id), ["money", "predict"]);
  assert.equal(top(three).id, "predict");
  assert.equal(framesIn(three).length, 2);
  // However many open, the city keeps its share: two frames, two bays.
  const many = ["chart", "exchange", "earn", "guard"].reduce((l, id) => open(l, id), three);
  assert.equal(framesIn(many).length, 2);
  for (const f of framesIn(many)) assert.ok(f.bay);
});

test("a narrow computer screen has one bay: the second window becomes its tab, and the wide screen gives both back", () => {
  const wide = desk("spot", "money");
  const narrow = carryIn(wide, { width: 1100, height: 800 });
  assert.deepEqual(baysOf(narrow.area), ["right"]);
  assert.equal(framesIn(narrow).length, 1);
  assert.equal(placed(narrow, "money").bay, "right");
  assert.equal(placed(narrow, "spot").stack, placed(narrow, "money").stack);
  assert.ok(!bothBaysIn(narrow));
  // The store carries from the layout the person set: the wide screen again has both bays.
  const back = carryIn(wide, DESK);
  assert.equal(back, wide);
  assert.equal(placed(carryIn(narrow, DESK), "money").bay, "right", "a carried layout is only what is drawn");
});

test("a bay stretches by its inner edge only, between its narrowest and its cap; the bay keeps the width given", () => {
  const layout = desk("spot", "money");
  const area = layout.area;
  const wider = resizeIn(layout, "money", "e", 300, 0);
  assert.equal(placed(wider.layout, "money").rect.width, bayCap(area), "never past the cap");
  const narrower = resizeIn(layout, "money", "e", -60, 0);
  assert.equal(placed(narrower.layout, "money").rect.width, Math.max(BAY.min, bayCap(area) - 60));
  assert.equal(narrower.layout.bays.left, placed(narrower.layout, "money").rect.width);
  assert.ok(narrower.guides.length === 1 && narrower.guides[0].axis === "x");
  const least = resizeIn(layout, "spot", "w", 900, 0);
  assert.equal(placed(least.layout, "spot").rect.width, BAY.min);
  assert.equal(right(placed(least.layout, "spot").rect), right(area), "the right bay keeps to its side");
  // Its outer edge, its top and its bottom stay where they are.
  for (const handle of ["w", "n", "s", "nw", "sw"]) assert.equal(resizeIn(layout, "money", handle, 80, 80).layout, layout, handle);
  // A smaller screen keeps the width given within its own cap.
  const small = carryIn(narrower.layout, { width: 1280, height: 800 });
  assert.equal(placed(small, "money").rect.width, Math.min(narrower.layout.bays.left, bayCap(small.area)));
});

test("tabs: a window dropped on another's head joins its frame; the tab shown is the one in front; pop out takes it out", () => {
  let layout = desk("spot", "money");
  layout = open(layout, "chart");
  // Floating, then dropped on the spot's head.
  layout = popOutIn(layout, "chart");
  assert.equal(placed(layout, "chart").bay, null);
  layout = tabIn(layout, "chart", "spot");
  assert.equal(placed(layout, "chart").bay, "right");
  assert.deepEqual(placed(layout, "chart").rect, placed(layout, "spot").rect);
  assert.equal(top(layout).id, "chart");
  // A tab tapped comes to the front of its frame; the frame keeps its place.
  layout = raiseIn(layout, "spot");
  assert.equal(top(layout).id, "spot");
  assert.deepEqual(placed(layout, "chart").rect, placed(layout, "spot").rect);
  assert.ok(dockedIn(layout, "spot"));
  // Pop out: out of the frame, a stack of its own, floating, sticking to nothing.
  const out = popOutIn(layout, "chart");
  assert.notEqual(placed(out, "chart").stack, placed(out, "spot").stack);
  assert.equal(placed(out, "chart").bay, null);
  assert.equal(placed(out, "spot").bay, "right");
  assert.ok(!dockedIn(out, "chart"));
  // Closing the tab in front shows the next one; closing every tab empties the bay.
  const closed = closeIn(layout, "spot");
  assert.equal(framesIn(closed).find((f) => f.bay === "right").id, "chart");
  assert.ok(!framesIn(closeIn(closed, "chart")).some((f) => f.bay === "right"));
  // A window joins its own frame never; a missing one never.
  assert.equal(tabIn(layout, "chart", "spot"), layout);
  assert.equal(tabIn(layout, "nothing", "spot"), layout);
});

test("a frame dragged by its head: lifted out of its bay, docked near the side, a tab over another head", () => {
  const layout = desk("spot", "money");
  const area = layout.area;
  const money = placed(layout, "money").rect;
  // Picked up from the left bay: the bay's width, about three quarters of the height, the pointer on the same spot.
  const at = { x: money.x + 100, y: money.y + 20 };
  const lifted = liftIn(layout, "money", at);
  const r = placed(lifted, "money").rect;
  assert.equal(placed(lifted, "money").bay, null);
  assert.equal(r.width, money.width);
  assert.equal(r.height, Math.round(area.height * 0.72));
  assert.equal(at.x - r.x, 100);
  assert.equal(at.y - r.y, 20);
  assert.ok(!bothBaysIn(lifted));
  // In the middle of the city it lands nowhere: it floats where it is let go.
  const moved = moveIn(lifted, "money", r, 300, 60).layout;
  assert.equal(dropAt(moved, "money", { x: 700, y: 400 }), null);
  // Near the left side: the left bay, lit along its whole height.
  const left = dropAt(moved, "money", { x: area.x + BAY_REACH - 2, y: 400 });
  assert.deepEqual(left, { kind: "bay", bay: "left", rect: bayRect(area, "left") });
  assert.equal(placed(dropIn(moved, "money", left), "money").bay, "left");
  // Over the spot's head: its tab.
  const spot = placed(moved, "spot").rect;
  const tab = dropAt(moved, "money", { x: spot.x + 60, y: spot.y + HEAD / 2 });
  assert.deepEqual(tab, { kind: "tab", id: "spot", rect: spot });
  const joined = dropIn(moved, "money", tab);
  assert.equal(placed(joined, "money").stack, placed(joined, "spot").stack);
  assert.equal(placed(joined, "money").bay, "right");
  // Below the head of a frame it is not a tab: the pointer is over its contents.
  assert.equal(dropAt(moved, "money", { x: spot.x + 60, y: spot.y + HEAD + 40 }), null);
  // Near the right side, with the spot already there: the right bay — the spot's frame takes it as a tab.
  const near = dropAt(moved, "money", { x: right(area) - 10, y: 600 });
  assert.equal(near.kind, "bay");
  const docked = dropIn(moved, "money", near);
  assert.equal(placed(docked, "money").stack, placed(docked, "spot").stack);
  assert.equal(framesIn(docked).length, 1);
});

test("a floating frame still sticks to the others and to the bays' edges; the seams and «Snap together» count floating frames", () => {
  let layout = desk("spot", "money");
  layout = popOutIn(open(layout, "chart"), "chart");
  layout = popOutIn(open(layout, "earn"), "earn");
  assert.ok(!togetherIn(layout));
  // Both bays taken: they already cover what the city leaves the windows — no room to snap into, nothing moves.
  assert.equal(gridRoomIn(layout), null);
  assert.equal(gridIn(layout), layout);
  // One bay: the floating frames snap together in the room beside it, the bay stays, the city keeps its share.
  const one = popOutIn(layout, "money");
  const room = gridRoomIn(one);
  const spot = placed(one, "spot").rect;
  assert.ok(room && room.x + room.width <= spot.x - 8 && room.width <= Math.floor(0.6 * 1440) - spot.width);
  const grid = gridIn(one);
  assert.equal(placed(grid, "spot").bay, "right");
  assert.ok(framesIn(grid).filter((f) => !f.bay).every((f) => f.rect.x >= room.x && f.rect.x + f.rect.width <= room.x + room.width));
  assert.ok(togetherIn(grid));
  assert.equal(seamsIn(grid).length > 0, true);
  assert.ok(coverIn(grid) <= coverLimit + 1e-9);
  // Two frames in the bays alone: nothing floats, nothing to snap, no seams drawn.
  const bays = desk("spot", "money");
  assert.ok(togetherIn(bays));
  assert.deepEqual(seamsIn(bays), []);
  // A floating frame dragged near the left bay's inner edge sticks a seam away from it.
  const free = popOutIn(open(bays, "chart"), "chart");
  const c = placed(free, "chart").rect;
  const money = placed(free, "money").rect;
  const near = moveIn(free, "chart", c, right(money) + 8 + 5 - c.x, 0).layout;
  assert.ok(stuck(placed(near, "chart").rect, money));
});

test("a new window never hides one a signature holds: with both bays taken it joins the other bay, or floats", () => {
  const layout = desk("spot", "money");
  // Money (the bay in front) waits on a signature: the new window joins the spot's frame instead.
  const place = firstPlace(layout, (id) => id === "money");
  assert.equal(place.tab, "spot");
  // Both held: no bay takes it — it floats, no larger than the city leaves the windows.
  assert.equal(firstPlace(layout, () => true), null);
  const floating = openIn(layout, { id: "chart", size: { width: 900, height: 700 } });
  assert.equal(placed(floating, "chart").bay, null);
  assert.ok(coverIn(floating) <= Math.max(coverLimit, coverIn(layout)) + 1e-9);
});

test("the city keeps at least 40 % of the screen under what the system arranges and what a hand stretches", () => {
  const area = areaOf(DESK);
  // The two bays at their widest cover under 60 % of the screen.
  const bays = desk("spot", "money");
  assert.ok(coverIn(bays) <= coverLimit);
  // A floating frame stretched by hand stops where the windows would cover more than 60 %.
  let one = popOutIn(desk("spot"), "spot");
  one = moveIn(one, "spot", placed(one, "spot").rect, 400 - placed(one, "spot").rect.x, 0).layout;
  const stretched = resizeIn(one, "spot", "se", 3000, 3000).layout;
  assert.ok(coverIn(stretched) <= coverLimit + 1e-9);
  assert.ok(placed(stretched, "spot").rect.width > placed(one, "spot").rect.width, "it still grew as far as it could");
  // Shrinking is never held back.
  const smaller = resizeIn(stretched, "spot", "se", -200, -200).layout;
  assert.ok(placed(smaller, "spot").rect.width < placed(stretched, "spot").rect.width);
  // A tab popped out of a full bay floats smaller if it must: the windows still leave the city its share.
  const tabs = open(open(bays, "chart"), "earn");
  const out = popOutIn(tabs, "earn");
  assert.equal(placed(out, "earn").bay, null);
  assert.ok(coverIn(out) <= Math.max(coverLimit, coverIn(tabs)) + 1e-9);
  // Only the whole screen, which the person chooses, is not counted against the city.
  assert.ok(coverIn(fullIn(bays, "spot")) <= coverLimit);
  assert.equal(coverIn(emptyLayout(DESK)), 0);
  void area;
});

test("the city is drawn lean behind windows: both bays taken, or one window on the whole screen", () => {
  assert.ok(!leanIn(desk("spot")));
  assert.ok(leanIn(desk("spot", "money")));
  assert.ok(leanIn(fullIn(desk("spot"), "spot")));
  assert.ok(!leanIn(popOutIn(desk("spot", "money"), "money")));
  assert.ok(!leanIn(emptyLayout(DESK)));
});

test("a layout places open windows again: into a bay, as a tab, or at a place, keeping the order they opened in", () => {
  let layout = desk("spot", "money", "chart");
  const seq = placed(layout, "chart").seq;
  layout = placeIn(layout, "chart", { rect: bayRect(layout.area, "right"), full: false, bay: "right" });
  assert.equal(placed(layout, "chart").bay, "right");
  assert.equal(placed(layout, "chart").stack, placed(layout, "spot").stack);
  assert.equal(placed(layout, "chart").seq, seq);
  const free = { x: 500, y: 200, width: 400, height: 300 };
  layout = placeIn(layout, "chart", { rect: free, full: false });
  assert.deepEqual(placed(layout, "chart").rect, free);
  assert.equal(placed(layout, "chart").bay, null);
  layout = placeIn(layout, "spot", { rect: free, full: false, tab: "chart" });
  assert.equal(placed(layout, "spot").stack, placed(layout, "chart").stack);
  assert.equal(placeIn(layout, "nothing", { rect: free, full: false }), layout);
  // Docking a floating frame into a free bay; into a bay this screen lacks, the one it has.
  const narrow = carryIn(desk("spot"), { width: 1000, height: 800 });
  const docked = dockIn(openIn(narrow, { id: "chart" }), "chart", "left");
  assert.equal(placed(docked, "chart").bay, "right");
});

test("the device remembers a window's bay: opened again it stands there, as the tab of whatever holds the bay now", () => {
  const layout = desk("spot", "money");
  const memory = parseMemory(serializeMemory(remember(null, layout)));
  assert.equal(memory.places.money.bay, "left");
  assert.equal(memory.places.spot.bay, "right");
  const r = recall(memory, "money", layout.area);
  assert.equal(r.bay, "left");
  const again = openIn(emptyLayout(DESK), { id: "money" }, r);
  assert.equal(placed(again, "money").bay, "left");
  // Something else stands in the left bay now: money joins it.
  const other = openIn(emptyLayout(DESK), { id: "predict" }, { rect: bayRect(layout.area, "left"), full: false, bay: "left" });
  const joined = openIn(other, { id: "money" }, r);
  assert.equal(placed(joined, "money").stack, placed(joined, "predict").stack);
  // Floating windows that shared a frame come back as tabs: they were remembered on the same place.
  let free = popOutIn(desk("spot", "money"), "money");
  free = tabIn(open(free, "chart"), "chart", "money");
  const kept = parseMemory(serializeMemory(remember(null, free)));
  const back = ["chart", "money"].reduce((l, id) => openIn(l, { id }, recall(kept, id, l.area)), emptyLayout(DESK));
  assert.equal(placed(back, "chart").stack, placed(back, "money").stack);
});
