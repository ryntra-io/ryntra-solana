import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { GUTTER, MAIN_MIN, SIDE_MAX, SIDE_MIN, SIDE_WIDE, readSideMemory, sideAtPointer, sideByKey, sideClamp, sideDefault, sideMax } from "./split-rules.ts";

/* The side column — 400 px on a 1440 desk, wider on a wider one; dragged either way within limits; folded;
   remembered; a sheet on a phone. One terminal: no «Pro» switch, the rail by its names, folded by the person. */

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the default: 400 px on a 1440 window, wider on a wider one, never past SIDE_WIDE", () => {
  assert.equal(sideDefault(1440), 401);
  assert.ok(sideDefault(1920) > sideDefault(1440));
  assert.equal(sideDefault(1920), SIDE_WIDE);
  assert.equal(sideDefault(2560), SIDE_WIDE);
  assert.equal(sideDefault(1024), 380);
  assert.equal(sideDefault(Number.NaN), 400);
});

test("the CSS default is the same line as the rule: 22vw + 84px between 380 and 480", () => {
  const css = read("./split.module.css");
  assert.match(css, /--side-w: clamp\(380px, calc\(22vw \+ 84px\), 480px\);/);
  assert.match(css, /max\(340px, min\(var\(--side-w\), calc\(100% - 496px\)\)\)/, "the screen's column keeps MAIN_MIN + GUTTER");
  assert.equal(MAIN_MIN + GUTTER, 496);
  assert.equal(SIDE_MIN, 340);
});

test("a drag holds between SIDE_MIN and what leaves the screen's column MAIN_MIN", () => {
  const split = 1180;
  assert.equal(sideMax(split), split - GUTTER - MAIN_MIN);
  assert.equal(sideMax(4000), SIDE_MAX);
  assert.equal(sideMax(600), SIDE_MIN, "a split too narrow for both still lets the side keep its least");
  // The pointer far right: the narrowest; far left: the widest.
  assert.equal(sideAtPointer(1300, 1400, split, 1440), SIDE_MIN);
  assert.equal(sideAtPointer(0, 1400, split, 1440), sideMax(split));
  // In between: the split's right edge less the pointer, less half the strip.
  assert.equal(sideAtPointer(1000, 1400, split, 1440), 1400 - 1000 - GUTTER / 2);
  assert.equal(sideClamp(Number.NaN, split, 1440), sideDefault(1440));
});

test("the keys: left widens, right narrows, Home the least, End the most, anything else nothing", () => {
  assert.equal(sideByKey("ArrowLeft", 400, 1180, 1440), 416);
  assert.equal(sideByKey("ArrowRight", 400, 1180, 1440), 384);
  assert.equal(sideByKey("ArrowRight", SIDE_MIN, 1180, 1440), SIDE_MIN);
  assert.equal(sideByKey("Home", 500, 1180, 1440), SIDE_MIN);
  assert.equal(sideByKey("End", 400, 1180, 1440), sideMax(1180));
  assert.equal(sideByKey("Enter", 400, 1180, 1440), null);
});

test("the browser's memory: what is kept reads back; anything broken or foreign is dropped", () => {
  assert.deepEqual(readSideMemory(JSON.stringify({ ticket: { width: 452, shut: false }, earn: { width: null, shut: true } })), {
    ticket: { width: 452, shut: false },
    earn: { width: null, shut: true },
  });
  assert.deepEqual(readSideMemory("{not json"), {});
  assert.deepEqual(readSideMemory(null), {});
  assert.deepEqual(readSideMemory("[1,2]"), {});
  assert.deepEqual(readSideMemory(JSON.stringify({ ticket: { width: 99999 } })), { ticket: { width: SIDE_MAX, shut: false } });
  assert.deepEqual(readSideMemory(JSON.stringify({ ticket: { width: "wide", shut: "yes" } })), { ticket: { width: null, shut: false } });
  assert.deepEqual(readSideMemory(JSON.stringify({ "../x": { width: 400 } })), {});
});

test("storage is read and written inside try: a private window or blocked storage never breaks the page", () => {
  for (const file of ["./rail-fold.ts", "./side.ts"]) {
    const src = read(file);
    const touches = src.match(/window.localStorage\.(getItem|setItem)/g) ?? [];
    const guarded = src.match(/try \{\s*(?:raw = |folded = )?window\.localStorage\.(getItem|setItem)/g) ?? [];
    assert.ok(touches.length > 0, file);
    assert.equal(guarded.length, touches.length, `${file}: every touch of storage is the first line of a try`);
  }
});

test("one terminal: no «Pro» switch in the header, nothing of it in the browser's memory or on the page", () => {
  const header = read("./Header.tsx");
  assert.ok(!/Switch|setPro|usePro|w\.pro\b/.test(header), "the header keeps no switch");
  const shell = read("./TerminalShell.tsx");
  assert.ok(!/data-pro|PRO_BOOT_SCRIPT|hydratePro/.test(shell));
  assert.ok(!existsSync(new URL("./pro.ts", import.meta.url)), "no mode's module: a screen has one variant");
  assert.ok(!/data-pro/.test(read("./shell.module.css")));
});

test("the rail names its shelves; a person folds it to its icons, a desk under 1360 px folds it itself", () => {
  const shell = read("./TerminalShell.tsx");
  assert.match(shell, /hydrateRail\(\);\s*return forgetRail;/);
  assert.match(shell, /__html: RAIL_BOOT_SCRIPT/, "the folded rail stands on the root before the first paint");
  const rail = read("./Rail.tsx");
  assert.match(rail, /data-terminal="rail-fold" title=\{folded \? w\.railOpen : w\.railFold\}/);
  assert.match(rail, /onClick=\{\(\) => setRailFolded\(!folded\)\}/);
  const css = read("./shell.module.css");
  assert.match(css, /--rail: 228px|\.rail \{[^}]*flex: 0 0 var\(--rail\)/);
  assert.match(css, /:global\(html\[data-rail='folded'\]\) \.app \{\s*--rail: 72px;\s*\}/);
  assert.match(css, /:global\(html\[data-rail='folded'\]\) \.app :is\(\.brandWord, \.quietName\)/);
  assert.match(css, /@media \(min-width: 768px\) and \(max-width: 1359px\) \{\s*\.app \{\s*--rail: 72px;/);
});

test("the boot script reads the same key and sets the same attribute, inside try", async () => {
  const { RAIL_BOOT_SCRIPT, RAIL_KEY, RAIL_ATTR } = await import("./rail-fold.ts");
  assert.ok(RAIL_BOOT_SCRIPT.startsWith("try{") && RAIL_BOOT_SCRIPT.includes(RAIL_KEY) && RAIL_BOOT_SCRIPT.includes(RAIL_ATTR));
});

test("on a phone the frame's body, not the screen's column, keeps room for the sheet; the sheet stands under the header", () => {
  const split = read("./Split.tsx");
  assert.match(split, /closest\('main'\)/);
  assert.match(split, /body\.style\.setProperty\('--sheet-h'/);
  const shell = read("./shell.module.css");
  assert.match(shell, /calc\(var\(--tabbar\) \+ 16px \+ env\(safe-area-inset-bottom\) \+ var\(--sheet-h, 0px\)\)/);
  const css = read("./split.module.css");
  assert.doesNotMatch(css, /\.main \{\s*padding-bottom: var\(--sheet-h/);
  assert.match(css, /z-index: 3;/);
});

test("a phone's sheet stands open at first unless its screen starts it folded; the person's open or fold wins", () => {
  const split = read("./Split.tsx");
  assert.match(split, /sheetStart = 'open',/, "open by default: a screen that says nothing keeps its sheet as it was");
  assert.match(split, /useSide\(\(st\) => st\.sheet\[id\] \?\? sheetStart === 'open'\)/);
  // Folded is a phone's state: every rule that reads it stands under the phone's width, so a desk never changes.
  const css = read("./split.module.css");
  const phone = css.slice(css.indexOf("@media (max-width: 767px)"), css.indexOf("@keyframes"));
  assert.ok(phone.length > 0);
  assert.equal((phone.match(/\[data-folded\]/g) ?? []).length, (css.match(/\[data-folded\]/g) ?? []).length);
});

test("a release keeps the last width under the pointer, not the last rendered one", () => {
  const split = read("./Split.tsx");
  assert.match(split, /if \(liveRef\.current !== null\) setSideWidth\(id, liveRef\.current\);/);
});

test("the strip is a separator a keyboard can move, and the folded column stays mounted", () => {
  const split = read("./Split.tsx");
  assert.match(split, /role="separator"/);
  assert.match(split, /aria-orientation="vertical"/);
  assert.match(split, /onKeyDown=\{key\}/);
  assert.match(split, /onDoubleClick=\{\(\) => setSideWidth\(id, null\)\}/);
  // Folded, the side column's body is hidden by CSS, never left out of the tree: a ticket keeps what was typed.
  assert.match(split, /<div className=\{s\.sideBody\}>\{side\}<\/div>/);
  assert.doesNotMatch(split, /shut \? null : side|shut && side/);
  const css = read("./split.module.css");
  assert.match(css, /\.split\[data-shut\] \.sideBody \{\s*display: none;/);
  assert.match(css, /\.split\[data-phone='sheet'\]\[data-folded\] \.sideBody \{\s*display: none;/);
});
