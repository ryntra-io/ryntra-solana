import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

/* CITY-221: «Агенти → Гараж» with no towers ended on «No towers of yours yet» and nothing to press, in a 640 px pane
   two-thirds empty (ryntra.io, 8.11, desk and phone). */
test("the garage with no towers has its one action: Ryntra's line, to buy or launch", () => {
  const win = read("./GarageWindow.tsx");
  const action = win.slice(win.indexOf("function Action("), win.indexOf("function Off("));
  assert.match(action, /if \(!mine\.length\) \{[\s\S]*?openCommand\(\);[\s\S]*?\{w\.emptyAction\}/u, "no towers: a button, not nothing");
  assert.doesNotMatch(action, /if \(!mine\.length\) return null;/u);
  assert.match(win, /import \{ openCommand \} from '@\/city\/lib\/command\/store';/u);
  const words = read("./words.ts");
  assert.match(words, /emptyAction: 'Buy or launch'/u);
  assert.match(words, /emptyAction: 'Купити чи запустити'/u);
});

test("with no towers the garage window stands as tall as its contents; with towers it fills its pane as before", () => {
  assert.match(read("./GarageLayer.tsx"), /fit: mine\.length === 0,/u);
  assert.match(read("./GarageWindow.tsx"), /className=\{`\$\{s\.framed\} \$\{mine\.length \? '' : s\.flow\}`\}/u);
  const css = read("./garage.module.css");
  assert.match(css, /\.framed \{\s*position: absolute;\s*inset: 0;/u, "with towers: the pane as it was");
  assert.match(css, /\.flow \{\s*position: relative;\s*inset: auto;\s*min-height: 100%;/u, "no towers: in the flow, so the frame fits it");
});
