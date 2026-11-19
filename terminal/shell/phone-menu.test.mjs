import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { FLICK_PX, PULL_AWAY_PX, SHEET_KEY, isSheetEntry, pullCloses, sheetEntry, withoutSheet } from "./sheet-moves.ts";
import { SHELL } from "./words.ts";

/* The phone's menu: a button with three lines first in the
   header, the mark beside it leading home, and a sheet over the screen that goes in every way a phone's sheet goes. */

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the header's first control is the menu's button, named «Menu», with room for a thumb; the mark leads home", () => {
  const header = read("./Header.tsx");
  const button = header.indexOf('data-terminal="menu-button"');
  const mark = header.indexOf('data-terminal="mark"');
  assert.ok(button > 0 && mark > button, "the button stands before the mark");
  assert.match(header, /className=\{`\$\{s\.iconBtn\} \$\{s\.menuBtn\}`\}[\s\S]*?aria-label=\{w\.menu\}[\s\S]*?onClick=\{\(\) => togglePanel\('sheet'\)\}/);
  assert.match(header, /<Icon name="menu"/);
  assert.match(header, /<Link className=\{s\.phoneMark\} data-terminal="mark" href=\{home\} aria-label=\{w\.home\}>/, "the mark is a link home, not the menu");
  assert.ok(!/phoneMark[^>]*onClick/.test(header), "a tap on the mark opens nothing");
  assert.deepEqual([SHELL.en.menu, SHELL.uk.menu], ["Menu", "Меню"]);
  const css = read("./shell.module.css");
  // 44 px a side: the frame's icon button.
  assert.match(css, /\.iconBtn \{[^}]*width: 44px;[^}]*height: 44px;/);
  assert.match(css, /\.top > \.menuBtn,\s*\.phoneMark \{\s*display: none;/, "on a desk the rail is the menu");
  assert.match(css, /@media \(max-width: 767px\) \{[\s\S]*\.top > \.menuBtn,\s*\.phoneMark \{\s*display: flex;/);
});

test("a pull down takes the sheet away when long enough or quick enough; a short slow one settles back", () => {
  assert.equal(pullCloses(PULL_AWAY_PX, 2_000), true);
  assert.equal(pullCloses(PULL_AWAY_PX - 1, 2_000), false);
  assert.equal(pullCloses(FLICK_PX, 30), true, "a flick");
  assert.equal(pullCloses(FLICK_PX - 1, 10), false, "too short even for a flick");
  assert.equal(pullCloses(0, 10), false);
  assert.equal(pullCloses(-40, 10), false, "up is the list's scroll");
  assert.equal(pullCloses(Number.NaN, 10), false);
});

test("the sheet stands on an entry of the history of its own, the page's state kept beside its mark", () => {
  const next = { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: ["", {}] };
  const entry = sheetEntry(next);
  assert.equal(entry.__NA, true, "Next.js's own state stays");
  assert.deepEqual(entry.__PRIVATE_NEXTJS_INTERNALS_TREE, next.__PRIVATE_NEXTJS_INTERNALS_TREE);
  assert.equal(entry[SHEET_KEY], true);
  assert.equal(isSheetEntry(entry), true);
  assert.equal(isSheetEntry(next), false);
  assert.equal(isSheetEntry(null), false);
  assert.deepEqual(sheetEntry(null), { [SHEET_KEY]: true });
  assert.deepEqual(sheetEntry([1]), { [SHEET_KEY]: true });
  // A page reloaded on the sheet's entry takes the mark off, Next.js's state kept, and loads nothing again.
  assert.deepEqual(withoutSheet(entry), next);
  assert.equal(isSheetEntry(withoutSheet(entry)), false);
  assert.match(read("./SectionsSheet.tsx"), /if \(isSheetEntry\(state\)\) window\.history\.replaceState\(withoutSheet\(state\), ''\);/);
});

test("every way the sheet goes: its close, a pull, Back, a tap outside, Escape — and a screen opens only after its entry is given back", () => {
  const sheet = read("./SectionsSheet.tsx");
  assert.match(sheet, /window\.history\.pushState\(sheetEntry\(window\.history\.state\), ''\)/);
  assert.match(sheet, /window\.addEventListener\('popstate', back\)/, "Back closes it");
  assert.match(sheet, /className=\{s\.scrim\}[^>]*onClick=\{\(\) => void closeSheet\(\)\}/, "a tap outside");
  assert.match(sheet, /className=\{s\.closeBtn\} aria-label=\{w\.close\} onClick=\{\(\) => void closeSheet\(\)\}/, "the close");
  assert.match(sheet, /event\.key === 'Escape'[\s\S]*?void closeSheet\(\)/);
  assert.match(sheet, /if \(pullCloses\(pulled, performance\.now\(\) - since\)\)/, "a pull");
  assert.match(sheet, /addEventListener\('touchmove', move, \{ passive: false \}\)/, "the pull holds the page still");
  assert.match(sheet, /void closeSheet\(\)\.then\(\(back\) => \{[\s\S]*?if \(back\) router\.push\(href\);\s*else router\.replace\(href\);/, "a screen opens after the entry is back: Back from it returns to the page");
  assert.match(sheet, /function closeSheet\(\): Promise<boolean> \{\s*closePanel\('sheet'\);\s*return giveBack\(\);/);
  // A page loaded whole from the sheet (the city, the site's pages) goes the same way.
  assert.match(sheet, /data-terminal="sheet-scroll" onClick=\{leave\}/);
  assert.match(sheet, /\(back \? window\.location\.assign\(href\) : window\.location\.replace\(href\)\)/);
  // Another site (a wallet's app link) opens from the tap itself.
  assert.match(sheet, /if \(link\.origin !== window\.location\.origin\) return;\s*event\.preventDefault\(\);/);
  const css = read("./shell.module.css");
  assert.match(css, /\.sheet \{[^}]*top: 64px;[^}]*bottom: 0;/, "over the whole screen under the header's strip");
  assert.match(css, /\.sheet\[data-leaving\] \{[^}]*animation: away 0\.2s ease-in forwards;/, "it leaves smoothly");
  assert.match(css, /\.sheetScroll \{[^}]*overflow-y: auto;[^}]*overscroll-behavior: contain;/, "its list scrolls inside it");
  assert.match(css, /\.scrim \{[^}]*touch-action: none;/);
});

test("the sheet has the Market and the same groups as the rail; another site says which, with its arrow", () => {
  const sheet = read("./SectionsSheet.tsx");
  assert.match(sheet, /const \{ view, groups, marketOn, at \} = useMenu\(\);/, "the rail's own menu");
  assert.match(sheet, /href=\{itemHref\(MARKET_ITEM, view\)\}\s*aria-current=\{at === 'market' \? 'page' : undefined\}/);
  assert.match(sheet, /aria-current=\{item\.id === at \? 'page' : undefined\}/, "the place a person is in is lit");
  assert.match(sheet, /\{hostOf\(item\.out\)\}[\s\S]*?<MenuIcon name="out" small \/>/);
  assert.match(read("./shell.module.css"), /\.sheetGroup\[data-lit\] \.ghIcon \{\s*color: var\(--amber\);/);
});
