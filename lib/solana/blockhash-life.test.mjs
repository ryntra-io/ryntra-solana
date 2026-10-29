import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BLOCKHASH_LIFE_MS,
  web3ChainReader,
  kitChainReader,
  BLOCKHASH_SUBMIT_MARGIN_MS,
  FALLBACK_MS_PER_SLOT,
  MAX_SIGNABLE_WINDOW_MS,
  MIN_WALLET_WINDOW_MS,
  MS_PER_SLOT_CACHE_MS,
  NEXT_TRANSACTION_MARGIN_MS,
  assessBlockhashLife,
  lifeWindowMs,
  msUntilBytesDie,
  mayOpenWallet,
  msPerSlotFromSamples,
  readBlockhashLife,
  readMsPerSlot,
  resetMsPerSlotCache,
  signableWindowClosed,
  signableWindowMs,
} from "./blockhash-life.ts";

/* The tip measured on mainnet 2026-10-17: height ~436.0M, slot ~458.0M. */
const TIP = { blockHeight: 436_048_735n, absoluteSlot: 458_013_351n };

test("bytes built a moment ago live ~150 blocks ≈ 30 s on 200 ms slots", () => {
  assert.equal(BLOCKHASH_LIFE_MS, 30_000);
  assert.equal(MAX_SIGNABLE_WINDOW_MS, 30_000 - BLOCKHASH_SUBMIT_MARGIN_MS);
  const life = assessBlockhashLife({ lastValidBlockHeight: TIP.blockHeight + 150n, tip: TIP, msPerSlot: 200 });
  assert.equal(life.state, "LIVE");
  assert.equal(life.blocksLeft, 150);
  assert.equal(life.msLeft, 30_000);
  assert.equal(life.signableMs, 25_000);
});

test("past lastValidBlockHeight is EXPIRED — read from the height, not a clock", () => {
  const life = assessBlockhashLife({ lastValidBlockHeight: TIP.blockHeight - 3n, tip: TIP, msPerSlot: 200 });
  assert.equal(life.state, "EXPIRED");
  assert.equal(life.blocksPast, 3);
  assert.equal(signableWindowMs(life), 0);
});

test("a slot answered as a block height is UNKNOWN, never expired (PublicNode getBlockHeight)", () => {
  /* PublicNode answers getBlockHeight with its slot: ~22M above the height. */
  const life = assessBlockhashLife({
    lastValidBlockHeight: TIP.blockHeight + 100n,
    tip: { blockHeight: TIP.absoluteSlot, absoluteSlot: TIP.absoluteSlot },
  });
  assert.equal(life.state, "UNKNOWN");
});

test("more blocks left than a blockhash can have is UNKNOWN", () => {
  const life = assessBlockhashLife({ lastValidBlockHeight: TIP.blockHeight + 5_000n, tip: TIP });
  assert.equal(life.state, "UNKNOWN");
});

test("an unreadable tip is UNKNOWN and the window falls back to a fresh build, never longer than one life", () => {
  const life = assessBlockhashLife({ lastValidBlockHeight: "436048885", tip: null, msPerSlot: 200 });
  assert.equal(life.state, "UNKNOWN");
  assert.equal(signableWindowMs(life), MAX_SIGNABLE_WINDOW_MS);
  assert.ok(signableWindowMs(life, 60_000) <= MAX_SIGNABLE_WINDOW_MS);
});

test("a window asked for is capped by the bytes' life, never stretched by it", () => {
  const life = assessBlockhashLife({ lastValidBlockHeight: TIP.blockHeight + 150n, tip: TIP, msPerSlot: 200 });
  assert.equal(signableWindowMs(life, 45_000), 25_000);
  assert.equal(signableWindowMs(life, 10_000), 10_000);
  const half = assessBlockhashLife({ lastValidBlockHeight: TIP.blockHeight + 60n, tip: TIP, msPerSlot: 200 });
  assert.equal(signableWindowMs(half, 45_000), 60 * 200 - BLOCKHASH_SUBMIT_MARGIN_MS);
});

test("slower slots give a longer life, still never past 150 blocks", () => {
  const life = assessBlockhashLife({ lastValidBlockHeight: TIP.blockHeight + 150n, tip: TIP, msPerSlot: 400 });
  assert.equal(life.msLeft, 60_000);
  assert.equal(signableWindowMs(life, 90_000), 60_000 - BLOCKHASH_SUBMIT_MARGIN_MS);
});

test("ms per slot from performance samples, implausible samples fall back", () => {
  /* Measured 2026-10-17: 276, 278, 272 slots per 60 s. */
  const ms = msPerSlotFromSamples([
    { numSlots: 276n, samplePeriodSecs: 60 },
    { numSlots: 278n, samplePeriodSecs: 60 },
    { numSlots: 272n, samplePeriodSecs: 60 },
  ]);
  assert.ok(ms > 210 && ms < 222, String(ms));
  assert.equal(msPerSlotFromSamples([]), null);
  assert.equal(msPerSlotFromSamples([{ numSlots: 1n, samplePeriodSecs: 60 }]), null);
  assert.equal(msPerSlotFromSamples(null), null);
});

function fakeHandle({ samples, tip, fail = false }) {
  const calls = { samples: 0, tip: 0 };
  return {
    calls,
    handle: {
      performanceSamples: async () => {
        calls.samples += 1;
        if (fail) throw new Error("down");
        return samples;
      },
      epochInfo: async () => {
        calls.tip += 1;
        if (fail) throw new Error("down");
        return tip;
      },
    },
  };
}

test("ms per slot is cached for five minutes and falls back to 200 ms", async () => {
  resetMsPerSlotCache();
  let now = 1_000_000;
  const { handle, calls } = fakeHandle({ samples: [{ numSlots: 240n, samplePeriodSecs: 60 }], tip: TIP });
  assert.equal(await readMsPerSlot(handle, { nowMs: () => now }), 250);
  now += MS_PER_SLOT_CACHE_MS - 1;
  assert.equal(await readMsPerSlot(handle, { nowMs: () => now }), 250);
  assert.equal(calls.samples, 1);
  now += 2;
  await readMsPerSlot(handle, { nowMs: () => now });
  assert.equal(calls.samples, 2);

  resetMsPerSlotCache();
  const down = fakeHandle({ fail: true });
  assert.equal(await readMsPerSlot(down.handle), FALLBACK_MS_PER_SLOT);
  const life = await readBlockhashLife(down.handle, 1n);
  assert.equal(life.state, "UNKNOWN");
  resetMsPerSlotCache();
});

test("readBlockhashLife reads the tip through getEpochInfo, which carries the slot", async () => {
  resetMsPerSlotCache();
  const { handle } = fakeHandle({ samples: [{ numSlots: 300n, samplePeriodSecs: 60 }], tip: TIP });
  const life = await readBlockhashLife(handle, TIP.blockHeight + 100n);
  assert.equal(life.state, "LIVE");
  assert.equal(life.msLeft, 100 * 200);
  resetMsPerSlotCache();
});

test("a wallet opens only with at least the wallet window left, measured from arrival (clock-skew safe)", () => {
  const receivedAtMs = 5_000;
  assert.equal(mayOpenWallet({ receivedAtMs, signableMs: 25_000, nowMs: 5_000 }), true);
  assert.equal(mayOpenWallet({ receivedAtMs, signableMs: 25_000, nowMs: 5_000 + 25_000 - MIN_WALLET_WINDOW_MS }), true);
  assert.equal(mayOpenWallet({ receivedAtMs, signableMs: 25_000, nowMs: 5_000 + 25_000 - MIN_WALLET_WINDOW_MS + 1 }), false);
  assert.equal(mayOpenWallet({ receivedAtMs, signableMs: Number.NaN, nowMs: 5_000 }), false);
  assert.equal(signableWindowClosed({ receivedAtMs, signableMs: 25_000, nowMs: 30_000 }), true);
  assert.equal(signableWindowClosed({ receivedAtMs, signableMs: 25_000, nowMs: 29_999 }), false);
});

test("readers adapt a web3.js Connection and a kit handle to the same two reads", async () => {
  resetMsPerSlotCache();
  const connection = {
    getEpochInfo: async (commitment) => {
      assert.equal(commitment, "confirmed");
      return { blockHeight: 436_048_735, absoluteSlot: 458_013_351 };
    },
    getRecentPerformanceSamples: async () => [{ numSlots: 300, samplePeriodSecs: 60 }],
  };
  const life = await readBlockhashLife(web3ChainReader(connection), 436_048_735 + 50);
  assert.equal(life.state, "LIVE");
  assert.equal(life.msLeft, 50 * 200);
  resetMsPerSlotCache();
  const seen = [];
  const handle = {
    timeoutMs: 1_000,
    endpoints: [{}],
    rpc: {
      getEpochInfo: (config) => ({ send: async () => (seen.push(config), { blockHeight: 10n, absoluteSlot: 20n }) }),
      getRecentPerformanceSamples: (limit) => ({ send: async () => (seen.push(limit), [{ numSlots: 300n, samplePeriodSecs: 60 }]) }),
    },
  };
  const kit = await readBlockhashLife(kitChainReader(handle), 20n);
  assert.equal(kit.state, "LIVE");
  assert.deepEqual(seen, [5, { commitment: "confirmed" }]);
  resetMsPerSlotCache();
});

test("several transactions in one blockhash keep a further margin for each after the first", () => {
  const life = assessBlockhashLife({ lastValidBlockHeight: TIP.blockHeight + 150n, tip: TIP, msPerSlot: 200 });
  assert.equal(signableWindowMs(life, Number.POSITIVE_INFINITY, 3), 30_000 - BLOCKHASH_SUBMIT_MARGIN_MS - 2 * NEXT_TRANSACTION_MARGIN_MS);
  const unknown = assessBlockhashLife({ lastValidBlockHeight: 1n, tip: null, msPerSlot: 200 });
  assert.equal(signableWindowMs(unknown, Number.POSITIVE_INFINITY, 2), 30_000 - BLOCKHASH_SUBMIT_MARGIN_MS - NEXT_TRANSACTION_MARGIN_MS);
  /* A launch of three transactions still leaves a wallet its window on fresh bytes. */
  assert.ok(signableWindowMs(life, Number.POSITIVE_INFINITY, 3) >= MIN_WALLET_WINDOW_MS + 5_000);
});

test("a reading far past the blockhash is not a verdict: UNKNOWN, never EXPIRED", () => {
  /* A slot-like height just under its own slot leaves the blockhash ~22 million blocks behind. */
  const life = assessBlockhashLife({
    lastValidBlockHeight: TIP.blockHeight,
    tip: { blockHeight: TIP.absoluteSlot - 1n, absoluteSlot: TIP.absoluteSlot },
  });
  assert.equal(life.state, "UNKNOWN");
  assert.equal(assessBlockhashLife({ lastValidBlockHeight: TIP.blockHeight - 19_999n, tip: TIP }).state, "EXPIRED");
});

test("windows are whole milliseconds; the server holds bytes for their life, the page signs a margin earlier", () => {
  const life = assessBlockhashLife({ lastValidBlockHeight: TIP.blockHeight + 150n, tip: TIP, msPerSlot: 60_000 / 277 });
  assert.ok(Number.isInteger(signableWindowMs(life)));
  assert.ok(Number.isInteger(lifeWindowMs(life)));
  assert.equal(lifeWindowMs(life) - signableWindowMs(life), BLOCKHASH_SUBMIT_MARGIN_MS);
  /* Unknown tip: one full life less the build's own time. */
  const unknown = assessBlockhashLife({ lastValidBlockHeight: 1n, tip: null, msPerSlot: 200 });
  assert.equal(lifeWindowMs(unknown, 7_000), 23_000);
  assert.equal(signableWindowMs(unknown, Number.POSITIVE_INFINITY, 1, 7_000), 18_000);
});

test("the page waits for the bytes' death before asking the chain", () => {
  assert.equal(msUntilBytesDie({ receivedAtMs: 0, signableMs: 20_000, nowMs: 12_000 }), 20_000 + BLOCKHASH_SUBMIT_MARGIN_MS - 12_000);
  assert.equal(msUntilBytesDie({ receivedAtMs: 0, signableMs: 20_000, nowMs: 60_000 }), 0);
});
