// Run from repo root: node --test lib/solana/limits/store.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { USDC_MINT, WRAPPED_SOL_MINT } from "../../core/fee-policy.ts";
import { createMemoryGuardStore, GUARD_COLLECTIONS } from "../../guard/store.ts";
import {
  advanceLimitOrder,
  beginLimitOrder,
  limitOrderKey,
  listLimitOrders,
  listUnsettledLimitOrders,
  mergeFills,
} from "./store.server.ts";
import { LIMIT_RECONCILE_MIN_AGE_MS, reconcileLimitOrders, sideOfMints } from "./sync.server.ts";

const WALLET = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const ORDER = "8bKHKzM64AwCjgkjEoTy76K79tzi6viBNeFawKVUWQZ7";
const SIGNATURE = "5UfDuX7hXbTiKFJqS1MzGsNpbXTzMKJe2bZP1zrd7DnFBSChKvF2FVDNAuqz7SJpaHXTB9E5DP6tMjfZmVDMJRs";

function input(overrides = {}) {
  return {
    wallet: WALLET,
    venue: "trigger",
    order: ORDER,
    pool: null,
    side: "buy",
    baseMint: WRAPPED_SOL_MINT,
    quoteMint: USDC_MINT,
    inputMint: USDC_MINT,
    outputMint: WRAPPED_SOL_MINT,
    makingRaw: "20000000",
    takingRaw: "200000000",
    price: "100",
    fillPrice: 99.9,
    fee: { ryntraBps: 10, venueBps: 0, account: "BDdSbE2s4fUtafn4u2Coy5XHKrUrXZMR8TyZBWBtzkhE" },
    state: "PLACING",
    placeSignature: SIGNATURE,
    cancelSignature: null,
    fills: [],
    reason: null,
    ...overrides,
  };
}

test("the collection is the Guard store's own, so no table is needed", () => {
  assert.ok(GUARD_COLLECTIONS.includes("solanaLimitOrders"));
});

test("an order is written once before the relay and advanced after it", async () => {
  const store = createMemoryGuardStore();
  const begun = await beginLimitOrder(store, input(), "2026-10-15T10:00:00.000Z");
  assert.equal(begun.ok, true);
  assert.equal((await beginLimitOrder(store, input(), "2026-10-15T10:00:01.000Z")).ok, false, "a second relay of the same order is refused");
  const key = limitOrderKey({ wallet: WALLET, venue: "trigger", order: ORDER });
  const open = await advanceLimitOrder(store, key, () => ({ state: "OPEN" }), "2026-10-15T10:00:05.000Z");
  assert.equal(open.ok, true);
  assert.equal(open.record.state, "OPEN");
  assert.equal(open.record.version, 2);
  const listed = await listLimitOrders(store, WALLET);
  assert.equal(listed.records.length, 1);
  assert.equal(listed.complete, true);
  assert.equal((await listUnsettledLimitOrders(store)).length, 1);
  await advanceLimitOrder(store, key, () => ({ state: "FILLED" }), "2026-10-15T11:00:00.000Z");
  assert.equal((await listUnsettledLimitOrders(store)).length, 0, "a filled order is final");
});

test("a malformed order is never written", async () => {
  const store = createMemoryGuardStore();
  assert.equal((await beginLimitOrder(store, input({ makingRaw: "-1" }), "2026-10-15T10:00:00.000Z")).ok, false);
});

test("fills merge by signature: a venue that repeats a fill records it once", () => {
  const fill = { signature: SIGNATURE, inputRaw: "1", outputRaw: "2", feeRaw: "0", at: "2026-10-15T10:00:00Z" };
  assert.equal(mergeFills([fill], [fill, { ...fill, signature: ORDER + ORDER.slice(0, 20) }]).length, 2);
});

test("the side is read off the mints: the quote is the asset the ticket prices in", () => {
  assert.deepEqual(sideOfMints(USDC_MINT, WRAPPED_SOL_MINT), { side: "buy", baseMint: WRAPPED_SOL_MINT, quoteMint: USDC_MINT });
  assert.deepEqual(sideOfMints(WRAPPED_SOL_MINT, USDC_MINT), { side: "sell", baseMint: WRAPPED_SOL_MINT, quoteMint: USDC_MINT });
  const meme = "DkgaAzZyjP3um9wDyWH8XETUuEj5W9VEK7hX8f5Npump";
  assert.deepEqual(sideOfMints(meme, WRAPPED_SOL_MINT), { side: "sell", baseMint: meme, quoteMint: WRAPPED_SOL_MINT });
  assert.deepEqual(sideOfMints(WRAPPED_SOL_MINT, meme), { side: "buy", baseMint: meme, quoteMint: WRAPPED_SOL_MINT });
});

function fakeConnection(status) {
  return {
    getSignatureStatuses: async () => ({ value: [status] }),
  };
}

test("the reconciler settles a placement the relay left unanswered, from its signature", async () => {
  const store = createMemoryGuardStore();
  await beginLimitOrder(store, input(), "2026-10-15T10:00:00.000Z");
  const later = Date.parse("2026-10-15T10:00:00.000Z") + LIMIT_RECONCILE_MIN_AGE_MS + 1;
  /* Too young: left alone. */
  assert.equal((await reconcileLimitOrders(store, { nowMs: Date.parse("2026-10-15T10:00:30.000Z"), sync: async () => undefined, connection: fakeConnection(null) })).length, 0);
  /* Landed: open (the venue read after it fails quietly in a test). */
  const decisions = await reconcileLimitOrders(store, { nowMs: later, sync: async () => undefined, connection: fakeConnection({ err: null, confirmationStatus: "confirmed" }) });
  assert.deepEqual(decisions.map((decision) => [decision.before, decision.after, decision.applied]), [["PLACING", "OPEN", true]]);
});

test("a placement the chain never saw after the window did not happen", async () => {
  const store = createMemoryGuardStore();
  await beginLimitOrder(store, input(), "2026-10-15T10:00:00.000Z");
  const later = Date.parse("2026-10-15T10:00:00.000Z") + LIMIT_RECONCILE_MIN_AGE_MS + 1;
  const decisions = await reconcileLimitOrders(store, { nowMs: later, sync: async () => undefined, connection: fakeConnection(null) });
  assert.deepEqual(decisions.map((decision) => decision.after), ["FAILED"]);
});

test("a cancellation that never landed leaves the order standing", async () => {
  const store = createMemoryGuardStore();
  await beginLimitOrder(store, input({ state: "CANCELLING", cancelSignature: SIGNATURE }), "2026-10-15T10:00:00.000Z");
  const later = Date.parse("2026-10-15T10:00:00.000Z") + LIMIT_RECONCILE_MIN_AGE_MS + 1;
  const decisions = await reconcileLimitOrders(store, { nowMs: later, sync: async () => undefined, connection: fakeConnection(null) });
  assert.deepEqual(decisions.map((decision) => decision.after), ["OPEN"]);
});

test("a DLMM order taken back: wholly converted is filled, part converted is cancelled with its fill", async () => {
  for (const [inputRaw, expected] of [["20000000", "FILLED"], ["5000000", "CANCELLED"]]) {
    const store = createMemoryGuardStore();
    await beginLimitOrder(store, input({ venue: "dlmm", pool: ORDER, state: "CANCELLING", cancelSignature: SIGNATURE, cancelFrom: "PARTIAL", claim: { inputRaw, outputRaw: "50000000" } }), "2026-10-15T10:00:00.000Z");
    const later = Date.parse("2026-10-15T10:00:00.000Z") + LIMIT_RECONCILE_MIN_AGE_MS + 1;
    const decisions = await reconcileLimitOrders(store, { nowMs: later, sync: async () => undefined, connection: fakeConnection({ err: null, confirmationStatus: "confirmed" }) });
    assert.deepEqual(decisions.map((decision) => decision.after), [expected]);
    const [record] = (await listLimitOrders(store, WALLET)).records;
    assert.equal(record.fills.length, 1);
    assert.equal(record.fills[0].outputRaw, "50000000");
  }
});
