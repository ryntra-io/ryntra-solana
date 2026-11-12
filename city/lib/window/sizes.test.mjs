import { test } from "node:test";
import assert from "node:assert/strict";

import { areaOf } from "./geometry.ts";
import { coverIn, emptyLayout, openIn } from "./layout.ts";
import { firstSize } from "./sizes.ts";

const SPOT = { least: 980, most: 1320 };
const at = (width, height) => ({ width, height });

test("a 900 px desk: as tall as the workspace, as wide as the city's share allows", () => {
  const size = firstSize(at(1440, 900), SPOT, 900);
  assert.equal(size.height, areaOf(at(1440, 900)).height);
  assert.ok(size.width >= 980 && size.width <= 1100, `${size.width}`);
  assert.ok((size.width * size.height) / (1440 * 900) <= 0.6, "the city keeps 40 %");
});

test("a large desk gets a larger window, never more than it asks", () => {
  const desk = firstSize(at(1440, 900), SPOT, 900);
  const wide = firstSize(at(1920, 1080), SPOT, 900);
  const big = firstSize(at(2560, 1305), SPOT, 900);
  assert.deepEqual(big, { width: 1320, height: 900 });
  assert.deepEqual(wide, { width: 1320, height: 900 });
  assert.ok(big.width > desk.width && big.height > desk.height);
});

test("a short or narrow desk keeps the window's narrowest and the workspace", () => {
  const short = firstSize(at(1440, 800), SPOT, 900);
  assert.equal(short.height, areaOf(at(1440, 800)).height);
  const narrow = firstSize(at(1000, 900), SPOT, 900);
  assert.ok(narrow.width <= areaOf(at(1000, 900)).width);
});

test("the frame opens the window at that size, whole, without shrinking it for the city's share", () => {
  for (const screen of [at(1440, 900), at(1440, 800), at(1920, 1080), at(2560, 1305)]) {
    const size = firstSize(screen, SPOT, 900);
    const layout = openIn(emptyLayout(screen), { id: "spot", size, min: { width: 380, height: 480 } });
    const rect = layout.windows[0].rect;
    assert.deepEqual([rect.width, rect.height], [size.width, size.height], `${screen.width}×${screen.height}`);
    assert.ok(coverIn(layout) <= 0.6);
  }
});

/* The review of CITY-242: the chips of folded windows stood over the diamond, in a layer over the windows, and a window
   as tall as the workspace has its foot there — its one action under a chip. On a wide desk they stand on the Deck's
   row, under the workspace's bottom edge, so no window reaches them. */
test("on a wide desk the folded windows' chips stand under the workspace, beside the Deck", async () => {
  const { readFileSync } = await import("node:fs");
  const { INSET } = await import("./geometry.ts");
  const css = readFileSync(new URL("../../components/window/window.module.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const rule = /\n\.foldBeside \{([^}]*)\}/u.exec(css)?.[1] ?? "";
  const lift = Number(/bottom: calc\(max\(14px, env\(safe-area-inset-bottom\)\) \+ (\d+)px\);/u.exec(rule)?.[1]);
  const chip = Number(/\n\.chip \{[^}]*height: (\d+)px;/u.exec(css)?.[1]) + 4;
  assert.ok(14 + lift + chip <= INSET.bottom, `the chips' top ${14 + lift + chip} px from the bottom, the workspace ends at ${INSET.bottom}`);
  assert.match(rule, /left: calc\(50% \+ min\(330px, 50vw - var\(--gutter\)\) \+ 12px\);/u, "right of the Deck (660 px at the most, in the middle), clear of «Snap together» on the left");
  const tray = readFileSync(new URL("../../components/window/Tray.tsx", import.meta.url), "utf8");
  assert.match(tray, /const beside = useWindows\(\(st\) => st\.desk && st\.viewport\.width >= CHIPS_BESIDE_FROM\) && deck;/u);
});

// Narrower than that the chips stand over the diamond, at the workspace's foot: a window the system places leaves
// their band clear (the second review of CITY-242: a 960 px browser, Spot's action under a chip).
test("on a narrower desk the windows the system places leave the chips' band clear", async () => {
  const { CHIP_ROOM, CHIPS_BESIDE_FROM, openRect, tallestIn } = await import("./geometry.ts");
  const narrow = areaOf(at(960, 1040));
  assert.equal(tallestIn(narrow), narrow.height - CHIP_ROOM);
  const rect = openRect({ width: 900, height: 2000 }, { width: 380, height: 480 }, narrow, 0);
  assert.ok(rect.y + rect.height <= narrow.y + narrow.height - CHIP_ROOM, "the window ends above the chips");
  assert.equal(firstSize(at(960, 1040), SPOT, 900).height, Math.min(900, narrow.height - CHIP_ROOM));
  // From where the chips stand beside the Deck, all the workspace's height.
  assert.equal(tallestIn(areaOf(at(CHIPS_BESIDE_FROM, 900))), areaOf(at(CHIPS_BESIDE_FROM, 900)).height);
});
