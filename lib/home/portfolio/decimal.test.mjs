import assert from "node:assert/strict";
import test from "node:test";

import {
  absoluteDecimal,
  addDecimal,
  compareDecimal,
  decimal,
  multiplyDecimal,
  parseDecimalText,
  rescale,
  subtractDecimal,
} from "./decimal.ts";

test("decimal rejects non-canonical integers, negative zero and unsupported scale", () => {
  assert.deepEqual(decimal("25", 1), { units: "25", scale: 1 });
  for (const units of ["", "01", "-0", "+1", "1.0", " 1", "1 "]) {
    assert.throws(() => decimal(units, 0), /canonical decimal/);
  }
  assert.throws(() => decimal("1", -1), /scale/);
  assert.throws(() => decimal("1", 19), /scale/);
});

test("HALF_EVEN rounds ties to the nearest even integer for both signs", () => {
  assert.deepEqual(rescale(decimal("25", 1), 0, "HALF_EVEN"), decimal("2", 0));
  assert.deepEqual(rescale(decimal("35", 1), 0, "HALF_EVEN"), decimal("4", 0));
  assert.deepEqual(rescale(decimal("-25", 1), 0, "HALF_EVEN"), decimal("-2", 0));
  assert.deepEqual(rescale(decimal("-35", 1), 0, "HALF_EVEN"), decimal("-4", 0));
});

test("TOWARD_ZERO never rounds a discarded fraction away from zero", () => {
  assert.deepEqual(rescale(decimal("29", 1), 0, "TOWARD_ZERO"), decimal("2", 0));
  assert.deepEqual(rescale(decimal("-29", 1), 0, "TOWARD_ZERO"), decimal("-2", 0));
});

test("cross-scale add and subtract preserve hand-derived exact values", () => {
  assert.deepEqual(
    addDecimal(decimal("125", 2), decimal("25", 1), 2, "HALF_EVEN"),
    decimal("375", 2),
  );
  assert.deepEqual(
    subtractDecimal(decimal("125", 2), decimal("25", 1), 2, "HALF_EVEN"),
    decimal("-125", 2),
  );
});

test("multiplication uses fixed point rather than binary floating point", () => {
  assert.deepEqual(
    multiplyDecimal(decimal("12345", 2), decimal("125", 2), 4, "HALF_EVEN"),
    decimal("1543125", 4),
  );
  assert.deepEqual(
    multiplyDecimal(decimal("1", 0), decimal("5", 1), 0, "HALF_EVEN"),
    decimal("0", 0),
  );
  assert.deepEqual(
    multiplyDecimal(decimal("3", 0), decimal("5", 1), 0, "HALF_EVEN"),
    decimal("2", 0),
  );
});

test("multiplication rounds the exact product once at the requested scale", () => {
  assert.deepEqual(
    multiplyDecimal(
      decimal("1000000000000000002", 18),
      decimal("3499999999999999993", 18),
      0,
      "HALF_EVEN",
    ),
    decimal("3", 0),
  );
});

test("comparison and absolute value align scales without losing digits", () => {
  assert.equal(compareDecimal(decimal("100", 2), decimal("1", 0)), 0);
  assert.equal(compareDecimal(decimal("1001", 3), decimal("1", 0)), 1);
  assert.equal(compareDecimal(decimal("999", 3), decimal("1", 0)), -1);
  assert.deepEqual(absoluteDecimal(decimal("-123", 2)), decimal("123", 2));
});

test("source decimal text parses exactly and rejects exponent or excess precision", () => {
  assert.deepEqual(parseDecimalText("123.4500"), decimal("1234500", 4));
  assert.deepEqual(parseDecimalText("-0.25"), decimal("-25", 2));
  assert.deepEqual(parseDecimalText("0"), decimal("0", 0));
  for (const value of ["1e3", "+1", " 1", "1.", ".5", "1.0000000000000000000"]) {
    assert.throws(() => parseDecimalText(value), /decimal text/);
  }
});
