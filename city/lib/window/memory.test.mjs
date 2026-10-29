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
  for (const raw of [null, "", "{", "[]", "null", "42", '{"v":2,"area":{"x":0,"y":0,"width":10,"height":10},"places":{}}', '{"v":1,"area":{"x":0,"y":0,"width":0,"height":10},"places":{}}', '{"v":1,"area":{"x":0,"y":0,"width":10,"height":10},"places":[]}', "x".repeat(9000)]) {
    assert.equal(parseMemory(raw), null, String(raw).slice(0, 40));
  }
  const area = { x: 16, y: 72, width: 1408, height: 684 };
  const mixed = parseMemory(
    JSON.stringify({
      v: 1,
      area,
      places: {
        swap: { rect: { x: 16, y: 72, width: 500, height: 400 }, full: true },
        "bad id!": { rect: { x: 0, y: 0, width: 10, height: 10 } },
        nan: { rect: { x: "1", y: 0, width: 10, height: 10 } },
        neg: { rect: { x: 0, y: 0, width: -10, height: 10 } },
        none: null,
        spot: { rect: { x: 16, y: 72, width: 500, height: 400 }, full: "yes", extra: 1 },
      },
    }),
  );
  assert.deepEqual(Object.keys(mixed.places), ["swap", "spot"]);
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
