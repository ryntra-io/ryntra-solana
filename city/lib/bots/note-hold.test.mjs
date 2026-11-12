// Run from repo root: node --test city/lib/bots/note-hold.test.mjs
//
// CITY-237 (CITY-235's phone pass, ask 3): «Stopped before your wallet — nothing was sent» stood under the ladder's two
// quiet buttons — below the edge of a phone's half-screen window — and went after eight seconds, before a person
// scrolled to it. A «no» now stands right under its action, comes into view when said and stays half a minute.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { NOTE_NO_MS, NOTE_YES_MS, noteHoldMs, noteLeftMs, saysNo } from "./note-hold.ts";

const read = (file) => readFileSync(new URL(file, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("a «no» stays long enough to be read; a «yes» goes as before; «costs changed» waits for the next tap", () => {
  for (const kind of ["refused", "walletNo", "unreachable", "overCap"]) {
    assert.equal(noteHoldMs(kind), NOTE_NO_MS, kind);
    assert.equal(saysNo(kind), true, kind);
  }
  for (const kind of ["placed", "cancelled", "partly", "checking", "rest", "elsewhere", "on", "stopped"]) {
    assert.equal(noteHoldMs(kind), NOTE_YES_MS, kind);
    assert.equal(saysNo(kind), false, kind);
  }
  assert.equal(noteHoldMs("costsChanged"), null);
  assert.ok(NOTE_NO_MS >= 20_000, "a line under the fold was gone in 8 s: a «no» holds at least 20 s");
  assert.equal(NOTE_YES_MS, 8_000);
});

test("a line's time runs from when it was said, so a window opened again later does not bring it back", () => {
  const at = 1_000_000;
  assert.equal(noteLeftMs({ kind: "refused", at }, at), NOTE_NO_MS);
  assert.equal(noteLeftMs({ kind: "refused", at }, at + 12_000), NOTE_NO_MS - 12_000);
  assert.equal(noteLeftMs({ kind: "refused", at }, at + 3_600_000), 0, "an hour on: its time is up");
  assert.equal(noteLeftMs({ kind: "placed", at }, at + 5_000), 3_000);
  assert.equal(noteLeftMs({ kind: "costsChanged", at }, at + 3_600_000), null, "waits for the next tap");
});

test("the windows keep the line by its kind and its age, not by a fixed eight seconds", () => {
  const win = read("../../components/bots/BotsWindow.tsx");
  assert.match(win, /const left = ladderNote \? noteLeftMs\(ladderNote, Date\.now\(\)\) : null;/u);
  assert.doesNotMatch(win, /\}, 8_000\);/u);
  const budget = read("../../components/bots/AgentBudget.tsx");
  assert.match(budget, /\}, noteLeftMs\(note, Date\.now\(\)\) \?\? NOTE_YES_MS\);/u);
  // A «no» said to one budget or coin does not sit under another choice.
  assert.match(budget, /if \(said && saysNo\(said\.kind\)\) useMandate\.getState\(\)\.say\(null\);\n  \}, \[preset, coin\]\);/u);
});

test("the ladder's answer stands right under «Place», above the two quiet buttons, and is brought into view", () => {
  const ladder = read("../../components/bots/Ladder.tsx");
  const start = ladder.slice(ladder.indexOf("export function LadderStart"), ladder.indexOf("export function WalletList"));
  const place = start.indexOf("data-ladder-place");
  const line = start.indexOf("<NoteLine kind={note.kind} at={note.at}>");
  const quiet = start.indexOf("className={s.twoUp}");
  assert.ok(place > 0 && line > place && quiet > line, "«Place» → the line → «Practice first · Save as strategy»");
  assert.doesNotMatch(start, /className=\{s\.liveNote\} data-kind=\{note\.kind\}/u, "no second copy under the quiet buttons");
  // A «no» said to the ladder as it was does not sit under changed settings.
  assert.match(start, /if \(st\.note && !st\.note\.bot && saysNo\(st\.note\.kind\)\) st\.say\(null\);/u);
  const note = read("../../components/bots/NoteLine.tsx");
  // The window's own scroller is moved, never a clipped ancestor (the city's page): no `scrollIntoView`.
  assert.match(note, /if \(by\) box\.scrollBy\(\{ top: by, behavior: calm \? 'auto' : 'smooth' \}\);/u);
  assert.doesNotMatch(note, /\.scrollIntoView\(/u);
  assert.match(note, /\}, \[kind, at\]\);/u, "the same answer said again comes into view again");
  assert.match(note, /role="status"/u);
});

test("the agent's budget answers under its action too, not under «Details»", () => {
  const budget = read("../../components/bots/AgentBudget.tsx");
  const line = budget.indexOf("<NoteLine kind=");
  const details = budget.indexOf("className={s.more}");
  assert.ok(line > 0 && details > line);
  assert.equal(budget.split("<NoteLine kind=").length, 2, "said once");
});

test("a stop before the wallet is not small grey text", () => {
  const css = read("../../components/bots/bots.module.css");
  const rule = css.slice(css.indexOf(".liveNote[data-kind='refused']"));
  assert.match(rule.slice(0, rule.indexOf("}")), /color: var\(--warm\);/u);
  assert.doesNotMatch(css, /\.liveNote\[data-kind='walletNo'\][^{]*\{\s*color: var\(--text-dim\)/u);
});

test("an empty «History» names trades, not receipts, and has the one way on", () => {
  const words = read("./words.ts");
  assert.match(words, /noReceipts: 'No trades yet',/u);
  assert.match(words, /noReceipts: 'Угод ще немає',/u);
  assert.doesNotMatch(words, /No receipts yet|Квитанцій ще немає/u);
  const history = read("../../components/bots/History.tsx");
  assert.match(history, /<Empty title=\{w\.noReceipts\} action=\{w\.startOne\} onAction=\{\(\) => useBotsWindow\.getState\(\)\.setTab\('launch'\)\} \/>/u);
});
