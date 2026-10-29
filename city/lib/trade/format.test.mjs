import { test } from "node:test";
import assert from "node:assert/strict";

import { formatBps, formatImpact, formatRoute, formatUnits, shortAddress, ticker } from "./format.ts";

test("amounts are short for the eye and exact in their digits", () => {
  assert.equal(formatUnits("1500000", 6), "1.5");
  assert.equal(formatUnits("276912345", 6), "276.9");
  assert.equal(formatUnits("12345678", 6), "12.35");
  assert.equal(formatUnits("1234000000", 6), "1,234");
  assert.equal(formatUnits("12400000000", 6), "12.4K");
  assert.equal(formatUnits("1250000000000", 6), "1.25M");
  assert.equal(formatUnits("1234567890", 0), "1.23B");
  assert.equal(formatUnits("41", 6), "0.000041");
  assert.equal(formatUnits("0", 9), "0");
});

test("the least you get is rounded down, never up", () => {
  assert.equal(formatUnits("1492500", 6, "down"), "1.492");
  assert.equal(formatUnits("1492500", 6), "1.493");
  assert.equal(formatUnits("123456", 6, "down"), "0.1234");
  assert.equal(formatUnits("123456", 6), "0.1235");
  assert.equal(formatUnits("272799999", 6, "down"), "272.7");
});

test("a rounding that reaches the next unit says it in that unit", () => {
  assert.equal(formatUnits("999999600000", 6), "1M");
  assert.equal(formatUnits("999999600000", 6, "down"), "999K");
});

test("anything that is not a raw amount is a dash, never a guess", () => {
  assert.equal(formatUnits("abc", 6), "—");
  assert.equal(formatUnits("-5", 6), "—");
  assert.equal(formatUnits("5", -1), "—");
});

test("fee rates read as a person reads them", () => {
  assert.equal(formatBps(100), "1%");
  assert.equal(formatBps(50), "0.5%");
  assert.equal(formatBps(10), "0.1%");
  assert.equal(formatBps(25), "0.25%");
  assert.equal(formatBps(0), "0%");
  assert.equal(formatBps(Number.NaN), "—");
});

test("price impact is the venue's percent; a favourable move costs nothing", () => {
  assert.deepEqual(formatImpact("0.0005"), { text: "<0.01%", level: "low" });
  assert.deepEqual(formatImpact("0.12"), { text: "0.12%", level: "low" });
  assert.deepEqual(formatImpact("1.5"), { text: "1.5%", level: "notable" });
  assert.deepEqual(formatImpact("-6.25"), { text: "6.25%", level: "high" });
  assert.deepEqual(formatImpact(null), { text: "—", level: "low" });
  assert.deepEqual(formatImpact("not a number"), { text: "—", level: "low" });
});

test("a route names its pools, two at most", () => {
  assert.equal(formatRoute([{ label: "Whirlpool" }]), "Whirlpool");
  assert.equal(formatRoute([{ label: "Whirlpool" }, { label: "Meteora DLMM" }, { label: "Whirlpool" }]), "Whirlpool + Meteora DLMM");
  assert.equal(formatRoute([{ label: "A" }, { label: "B" }, { label: "C" }]), "A + 2 more");
  assert.equal(formatRoute([]), "Jupiter");
});

test("tickers and addresses", () => {
  assert.equal(ticker("WIF"), "$WIF");
  assert.equal(ticker("$WIF"), "$WIF");
  assert.equal(shortAddress("4EeXQa4MKrBSwDj9pHEoZXjiiUaZmWzveGq5X9dUKPGW"), "4EeX…KPGW");
});
