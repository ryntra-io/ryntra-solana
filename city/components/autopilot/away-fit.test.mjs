// CITY-201: «While you were away» on a desk. A fixed 420 px cut «+0,008 SOL» to «+0,008 S…» beside the Ukrainian
// «Опублікувати в X», and with the lens as a strip under the top bar the card lay over its chips.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("./autopilot.module.css", import.meta.url), "utf8");
const away = css.match(/\n\.away \{([^}]*)\}/u)?.[1] ?? "";

test("the card is as wide as its line and its button, never past the screen", () => {
  assert.match(away, /width: max-content;/u);
  assert.match(away, /max-width: calc\(100vw - 32px\);/u);
  assert.doesNotMatch(away, /\n\s*width: min\(420px/u, "a fixed width cuts the sum");
});

test("with the lens as a strip under the bar, the card steps down by the strip's height", () => {
  assert.match(css, /:global\(body\):has\(\[data-lens-place='below'\]\) \.away \{\s*margin-top: var\(--lens-strip, 58px\);/u);
  // The lens names its place, which the card reads.
  assert.match(readFileSync(new URL("../lens/LensBar.tsx", import.meta.url), "utf8"), /data-lens-place=\{place === null \? 'below' : 'inline'\}/u);
});
