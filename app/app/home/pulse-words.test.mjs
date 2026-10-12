import assert from "node:assert/strict";
import test from "node:test";

import { ageText, changeText, parseBound, pctText } from "./pulse-words.ts";

test("a typed bound is read the reader's way: English commas group, Ukrainian spaces group and commas mark the cents", () => {
  assert.equal(parseBound("10,000", "en"), 10_000);
  assert.equal(parseBound("1,000,000", "en"), 1_000_000);
  assert.equal(parseBound("1.5", "en"), 1.5);
  assert.equal(parseBound("10k", "en"), 10_000);
  assert.equal(parseBound("2.5m", "en"), 2_500_000);
  assert.equal(parseBound("$50,000", "en"), 50_000);
  assert.equal(parseBound("10 000", "uk"), 10_000);
  assert.equal(parseBound("0,5", "uk"), 0.5);
  assert.equal(parseBound("1.5", "uk"), 1.5);
  assert.equal(parseBound("10к", "uk"), 10_000);
  assert.equal(parseBound("", "en"), null);
  assert.equal(parseBound("abc", "en"), "invalid");
  assert.equal(parseBound("10,0", "en"), "invalid", "an English comma groups three digits or is not a number");
  assert.equal(parseBound("1,000", "uk"), 1, "a Ukrainian comma marks the decimals");
});

test("figures: a change as wide as a row allows, shares and ages in their shortest honest form", () => {
  assert.equal(changeText(12.345, "en-US"), "+12.35%");
  assert.equal(changeText(-205.71, "en-US"), "−205.7%");
  assert.equal(changeText(28536.4, "uk-UA"), "+28536%");
  assert.equal(changeText(null, "en-US"), "—");
  assert.equal(pctText(12.44, "en-US"), "12.4%");
  assert.equal(pctText(12.44, "uk-UA"), "12,4%");
  assert.equal(pctText(0.03, "uk-UA"), "<0,1%", "a curve barely started is not «0%»");
  assert.equal(pctText(0, "en-US"), "0%");
  assert.equal(ageText(0.01, "en"), "36s");
  assert.equal(ageText(3, "uk"), "3 год");
  assert.equal(ageText(null, "en"), "—");
});
