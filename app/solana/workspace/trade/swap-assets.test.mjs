import assert from "node:assert/strict";
import test from "node:test";
const subject = await import("./swap-assets.ts").catch(() => ({}));

const held = (mint, amountRaw, price, symbol, suspicious = false) => ({
  kind: "TOKEN", mint, amountRaw, spendableRaw: amountRaw, decimals: 6,
  symbol: null, name: null, tokenProgram: "token",
  catalog: { symbol, name: symbol, usdPrice: price, isVerified: !suspicious, isSuspicious: suspicious },
});

test("held assets use server metadata and rank by USD instead of raw token count", () => {
  const rows = subject.buildSwapAssetRows?.([
    held("dust", "999000000000", "0.00000001", "DUST"),
    held("usd", "4000000", "1", "USDC"),
    held("valuable", "1000000", "6", "COIN"),
    held("spam", "9000000000", "100", "FAKE", true),
    held("unknown", "5000000", null, null),
  ], {}, []);
  assert.deepEqual(rows?.map(x => x.mint), ["valuable", "usd", "dust", "unknown", "spam"]);
  assert.equal(rows?.[0].symbol, "COIN");
  assert.equal(rows?.[0].usdValue, 6_000_000n);
  assert.equal(rows?.find(x=>x.mint==="unknown").usdValue, null);
});

test("native SOL wins over wrapped balance, and selected tokens retain chain decimals", () => {
  const sol = "So11111111111111111111111111111111111111112";
  const native = { ...held(null, "1000000000", "100", "SOL"), kind: "NATIVE_SOL", decimals: 9, spendableRaw: "999500000" };
  const rows = subject.buildSwapAssetRows?.([held(sol, "3000000", "100", "wSOL"), native], {}, []);
  assert.equal(rows?.length, 1);
  assert.equal(rows?.[0].symbol, "SOL");
  assert.equal(rows?.[0].name, "Solana");
  assert.equal(rows?.[0].decimals, 9);
  assert.equal(rows?.[0].usdValue, 100_000_000n);
});

test("scientific-notation prices still value a large token balance", () => {
  const rows = subject.buildSwapAssetRows([held("tiny", "200000000000000", "2.5e-7", "TINY")], {}, []);
  assert.equal(rows[0].usdValue, 50_000_000n);
});
