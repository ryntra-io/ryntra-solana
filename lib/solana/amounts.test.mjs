import { test } from "node:test";
import assert from "node:assert/strict";

import { displayAmount, parseHumanAmount, scaleRawAmount } from "./amounts.ts";

test("scaling places the point exactly and never rounds", () => {
  assert.equal(scaleRawAmount("1000000000", 9), "1.000000000");
  assert.equal(scaleRawAmount("75950470", 6), "75.950470");
  assert.equal(scaleRawAmount("1", 6), "0.000001");
  assert.equal(scaleRawAmount("0", 6), "0.000000");
  assert.equal(scaleRawAmount("5034943006584019", 6), "5,034,943,006.584019");
  assert.equal(scaleRawAmount("42", 0), "42");
  /* Bigger than any float could hold without lying. */
  assert.equal(scaleRawAmount("123456789012345678901234567", 9), "123,456,789,012,345,678.901234567");
});

test("parsing walks back exactly and round-trips", () => {
  assert.deepEqual(parseHumanAmount("1", 9), { ok: true, raw: "1000000000" });
  assert.deepEqual(parseHumanAmount("0.5", 9), { ok: true, raw: "500000000" });
  assert.deepEqual(parseHumanAmount("100", 6), { ok: true, raw: "100000000" });
  assert.deepEqual(parseHumanAmount("0.000001", 6), { ok: true, raw: "1" });
  assert.deepEqual(parseHumanAmount("07", 0), { ok: true, raw: "7" });
  for (const [human, decimals] of [
    ["1.25", 6],
    ["0.000000001", 9],
    ["12345.6789", 4],
  ]) {
    const parsed = parseHumanAmount(human, decimals);
    assert.ok(parsed.ok);
    const [whole, fraction = ""] = String(human).split(".");
    const expected = scaleRawAmount(parsed.raw, decimals);
    assert.equal(expected.replace(/,/g, "").replace(/0+$/, "").replace(/\.$/, ""), `${Number(whole) === 0 ? "0" : whole}${fraction ? "." + fraction.replace(/0+$/, "") : ""}`.replace(/\.$/, ""));
  }
});

test("displayAmount strips trailing zeros without rounding", () => {
  assert.equal(displayAmount("0", 9), "0");
  assert.equal(displayAmount("1000000000", 9), "1");
  assert.equal(displayAmount("95500000000000", 6), "95,500,000");
  assert.equal(displayAmount("1", 6), "0.000001");
});

test("refusals are sentences, not silent rounding", () => {
  assert.equal(parseHumanAmount("1.2345678901", 9).ok, false);
  assert.equal(parseHumanAmount("-1", 9).ok, false);
  assert.equal(parseHumanAmount("1e9", 9).ok, false);
  assert.equal(parseHumanAmount("0", 9).ok, false);
  assert.equal(parseHumanAmount("0.000", 9).ok, false);
  assert.equal(parseHumanAmount("", 9).ok, false);
  assert.equal(parseHumanAmount("1,000", 9).ok, false);
  const tooPrecise = parseHumanAmount("0.1234567", 6);
  assert.ok(!tooPrecise.ok && /rounding silently/.test(tooPrecise.reason));
});
