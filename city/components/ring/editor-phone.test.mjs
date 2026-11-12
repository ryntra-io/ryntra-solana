// Run from repo root: node --test city/components/ring/editor-phone.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/* CITY-239: the Ring's making screen in the Arena's window. On a phone's half sheet the list of brains showed one row
   — the screen's own rows took the rest — and a name of two lines was cut by the list's edge. With «i» open on a desk
   the script's counter stood half out of the pane. Layout only; the three rows are measured on the stand
   (docs/research/city-239-polish). */

const read = (file) => readFileSync(new URL(file, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const css = read("./ring.module.css").replace(/\/\*[\s\S]*?\*\//g, "");

function block(text, open, from = 0) {
  const at = text.indexOf(open, from);
  assert.ok(at >= 0, `no «${open}»`);
  const start = text.indexOf("{", at);
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === "{") depth += 1;
    else if (text[i] === "}" && --depth === 0) return text.slice(start + 1, i);
  }
  throw new Error(`«${open}» never closes`);
}

/** The phone's rules that hold the editor's own: the second «max-width: 480px» block of the sheet. */
const phone = (() => {
  let from = 0;
  for (;;) {
    const at = css.indexOf("@media (max-width: 480px)", from);
    assert.ok(at >= 0, "the phone's rules of the editor");
    const body = block(css, "@media (max-width: 480px)", at);
    if (body.includes(".editorInline")) return body;
    from = at + 1;
  }
})();

test("while a brain is picked on a phone the summary line steps aside, and only there", () => {
  assert.match(phone, /\.editorInline:has\(\.classes\) \.summary \{\s*display: none;\s*\}/u);
  // On the body and the script steps (no classes in the pane) the line, with its «i», is there; so it is on a desk.
  assert.doesNotMatch(css.replace(phone, ""), /\.summary \{[^}]*display: none/u);
  const editor = read("./RingEditor.tsx");
  assert.match(editor, /<div className=\{r\.classes\} role="tablist"/u, "the classes stand only on the brain step");
  assert.match(editor, /<div className=\{r\.summary\}>/u);
  // The pick is still in sight without the line: the picked row is marked and carries what the brain can play.
  assert.match(editor, /className=\{\[r\.model, picked && r\.modelOn\]/u);
  assert.match(editor, /\{picked && quote && \(\s*<span className=\{r\.pinned\}>/u);
});

test("the rows above the list stand closer on a phone, and nothing under a finger is smaller than 44 px", () => {
  const sizes = [...phone.matchAll(/\.editorInline \.(\w+) \{[^}]*?\b(?:min-)?height: (\d+)px;/gu)].map((m) => [m[1], Number(m[2])]);
  // CITY-240: «Close» and the search had gone down to 40 px to make room for the list's third row.
  // CITY-242: the steps' tabs (38 px) and the list's rows (40 px) too.
  const touch = sizes.filter(([name]) => ["head", "close", "step", "classTab", "search", "go"].includes(name));
  assert.equal(touch.length, 6, JSON.stringify(sizes));
  for (const [name, size] of touch) assert.ok(size >= 44, `${name}: ${size}px`);
  assert.ok(Number(/\.editorInline \.modelList \{[^}]*--row: (\d+)px;/u.exec(phone)?.[1]) >= 44, "a row of the list");
  // The room comes from the air between the rows — each gap a little closer — never from a row of the list.
  const gap = (name) => Number(new RegExp(`\\.editorInline \\.${name} \\{[^}]*?margin-top: (\\d+)px;`, "u").exec(phone)?.[1]);
  for (const name of ["steps", "pane", "search", "models", "go"]) assert.ok(gap(name) <= 6, `${name}: ${gap(name)}px above it`);
  assert.doesNotMatch(phone, /\.editorInline \.model \{/u, "a row of the list is as it was");
  // One scroll under the finger, the pane's: the list keeps no height or scroll of its own on a phone (CITY-240: the
  // list is a box inside its room; a desk cuts it to whole rows, a phone lets it run).
  assert.match(phone, /\.editorInline \.modelList \{[^}]*height: auto;[^}]*overflow: visible;[^}]*\}/u, "one scroll under the finger: the pane's");
  assert.match(phone, /\.editorInline \.models \{[^}]*flex: none;[^}]*container-type: normal;[^}]*\}/u, "and its room is the list's own height");
});

test("a brain's name wraps inside its row; the row is never a fixed height", () => {
  const head = /\n\.modelHead b \{([^}]*)\}/u.exec(css)?.[1] ?? "";
  assert.match(head, /overflow-wrap: anywhere;/u);
  assert.doesNotMatch(head, /white-space: nowrap|text-overflow/u);
  const row = /\n\.model \{([^}]*)\}/u.exec(css)?.[1] ?? "";
  // A least height is not a fixed one (CITY-240: a row of one line is the list's step): a longer name still grows the row.
  assert.doesNotMatch(row, /(?<![-\w])height:|overflow: hidden/u);
});

test("the script's field gives its room to the counter under it", () => {
  const script = /\n\.script \{([^}]*)\}/u.exec(css)?.[1] ?? "";
  assert.match(script, /flex: 1 1 0;/u, "it shrinks before the pane scrolls");
  const least = Number(/min-height: (\d+)px;/u.exec(script)?.[1]);
  assert.ok(least <= 120, `the field's least height (${least}px) leaves the counter its line`);
  const count = /\n\.count \{([^}]*)\}/u.exec(css)?.[1] ?? "";
  assert.match(count, /flex: none;/u, "the counter keeps its height");
});

test("a free brain's price is one short word in Ukrainian too, so the name beside it keeps its line on a phone", async () => {
  const { RING } = await import("../../lib/ring/words.ts");
  // «Матч безкоштовно» took the room of the name: «Dots3-Note Preview» and «Gemma 4 26B A4B» wrapped, and the third row
  // of the list was cut on the half sheet. The rows beside it say «… за матч»; a free one says it is free.
  assert.equal(RING.en.freeMatch, "Free a match");
  assert.equal(RING.uk.freeMatch, "Безкоштовно");
  assert.ok(RING.uk.freeMatch.length <= RING.en.freeMatch.length);
});
