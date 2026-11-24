import assert from "node:assert/strict";
import test from "node:test";

import { darkLogo, LOGO_SAMPLE } from "./logo-tone.ts";

/* A logo in dark ink stands on a light disc; every other logo reads as it is. By the pixels, not by a list. */

const SIDE = LOGO_SAMPLE;
/** A picture of SIDE × SIDE: `paint(x, y)` → [r, g, b, a]. */
const picture = (paint) => {
  const out = new Uint8ClampedArray(SIDE * SIDE * 4);
  for (let y = 0; y < SIDE; y += 1) for (let x = 0; x < SIDE; x += 1) out.set(paint(x, y), (y * SIDE + x) * 4);
  return out;
};
const inDisc = (x, y, r = SIDE / 2 - 1) => (x - SIDE / 2 + 0.5) ** 2 + (y - SIDE / 2 + 0.5) ** 2 <= r * r;
const CLEAR = [0, 0, 0, 0];

test("a black mark on a clear ground is dark ink — Anthropic's logo on ANT", () => {
  /* A black «A»-ish wedge on transparency, its edges softened. */
  const mark = picture((x, y) => (Math.abs(x - SIDE / 2) <= y / 3 && y > 4 ? [8, 8, 10, 255] : y > 4 && Math.abs(x - SIDE / 2) <= y / 3 + 1 ? [20, 20, 22, 120] : CLEAR));
  assert.equal(darkLogo(mark), true);
  /* A near-black navy disc with nothing light on it. */
  assert.equal(darkLogo(picture((x, y) => (inDisc(x, y) ? [16, 18, 40, 255] : CLEAR))), true);
});

test("a light, a colourful, or a dark logo with a light mark reads as it is", () => {
  /* White mark on clear ground. */
  assert.equal(darkLogo(picture((x, y) => (inDisc(x, y, 6) ? [250, 250, 250, 255] : CLEAR))), false);
  /* Solana's violet-to-mint, Jupiter's lime: colour, not ink. */
  assert.equal(darkLogo(picture((x, y) => (inDisc(x, y) ? [153 - x * 3, 69 + y * 7, 255 - y * 4, 255] : CLEAR))), false);
  assert.equal(darkLogo(picture((x, y) => (inDisc(x, y) ? [199, 242, 132, 255] : CLEAR))), false);
  /* A black disc with a white letter on it: the letter reads on the glass. */
  assert.equal(darkLogo(picture((x, y) => (inDisc(x, y) ? (inDisc(x, y, 5) ? [255, 255, 255, 255] : [0, 0, 0, 255]) : CLEAR))), false);
  /* A mid-grey logo is not ink. */
  assert.equal(darkLogo(picture((x, y) => (inDisc(x, y) ? [110, 110, 110, 255] : CLEAR))), false);
});

test("a picture with nothing seen, or no pixels at all, is not judged dark", () => {
  assert.equal(darkLogo(picture(() => CLEAR)), false);
  assert.equal(darkLogo(new Uint8ClampedArray(0)), false);
  /* One dark pixel in a clear picture is too little to judge. */
  assert.equal(darkLogo(picture((x, y) => (x === 3 && y === 3 ? [0, 0, 0, 255] : CLEAR))), false);
});
