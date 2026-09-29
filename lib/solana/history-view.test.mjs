import assert from "node:assert/strict";
import test from "node:test";

import {
  filterHistory,
  HISTORY_EXPORT_COLUMNS,
  HISTORY_FILTERS,
  historyPage,
  historyCounts,
  historyExportName,
  historyToCsv,
} from "./history-view.ts";

/**
 * The depth `Simple | Pro` was supposed to mean.
 *
 * Canon §0.7 allows Pro more data and control over the same product and forbids
 * a technical dump or a longer list, so what is tested here is narrowing and
 * leaving with the result — never a row Pro can see and Simple cannot.
 */

const action = (over = {}) => ({
  actionId: "a1",
  lane: "SEND",
  outcome: "DONE",
  out: { amountRaw: "1500000", decimals: 6, symbol: "USDC" },
  in: null,
  signature: "4TX1LSCt",
  updatedAt: "2026-09-03T10:00:00.000Z",
  ...over,
});

const LIST = [
  action({ actionId: "s1", lane: "SEND", outcome: "DONE" }),
  action({ actionId: "s2", lane: "SEND", outcome: "NEEDS_YOU" }),
  action({ actionId: "w1", lane: "SWAP", outcome: "IN_FLIGHT" }),
  action({ actionId: "b1", lane: "BRIDGE", outcome: "FAILED" }),
  action({ actionId: "p1", lane: "SWAP", outcome: "DONE", origin: { surface: "SPOT", side: "BUY" } }),
  action({ actionId: "x1", lane: "CROSS_SWAP", outcome: "DONE" }),
  action({ actionId: "r1", lane: "RECEIVE", outcome: "DONE", out: null, in: { amountRaw: "10000000", decimals: 9, symbol: "SOL" } }),
];

test("every filter narrows to the page that made the row, and ALL narrows to nothing", () => {
  /* Owner, 2026-09-12: the filters are the product's pages. A Spot buy is a
     Swap-lane row with a Spot origin and belongs under Spot, not Swap; the
     cross-chain swap the Bridge page runs belongs under Bridge with the
     USDC bridge. */
  assert.equal(filterHistory(LIST, "ALL").length, 7);
  assert.deepEqual(filterHistory(LIST, "SEND").map((a) => a.actionId), ["s1", "s2"]);
  assert.deepEqual(filterHistory(LIST, "SWAP").map((a) => a.actionId), ["w1"]);
  assert.deepEqual(filterHistory(LIST, "SPOT").map((a) => a.actionId), ["p1"]);
  assert.deepEqual(filterHistory(LIST, "BRIDGE").map((a) => a.actionId), ["b1", "x1"]);
  assert.deepEqual(filterHistory(LIST, "RECEIVE").map((a) => a.actionId), ["r1"]);
  assert.equal(historyPage({ lane: "SWAP", origin: null }), "SWAP");
  assert.equal(historyPage({ lane: "SWAP", origin: { surface: "SPOT", side: "SELL" } }), "SPOT");
});

test("what still needs the person includes everything unfinished, not one state", () => {
  /* An unresolved transfer is neither a success nor a failure, and both shapes
     of unfinished are still the person's problem. A filter that showed only
     NEEDS_YOU would hide the money that is in the air. */
  assert.deepEqual(
    filterHistory(LIST, "NEEDS_YOU").map((a) => a.actionId),
    ["s2", "w1"],
  );
});

test("no filter can invent or lose a row", () => {
  /* Every filtered row must be one of the originals, and ALL must be the whole
     list unchanged — a filter is a view, never a transformation. */
  for (const filter of HISTORY_FILTERS) {
    for (const row of filterHistory(LIST, filter)) {
      assert.ok(LIST.includes(row), `${filter} produced a row that was not in the history`);
    }
  }
  assert.deepEqual(filterHistory(LIST, "ALL"), LIST);
  assert.deepEqual(filterHistory([], "SEND"), []);
});

test("the counts a control shows agree with what pressing it produces", () => {
  const counts = historyCounts(LIST);
  for (const filter of HISTORY_FILTERS) {
    assert.equal(counts[filter], filterHistory(LIST, filter).length, `${filter} count disagrees`);
  }
});

test("the export carries the filtered rows, with amounts a person can read", () => {
  const csv = historyToCsv(filterHistory(LIST, "SEND"));
  const lines = csv.trim().split("\n");
  assert.equal(lines.length, 3, "a header and the two SEND rows");
  assert.equal(lines[0], HISTORY_EXPORT_COLUMNS.map((c) => `"${c}"`).join(","));
  assert.ok(lines[1].includes('"1.5"'), `raw base units reached the file: ${lines[1]}`);
  assert.ok(lines[1].includes('"USDC"'));
  assert.ok(csv.endsWith("\n"), "a file without a trailing newline loses its last row in some tools");
});

test("a spreadsheet cannot be made to execute anything from this file", () => {
  /* A symbol is data. Some token symbols begin with a character a spreadsheet
     reads as the start of a formula, and an export that lets that run is a
     security defect rather than a formatting one. */
  const csv = historyToCsv([
    action({ out: { amountRaw: "1", decimals: 0, symbol: '=cmd|/c calc"!A1' } }),
  ]);
  assert.ok(csv.includes(`"'=cmd`), `formula was not neutralised: ${csv}`);
  assert.ok(csv.includes('""'), "an embedded quote was not doubled");
});

test("an unreadable amount becomes empty rather than wrong", () => {
  /* Guessing is worse than blank in a file somebody may reconcile against a
     bank statement. */
  const csv = historyToCsv([action({ out: { amountRaw: "not-a-number", decimals: 6, symbol: "X" } })]);
  assert.ok(csv.includes('"","X"'), csv);
});

test("decimals are placed, not multiplied", () => {
  const csv = historyToCsv([
    action({ actionId: "d0", out: { amountRaw: "42", decimals: 0, symbol: "A" } }),
    action({ actionId: "d9", out: { amountRaw: "1000000000", decimals: 9, symbol: "SOL" } }),
    action({ actionId: "dp", out: { amountRaw: "5", decimals: 9, symbol: "SOL" } }),
  ]);
  assert.ok(csv.includes('"42"'));
  assert.ok(csv.includes('"1"'), "a whole number kept a trailing fraction");
  assert.ok(csv.includes('"0.000000005"'), csv);
});

test("the filename says whose history, which slice, and sorts by day", () => {
  assert.equal(
    historyExportName("4MS4RQ3Vj2oYFHJz4EtLyxtq6panVcDUpDyXdoGxfQ1n", "ALL", "2026-09-03T10:00:00.000Z"),
    "ryntra-4MS4-2026-09-03.csv",
  );
  assert.equal(
    historyExportName("4MS4RQ3Vj2oYFHJz", "SEND", "2026-09-03T10:00:00.000Z"),
    "ryntra-4MS4-send-2026-09-03.csv",
  );
  assert.ok(historyExportName("4MS4", "ALL", "nonsense").endsWith("history.csv"));
});
