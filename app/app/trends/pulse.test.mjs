import assert from "node:assert/strict";
import test from "node:test";

import { pulseOf } from "./pulse.ts";

/**
 * The pulse carries only figures the rows carry: the most traded by volume,
 * the biggest move by the absolute change, the most liquid by the pool, the
 * volume summed over the rows shown. A row without the figure never wins
 * the tile, and an empty list has no tile at all.
 */

const row = (over) => ({
  mint: over.symbol,
  symbol: over.symbol,
  name: over.symbol,
  icon: null,
  decimals: 6,
  tokenProgram: null,
  price: 1,
  change24hPct: null,
  volume24hUsd: null,
  liquidityUsd: null,
  verified: true,
  suspicious: false,
  category: "crypto",
  issuer: null,
  ...over,
});

test("each tile is the row with the largest figure, and the sum is over the rows shown", () => {
  const pulse = pulseOf([
    row({ symbol: "SOL", change24hPct: -3.95, volume24hUsd: 7_300_000_000, liquidityUsd: 830_500_000 }),
    row({ symbol: "STONK", change24hPct: -10.74, volume24hUsd: 64_600_000, liquidityUsd: 5_000_000 }),
    row({ symbol: "PTN", change24hPct: 32.55, volume24hUsd: 34_900_000, liquidityUsd: 100_000 }),
    row({ symbol: "NOFIG", change24hPct: null, volume24hUsd: null, liquidityUsd: null }),
    row({ symbol: "SCRIBE", change24hPct: 18_077, volume24hUsd: 6_400_000, liquidityUsd: 70_000, verified: false }),
  ]);
  assert.equal(pulse.mostTraded?.symbol, "SOL");
  assert.equal(pulse.biggestMove?.symbol, "PTN", "the biggest move is by absolute change, among verified rows");
  assert.equal(pulse.mostLiquid?.symbol, "SOL");
  assert.equal(pulse.volumeUsd, 7_300_000_000 + 64_600_000 + 34_900_000 + 6_400_000);
  assert.equal(pulse.count, 5);
  assert.equal(pulse.up, 2);
  assert.equal(pulse.down, 2);
});

test("an empty list has no tile and no activity", () => {
  const pulse = pulseOf([]);
  assert.equal(pulse.mostTraded, null);
  assert.equal(pulse.biggestMove, null);
  assert.equal(pulse.mostLiquid, null);
  assert.equal(pulse.volumeUsd, 0);
  assert.equal(pulse.count, 0);
});

test("a row without a figure never wins its tile", () => {
  const pulse = pulseOf([row({ symbol: "A", volume24hUsd: null, liquidityUsd: 10 }), row({ symbol: "B", volume24hUsd: 5, liquidityUsd: null })]);
  assert.equal(pulse.mostTraded?.symbol, "B");
  assert.equal(pulse.mostLiquid?.symbol, "A");
  assert.equal(pulse.biggestMove, null);
});
