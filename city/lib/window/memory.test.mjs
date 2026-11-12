import { test } from "node:test";
import assert from "node:assert/strict";

import { areaOf, stuck } from "./geometry.ts";
import { closeIn, emptyLayout, fullIn, gridIn, openIn, placed } from "./layout.ts";
import { LAYOUT_KEY, MEMORY_LIMIT, parseMemory, readMemory, recall, remember, serializeMemory, writeMemory } from "./memory.ts";

const DESK = { width: 1440, height: 860 };
const IDS = ["chart", "swap", "spot", "futures"];

function grid() {
  return gridIn(IDS.reduce((layout, id) => openIn(layout, { id }), emptyLayout(DESK)));
}

/** A browser's storage, with the failures a real one has. */
function storage({ refuse = false, missing = false } = {}) {
  const items = new Map();
  const store = {
    getItem: (key) => {
      if (refuse) throw new Error("SecurityError");
      return items.get(key) ?? null;
    },
    setItem: (key, value) => {
      if (refuse) throw new Error("QuotaExceededError");
      items.set(key, value);
    },
    items,
  };
  return () => (missing ? null : store);
}

test("the layout is remembered and comes back the same, window by window", () => {
  const layout = grid();
  const memory = parseMemory(serializeMemory(remember(null, layout)));
  assert.deepEqual(memory.area, layout.area);
  // Opened again one by one, in any order, each window stands where it stood: the grid comes back stuck.
  const again = ["futures", "swap", "chart", "spot"].reduce((l, id) => openIn(l, { id }, recall(memory, id, l.area)), emptyLayout(DESK));
  for (const id of IDS) assert.deepEqual(placed(again, id).rect, placed(layout, id).rect, id);
});

test("a closed window keeps its place for next time", () => {
  const layout = grid();
  const before = remember(null, layout);
  const after = remember(before, closeIn(layout, "swap"));
  assert.deepEqual(after.places.swap.rect, placed(layout, "swap").rect);
});

test("the window on the whole screen is remembered there, and only one", () => {
  const memory = remember(remember(null, fullIn(grid(), "swap")), fullIn(closeIn(grid(), "swap"), "chart"));
  assert.equal(memory.places.chart.full, true);
  assert.equal(memory.places.swap.full, false);
  assert.equal(recall(memory, "chart", memory.area).full, true);
  assert.equal(Object.values(memory.places).filter((p) => p.full).length, 1);
});

test("on another screen the remembered grid comes back carried onto it, still stuck, whole on the screen", () => {
  const memory = remember(null, grid());
  const small = { width: 1100, height: 700 };
  const area = areaOf(small);
  const again = IDS.reduce((l, id) => openIn(l, { id }, recall(memory, id, area)), emptyLayout(small));
  const rects = Object.fromEntries(again.windows.map((w) => [w.id, w.rect]));
  assert.ok(stuck(rects.chart, rects.swap) && stuck(rects.swap, rects.spot) && stuck(rects.spot, rects.futures));
  for (const w of again.windows) {
    assert.ok(w.rect.x >= area.x && w.rect.y >= area.y && w.rect.x + w.rect.width <= area.x + area.width && w.rect.y + w.rect.height <= area.y + area.height, w.id);
  }
  // A floating window is carried at its own size.
  const floating = remember(null, openIn(emptyLayout(DESK), { id: "swap", size: { width: 480, height: 360 } }));
  const r = recall(floating, "swap", area);
  assert.deepEqual([r.rect.width, r.rect.height, r.docked], [480, 360, false]);
});

test("what is not a remembered layout is not trusted: junk, other versions, bad places, too much", () => {
  for (const raw of [null, "", "{", "[]", "null", "42", '{"v":1,"area":{"x":0,"y":0,"width":10,"height":10},"places":{}}', '{"v":3,"area":{"x":0,"y":0,"width":10,"height":10},"places":{}}', '{"v":2,"area":{"x":0,"y":0,"width":0,"height":10},"places":{}}', '{"v":2,"area":{"x":0,"y":0,"width":10,"height":10},"places":[]}', "x".repeat(9000)]) {
    assert.equal(parseMemory(raw), null, String(raw).slice(0, 40));
  }
  const area = { x: 16, y: 72, width: 1408, height: 684 };
  const mixed = parseMemory(
    JSON.stringify({
      v: 2,
      area,
      places: {
        swap: { rect: { x: 16, y: 72, width: 500, height: 400 }, full: true },
        "bad id!": { rect: { x: 0, y: 0, width: 10, height: 10 } },
        nan: { rect: { x: "1", y: 0, width: 10, height: 10 } },
        neg: { rect: { x: 0, y: 0, width: -10, height: 10 } },
        none: null,
        spot: { rect: { x: 16, y: 72, width: 500, height: 400 }, full: "yes", extra: 1, bay: "middle" },
        chart: { rect: { x: 16, y: 72, width: 432, height: 684 }, full: false, bay: "left" },
      },
    }),
  );
  assert.deepEqual(Object.keys(mixed.places), ["swap", "spot", "chart"]);
  // A bay is one of the two; anything else is no bay at all.
  assert.equal(mixed.places.chart.bay, "left");
  assert.equal(mixed.places.spot.full, false);
  assert.deepEqual(mixed.places.spot, { rect: { x: 16, y: 72, width: 500, height: 400 }, full: false });
});

test("no more than the limit of places are kept, the newest", () => {
  let layout = emptyLayout(DESK);
  let memory = null;
  for (let i = 0; i < MEMORY_LIMIT + 6; i += 1) {
    layout = openIn(layout, { id: `w${i}` });
    memory = remember(memory, layout);
    layout = closeIn(layout, `w${i}`);
  }
  const ids = Object.keys(memory.places);
  assert.equal(ids.length, MEMORY_LIMIT);
  assert.equal(ids.at(-1), `w${MEMORY_LIMIT + 5}`);
  assert.ok(!ids.includes("w0"));
  assert.ok(serializeMemory(memory).length < 8000);
});

test("storage: written and read under one key; missing, refusing or broken storage means the first places again", () => {
  const ok = storage();
  const memory = remember(null, grid());
  writeMemory(ok, memory);
  assert.ok(ok().items.has(LAYOUT_KEY));
  assert.deepEqual(readMemory(ok), parseMemory(serializeMemory(memory)));
  for (const bad of [storage({ refuse: true }), storage({ missing: true }), () => { throw new Error("no window"); }]) {
    assert.equal(readMemory(bad), null);
    assert.doesNotThrow(() => writeMemory(bad, memory));
  }
  const junk = storage();
  junk().setItem(LAYOUT_KEY, "{oops");
  assert.equal(readMemory(junk), null);
});

/* CITY-242: Spot, Earn and «My tower» got sizes for a large desk. Every place is remembered, the system's own first
   place too — a device that ever opened Spot would keep the old small window for good. The system's old first place is
   not the person's; anything the person did to the window is. */
test("a window's old first place is forgotten once; a place the person set stays", () => {
  const screen = { width: 1440, height: 900 };
  const area = areaOf(screen);
  // Where the frame first put Spot before CITY-242: 980 wide, 85 % of the workspace's height, in the middle.
  const height = Math.round(area.height * 0.85);
  const first = { x: Math.round(area.x + (area.width - 980) / 2), y: Math.round(area.y + (area.height - height) / 2), width: 980, height };
  const memory = { area, places: { spot: { rect: first, full: false } } };
  assert.equal(recall(memory, "spot", area), null, "the old first place: the window opens at its new size");
  // The second new window of a visit stood a step down and right: the same.
  const second = { ...first, x: first.x + 32, y: first.y + 32 };
  assert.equal(recall({ area, places: { spot: { rect: second, full: false } } }, "spot", area), null);
  // Moved, stretched, on the whole screen, in a bay: the person's.
  for (const place of [
    { rect: { ...first, x: first.x - 120 }, full: false },
    { rect: { ...first, width: 1020 }, full: false },
    { rect: first, full: true },
    { rect: { x: area.x, y: area.y, width: 432, height: area.height }, full: false, bay: "left" },
  ]) {
    assert.ok(recall({ area, places: { spot: place } }, "spot", area), JSON.stringify(place));
  }
  // Another window at the same rectangle is not touched: only the windows whose first size changed.
  assert.ok(recall({ area, places: { swap: { rect: first, full: false } } }, "swap", area));
});

test("the old rule's first place of any window is not the person's: the Ring opens as tall as the workspace again", () => {
  const area = areaOf({ width: 1440, height: 900 });
  // The Ring asks for 980 × 760; the old rule stood it 85 % of the workspace's height in the middle.
  const height = Math.round(area.height * 0.85);
  const old = { x: Math.round(area.x + (area.width - 980) / 2), y: Math.round(area.y + (area.height - height) / 2), width: 980, height };
  const memory = { area, places: { ring: { rect: old, full: false } } };
  const asked = { size: { width: 980, height: 760 }, min: { width: 380, height: 560 } };
  assert.equal(recall(memory, "ring", area, asked), null);
  assert.ok(recall({ area, places: { ring: { rect: { ...old, y: old.y + 5 }, full: false } } }, "ring", area, asked), "moved by the person");
  // Without the window's ask nothing is guessed.
  assert.ok(recall(memory, "ring", area));
});

test("an old first place the person stuck another window to stays theirs; a window the old rule never cut keeps its place", () => {
  const area = areaOf({ width: 1440, height: 900 });
  const height = Math.round(area.height * 0.85);
  const first = { x: Math.round(area.x + (area.width - 980) / 2), y: Math.round(area.y + (area.height - height) / 2), width: 980, height };
  // A chart stuck under it by the person (an 8 px seam): Spot's place stays, so the two come back stuck.
  const chart = { x: first.x, y: first.y + first.height + 8, width: 400, height: 60 };
  assert.ok(recall({ area, places: { spot: { rect: first, full: false }, chart: { rect: chart, full: false } } }, "spot", area));
  // The swap asks for 440 × 620 — under 85 % of this workspace: its first place is the same today, and it is kept.
  const swap = { x: Math.round(area.x + (area.width - 440) / 2), y: Math.round(area.y + (area.height - 620) / 2), width: 440, height: 620 };
  assert.ok(recall({ area, places: { swap: { rect: swap, full: false } } }, "swap", area, { size: { width: 440, height: 620 }, min: { width: 360, height: 460 } }));
});
