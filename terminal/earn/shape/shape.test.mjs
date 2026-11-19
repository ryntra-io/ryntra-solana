/**
 * A shape of one's own on the ticket, with no screen: the four shapes a grid starts from, a stroke painted
 * across it, a press that takes a column's top cell off, strokes back and forth, the person's own shapes kept in the
 * browser — and the Review the form asks for it.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const {
  COLUMNS,
  LEVELS,
  PRESETS,
  SIDE,
  cellAt,
  cleanName,
  commit,
  historyOf,
  isColumns,
  nextName,
  paintColumn,
  paintStroke,
  parseSaved,
  presetColumns,
  pressCells,
  redo,
  undo,
  withSaved,
  MAX_SAVED,
} = await import("./model.ts");
const { SHAPE } = await import("./words.ts");
const { proChoice, proShapeBuilds, proShapeFault, proShapeRanges } = await import("../../../city/lib/earn/pro.ts");

test("the four shapes a grid starts from: the three goals and «Wave», each mirrored about the price and painted on both sides", () => {
  assert.deepEqual([...PRESETS], ["even", "near", "edges", "wave"]);
  for (const preset of PRESETS) {
    const columns = presetColumns(preset);
    assert.equal(isColumns(columns), true, preset);
    for (const style of ["calm", "balanced", "dense"]) assert.equal(proShapeBuilds(columns, style), true, `${preset} on ${style}: within fifteen ranges`);
    assert.deepEqual(columns.slice(0, SIDE), [...columns.slice(SIDE)].reverse(), `${preset} mirrors about the price`);
  }
  const outward = (preset) => presetColumns(preset).slice(SIDE);
  assert.deepEqual(outward("even"), Array(SIDE).fill(LEVELS / 2), "even stands at half height, to paint up or down");
  assert.deepEqual(outward("near"), [8, 8, 7, 7, 6, 6, 5, 5, 4, 4, 3, 3, 2, 2, 1, 1], "most by the price");
  assert.deepEqual(outward("edges"), [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8], "most at the edges");
  const wave = outward("wave");
  assert.equal(Math.max(...wave), LEVELS);
  assert.ok(wave[0] <= 2 && wave.at(-1) <= 2 && wave[7] === LEVELS && wave[8] === LEVELS, `one hump a side, in its middle: ${wave}`);
});

test("a point of the grid is a column and a height; a press on a column's top cell takes it off", () => {
  assert.deepEqual(cellAt(0, 0), { column: 0, cells: LEVELS });
  assert.deepEqual(cellAt(0.999, 0.999), { column: COLUMNS - 1, cells: 1 });
  assert.deepEqual(cellAt(0.5, 0.5), { column: SIDE, cells: 4 });
  assert.deepEqual(cellAt(-1, 2), { column: 0, cells: 0 }, "below the grid clears the column");
  assert.deepEqual(cellAt(2, -1), { column: COLUMNS - 1, cells: LEVELS }, "above it fills the column");
  const columns = presetColumns("even");
  assert.equal(pressCells(columns, { column: 3, cells: 4 }), 3, "the top cell pressed is taken off");
  assert.equal(pressCells(columns, { column: 3, cells: 6 }), 6);
  assert.equal(pressCells(paintColumn(columns, 3, 1), { column: 3, cells: 1 }), 0, "the last cell too");
});

test("a stroke paints every column it crosses, on the straight line between its two points", () => {
  const flat = Array(COLUMNS).fill(0);
  const stroke = paintStroke(flat, { column: 2, cells: 2 }, { column: 8, cells: 8 });
  assert.deepEqual(stroke.slice(2, 9), [2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(stroke.slice(0, 2), [0, 0]);
  const back = paintStroke(flat, { column: 8, cells: 8 }, { column: 2, cells: 2 });
  assert.deepEqual(back, stroke, "either way across");
  assert.equal(paintColumn(stroke, 40, 3), stroke, "a column outside the grid changes nothing");
  assert.equal(paintColumn(stroke, 2, 2), stroke, "nor does the height it already has");
  assert.equal(paintColumn(stroke, 2, 12)[2], LEVELS);
});

test("strokes back and forth: undo takes one back, redo puts it again, a new stroke drops what stood ahead", () => {
  let history = historyOf(presetColumns("even"));
  const one = paintColumn(history.present, 0, 8);
  const two = paintColumn(one, 1, 8);
  history = commit(commit(history, one), two);
  assert.equal(commit(history, two), history, "the same grid is not a step");
  history = undo(history);
  assert.deepEqual(history.present, one);
  history = redo(history);
  assert.deepEqual(history.present, two);
  history = commit(undo(history), paintColumn(one, 5, 0));
  assert.equal(history.future.length, 0);
  assert.equal(undo(historyOf(one)).present, one, "nothing to take back");
  let long = historyOf(presetColumns("even"));
  for (let n = 0; n < 60; n += 1) long = commit(long, paintColumn(long.present, n % COLUMNS, (n % 7) + 1));
  assert.ok(long.past.length <= 40, "only the last forty are kept");
});

test("the person's own shapes: read back only as kept, named once, twelve at most — and nothing breaks on what a browser holds", () => {
  const wave = presetColumns("wave");
  assert.deepEqual(parseSaved(null), []);
  assert.deepEqual(parseSaved("{"), []);
  assert.deepEqual(parseSaved('{"a":1}'), []);
  const kept = JSON.stringify([{ id: "a", name: "  Walls   high ", columns: wave }, { id: "a", name: "twice", columns: wave }, { id: "b", name: "", columns: wave }, { id: "c", name: "bad", columns: [1, 2] }, { id: "d", name: "x".repeat(40), columns: wave }]);
  const read = parseSaved(kept);
  assert.deepEqual(read.map((shape) => shape.name), ["Walls high", "x".repeat(24)]);
  let saved = withSaved([], "Mine", wave, "1");
  saved = withSaved(saved, "mine", presetColumns("near"), "2");
  assert.equal(saved.length, 1, "a name is one shape: the new one replaces it");
  assert.deepEqual(saved[0].columns, presetColumns("near"));
  assert.deepEqual(withSaved(saved, "   ", wave, "3"), saved, "no name, nothing kept");
  for (let n = 0; n < 20; n += 1) saved = withSaved(saved, `S${n}`, wave, `id${n}`);
  assert.equal(saved.length, MAX_SAVED);
  assert.equal(saved[0].name, "S19", "the newest first");
  assert.equal(cleanName("  a   b  "), "a b");
  assert.equal(nextName([{ id: "1", name: "My shape 1", columns: wave }], SHAPE.en.nameOf), "My shape 2");
  assert.equal(nextName([], SHAPE.uk.nameOf), "Моя форма 1");
});

test("the Review the form asks for: the grid names its key, and a grid on one side only is not asked", () => {
  const pier = { address: "Pier1111111111111111111111111111111111111111" };
  const holdings = null;
  const wave = presetColumns("wave");
  const goal = proChoice(pier, "balanced", "near", "1", holdings, "Owner111111111111111111111111111111111111111");
  const own = proChoice(pier, "balanced", "near", "1", holdings, "Owner111111111111111111111111111111111111111", wave);
  assert.equal(proShapeBuilds(wave, "balanced"), true);
  assert.equal(proShapeBuilds([...Array(16).fill(0), ...wave.slice(16)], "balanced"), false);
  assert.equal(proShapeBuilds(wave.slice(1), "balanced"), false);
  /* Too detailed for one position: teeth on every column need more ranges than fifteen — said, never flattened. */
  const comb = Array.from({ length: 32 }, (_, index) => (index % 2 ? 1 : 8));
  assert.equal(proShapeRanges(wave, "balanced"), 11, "«Wave» stacks into eleven ranges");
  assert.equal(proShapeFault(comb, "balanced"), "detail");
  assert.equal(proShapeFault(comb, "dense"), null, "the same teeth over five steps a side blend into eight ranges");
  assert.equal(proShapeFault([...Array(16).fill(0), ...wave.slice(16)], "balanced"), "sides");
  assert.equal(proShapeFault(wave.map((cells, index) => (index ? cells : 9)), "balanced"), "format");
  /* While the wallet's SOL is not read, the key stands on what is on the form: the grid names it — another grid is another Review. */
  assert.ok(goal.key && !goal.key.includes("custom") && goal.key.includes(":near:"));
  assert.ok(own.key && own.key.includes(`:custom-${wave.join("")}:`) && !own.key.includes(":near:"), own.key);
  const lopsided = proChoice(pier, "balanced", "near", "1", holdings, "Owner111111111111111111111111111111111111111", [...Array(16).fill(0), ...wave.slice(16)]);
  assert.deepEqual([lopsided.problem, lopsided.key], [null, null], "no Review is asked; the ticket says why");
  for (const lang of ["en", "uk"]) {
    for (const [key, value] of Object.entries(SHAPE[lang])) {
      const said = typeof value === "string" ? value : value("1", "1", "1");
      assert.doesNotMatch(said, /\b(tick|bin id|program|api|weight|custom strategy)\b/i, `${lang}.${key}: «${said}» — no technical word on the screen`);
    }
  }
});

test("the ticket offers the shape only behind its switch, and the store sends the grid as the goal `custom`", () => {
  const model = readFileSync(new URL("./model.ts", import.meta.url), "utf8");
  assert.match(model, /process\.env\.NEXT_PUBLIC_RYNTRA_EARN_PRO_SHAPE === 'open'/);
  const store = readFileSync(new URL("../../../city/lib/earn/pro-store.ts", import.meta.url), "utf8");
  assert.match(store, /goal: 'custom', columns: \[\.\.\.st\.shape\]/);
  const ticket = readFileSync(new URL("../ProTicket.tsx", import.meta.url), "utf8");
  assert.match(ticket, /SHAPE_OPEN \? \[\.\.\.PIER_GOALS, 'custom'\] : PIER_GOALS/);
});
