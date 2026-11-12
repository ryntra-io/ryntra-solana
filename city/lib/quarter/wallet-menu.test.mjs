// Run from repo root: node --test city/lib/quarter/wallet-menu.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { MENU_GAP, MENU_TOP_MIN, menuPlace, TABBABLE, tabTo } from "./wallet-menu.ts";

const read = (file) => readFileSync(new URL(file, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const css = (file) => read(file).replace(/\/\*[\s\S]*?\*\//g, "");

/* CITY-239: only the wallet's panel stands over the windows. CITY-236 lifted the whole layer of the top bar while the
   panel was open, and the city's event slab («NEW TOWER · NEW POOL») and the home's cards lay on the Ring's window. */

test("the panel stands under its chip, its right edge on the chip's", () => {
  assert.deepEqual(menuPlace({ bottom: 56, right: 1316 }, 1440), { top: 56 + MENU_GAP, right: 124 });
  assert.deepEqual(menuPlace({ bottom: 55.6, right: 1315.5 }, 1440), { top: 64, right: 125 }, "whole pixels: the panel's edge never blurs");
});

test("a chip out of sight still gets its panel on the screen", () => {
  // The top bar folded away (it slides up past the screen's top) while the Ring asks for the wallet.
  assert.equal(menuPlace({ bottom: -40, right: 1316 }, 1440).top, MENU_TOP_MIN);
  assert.equal(menuPlace({ bottom: 56, right: 1500 }, 1440).right, 0, "never past the screen's right edge");
});

test("the top bar's layer is no longer lifted over the windows", () => {
  const hud = css("../../components/hud/hud.module.css");
  // Rules that restyle a piece inside the layer by what is open (`.layer:has(…) .slot`) are not this: none sets the
  // layer's own place among the city's layers.
  assert.doesNotMatch(hud, /\.layer:has\([^)]*\)\s*\{/u, "no rule lifts the HUD's layer by what is open in it");
  assert.doesNotMatch(hud, /data-wallet-menu/u);
  const layer = /\.layer \{([^}]*)\}/u.exec(hud)?.[1] ?? "";
  assert.match(layer, /z-index: 10;/u, "the HUD stays under the windows (12)");
});

test("the wallet's panel has a layer of its own over the windows, on a desk and on a phone", () => {
  const wallet = css("../../components/quarter/wallet.module.css");
  const over = /\.over \{([^}]*)\}/u.exec(wallet)?.[1] ?? "";
  assert.match(over, /position: fixed;/u);
  assert.match(over, /pointer-events: none;/u, "the layer itself takes no tap: the window under it stays alive");
  const z = Number(/z-index: (\d+);/u.exec(over)?.[1]);
  const windows = css("../../components/window/window.module.css");
  const frames = Math.max(...[...windows.matchAll(/\.(?:layer|sheet) \{[^}]*z-index: (\d+);/gu)].map((m) => Number(m[1])));
  assert.equal(frames, 12, "the frame's windows and the phone's sheet");
  assert.ok(z > frames, `the panel's layer (${z}) is over the windows (${frames})`);
  // No width decides it: the rule of CITY-236 held from 900 px up only, and a phone's whole-screen window hid the list.
  assert.doesNotMatch(wallet, /@media[^{]*\{\s*\.over \{/u);
  assert.match(wallet, /\.menu \{[^}]*position: fixed;[^}]*top: var\(--wallet-top/u);
});

test("the chip draws its panel into that layer, at the chip's place, and a tap inside it is not «outside»", () => {
  const chip = read("../../components/quarter/WalletChip.tsx");
  assert.match(chip, /createPortal\(/u);
  assert.match(chip, /closest\('main'\)/u, "inside the city's root, where its tokens are");
  assert.match(chip, /menuPlace\(/u);
  assert.equal(chip.match(/data-wallet-menu=""/gu)?.length, 2, "the list of wallets and the wallet's own menu");
  assert.match(chip, /wrap\.current\?\.contains\(target\) \|\| panel\.current\?\.contains\(target\)/u);
  assert.equal(chip.match(/<div ref=\{panel\} className=\{`\$\{s\.panel\} \$\{w\.menu\}`\}/gu)?.length, 2, "both panels are the one a tap is looked for in");
  // The keyboard follows the panel out of the chip's box: in from the chip, back to it on close.
  assert.match(chip, /if \(button && button === document\.activeElement\) box\?\.querySelector<HTMLElement>\('button, a\[href\]'\)\?\.focus\(/u);
  assert.match(chip, /if \(box\?\.contains\(document\.activeElement\)\) button\?\.focus\(/u);
  // The chip itself stays in the top bar, «expanded» while its panel is open: Escape in the HUD still waits for it.
  assert.match(chip, /aria-expanded=\{showing\}/u);
  assert.match(chip, /useBackPanel\('wallet', showing, close\)/u, "«Back» closes the panel first, as before");
});

/* CITY-240: the panel is drawn at the end of the page, so the page's own order no longer leads from the chip into it.
   Tab from the chip went along the top bar and reached the panel last; Shift+Tab from the panel's first button went to
   whatever stands before the page's end. */
test("Tab goes chip → the panel's controls → what follows the chip; Shift+Tab walks the same way back", () => {
  // Signed out: «Settings», «Sign in», «Disconnect».
  assert.equal(tabTo("chip", 3, false), "first");
  assert.equal(tabTo(0, 3, false), null, "inside the panel the page's own order is right: its controls stand together");
  assert.equal(tabTo(1, 3, false), null);
  assert.equal(tabTo(2, 3, false), "after", "from the last control on to the rest of the top bar");
  assert.equal(tabTo("after", 3, true), "last");
  assert.equal(tabTo(2, 3, true), null);
  assert.equal(tabTo(0, 3, true), "chip", "Shift+Tab from the first control is the chip again");
  // One control (the way to a wallet): both ends at once.
  assert.equal(tabTo(0, 1, false), "after");
  assert.equal(tabTo(0, 1, true), "chip");
});

test("nothing is trapped: past the panel's two ends, and anywhere else, the page's own order goes on", () => {
  assert.equal(tabTo("chip", 3, true), null, "Shift+Tab from the chip: whatever stands before it in the top bar");
  assert.equal(tabTo("after", 3, false), null, "Tab from the control after the chip: on along the bar");
  assert.equal(tabTo(null, 3, false), null);
  assert.equal(tabTo(null, 3, true), null);
  // A panel with nothing to stop on (a line of words alone) is passed by.
  assert.equal(tabTo("chip", 0, false), null);
  assert.equal(tabTo("after", 0, true), null);
});

test("the panel keeps that order by hand, and only while it is open", () => {
  const chip = read("../../components/quarter/WalletChip.tsx");
  assert.match(chip, /const to = tabTo\(at, inside\.length, event\.shiftKey\);/u);
  assert.match(chip, /if \(event\.key !== 'Tab' \|\| event\.altKey \|\| event\.ctrlKey \|\| event\.metaKey \|\| event\.defaultPrevented\) return;/u);
  // Only a move the rule names is made by hand; everything else is the browser's own Tab.
  assert.match(chip, /if \(!target\) return;\s+event\.preventDefault\(\);\s+target\.focus\(\);/u);
  assert.match(chip, /if \(!shown\) return;\s+const stops = /u, "no listener without a panel");
  // What Tab can stop on: nothing switched off, nothing taken out of the order.
  for (const piece of ["a[href]", "button:not([disabled])", '[tabindex]:not([tabindex="-1"])']) assert.ok(TABBABLE.includes(piece), piece);
  // Escape still hands the keyboard back to the chip (CITY-239).
  assert.match(chip, /if \(box\?\.contains\(document\.activeElement\)\) button\?\.focus\(/u);
});
