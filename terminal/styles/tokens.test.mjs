import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { PALETTE } from "../../city/lib/palette.ts";
import { TYPE } from "../../city/styles/brand.ts";

/* The terminal's colours and sizes are the brand's: the same values as the city's palette and type scale, and the
   approved design's own (docs/terminal/design/2026-11-16/ryntra.css). */

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const css = read("./terminal.module.css");
/* The approved design lives beside the code in the development repository; a checkout without it skips the comparison. */
const DESIGN = new URL("../../docs/terminal/design/2026-11-16/ryntra.css", import.meta.url);
const design = existsSync(DESIGN) ? readFileSync(DESIGN, "utf8") : "";

/** The custom properties a stylesheet sets, lower case. */
function tokens(source) {
  return Object.fromEntries([...source.matchAll(/(--[a-z-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim().toLowerCase()]));
}

const ours = tokens(css);
const theirs = tokens(design);

test("the brand's lights are the city's palette", () => {
  const pairs = { "--ink": PALETTE.ink, "--ink-deep": PALETTE.inkDeep, "--haze": PALETTE.violetHaze, "--violet": PALETTE.violet, "--amber": PALETTE.amber, "--warm": PALETTE.warmWhite, "--mint": PALETTE.mint, "--flare": PALETTE.flare, "--ice": PALETTE.ice };
  for (const [token, value] of Object.entries(pairs)) assert.equal(ours[token], value.toLowerCase(), token);
});

/* The cut is the terminal's own since 17.11 (20 px on the panel a screen acts in, 12 px on its button):
   terminal/styles/form.test.mjs holds it. */
test("every colour of the approved design stands as it set them", { skip: !design && "the approved design is not in this checkout" }, () => {
  for (const token of ["--ink", "--ink-deep", "--haze", "--violet", "--lilac", "--amber", "--warm", "--mint", "--flare", "--ice", "--dim", "--panel", "--panel-up", "--well", "--edge", "--edge-soft", "--line"]) {
    assert.equal(ours[token], theirs[token], token);
  }
});

test("the type scale is the brandbook's", () => {
  for (const step of TYPE) assert.equal(ours[step.token], `${step.px}px`, step.token);
});

test("the faces: Hubot Sans for the numbers, Geist for the words, Mona Sans and the Cyrillic beneath", () => {
  assert.match(css, /--display: var\(--font-zero, 'Ryntra Zero'\), var\(--font-display/);
  assert.match(css, /--ui: var\(--font-geist, 'Geist'\), var\(--font-ui/);
  const layout = readFileSync(new URL("../../app/(terminal)/layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /CITY_FONTS\.className/);
  assert.match(layout, /LANG_BOOT_SCRIPT/);
});

test("the numbers' zero is plain: one glyph of the terminal's own, ahead of Hubot Sans for U+0030 alone", () => {
  const zero = read("./zero.ts");
  assert.match(zero, /src: '\.\/zero\/ryntra-zero\.woff2'/);
  assert.match(zero, /variable: '--font-zero'/);
  assert.match(zero, /\{ prop: 'unicode-range', value: 'U\+0030' \}/, "the one digit, nothing else");
  assert.match(zero, /weight: '200 900'/, "every weight of the numbers");
  assert.match(zero, /\{ prop: 'font-stretch', value: '75% 125%' \}/, "every width of the numbers");
  const file = readFileSync(new URL("./zero/ryntra-zero.woff2", import.meta.url));
  assert.equal(file.subarray(0, 4).toString("latin1"), "wOF2");
  assert.ok(file.length < 8192, "one glyph is a few kilobytes");
  const layout = readFileSync(new URL("../../app/(terminal)/layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /\$\{ZERO\.variable\}/, "on the terminal's root — the city and the share cards keep their numbers");
  assert.ok(!/font-zero|ryntra-zero/.test(readFileSync(new URL("../../city/styles/fonts.ts", import.meta.url), "utf8")));
});
