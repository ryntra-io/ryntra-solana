import { test } from "node:test";
import assert from "node:assert/strict";

import { bestLst, readFeed, rowFromPool, rowFromSanctum } from "./feed.ts";
import { epochApyPercent, epochsPerYear, lamportsOf, LSTS, percentText, rateOf, solPerToken, solText } from "./lst.ts";
import { base58, decodeStakePool } from "./stake-pool.ts";

test("an LST balance is valued in SOL exactly, rounded down", () => {
  const rate = rateOf(1_234_567_890_123n, 1_000_000_000_000n); // 1.234567890123 SOL a token
  assert.equal(lamportsOf(1_000_000_000n, rate), 1_234_567_890n);
  assert.equal(lamportsOf("3", rate), 3n);
  assert.equal(lamportsOf(0n, rate), 0n);
  assert.equal(lamportsOf("12a", rate), null);
  assert.equal(lamportsOf(1n, null), null);
  assert.ok(Math.abs(solPerToken(rate) - 1.234567890123) < 1e-9);
  assert.equal(rateOf(0n, 5n), null);
  assert.equal(rateOf("1", "0"), null);
});

test("the last epoch's yield compounds over the epochs of a year at the measured slot time", () => {
  const perYear = epochsPerYear(432_000, 400);
  assert.ok(Math.abs(perYear - 182.6) < 0.1, String(perYear));
  assert.equal(epochsPerYear(432_000, null), null);
  assert.equal(epochsPerYear(432_000, 50), null, "a slot time no network keeps");
  const before = rateOf(1_000_000_000n, 1_000_000_000n);
  const now = rateOf(1_000_320_000n, 1_000_000_000n); // +0.032 % in an epoch
  const apy = epochApyPercent(now, before, perYear);
  assert.ok(apy > 6 && apy < 6.1, String(apy));
  assert.ok(epochApyPercent(rateOf(999_000_000n, 1_000_000_000n), before, perYear) < 0, "a slashing is said as a loss");
  assert.equal(epochApyPercent(rateOf(1_050_000_000n, 1_000_000_000n), before, perYear), null, "5 % in an epoch is no yield");
  assert.equal(epochApyPercent(now, null, perYear), null);
  assert.equal(epochApyPercent(now, before, null), null);
});

test("SOL and rates are written short, with a true minus", () => {
  assert.equal(solText(1_234_500_000n), "1.2345");
  assert.equal(solText(-12_000_000n), "−0.012");
  assert.equal(solText(12_000_000n, true), "+0.012");
  assert.equal(solText(0n, true), "0");
  assert.equal(solText(null), "—");
  assert.equal(percentText(6.1534), "6.15%");
  assert.equal(percentText(-0.5), "−0.5%");
  assert.equal(percentText(null), "—");
});

/* A stake pool account as the program writes it (Borsh), with the variable parts set as given. */
function poolBytes({ mint, total, supply, lastEpoch, lastTotal, lastSupply, epochFee = [100n, 4n], withdrawFee = [1000n, 1n], nextFee = false, preferred = false }) {
  const out = [];
  const u8 = (v) => out.push(v);
  const u64 = (v) => {
    let x = BigInt(v);
    for (let i = 0; i < 8; i += 1) {
      out.push(Number(x & 0xffn));
      x >>= 8n;
    }
  };
  const key = (bytes) => out.push(...bytes);
  const zero = () => key(new Array(32).fill(7));
  const fee = ([den, num]) => {
    u64(den);
    u64(num);
  };
  u8(1);
  zero();
  zero();
  zero();
  u8(255);
  zero();
  zero();
  key(mint);
  zero();
  zero();
  u64(total);
  u64(supply);
  u64(lastEpoch);
  u64(0);
  u64(0);
  zero();
  fee(epochFee);
  u8(nextFee ? 1 : 0);
  if (nextFee) fee([100n, 5n]);
  u8(preferred ? 1 : 0);
  if (preferred) zero();
  u8(0);
  fee([0n, 0n]);
  fee([0n, 0n]);
  u8(0);
  u8(0);
  u8(1);
  zero();
  fee([0n, 0n]);
  u8(0);
  u8(0);
  fee(withdrawFee);
  u8(2);
  fee([100n, 1n]);
  u64(lastSupply);
  u64(lastTotal);
  out.push(...new Array(200).fill(0));
  return new Uint8Array(out);
}

function decodeBase58(text) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let value = 0n;
  for (const c of text) value = value * 58n + BigInt(alphabet.indexOf(c));
  const bytes = [];
  while (value > 0n) {
    bytes.unshift(Number(value & 0xffn));
    value >>= 8n;
  }
  while (bytes.length < 32) bytes.unshift(0);
  return bytes;
}

test("a stake pool account is read for its mint, its worth now and before, and its fees", () => {
  const jito = LSTS.find((l) => l.id === "jitosol");
  assert.equal(base58(new Uint8Array(decodeBase58(jito.mint))), jito.mint);
  for (const variant of [{}, { nextFee: true, preferred: true }]) {
    const pool = decodeStakePool(poolBytes({ mint: decodeBase58(jito.mint), total: 12_600_000_000_000_000n, supply: 10_000_000_000_000_000n, lastEpoch: 870n, lastTotal: 12_596_000_000_000_000n, lastSupply: 10_000_000_000_000_000n, ...variant }));
    assert.ok(pool, JSON.stringify(variant));
    assert.equal(pool.poolMint, jito.mint);
    assert.deepEqual(pool.now, { lamports: "12600000000000000", supply: "10000000000000000" });
    assert.deepEqual(pool.before, { lamports: "12596000000000000", supply: "10000000000000000" });
    assert.equal(pool.lastUpdateEpoch, 870n);
    assert.equal(pool.rewardsFeePct, 4);
    assert.equal(pool.solWithdrawalFeePct, 0.1);
  }
  assert.equal(decodeStakePool(new Uint8Array(40)), null, "cut short");
  assert.equal(decodeStakePool(new Uint8Array([2, ...new Array(600).fill(0)])), null, "another account type");
});

test("a pool row holds figures only for the LST's own mint, read this epoch or the one before", () => {
  const jito = LSTS.find((l) => l.id === "jitosol");
  const pool = decodeStakePool(poolBytes({ mint: decodeBase58(jito.mint), total: 1_000_320_000n, supply: 1_000_000_000n, lastEpoch: 870n, lastTotal: 1_000_000_000n, lastSupply: 1_000_000_000n }));
  const row = rowFromPool("jitosol", jito.mint, pool, 871n, 182.6);
  assert.equal(row.source, "chain");
  assert.ok(row.apyPct > 6 && row.apyPct < 6.1);
  assert.deepEqual(rowFromPool("jupsol", LSTS[0].mint, pool, 871n, 182.6).rate, null, "a pool of another mint gives nothing");
  assert.equal(rowFromPool("jitosol", jito.mint, pool, 880n, 182.6).apyPct, null, "a pool not updated for epochs gives no rate");
});

test("Sanctum's answers become a row; anything malformed stays hidden", () => {
  const row = rowFromSanctum("inf", "INF", 9, { INF: 0.0712 }, { INF: "1305000000" });
  assert.ok(Math.abs(row.apyPct - 7.12) < 1e-9);
  assert.deepEqual(row.rate, { lamports: "1305000000", supply: "1000000000" });
  assert.equal(rowFromSanctum("inf", "INF", 9, { INF: "lots" }, {}).apyPct, null);
  assert.equal(rowFromSanctum("inf", "INF", 9, { INF: 4 }, {}).apyPct, null, "400 % is no staking yield");
});

test("the feed read from the route keeps the catalogue's order and drops what it does not know", () => {
  const feed = readFeed({
    at: "2026-10-29T10:00:00.000Z",
    epochsPerYear: 182.6,
    lsts: [
      { id: "jitosol", rate: { lamports: "1260", supply: "1000" }, apyPct: 5.9, rewardsFeePct: 4, unstakeFeePct: 0.1, source: "chain", epoch: 870 },
      { id: "inf", rate: null, apyPct: 7.1, source: "sanctum" },
      { id: "fakeSOL", apyPct: 99 },
    ],
  });
  assert.deepEqual(feed.lsts.map((r) => r.id), ["jupsol", "inf", "jitosol"]);
  assert.equal(feed.lsts[0].apyPct, null);
  assert.equal(bestLst(feed), "jitosol", "the best rate with a worth read");
  assert.equal(readFeed({ lsts: "no" }), null);
});
