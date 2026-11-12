import { test } from "node:test";
import assert from "node:assert/strict";

import { trayCentre } from "./tray.ts";

// A desk 1440 wide: the Deck is 660 wide in the middle (left 390); Spot's middle 533, Agents' 720, the Arena's 818.
test("on a desk the tray stands over the place pressed, not in the Deck's middle", () => {
  assert.equal(trayCentre(390, 533, 348, 1440, 16), 533 - 390);
  assert.equal(trayCentre(390, 720, 348, 1440, 16), 720 - 390);
  assert.equal(trayCentre(390, 818, 236, 1440, 16), 818 - 390);
});

// A phone 390 wide: the Deck runs gutter to gutter (left 16); Spot's middle 91, the tray of three doors 324 wide.
test("on a phone a tray near the edge moves in only as far as the screen's edge asks, and still covers the place", () => {
  const centre = trayCentre(16, 91, 324, 390, 16);
  const left = 16 + centre - 324 / 2;
  assert.equal(left, 16, "the tray's left edge stands on the city's edge");
  assert.ok(left <= 91 && left + 324 >= 91, "the place pressed is under the tray");
  // The Arena's two doors (220 wide) over its middle 251 fit there as they are.
  assert.equal(trayCentre(16, 251, 220, 390, 16), 251 - 16);
  // The money side: a tray pressed near the right edge stops at it.
  const right = 16 + trayCentre(16, 360, 324, 390, 16) + 324 / 2;
  assert.equal(right, 390 - 16);
});

test("a tray wider than the screen keeps the screen's middle", () => {
  assert.equal(trayCentre(0, 40, 500, 400, 16), 200);
});

// A window as tall as the workspace (CITY-242) reaches the Deck's top: the tray, inside the HUD's layer, stood under it.
test("the open tray stands in a layer of its own over the city's windows", async () => {
  const { readFileSync } = await import("node:fs");
  const read = (file) => readFileSync(new URL(file, import.meta.url), "utf8").replace(/\r\n/g, "\n").replace(/\/\*[\s\S]*?\*\//g, "");
  const z = (file, selector) => Number(new RegExp(`\\n${selector.replace(/[.]/g, "\\$&")} \\{[^}]*z-index: (\\d+);`, "u").exec(read(file))?.[1]);
  const tray = z("../../components/deck/deck.module.css", ".trayLayer");
  const windows = z("../../components/window/window.module.css", ".layer");
  assert.ok(tray > windows, `the tray's layer ${tray} over the windows' ${windows}`);
  const deck = read("../../components/deck/Deck.tsx");
  assert.match(deck, /createPortal\(\s*<div className=\{s\.trayLayer\}>/u);
  // A tap inside the tray is not a tap «outside» the Deck.
  assert.match(deck, /!ref\.current\?\.contains\(target\) && !trayRef\.current\?\.contains\(target\)/u);
});
