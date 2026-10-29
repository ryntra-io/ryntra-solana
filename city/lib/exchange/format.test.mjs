import { test } from "node:test";
import assert from "node:assert/strict";

import { funding, leverage, micro, price, usd } from "./format.ts";

test("the funding reads as its rate and its period, whole minutes deciding the period", () => {
  assert.equal(funding({ ratePercent: 0.0012, payer: null, periodSeconds: 3600 }), "0.0012% / 1h");
  // Phoenix measures the period to a fraction of a second: 3599.98 s is still an hour.
  assert.equal(funding({ ratePercent: 0.0018, payer: null, periodSeconds: 3599.98 }), "0.0018% / 1h");
  assert.equal(funding({ ratePercent: -0.0005, payer: "short", periodSeconds: 1800 }), "−0.0005% / 30m · shorts pay");
  assert.equal(funding({ ratePercent: 0.001, payer: null, periodSeconds: null }), "0.0010%");
  assert.equal(funding(null), "—");
});

test("a figure the engine did not send is a dash, never a zero", () => {
  assert.equal(price(null), "—");
  assert.equal(usd(undefined), "—");
  assert.equal(leverage(null), "—");
  assert.equal(micro(null), "—");
  assert.equal(micro("25000000"), "$25.00");
});
