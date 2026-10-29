// Run from repo root: node --test lib/predictions/market-clean.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { atStart, reconcile, standardLayout, untouched } from "@ryntra/core/ui";

import { CLEAN_PANELS, MARKET_PANELS, READY_LAYOUTS, arrangedByHand, chooseKept, cleanMarketLayout, isCleanStandard, keptUntouched, mirrorDock, readyDock, ticketSide } from "./market-layout.ts";

const ALL = MARKET_PANELS.map((panel) => panel.id);
const SPECS = MARKET_PANELS.map((panel) => ({ id: panel.id, span: panel.span, ...(panel.kind ? { kind: panel.kind } : {}) }));

/** The order each ready layout of before kept its blocks in (a phone stacked them so). */
const ORDER = {
  standard: ["ticket", "ryntra", "chart", "outcomes", "rules", "map", "book", "prices", "news"],
  analytics: ["ticket", "chart", "rules", "map", "news", "ryntra", "outcomes", "prices", "book"],
  monitoring: ["ticket", "chart", "book", "prices", "news", "outcomes", "ryntra", "rules", "map"],
};

/** The panels of each group, walking the grid left to right, top to bottom. */
function leaves(node, out = []) {
  if (node.type === "leaf") out.push(node.data.views);
  else for (const child of node.data) leaves(child, out);
  return out;
}

/** A layout as the page kept it before «Стандарт»: every panel shown, the ready layout's arrangement. */
const kept = (ready, side, extra = {}) => ({
  v: 1,
  preset: "dense",
  blocks: ORDER[ready].map((id) => ({ id, span: MARKET_PANELS.find((spec) => spec.id === id).span, hidden: false })),
  updatedAt: 42,
  dock: readyDock(ready, ALL, side),
  ...extra,
});

/** Every split's sizes times `k`, rounded — the same arrangement written by a window of another size. */
function scaled(dock, k) {
  const walk = (node) => ({ ...node, size: Math.round(node.size * k), ...(node.type === "branch" ? { data: node.data.map(walk) } : {}) });
  return { ...dock, grid: { ...dock.grid, width: Math.round(dock.grid.width * k), height: Math.round(dock.grid.height * k), root: walk(dock.grid.root) } };
}

test("«Стандарт»: the chart and the ticket, nothing else shown; every other panel kept in its place for when it comes back", () => {
  const layout = cleanMarketLayout("right", 7);
  assert.equal(layout.preset, "clean");
  assert.equal(layout.rev, 1);
  assert.equal(layout.updatedAt, 7);
  assert.deepEqual(layout.blocks.map((block) => block.id), ALL);
  assert.deepEqual(layout.blocks.filter((block) => !block.hidden).map((block) => block.id).sort(), [...CLEAN_PANELS].sort());
  // The chart beside the ticket, the ticket in the narrower column on the right.
  assert.equal(layout.dock.grid.orientation, "HORIZONTAL");
  assert.deepEqual(leaves(layout.dock.grid.root), [["chart"], ["ticket"]]);
  const [chart, ticket] = layout.dock.grid.root.data.map((child) => child.size);
  assert.equal(chart > ticket * 2, true);
  assert.deepEqual(Object.keys(layout.dock.panels).sort(), ["chart", "ticket"]);
  assert.equal(layout.dock.activeGroup, "g-chart");
});

test("«Стандарт» on the left is the same mirrored", () => {
  const left = cleanMarketLayout("left");
  assert.deepEqual(leaves(left.dock.grid.root), [["ticket"], ["chart"]]);
  assert.deepEqual(left.dock, mirrorDock(cleanMarketLayout("right").dock));
});

test("the page's «Стандарт» shows what the core's «Стандарт» shows: the chart and the ticket by their kinds", () => {
  const core = standardLayout(SPECS);
  assert.deepEqual(reconcile(cleanMarketLayout("right"), SPECS).blocks, core.blocks);
  // Drawn as it starts: «Повернути стандарт» has nothing to bring back — at any time, but not on the other side.
  assert.equal(atStart(cleanMarketLayout("right", 99), SPECS, cleanMarketLayout("right")), true);
  assert.equal(atStart(cleanMarketLayout("left", 99), SPECS, cleanMarketLayout("right")), false);
  // A panel brought back is a change of the person's: back to «Стандарт» in one act.
  const withRules = { ...cleanMarketLayout("right", 5), blocks: cleanMarketLayout("right").blocks.map((block) => (block.id === "rules" ? { ...block, hidden: false } : block)) };
  assert.equal(atStart(withRules, SPECS, cleanMarketLayout("right")), false);
  // Kept under today's rule: the core never moves it again.
  assert.equal(untouched(cleanMarketLayout("right", 5), SPECS), false);
});

test("a ready layout of before, never arranged by hand, moves to «Стандарт» once — any of the three, on either side", () => {
  for (const ready of READY_LAYOUTS) {
    for (const side of ["right", "left"]) {
      assert.equal(keptUntouched(kept(ready, side)), true, `${ready} on the ${side}`);
      // The same arrangement written by a window of another size.
      assert.equal(keptUntouched(kept(ready, side, { dock: scaled(readyDock(ready, ALL, side), 1.37) })), true, `${ready} on the ${side}, scaled`);
      // Another tab in front of its group is no arrangement of the person's.
      const dock = readyDock(ready, ALL, side);
      const front = JSON.parse(JSON.stringify(dock).replace('"activeView":"outcomes"', '"activeView":"news"'));
      assert.equal(keptUntouched(kept(ready, side, { dock: front })), true);
    }
  }
  // A copy from before arrangements were kept, in the order it opened in.
  const { dock: _dock, ...plain } = kept("standard", "right");
  assert.equal(keptUntouched(plain), true);
});

test("a layout the person arranged stays theirs", () => {
  const base = kept("standard", "right");
  // A border moved.
  const dock = JSON.parse(JSON.stringify(base.dock));
  dock.grid.root.data[0].size += 180;
  dock.grid.root.data[1].size -= 180;
  assert.equal(keptUntouched({ ...base, dock }), false);
  // A panel put away.
  assert.equal(keptUntouched({ ...base, blocks: base.blocks.map((block) => (block.id === "ryntra" ? { ...block, hidden: true } : block)) }), false);
  // The blocks reordered on a phone.
  assert.equal(keptUntouched({ ...base, blocks: [...base.blocks].reverse() }), false);
  const { dock: _dock, ...plain } = base;
  assert.equal(keptUntouched({ ...plain, blocks: [...plain.blocks].reverse() }), false);
  // One ready layout's arrangement under another's order of blocks: arranged by hand.
  assert.equal(keptUntouched({ ...kept("analytics", "right"), dock: readyDock("monitoring", ALL, "right") }), false);
  // A tab moved into another group.
  const moved = JSON.parse(JSON.stringify(base.dock).replace('["outcomes","rules","map","book","prices","news"]', '["outcomes","rules","map","book","prices"]').replace('["ryntra"]', '["ryntra","news"]'));
  assert.equal(keptUntouched({ ...base, dock: moved }), false);
});

test("anything kept under today's rule, or not a ready layout at all, is never moved", () => {
  assert.equal(keptUntouched(cleanMarketLayout("right", 5)), false);
  assert.equal(keptUntouched({ ...kept("standard", "right"), rev: 1 }), false);
  assert.equal(keptUntouched({ ...kept("standard", "right"), preset: "trading" }), false);
  assert.equal(keptUntouched({ ...kept("standard", "right"), before: kept("analytics", "right") }), false);
  assert.equal(keptUntouched({ ...kept("standard", "right"), dock: { grid: { root: "x" } } }), false);
  assert.equal(keptUntouched({ ...kept("standard", "right"), blocks: kept("standard", "right").blocks.slice(1) }), false);
});

test("an arrangement the library wrote with its root turned — one split holding the whole — is still told apart by its shape", () => {
  const base = kept("monitoring", "left");
  const turned = { ...base.dock, grid: { ...base.dock.grid, orientation: "VERTICAL", root: { type: "branch", size: base.dock.grid.width, data: [base.dock.grid.root] } } };
  assert.equal(keptUntouched({ ...base, dock: turned }), true);
  // The same columns one under another is another arrangement.
  const stacked = { ...base.dock, grid: { ...base.dock.grid, orientation: "VERTICAL" } };
  assert.equal(keptUntouched({ ...base, dock: stacked }), false);
});

/** A layout the person arranged: «Стандарт» with the rules brought back beside the chart, dated `at`. */
const arranged = (side, at) => {
  const clean = cleanMarketLayout(side, at);
  const dock = readyDock("analytics", ["chart", "rules", "ticket"], side);
  return { ...clean, blocks: clean.blocks.map((block) => (block.id === "rules" ? { ...block, hidden: false } : block)), dock };
};

test("«Стандарт» on the side chosen, or kept before the side was chosen, is nothing of the person's: the page opens on the side chosen now", () => {
  for (const side of ["right", "left"]) {
    const other = side === "right" ? "left" : "right";
    assert.equal(isCleanStandard(cleanMarketLayout(side, 9)), true);
    assert.equal(isCleanStandard(cleanMarketLayout(side, 9), side), true);
    assert.equal(isCleanStandard(cleanMarketLayout(side, 9), other), false);
    assert.equal(arrangedByHand(cleanMarketLayout(side, 9)), false);
    assert.equal(chooseKept(cleanMarketLayout(side, 9), [], side, 100), null);
    assert.equal(chooseKept(cleanMarketLayout(side, 9), [], other, 100), null);
    // The ticket dragged across after the side was chosen: where the person put it.
    const dragged = cleanMarketLayout(side, 200);
    assert.equal(chooseKept(dragged, [arranged(other, 300)], other, 100), dragged);
  }
  // Without its arrangement (a link's), too; with a panel brought back — the person's.
  const { dock: _dock, ...plain } = cleanMarketLayout("right");
  assert.equal(isCleanStandard(plain), true);
  assert.equal(isCleanStandard(arranged("right", 5)), false);
  assert.equal(arrangedByHand(arranged("right", 5)), true);
  assert.equal(arrangedByHand(null), false);
});

test("a layout arranged before the side was chosen turns to it; one arranged after stays as the person left it", () => {
  const before = chooseKept(arranged("right", 100), [], "left", 200);
  assert.equal(ticketSide(before.dock), "left");
  assert.equal(before.updatedAt, 100);
  const after = chooseKept(arranged("right", 300), [], "left", 200);
  assert.equal(ticketSide(after.dock), "right");
  // Already on the chosen side: the same object.
  const same = arranged("left", 100);
  assert.equal(chooseKept(same, [], "left", 200), same);
});

test("nothing arranged by hand is left out of reach: with nothing of theirs on this page, the latest they arranged in another layout opens", () => {
  const older = arranged("right", 10);
  const newer = { ...arranged("right", 20), dock: readyDock("monitoring", ["chart", "rules", "ticket"], "right") };
  // Nothing kept here, or a ready layout of before never arranged: the latest arranged elsewhere.
  assert.equal(chooseKept(null, [older, newer, null], "right", 0), newer);
  assert.equal(chooseKept(kept("analytics", "right"), [older, kept("monitoring", "right")], "right", 0), older);
  // Untouched everywhere: «Стандарт».
  assert.equal(chooseKept(kept("standard", "right"), [kept("analytics", "left"), null], "right", 0), null);
  // This page arranged by hand: it, whatever is newer elsewhere.
  const own = arranged("right", 5);
  assert.equal(chooseKept(own, [newer], "right", 0), own);
  // «Повернути стандарт» on this page is the person's latest word here: nothing older comes back over it.
  assert.equal(chooseKept(cleanMarketLayout("right", 30), [newer], "right", 0), null);
});
