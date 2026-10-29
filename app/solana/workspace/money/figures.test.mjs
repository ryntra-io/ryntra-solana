import assert from "node:assert/strict";
import test from "node:test";

import { localFigure } from "./figures.ts";

test("a figure reads in the page's language, digits untouched", () => {
  assert.equal(localFigure("1,234.5", "uk"), "1 234,5");
  assert.equal(localFigure("120.5", "uk"), "120,5");
  assert.equal(localFigure("95,500,000", "uk"), "95 500 000");
  assert.equal(localFigure("1,234.5", "en"), "1,234.5");
  assert.equal(localFigure("0.000005", "uk"), "0,000005");
});

test("a line of words keeps its words and its arrows; only its figures change", () => {
  assert.equal(localFigure("Обміняно 1.5 SOL → 1,270.3 USDC", "uk"), "Обміняно 1,5 SOL → 1 270,3 USDC");
  assert.equal(localFigure("Надіслано 25 USDC", "uk"), "Надіслано 25 USDC");
  assert.equal(localFigure("Так, 3. Далі", "uk"), "Так, 3. Далі");
});
