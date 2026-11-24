import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { FRESH, MODE_KEY, choose, isScope, modeOf, readMemory, writeMemory } from "./private-mode.ts";
import { PRIVATE_KIT, PRIVATE_KIT_STAND } from "./words.ts";

/* The toggle «Public ⇄ Private»: each screen remembers its choice; until the person turns private on once, a
   screen opens public; from then on private is the default; a broken memory is a fresh one, never an error. */

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("a fresh memory opens every screen public", () => {
  assert.equal(modeOf(FRESH, "send"), "open");
  assert.equal(modeOf(FRESH, "payouts"), "open");
  assert.equal(FRESH.ever, false);
});

test("after the first turn on, private is the default on every screen not chosen yet", () => {
  const once = choose(FRESH, "send", "private");
  assert.equal(once.ever, true);
  assert.equal(modeOf(once, "send"), "private");
  assert.equal(modeOf(once, "payouts"), "private", "a screen never chosen on opens private");
  assert.equal(modeOf(once, "invoices"), "private");
});

test("each screen remembers its own choice; turning one back to public leaves the default private", () => {
  const memory = choose(choose(FRESH, "send", "private"), "swap", "open");
  assert.equal(modeOf(memory, "swap"), "open", "the screen keeps its public");
  assert.equal(modeOf(memory, "send"), "private");
  assert.equal(modeOf(memory, "payouts"), "private", "the default stays private");
  assert.equal(memory.ever, true);
  const publicOnly = choose(FRESH, "swap", "open");
  assert.equal(publicOnly.ever, false, "choosing public never makes private the default");
  assert.equal(modeOf(publicOnly, "send"), "open");
});

test("the memory survives the browser's storage and refuses what it cannot read", () => {
  const memory = choose(choose(FRESH, "send", "private"), "swap", "open");
  assert.deepEqual(readMemory(writeMemory(memory)), memory);
  for (const broken of [null, undefined, "", "{", "null", "[]", "42", '{"ever":"yes"}']) assert.deepEqual(readMemory(broken), { ever: false, by: {} }, String(broken));
  const odd = readMemory(JSON.stringify({ ever: true, by: { send: "private", swap: "anonymous", "Bad Scope": "open", __proto__: "open", invoices: "open" } }));
  assert.deepEqual(odd, { ever: true, by: { send: "private", invoices: "open" } }, "unknown modes and names are dropped");
  assert.ok(MODE_KEY.startsWith("ryntra."));
});

test("a screen's name is short and plain; a bad one changes nothing", () => {
  for (const good of ["send", "payouts", "kit-stand", "swap2"]) assert.ok(isScope(good), good);
  for (const bad of ["", "Send", "a b", "__proto__", "x".repeat(40), 3, null]) assert.equal(isScope(bad), false, String(bad));
  assert.equal(choose(FRESH, "__proto__", "private"), FRESH);
  assert.equal(modeOf(choose(FRESH, "send", "private"), "constructor"), "private", "an inherited name is no choice");
});

test("the memory keeps no more screens than the terminal has", () => {
  let memory = FRESH;
  for (let i = 0; i < 40; i++) memory = choose(memory, `s${i}`, "open");
  assert.equal(Object.keys(memory.by).length, 32);
  assert.equal(modeOf(memory, "s39"), "open", "the latest choice is kept");
});

test("the toggle and the band stay shut in a build without the private mode, and say «private», never «anonymous»", () => {
  const toggle = read("./PrivacyToggle.tsx");
  assert.match(toggle, /export function privateModeOpen\(\): boolean \{\n  return privateNetwork\(\) !== null;/);
  assert.match(toggle, /if \(!privateModeOpen\(\)\) return null;/);
  assert.match(toggle, /return \[privateModeOpen\(\) \? modeOf\(memory, scope\) : 'open', set\]/, "without the flag every screen is public");
  assert.match(read("./PrivacyBand.tsx"), /if \(!privateModeOpen\(\)\) return null;/);
  for (const dict of [PRIVATE_KIT, PRIVATE_KIT_STAND]) {
    for (const half of [dict.en, dict.uk]) {
      for (const said of Object.values(half).map((value) => (typeof value === "string" ? value : value(1)))) assert.doesNotMatch(said, /anonym|анонім|untrace|невідстеж|\bfirst\b|перш/i, said);
    }
  }
  assert.match(read("../../app/(terminal)/terminal/kit/private/page.tsx"), /if \(!kitOpen\(\) \|\| !privateNetwork\(\)\) notFound\(\);/, "the stand needs both switches");
});

test("the page's head carries the mode on a phone too", () => {
  const page = read("./Page.tsx");
  assert.match(page, /\{mode \? <div className=\{s\.pageMode\}>\{mode\}<\/div> : null\}/);
  const css = read("./ui.module.css");
  assert.match(css, /\.pageMode \{\n    order: 2;\n  \}/, "beside the name, not hidden as the mark is");
  assert.match(css, /\.switch\[data-on\] \{/, "the toggle's track lights as the kit's switch does");
});
