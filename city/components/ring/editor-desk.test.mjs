// Run from repo root: node --test city/components/ring/editor-desk.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/* CITY-240: the list of brains on a desk. In the Arena's window on a screen 900 px tall (the window is 615 px there)
   the list showed two rows and half of a third: its room was 120 px, less the 5 px the pane ran over, and three rows
   take 132. The list is now a box inside its room, cut to whole rows — so no edge halves a row before the first scroll
   at any height of the window — and a short desk gives the room its third row. Layout only; measured on the stand
   (docs/research/city-240-polish). */

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
const px = (body, property) => Number(new RegExp(`(?:^|\\s)${property}: (\\d+)px;`, "u").exec(body)?.[1]);

const ROW = 40;
const GAP = 6;

test("the list is cut to whole rows: its height is its room rounded down to a row and its gap", () => {
  const list = block(css, "\n.modelList {");
  assert.match(list, new RegExp(`--row: ${ROW}px;\\s+--gap: ${GAP}px;`, "u"));
  assert.match(list, /gap: var\(--gap\);/u);
  // The plain height first: a browser that does not know `round()` keeps the whole room, as the list had before.
  assert.match(list, /height: 100%;\s+height: calc\(round\(down, 100cqh \+ var\(--gap\), var\(--row\) \+ var\(--gap\)\) - var\(--gap\)\);/u);
  assert.match(list, /overflow-y: auto;\s+overscroll-behavior: contain;/u, "the list scrolls, not its room");
  // The room is what the pane has left, and the list's own measure: never less than three rows.
  const room = block(css, "\n.models {");
  assert.match(room, /flex: 1;/u);
  assert.match(room, /container-type: size;/u, "`100cqh` is this box");
  assert.equal(px(room, "min-height"), 3 * ROW + 2 * GAP);
  assert.doesNotMatch(room, /overflow/u);
  // A row of one line is exactly the list's step, whatever face draws it; a longer name still takes a second line.
  const row = block(css, "\n.model {");
  assert.match(row, /min-height: var\(--row, 40px\);/u);
  assert.doesNotMatch(row, /(?:^|\s)height:|overflow: hidden/u);
  // …and the list sizes each row by what it holds (the review of CITY-240). In a list of a set height a row with a
  // least height of its own is laid at that least: the picked row stayed 40 px on a desk, and its line — what the brain
  // can play, why the server refused it — was drawn outside the row and cut away by the row's own corners.
  assert.match(list, /grid-auto-rows: max-content;/u);
  // The same arithmetic, in numbers: what is in sight is whole rows, for any room.
  const shown = (roomPx) => Math.floor((roomPx + GAP) / (ROW + GAP)) * (ROW + GAP) - GAP;
  assert.equal(shown(132), 132, "three rows");
  assert.equal(shown(137), 132, "five spare pixels show no sliver of a fourth");
  assert.equal(shown(177), 132);
  assert.equal(shown(178), 178, "four rows");
  for (let roomPx = 132; roomPx <= 600; roomPx += 1) assert.equal((shown(roomPx) + GAP) % (ROW + GAP), 0, `${roomPx}px`);
  const editor = read("./RingEditor.tsx");
  assert.match(editor, /<div className=\{r\.models\}>\s+<div className=\{r\.modelList\} ref=\{list\}>/u, "the room, and the list inside it — the box a class tab scrolls back to its top");
});

test("a desk 900 px tall gives the list its third row, and only a desk's window", () => {
  const short = block(css, "@media (max-height: 940px) and (min-width: 761px)");
  // Each rule names a piece of the making screen in the Arena's window; the screen over a quarter is as it was.
  for (const rule of short.matchAll(/([^{}]+)\{/gu)) assert.match(rule[1].trim(), /^\.editor(\.editorInline|Inline \.\w+)$/u, rule[1].trim());
  const plain = (selector) => block(css, `\n${selector} {`);
  assert.match(plain(".editor"), /padding: 16px 18px 14px;/u);
  const inline = block(short, ".editor.editorInline");
  const gains = [
    16 - px(inline, "padding-top"),
    14 - px(inline, "padding-bottom"),
    px(plain(".steps"), "margin-top") - px(block(short, ".editorInline .steps"), "margin-top"),
    px(plain(".pane"), "margin-top") - px(block(short, ".editorInline .pane"), "margin-top"),
    px(plain(".summary"), "margin-top") - px(block(short, ".editorInline .summary"), "margin-top"),
    px(plain(".go"), "margin-top") - px(block(short, ".editorInline .go"), "margin-top"),
  ];
  for (const gain of gains) assert.ok(gain > 0, `every gap gives a little: ${gains}`);
  const given = gains.reduce((sum, gain) => sum + gain, 0);
  // Measured on the stand at 1440×900: the list's room was 120 px and the pane ran 5 px over; three rows take 132.
  assert.ok(given >= 132 - 120 + 5 + 4, `${given} px given for the 17 px the third row needs, with room to spare`);
  // Nothing under a pointer gets smaller: the step tabs, the search, «Close» and the action keep their rules.
  assert.doesNotMatch(short, /(?:^|\s)(?:min-)?height:/u);
  // A phone's sheet has its own rules (`max-width: 480px`), and this one never reaches a phone: 761 px and wider.
  assert.doesNotMatch(short, /\.models|\.modelList|\.classTab|\.search/u);
});

test("on a phone the list runs with the pane, as before: no height of its own, one scroll under the finger", () => {
  let from = 0;
  let phone = "";
  for (;;) {
    const at = css.indexOf("@media (max-width: 480px)", from);
    assert.ok(at >= 0, "the phone's rules of the editor");
    phone = block(css, "@media (max-width: 480px)", at);
    if (phone.includes(".editorInline")) break;
    from = at + 1;
  }
  assert.match(block(phone, ".editorInline .models"), /flex: none;\s+min-height: 0;[^}]*container-type: normal;/u);
  assert.match(block(phone, ".editorInline .modelList"), /height: auto;\s+overflow: visible;/u);
});
