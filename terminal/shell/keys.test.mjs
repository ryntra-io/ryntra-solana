// Run from repo root: node --test terminal/shell/keys.test.mjs
//
// The terminal's keys on a desk: «/» finds a coin from anywhere, B and S buy and sell on a coin's screen, 1–4 its quick
// sums, Esc closes, «?» lists the keys. Never while the person types, never with Ctrl, ⌘ or Alt, never on a phone.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { KEY_LIST, coinAt, keyHit, sumFor } from "./key-map.ts";
import { KEYS } from "./words.ts";

const press = (key, code, more = {}) => ({ key, code, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, repeat: false, ...more });
const DESK = { typing: false, narrow: false, coin: false, listOpen: false };
const COIN = { ...DESK, coin: true };

test("«/» finds a coin from anywhere; «?» lists the keys; Esc closes", () => {
  assert.deepEqual(keyHit(press("/", "Slash"), DESK), { action: "search" });
  assert.deepEqual(keyHit(press("/", "Slash"), COIN), { action: "search" });
  // A Ukrainian layout writes «.» on the key: its place is still «/».
  assert.deepEqual(keyHit(press(".", "Slash"), DESK), { action: "search" });
  assert.deepEqual(keyHit(press("?", "Slash", { shiftKey: true }), DESK), { action: "help" });
  assert.deepEqual(keyHit(press(",", "Slash", { shiftKey: true }), DESK), { action: "help" });
  assert.deepEqual(keyHit(press("Escape", "Escape"), DESK), { action: "close" });
});

test("on a coin's screen B and S buy and sell, 1–4 the quick sums — on any layout; elsewhere they are letters", () => {
  assert.deepEqual(keyHit(press("b", "KeyB"), COIN), { action: "buy" });
  assert.deepEqual(keyHit(press("и", "KeyB"), COIN), { action: "buy" });
  assert.deepEqual(keyHit(press("s", "KeyS"), COIN), { action: "sell" });
  assert.deepEqual(keyHit(press("і", "KeyS"), COIN), { action: "sell" });
  assert.deepEqual(keyHit(press("1", "Digit1"), COIN), { action: "sum", index: 0 });
  assert.deepEqual(keyHit(press("4", "Numpad4"), COIN), { action: "sum", index: 3 });
  assert.equal(keyHit(press("5", "Digit5"), COIN), null);
  for (const [key, code] of [["b", "KeyB"], ["s", "KeyS"], ["1", "Digit1"]]) assert.equal(keyHit(press(key, code), DESK), null, `${key} off a coin`);
});

test("never while typing, with a modifier, held down, or on a phone — Esc in a field is the field's, unless the list is open", () => {
  const typing = { ...COIN, typing: true };
  for (const [key, code] of [["/", "Slash"], ["b", "KeyB"], ["s", "KeyS"], ["1", "Digit1"]]) assert.equal(keyHit(press(key, code), typing), null, key);
  assert.equal(keyHit(press("?", "Slash", { shiftKey: true }), typing), null);
  assert.equal(keyHit(press("Escape", "Escape"), typing), null);
  assert.deepEqual(keyHit(press("Escape", "Escape"), { ...typing, listOpen: true }), { action: "close" });
  for (const mod of ["metaKey", "ctrlKey", "altKey", "repeat"]) assert.equal(keyHit(press("b", "KeyB", { [mod]: true }), COIN), null, mod);
  assert.equal(keyHit(press("B", "KeyB", { shiftKey: true }), COIN), null, "Shift+B is a capital typed, not a buy");
  const phone = { ...COIN, narrow: true };
  for (const [key, code] of [["/", "Slash"], ["b", "KeyB"], ["1", "Digit1"], ["Escape", "Escape"], ["?", "Slash"]]) assert.equal(keyHit(press(key, code), phone), null, `${key} on a phone`);
});

test("a coin's screen is known by its address", () => {
  assert.equal(coinAt("/coin/JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN"), "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN");
  assert.equal(coinAt("/coin/abc/?x=1"), "abc");
  assert.equal(coinAt("/coin/abc#orders"), "abc");
  for (const path of ["/", "/swap", "/coin", "/coin/a/b", "/terminal/kit/market"]) assert.equal(coinAt(path), null, path);
});

test("1–4 fill the buy's own quick sums, and a sale's shares; nothing where the ticket has none", () => {
  const sums = ["0.1", "0.5", "1", "5"];
  const shares = [25, 50, 75, 100];
  assert.deepEqual(sumFor(0, "buy", sums, shares), { typed: "0.1" });
  assert.deepEqual(sumFor(3, "buy", sums, shares), { typed: "5" });
  assert.equal(sumFor(0, "buy", null, shares), null, "another coin paying has no quick sums");
  assert.deepEqual(sumFor(1, "sell", sums, shares), { share: 50 });
  assert.deepEqual(sumFor(3, "sell", null, shares), { share: 100 });
});

test("the quiet list names every key in both languages, with no word of the machine", () => {
  for (const lang of ["en", "uk"]) {
    const w = KEYS[lang];
    for (const row of KEY_LIST) assert.equal(typeof w[row.word], "string", `${lang}: ${row.word}`);
    for (const text of Object.values(w)) assert.doesNotMatch(text, /shortcut|hotkey|keyboard|API|route|engine/iu);
  }
  assert.deepEqual(KEY_LIST.map((row) => row.keys.join("–")), ["/", "B", "S", "1–4", "Esc", "?"]);
});

test("the frame hears the keys once, after the fields and the panels: a field's press and a panel's Escape stay theirs", () => {
  const source = readFileSync(new URL("./Keys.tsx", import.meta.url), "utf8");
  assert.match(source, /if \(event\.defaultPrevented\) return;/);
  assert.match(source, /window\.addEventListener\('keydown', onKey\);/, "heard on the way up, after the panels' own Escape");
  assert.match(source, /typing: typingAt\(event\.target\)/);
  assert.doesNotMatch(source, /press\(|sign|execute|send\(/u, "a key only opens or fills");
  const shell = readFileSync(new URL("./TerminalShell.tsx", import.meta.url), "utf8");
  assert.match(shell, /<Keys \/>/);
});
