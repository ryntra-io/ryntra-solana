import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ALL_TIME, CSV_STYLE, periodOf, reportCsv, totalsOf } from "../../../lib/privacy/report/report.ts";
import { csvWords, leadOf, periodName, receiptWords, rowName, unitNames } from "./report-view.ts";
import { REPORT_WORDS } from "./words.ts";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the file's and the receipt's words come whole in both languages", () => {
  for (const lang of ["en", "uk"]) {
    const w = REPORT_WORDS[lang];
    const csv = csvWords(w);
    assert.equal(csv.head.length, 10);
    assert.ok(csv.head.every((h) => typeof h === "string" && h.trim()));
    assert.ok(Object.values(receiptWords(w)).every((v) => typeof v === "string" && v.trim()));
    assert.equal(Object.keys(unitNames(w)).length, 4);
    assert.ok(reportCsv([], csv, CSV_STYLE[lang]).startsWith(`﻿${csv.head[0]}`));
  }
});

test("the words say what is true: private, never anonymous; no tax or rules promised; what is given stays given", () => {
  const all = JSON.stringify(REPORT_WORDS, (key, value) => (typeof value === "function" ? value("A", "B") : value));
  assert.doesNotMatch(all, /anonym|анонім|untrace|не відстеж|перш(ий|а) |first private|tax|подат|complian|відповідає вимогам/i);
  assert.match(REPORT_WORDS.en.consent, /cannot be taken back/);
  assert.match(REPORT_WORDS.uk.consent, /Відкликати вже видане не можна/);
  assert.match(REPORT_WORDS.en.a1, /never given/, "no key that opens everything");
});

test("a period is named the way people say it", () => {
  const now = new Date(2026, 10, 20).getTime();
  const en = REPORT_WORDS.en;
  assert.equal(periodName("quarter", periodOf("quarter", now), en, () => "x"), "Q4 2026");
  assert.equal(periodName("quarter", periodOf("quarter", now, -1), REPORT_WORDS.uk, () => "x"), "3 квартал 2026");
  assert.equal(periodName("year", periodOf("year", now, -1), en, () => "x"), "2025");
  assert.equal(periodName("month", periodOf("month", now), en, (at) => String(new Date(at).getMonth())), "10");
  assert.equal(periodName("all", ALL_TIME, en, () => "x"), "All");
});

test("the panel leads with one figure: out for payouts, in for invoices", () => {
  const rows = [
    { kind: "payout", state: "paid", coin: "SOL", amount: "0.5" },
    { kind: "payout", state: "failed", coin: "SOL", amount: "9" },
    { kind: "invoice", state: "paid", coin: "SOL", amount: "0.25" },
  ];
  const totals = totalsOf(rows);
  assert.deepEqual(leadOf(totals, "out"), { coin: "SOL", sum: "0.5", count: 1, other: { coin: "SOL", sum: "0.25" } });
  assert.deepEqual(leadOf(totals, "in"), { coin: "SOL", sum: "0.25", count: 1, other: { coin: "SOL", sum: "0.5" } });
  assert.deepEqual(leadOf(totalsOf([]), "out"), { coin: "SOL", sum: "0", count: 0, other: null });
  assert.equal(rowName({ kind: "invoice", name: null, to: "x", note: null }, "Invoice"), "Invoice");
  assert.equal(rowName({ kind: "payout", name: null, to: "4EotVUjoPNgsBtTd82vAZMiey6Uw9uQgX4fVgkgxzFmS", note: null }, "I"), "4Eot…zFmS");
});

test("the panel stands quiet and inside its disclosure: no amber press of its own, colours only by token", () => {
  const tsx = read("./Report.tsx");
  assert.doesNotMatch(tsx, /<Action\b/, "the action panel keeps the screen's one amber press");
  assert.match(tsx, /aria-expanded/);
  const css = read("./report.module.css");
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|rgba?\(/i);
});
