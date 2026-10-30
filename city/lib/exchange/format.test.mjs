import { test } from "node:test";
import assert from "node:assert/strict";

import { funding, lamportsSol, leverage, micro, price, units, usd } from "./format.ts";

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

test("a price from a dollar up is in cents: «$97.350» read as thousands beside the Spot's «$97.48» (CITY-150)", () => {
  assert.equal(price(97.35), "$97.35");
  assert.equal(price(1.2345), "$1.23");
  assert.equal(price(150.5), "$150.50");
  assert.equal(price(97_350), "$97,350.0");
  assert.equal(price(0.000123456), "$0.0001235");
});

test("an amount is never written with an exponent (CITY-150: «1,2e-7 BTC»)", () => {
  assert.equal(units(1.2e-7, "BTC"), "0.00000012 BTC");
  assert.equal(units(0.099796891, "SOL"), "0.0998 SOL");
  assert.equal(units(12.5, "SOL"), "12.5 SOL");
  assert.equal(lamportsSol("5000"), "0.000005 SOL");
});
