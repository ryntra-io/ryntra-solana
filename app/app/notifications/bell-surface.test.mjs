import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { onSurface } from "./bell-surface.ts";

/**
 * The bell shows what Нагляд shows: the prediction demo's paper notes left
 * the surface with the demo, so the bell neither lists them nor counts them
 * — its number is always the number of notes its panel can open.
 */

const note = (id, { unread = false, paper = false } = {}) => ({ id, unread, paper, title: id, reason: "", href: "/app/alerts", createdAt: "2026-09-24T18:00:00.000Z" });

test("paper notes are neither listed nor counted", () => {
  const shown = onSurface({ recent: [note("a", { unread: true }), note("demo", { unread: true, paper: true }), note("b")], unread: 2 });
  assert.deepEqual(shown.recent.map((row) => row.id), ["a", "b"]);
  assert.equal(shown.unread, 1);
});

test("the count is the unread notes the panel lists, in the service's order", () => {
  const shown = onSurface({ recent: [note("c", { unread: true }), note("d", { unread: true }), note("e")], unread: 2 });
  assert.deepEqual(shown.recent.map((row) => row.id), ["c", "d", "e"]);
  assert.equal(shown.unread, 2);
});

test("an answer without notes reads as nothing unread", () => {
  assert.deepEqual(onSurface({ recent: [], unread: 0 }), { recent: [], unread: 0 });
  assert.deepEqual(onSurface({ recent: undefined, unread: 3 }), { recent: [], unread: 0 });
});

test("the bell reads the one monitoring surface behind the wallet's proof, and «Усі сповіщення» opens Нагляд", () => {
  const read = (name) => readFileSync(new URL(name, import.meta.url), "utf8");
  const notes = read("./use-notes.ts");
  assert.match(notes, /fetch\("\/api\/monitoring"/);
  assert.match(notes, /proof\.state\.status === "proven" && proof\.state\.address === address/);
  /* One read for the page: the store is module-wide, keyed by the wallet and the language. */
  assert.match(notes, /\$\{address\}:\$\{locale\}/);
  assert.match(read("./note-list.tsx"), /\/app\/alerts\/open/);
  assert.match(read("./bell.tsx"), /href="\/app\/alerts"/);
  assert.match(read("./bell.tsx"), /useNotes\(locale\)/);
});
