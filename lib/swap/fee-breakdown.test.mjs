import assert from "node:assert/strict";
import test from "node:test";
import * as fees from "./service-fee.ts";

test("the 50 bps referral total is not added to the same 50 bps again", () => {
  const fee = { mechanism: "JUPITER_REFERRAL", state: "QUOTED", basisPoints: 50 };
  assert.equal(fees.additionalJupiterFeeBps?.(50, fee), 0);
  assert.equal(fees.additionalJupiterFeeBps?.(52, fee), 2);
  assert.equal(fees.additionalJupiterFeeBps?.(2, { ...fee, state: "NOT_APPLIED", basisPoints: 0 }), 2);
  assert.equal(fees.additionalJupiterFeeBps?.(2, null), 2);
  assert.equal(fees.additionalJupiterFeeBps?.(null, fee), null);
});
