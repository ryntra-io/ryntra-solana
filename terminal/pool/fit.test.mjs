import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/* Measured on a stand with recorded answers (terminal/pool/shots-358e.mjs): before — the desk 618 px, the ticket
   scrolling 123 px, «Connect wallet» under the window's foot, the book's fourth row 8 px of 24; after — the desk
   676 px, the action whole at 861 px, the book ending on a row's edge. */

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const css = read("./pool.module.css");
const screen = read("./PoolScreen.tsx");
const side = read("./PoolSide.tsx");

test("fault 23: the pool's desk takes the window's height its one-row head leaves", () => {
  assert.match(css, /\.deskBox > div \{\s*--desk-h: max\(600px, calc\(100dvh - var\(--top\) - 156px\)\);/);
  assert.match(screen, /<div className=\{p\.deskBox\} data-pool-desk="">\s*<Desk\s/);
  // The coin's own desk keeps its two-row head's measure (terminal/coin is not this page's).
  assert.match(read("../coin/desk.module.css"), /--desk-h: max\(600px, calc\(100dvh - var\(--top\) - 214px\)\);/);
});

test("fault 23: on a short desk the ticket's rows close a step, so the Limit's action stands on the first screen", () => {
  assert.match(side, /style=\{SIDE_GAP\}/);
  assert.match(side, /const SIDE_GAP = \{ gap: 'var\(--side-gap\)' \} as const;/);
  assert.match(css, /\.side \{\s*--side-gap: 12px;/);
  assert.match(css, /@media \(min-width: 768px\) and \(max-height: 900px\) \{\s*\.side \{\s*--side-gap: 8px;/);
});

test("fault 24: the book ends on a row's own edge — after it is centred, and whenever its column's height changes", () => {
  assert.match(screen, /function snapBook\(box: HTMLElement, rows: string = 'li, p'\): void/);
  assert.match(screen, /box\.style\.maxHeight = `\$\{Math\.ceil\(cut\)\}px`/);
  assert.match(screen, /snapBook\(box\);\s*\}\);/, "after the centring scroll");
  assert.match(screen, /size\.observe\(column\);/, "the column is watched, never the book it sets");
});
