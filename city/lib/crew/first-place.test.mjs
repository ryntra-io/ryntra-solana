import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/*
 * CITY-241: the first screen's one action stands over the Deck, by the Agents — never over the sky and the coin over
 * the central tower — and waits while anything else stands in the bottom of the screen. While the scene builds, the
 * city's dusk and mark stand under the canvas instead of a black screen.
 */

const read = (path) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const noComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

test("the first action stands over the Deck, lower on a phone, at the bottom edge with the Deck hidden", () => {
  const css = read("city/components/hud/hud.module.css");
  assert.match(css, /\.firstHint \{\n  --deck-h: 78px;\n  position: absolute;\n  bottom: calc\(max\(14px, env\(safe-area-inset-bottom\)\) \+ var\(--deck-h\) \+ 50px\);/);
  assert.doesNotMatch(css, /\.firstHint \{[^}]*\btop:/);
  assert.match(css, /@media \(max-width: 560px\) \{\n  \.firstHint \{\n    --deck-h: 70px;/);
  assert.match(css, /\.layer\[data-deck-hidden\] \.firstHint \{\n  bottom: max\(34px, calc\(env\(safe-area-inset-bottom\) \+ 20px\)\);/);
  assert.match(read("city/components/hud/Hud.tsx"), /data-deck-hidden=\{deckShown \? undefined : ''\}/);
});

test("it waits while the Deck's doors, folded windows, a home card or the Hall's sheet stand in the bottom of the screen", () => {
  const hud = read("city/components/hud/Hud.tsx");
  assert.match(hud, /const doors = useBackPanels\(\(st\) => st\.open\.includes\('tray'\)\);/);
  assert.match(hud, /const folded = useWindows\(\(st\) => st\.chips\.length > 0\);/);
  assert.match(hud, /const homeCard = !\(menu \|\| settings \|\| hall\) && \(agentCard \|\| challenge !== null \|\| play \|\| nightCard\);/);
  assert.match(hud, /const hintAway = !!hall \|\| homeCard \|\| doors \|\| folded;/);
  assert.match(hud, /<FirstAction hidden=\{windowOpen \|\| trading \|\| !!selectedId \|\| launch\.showing \|\| nightPlaying \|\| agentAway \|\| hintAway\} \/>/);
});

test("nothing at the top still steps down for a hint that is no longer there", () => {
  for (const path of ["city/components/feed/feed.module.css", "city/components/lens/lens.module.css", "city/components/trade/mine.module.css", "city/components/hud/hud.module.css"]) {
    assert.doesNotMatch(noComments(read(path)), /city-hint/, path);
  }
  // Only the Deck's own hint over the Agents gives way to it.
  assert.match(noComments(read("city/components/deck/deck.module.css")), /:global\(body:has\(\[data-city-hint\]\)\) \.center::after \{\n    display: none;/);
});

test("while the scene builds the city's dusk stands under the canvas, from the server's first paint, and leaves once the city stands", () => {
  const app = read("city/components/CityApp.tsx");
  assert.match(app, /<CityLoading \/>\n      <CityCanvas \/>/);
  const loading = read("city/components/city/CityLoading.tsx");
  assert.match(loading, /const shown = useSkyline\(\(st\) => \(st\.ready && st\.lit\) \|\| st\.fallback\);/);
  // The same rule the canvas fades in by.
  assert.match(read("city/components/city/CityCanvas.tsx"), /const shown = useSkyline\(\(s\) => \(s\.ready && s\.lit\) \|\| s\.fallback\);/);
  assert.match(loading, /if \(!shown\) \{\n      setGone\(false\);/);
  assert.match(loading, /role="status"/);
  // No words on the screen; the mark, not a spinner of the browser.
  assert.match(loading, /<Mark size=\{52\} \/>/);
  assert.match(loading, /\{!shown && <span className=\{s\.said\}>\{w\.cityLoading\}<\/span>\}/);
  const css = read("city/components/city/loading.module.css");
  assert.match(css, /\.loading \{\n  position: fixed;\n  inset: 0;/);
  assert.doesNotMatch(noComments(css), /z-index/, "under the canvas and the HUD by the page's own order");
});
