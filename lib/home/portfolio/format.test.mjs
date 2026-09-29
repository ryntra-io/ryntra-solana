import assert from "node:assert/strict";
import test from "node:test";

import { formatBps, formatDecimal, formatMoney } from "./format.ts";

test("a decimal is rendered by placing its point, never by floating it", () => {
  assert.equal(formatDecimal({ units: "123456", scale: 2 }), "1234.56");
  assert.equal(formatDecimal({ units: "-123456", scale: 2 }), "-1234.56");
  assert.equal(formatDecimal({ units: "5", scale: 2 }), "0.05");
  assert.equal(formatDecimal({ units: "-5", scale: 2 }), "-0.05");
  assert.equal(formatDecimal({ units: "0", scale: 2 }), "0.00");
  assert.equal(formatDecimal({ units: "7", scale: 0 }), "7");
  /* Beyond IEEE-754 exactness: a float renderer loses this and a string one
     cannot. This is why the surface never sees a `Number`. */
  assert.equal(
    formatDecimal({ units: "123456789012345678901234", scale: 6 }),
    "123456789012345678.901234",
  );
});

test("money carries its currency and groups the whole part", () => {
  assert.equal(formatMoney({ amount: { units: "123456", scale: 2 }, currency: "USD" }), "1,234.56 USD");
  assert.equal(formatMoney({ amount: { units: "-123456789", scale: 2 }, currency: "USD" }), "-1,234,567.89 USD");
  assert.equal(formatMoney({ amount: { units: "0", scale: 2 }, currency: "EUR" }), "0.00 EUR");
});

test("basis points render as a percentage and never as a rounded integer", () => {
  assert.equal(formatBps(10_000), "100.00%");
  assert.equal(formatBps(7_500), "75.00%");
  assert.equal(formatBps(1), "0.01%");
  assert.equal(formatBps(0), "0.00%");
  assert.equal(formatBps(null), "—");
});
