import assert from "node:assert/strict";
import test from "node:test";

import { accruePoints, eligibleVolume, isSameAssetMove, surfaceOf } from "./accrue.ts";
import { PointsEntrySchema } from "./model.ts";
import { USD_MICROS } from "./policy.ts";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL = "So11111111111111111111111111111111111111112";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const TRADER = "6dNVSFwbC6RGDCyEXBuMBpBHVpPTGqJnGG8kk9EMXbLp";
const INVITER = "3EjkPWNaQmDLNKYAP6sHKZgLMxYPjQnfPdBbEjNzXZQL";
const SIG = "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW";
const NOW = "2026-09-11T12:00:00.000Z";

function action(overrides = {}) {
  return {
    schema: "ryntra.solana.wallet-action",
    schemaVersion: "1.0.0",
    version: 1,
    network: "mainnet",
    wallet: TRADER,
    actionId: SIG,
    lane: "SWAP",
    outcome: "DONE",
    out: { mint: USDC, amountRaw: (250n * USD_MICROS).toString(), decimals: null, symbol: null },
    in: { mint: SOL, amountRaw: "1234567890", decimals: null, symbol: null },
    destination: null,
    signature: SIG,
    receiptHash: null,
    sourceTx: null,
    destinationTx: null,
    fee: null,
    origin: null,
    startedAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

const base = {
  statedUsd: null,
  internal: false,
  dayEntries: [],
  priorActiveDays: 0,
  referrerL1: null,
  referrerAlreadyQualified: false,
  settledAt: NOW,
  now: NOW,
};

test("a settled stablecoin swap earns volume points at par, an active day, and every row parses", () => {
  const result = accruePoints({ ...base, action: action() });
  assert.equal(result.ok, true);
  assert.equal(result.day, "2026-09-11");
  assert.deepEqual(
    result.entries.map((entry) => [entry.reason, entry.points, entry.wallet]),
    [
      ["TRADE_VOLUME", "250", TRADER],
      ["ACTIVE_DAY", "10", TRADER],
    ],
  );
  for (const entry of result.entries) PointsEntrySchema.parse(entry);
  const trade = result.entries[0];
  assert.equal(trade.eventId, `TRADE_VOLUME:${SIG}`);
  assert.equal(trade.policyVersion, "1.0.0");
  assert.equal(trade.source.surface, "SWAP");
  assert.equal(trade.source.lane, "SWAP");
  assert.equal(trade.source.operationRef, SIG);
  assert.equal(trade.source.volumeUsdMicros, (250n * USD_MICROS).toString());
  assert.deepEqual(trade.source.valuation, { basis: "STABLECOIN_PAR", sourceRef: USDC });
  assert.equal(trade.source.dayVolumeBeforeUsdMicros, "0");
  assert.equal(result.entries[1].eventId, "ACTIVE_DAY:2026-09-11");
});

test("a quote, a Review, an in-flight or a failed operation earns nothing", () => {
  for (const outcome of ["IN_FLIGHT", "FAILED", "NEEDS_YOU"]) {
    const result = accruePoints({ ...base, action: action({ outcome }) });
    assert.equal(result.ok, false, outcome);
    assert.match(result.reason, /not settled/);
  }
});

test("Send, Receive and the CCTP transfer lane are not trades", () => {
  for (const lane of ["SEND", "RECEIVE", "BRIDGE"]) {
    const result = accruePoints({ ...base, action: action({ lane }) });
    assert.equal(result.ok, false, lane);
    assert.match(result.reason, /not a trade/);
  }
  assert.equal(surfaceOf(action({ lane: "SEND" })), null);
  assert.equal(surfaceOf(action({ origin: { surface: "SPOT", side: "BUY" } })), "SPOT");
  assert.equal(surfaceOf(action({ lane: "CROSS_SWAP" })), "BRIDGE");
});

test("an internal wallet earns nothing, even when the caller forgot", () => {
  const result = accruePoints({ ...base, action: action(), internal: true });
  assert.equal(result.ok, false);
  assert.match(result.reason, /internal/);
});

test("a cross-chain move of the same asset is a transfer and earns nothing", () => {
  const move = action({
    lane: "CROSS_SWAP",
    signature: null,
    sourceTx: "0x0c86401dfe",
    out: { mint: null, amountRaw: "5000000", decimals: 6, symbol: "USDC" },
    in: { mint: null, amountRaw: "4990000", decimals: 6, symbol: "USDC" },
  });
  assert.equal(isSameAssetMove(move), true);
  const result = accruePoints({ ...base, action: move });
  assert.equal(result.ok, false);
  assert.match(result.reason, /transfer/);
  /* Same mint on both sides is the same rule for the Solana lane. */
  assert.equal(isSameAssetMove(action({ in: { mint: USDC, amountRaw: "1", decimals: null, symbol: null } })), true);
  assert.equal(isSameAssetMove(action()), false);
});

test("a bridge that swaps while it moves is a trade, valued from the stablecoin leg", () => {
  const bridge = action({
    lane: "CROSS_SWAP",
    actionId: "0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
    signature: null,
    sourceTx: "0x0c86401dfe",
    destination: "SOLANA",
    out: { mint: null, amountRaw: "5020909", decimals: 6, symbol: "USDC" },
    in: { mint: null, amountRaw: "49962401", decimals: 9, symbol: "SOL" },
  });
  const result = accruePoints({ ...base, action: bridge });
  assert.equal(result.ok, true);
  const trade = result.entries[0];
  assert.equal(trade.source.surface, "BRIDGE");
  assert.equal(trade.source.operationRef, "0x0c86401dfe");
  assert.equal(trade.source.volumeUsdMicros, "5020909");
  assert.equal(trade.points, "5", "$5.02 floors to five points");
  assert.equal(result.entries.length, 1, "five dollars is under the active-day floor");
});

test("a non-stable input takes the provider's own dollar figure, and never a guess", () => {
  const solIn = action({
    out: { mint: SOL, amountRaw: "68266385", decimals: null, symbol: null },
    in: { mint: BONK, amountRaw: "1857546399770", decimals: null, symbol: null },
  });
  const stated = accruePoints({ ...base, action: solIn, statedUsd: { value: "12.5", sourceRef: "jupiter:order:inUsdValue" } });
  assert.equal(stated.ok, true);
  assert.equal(stated.entries[0].source.volumeUsdMicros, "12500000");
  assert.deepEqual(stated.entries[0].source.valuation, { basis: "PROVIDER_STATED_USD", sourceRef: "jupiter:order:inUsdValue" });
  assert.equal(stated.entries[0].points, "12");
  assert.equal(stated.entries.length, 2, "twelve dollars crosses the active-day floor");

  const unvalued = accruePoints({ ...base, action: solIn });
  assert.equal(unvalued.ok, true);
  assert.equal(unvalued.entries.length, 1, "no active day without a dollar figure");
  assert.equal(unvalued.entries[0].points, "0");
  assert.equal(unvalued.entries[0].source.volumeUsdMicros, null);
  assert.deepEqual(unvalued.entries[0].source.valuation, { basis: "UNVALUED", sourceRef: null });
});

test("a cross-chain fill without a stable leg is valued from the fee the provider reported collecting", () => {
  const ethIn = action({
    lane: "CROSS_SWAP",
    actionId: "0xfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeed",
    signature: null,
    sourceTx: "0x11",
    out: { mint: null, amountRaw: "10000000000000000", decimals: 18, symbol: "ETH" },
    in: { mint: null, amountRaw: "220000000", decimals: 9, symbol: "SOL" },
    fee: { collected: true, basisPoints: 25, amountRaw: "25000000000000", decimals: 18, symbol: "ETH", usd: 0.1, asset: null, providerRaw: null, ryntraRaw: null },
  });
  const volume = eligibleVolume(ethIn, null);
  assert.equal(volume.usdMicros, 40_000_000n, "$0.10 at 25 bps is a $40 input");
  assert.deepEqual(volume.valuation, { basis: "PROVIDER_STATED_USD", sourceRef: "fee:25bps" });
  /* A fee that was quoted and not collected is not a measurement of anything. */
  const quoted = eligibleVolume(action({ ...ethIn, fee: { ...ethIn.fee, collected: false } }), null);
  assert.equal(quoted.usdMicros, null);
});

test("the tier continues from the day's prior rows and the active day is awarded once", () => {
  const earlier = accruePoints({ ...base, action: action({ actionId: SIG.slice(0, 80) + "AAAAAAAAAA", signature: null, out: { mint: USDC, amountRaw: (900n * USD_MICROS).toString(), decimals: null, symbol: null } }) });
  assert.equal(earlier.ok, true);
  const later = accruePoints({ ...base, action: action(), dayEntries: earlier.entries });
  assert.equal(later.ok, true);
  assert.equal(later.entries.length, 1, "the day is already active");
  assert.equal(later.entries[0].source.dayVolumeBeforeUsdMicros, (900n * USD_MICROS).toString());
  assert.equal(later.entries[0].points, "175", "$100 at 1.0 and $150 at 0.5");
});

test("a small trade still counts as a trade, and the active day arrives when the day reaches ten dollars", () => {
  const four = accruePoints({ ...base, action: action({ out: { mint: USDC, amountRaw: "4000000", decimals: null, symbol: null } }) });
  assert.equal(four.entries.length, 1);
  assert.equal(four.entries[0].points, "4");
  const seven = accruePoints({
    ...base,
    action: action({ actionId: SIG.slice(0, 80) + "BBBBBBBBBB", signature: null, out: { mint: USDC, amountRaw: "7000000", decimals: null, symbol: null } }),
    dayEntries: four.entries,
  });
  assert.equal(seven.entries.length, 2, "$4 + $7 crosses the floor on the second trade");
  assert.equal(seven.entries[1].reason, "ACTIVE_DAY");
});

test("the inviter earns the qualified-referral bonus once, on the first active day, and never from themselves", () => {
  const first = accruePoints({ ...base, action: action(), referrerL1: INVITER });
  assert.equal(first.ok, true);
  assert.deepEqual(
    first.entries.map((entry) => [entry.reason, entry.wallet, entry.points]),
    [
      ["TRADE_VOLUME", TRADER, "250"],
      ["ACTIVE_DAY", TRADER, "10"],
      ["QUALIFIED_REFERRAL", INVITER, "100"],
    ],
  );
  const bonus = first.entries[2];
  assert.equal(bonus.eventId, `QUALIFIED_REFERRAL:${TRADER}`);
  assert.equal(bonus.source.trader, TRADER, "the bonus names whose trade qualified");

  const second = accruePoints({ ...base, action: action(), referrerL1: INVITER, priorActiveDays: 1 });
  assert.equal(second.entries.some((entry) => entry.reason === "QUALIFIED_REFERRAL"), false, "not on a later active day");

  const already = accruePoints({ ...base, action: action(), referrerL1: INVITER, referrerAlreadyQualified: true });
  assert.equal(already.entries.some((entry) => entry.reason === "QUALIFIED_REFERRAL"), false, "not twice");

  const self = accruePoints({ ...base, action: action(), referrerL1: TRADER });
  assert.equal(self.entries.some((entry) => entry.reason === "QUALIFIED_REFERRAL"), false, "never to oneself");
});

test("no row is ever negative, and points are whole numbers", () => {
  const result = accruePoints({ ...base, action: action({ out: { mint: USDC, amountRaw: "999999", decimals: null, symbol: null } }) });
  assert.equal(result.ok, true);
  for (const entry of result.entries) {
    assert.match(entry.points, /^(0|[1-9][0-9]*)$/);
  }
});
