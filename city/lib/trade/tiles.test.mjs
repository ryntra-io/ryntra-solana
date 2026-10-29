import { test } from "node:test";
import assert from "node:assert/strict";

import { payAssetFor, payOptionsFor, SOL, USDC } from "./tiles.ts";

const WIF = "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm";

test("a tower is bought with SOL or USDC; the SOL tower only with USDC, the USDC tower only with SOL", () => {
  assert.equal(payAssetFor(WIF), SOL);
  assert.deepEqual(payOptionsFor(WIF), [SOL, USDC]);
  assert.equal(payAssetFor(WIF, "USDC"), USDC);
  assert.equal(payAssetFor(SOL.mint), USDC);
  assert.equal(payAssetFor(SOL.mint, "SOL"), USDC);
  assert.deepEqual(payOptionsFor(USDC.mint), [SOL]);
  assert.equal(payAssetFor(USDC.mint, "USDC"), SOL);
  assert.equal(USDC.mint, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
});
