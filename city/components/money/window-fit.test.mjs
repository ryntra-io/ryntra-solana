// CITY-209: «Earn» and «Money» stand as tall as their tab, up to their place — a short tab (one line of «Mine», the
// wallet's «Connect») left 180–680 px of empty glass under it. The contents keep their own scroller under fixed tabs, so
// in a `fit` frame they stand in the flow and shrink to its ceiling; on the whole screen they fill it as before.
// The first open of «Earn» no longer waits for its code and then for its reads: the code is warm after the city's first
// frame, and the reads start with the tap.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("both windows ask the frame to stand as tall as their tab", () => {
  assert.match(read("./MoneyLayer.tsx"), /id: 'money',[\s\S]*?\bfit: true,/u);
  assert.match(read("../earn/EarnLayer.tsx"), /id: 'earn',[\s\S]*?\bfit: true,/u);
});

test("the frame and the sheet say when they fit, so the contents can stand in the flow", () => {
  assert.match(read("../window/WindowFrame.tsx"), /data-window-fit=\{fit \? '' : undefined\}/u);
  assert.match(read("../window/WindowSheet.tsx"), /data-window-fit=\{on && !full && spec\?\.fit \? '' : undefined\}/u);
  const frame = read("../window/window.module.css");
  for (const scope of ["\\.fit", "\\.sheetFit"]) {
    const rule = frame.match(new RegExp(`${scope} \\.body:not\\(\\[hidden\\]\\) \\{([^}]*)\\}`, "u"));
    assert.ok(rule, `${scope} .body is a column, never shown when hidden`);
    assert.match(rule[1], /display: flex;/u);
    assert.match(rule[1], /flex-direction: column;/u);
  }
});

for (const sheet of ["./money.module.css", "../earn/earn.module.css"]) {
  test(`${sheet}: in a fitting frame the contents stand in the flow and shrink, the tab's body scrolls`, () => {
    const css = read(sheet);
    const framed = css.match(/:global\(\[data-window-fit\]\) \.framed \{([^}]*)\}/u);
    assert.ok(framed);
    assert.match(framed[1], /position: relative;/u);
    assert.match(framed[1], /min-height: 0;/u);
    assert.match(css, /:global\(\[data-window-fit\]\) \.framed \.body \{\s*flex: 0 1 auto;/u);
    /* Off the fitting frame (the whole screen) the contents still fill the window. */
    assert.match(css, /\n\.framed \{\s*position: absolute;\s*inset: 0;/u);
    /* While the code arrives the glass is not a sliver. */
    assert.match(css, /:global\(\[data-window-fit\]\) \.pending \{[^}]*height: min\(/u);
  });
}

test("«Earn»: the code is warm after the city's first frame, the reads start with the tap", () => {
  const layer = read("../earn/EarnLayer.tsx");
  assert.match(layer, /const loadEarnWindow = \(\) => import\('\.\/EarnWindow'\);/u);
  assert.match(layer, /dynamic\(loadEarnWindow,/u);
  assert.match(layer, /if \(!cityDrawn\(\)\) return;/u, "never before the city's first frame");
  assert.match(layer, /useEffect\(\(\) => warmEarnWindow\(\), \[\]\);/u);
  assert.match(layer, /startWallets\(\);\s*startEarnReads\(\);/u);
  for (const call of ["loadFeed", "loadPiers", "loadLend", "loadCaptain"]) assert.match(layer, new RegExp(`data\\.${call}\\(\\)`, "u"));
});

test("«Earn»'s Shelf holds each big number's place while it is read", () => {
  const shelf = read("../earn/Shelf.tsx");
  assert.match(shelf, /reading\[id\] \?/u);
  assert.match(shelf, /\{big \|\| reading\[id\] \? <p className=\{s\.cardLine\}>/u);
});
