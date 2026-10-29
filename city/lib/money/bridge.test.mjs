import { test } from "node:test";
import assert from "node:assert/strict";

import { BRIDGE_NETWORKS, bridgeRefusalWords, bridgeRoute, confirmBridge, orderPhase, planBridge, quoteBridge, quoteFacts, readDestination, readOrder } from "./bridge.ts";
import { clock, DIGEST, EVM, no, ok, OWNER, scriptedFetch, SIGNATURE } from "./test-fixtures.mjs";

const QUOTE = "/api/solana/cross-swap/quote";
const PLAN = "/api/solana/cross-swap/plan";
const SUBMIT = "/api/solana/cross-swap/submit";
const STATUS = "/api/solana/cross-swap/status";

const quote = (minimumRaw = "9970000") => ({
  route: "RELAY_DEPOSIT",
  provider: "RELAY",
  from: { network: "solana", asset: "USDC", symbol: "USDC", decimals: 6, amountRaw: "10000000" },
  to: { network: "base", asset: "USDC", symbol: "USDC", decimals: 6, expectedRaw: "9980000", minimumRaw },
  etaSeconds: 30,
  deadlineUnix: 1_900_000_000,
  fees: { protocolBps: 0, protocolUsd: 0.01, relayerUsd: 0.02, relayerGasUsd: 0.01, sourceGasUsd: 0.0007, refundUsd: null, rentLamports: null, referrerBps: 0 },
  serviceFee: { mechanism: "RELAY_APP_FEE", state: "REQUESTED", basisPoints: 25, requestedBasisPoints: 25, asset: null, symbol: null, decimals: null, amountRaw: null, usd: 0.025, accrual: "PROVIDER" },
});

const runs = () => {
  let held = null;
  const log = [];
  return {
    log,
    store: {
      read: () => held,
      save: (intentDigest, tupleId) => {
        held = { intentDigest, tupleId };
        log.push("save");
      },
      clear: () => {
        held = null;
        log.push("clear");
      },
    },
  };
};

test("the engine carries USDC out of Solana to every network money also comes in from", () => {
  assert.deepEqual([...BRIDGE_NETWORKS], ["base", "ethereum", "arbitrum", "optimism", "polygon", "bnb"]);
  for (const network of BRIDGE_NETWORKS) {
    const route = bridgeRoute(network);
    assert.equal(route?.kind, "CROSS_SWAP", network);
    assert.equal(route.from.network, "solana");
    assert.equal(route.to.network, network);
  }
});

test("the address there is a 0x address; a Solana one is a Send", () => {
  assert.deepEqual(readDestination(` ${EVM} `), { ok: true, address: EVM });
  assert.equal(readDestination("").problem, "EMPTY");
  assert.equal(readDestination(OWNER).problem, "SOLANA");
  assert.equal(readDestination("0x123").problem, "NOT_EVM");
});

test("a price is the engine's: asked with both wallets, read without adding fees twice", async () => {
  const engine = scriptedFetch({ [QUOTE]: [ok({ kind: "CROSS_SWAP", quote: quote(), lane: "OPEN", buildable: true })] });
  const route = bridgeRoute("base");
  const answer = await quoteBridge(engine.fetch, { route, amountRaw: "10000000", owner: OWNER, destination: EVM });
  assert.equal(answer.ok, true);
  assert.deepEqual(engine.asked(QUOTE)[0].body, { from: { network: "solana", asset: "USDC" }, to: { network: "base", asset: "USDC" }, amountRaw: "10000000", destinationAddress: EVM, sourceAddress: OWNER });
  const facts = quoteFacts(answer.body.quote);
  // The relayer figure already holds the protocol fee and the relayer's gas: one figure, never their sum.
  assert.equal(facts.providerUsd, 0.02);
  assert.equal(facts.minimumRaw, "9970000");
  assert.match(facts.ryntraFee, /0\.25%/);
  const refused = await quoteBridge(scriptedFetch({ [QUOTE]: [no(429, "RATE_LIMITED")] }).fetch, { route, amountRaw: "1", owner: OWNER, destination: EVM });
  assert.equal(refused.failure.code, "RATE_LIMITED");
  assert.equal(bridgeRefusalWords("RATE_LIMITED"), "Too many requests. Try again in a moment.");
  assert.equal(bridgeRefusalWords("RELAY_SAID_SOMETHING"), "This transfer could not continue. Nothing was sent.");
});

test("only a Solana plan is ever signed here", async () => {
  const time = clock();
  const route = bridgeRoute("base");
  const input = { route, amountRaw: "10000000", owner: OWNER, destination: EVM };
  const solana = scriptedFetch({ [PLAN]: [ok({ intentDigest: DIGEST, quote: quote(), plan: { origin: "solana", unsignedWireBase64: "unsigned" }, reviewExpiresAt: "2026-10-28T12:00:45Z", signableMs: 30_000 })] });
  const planned = await planBridge(solana.fetch, input, quote(), time.now);
  assert.equal(planned.ok, true);
  assert.deepEqual(solana.asked(PLAN)[0].body.reviewed, { route: "RELAY_DEPOSIT", amountRaw: "10000000", minimumRaw: "9970000" });
  const evm = scriptedFetch({ [PLAN]: [ok({ intentDigest: DIGEST, quote: quote(), plan: { origin: "evm", calls: [] } })] });
  assert.equal((await planBridge(evm.fetch, input, quote(), time.now)).failure.code, "BUILD_FAILED");
  const moved = scriptedFetch({ [PLAN]: [no(409, "QUOTE_CHANGED", { quote: quote("9000000") })] });
  const refused = await planBridge(moved.fetch, input, quote(), time.now);
  assert.deepEqual([refused.failure.code, refused.fresh.to.minimumRaw], ["QUOTE_CHANGED", "9000000"]);
});

const plan = (receivedAt, reviewMs = 45_000) => ({ intentDigest: DIGEST, quote: quote(), unsignedWireBase64: "unsigned", reviewExpiresAt: new Date(receivedAt + reviewMs).toISOString(), signableMs: 30_000, receivedAt });

test("one signature, the run kept before the bytes leave, then the order is followed", async () => {
  const time = clock();
  const engine = scriptedFetch({ [SUBMIT]: [ok({ state: "SUBMITTED", intentDigest: DIGEST })] });
  const kept = runs();
  const signed = [];
  const outcome = await confirmBridge(
    { fetch: engine.fetch, sign: async (wire) => (signed.push(wire), { ok: true, signedWireBase64: "signed" }), runs: kept.store, now: time.now },
    plan(time.now()),
    "SOLANA_USDC_TO_BASE_USDC",
  );
  assert.deepEqual(outcome, { kind: "tracking", intentDigest: DIGEST });
  assert.deepEqual(signed, ["unsigned"]);
  assert.deepEqual(kept.log, ["save"]);
  assert.deepEqual(engine.asked(SUBMIT)[0].body, { phase: "SOLANA", intentDigest: DIGEST, reviewedTransactionBase64: "unsigned", signedTransactionBase64: "signed" });
});

test("bytes too old to sign never reach the wallet; bytes that aged in it never leave", async () => {
  const time = clock();
  const engine = scriptedFetch({ [SUBMIT]: [] });
  const kept = runs();
  let asked = 0;
  const deps = { fetch: engine.fetch, sign: async () => (asked++, { ok: true, signedWireBase64: "signed" }), runs: kept.store, now: time.now };
  const old = await confirmBridge(deps, plan(time.now() - 25_000), "t");
  assert.equal(old.kind, "stale");
  assert.equal(asked, 0);
  // A Review read past its own time is asked for again too, however young its bytes.
  const read = await confirmBridge(deps, plan(time.now(), 5_000), "t");
  assert.equal(read.kind, "stale");
  assert.equal(asked, 0);
  const slow = await confirmBridge({ ...deps, sign: async () => (time.advance(31_000), { ok: true, signedWireBase64: "signed" }) }, plan(time.now()), "t");
  assert.equal(slow.kind, "stale");
  assert.equal(engine.asked(SUBMIT).length, 0);
  assert.deepEqual(kept.log, []);
});

test("a wallet that says no sends nothing; an open order blocks a second", async () => {
  const time = clock();
  const kept = runs();
  const engine = scriptedFetch({ [SUBMIT]: [] });
  const no1 = await confirmBridge({ fetch: engine.fetch, sign: async () => ({ ok: false, reason: "User rejected" }), runs: kept.store, now: time.now }, plan(time.now()), "t");
  assert.deepEqual(no1, { kind: "cancelled", line: "Wallet approval was cancelled." });
  kept.store.save(DIGEST, "t");
  const twice = await confirmBridge({ fetch: engine.fetch, sign: async () => ({ ok: true, signedWireBase64: "s" }), runs: kept.store, now: time.now }, plan(time.now()), "t");
  assert.equal(twice.code, "CROSS_SWAP_ALREADY_STARTED");
  assert.equal(engine.asked(SUBMIT).length, 0);
});

test("a refusal before the submit boundary clears the run; one that may have crossed is followed, never retried", async () => {
  const time = clock();
  const before = runs();
  const refused = await confirmBridge(
    { fetch: scriptedFetch({ [SUBMIT]: [no(409, "CROSS_SWAP_PAUSED", { submitBoundary: "NOT_CROSSED" })] }).fetch, sign: async () => ({ ok: true, signedWireBase64: "s" }), runs: before.store, now: time.now },
    plan(time.now()),
    "t",
  );
  assert.deepEqual([refused.kind, refused.line], ["refused", "Moving money between networks is paused right now."]);
  assert.deepEqual(before.log, ["save", "clear"]);
  const crossed = runs();
  const unclear = await confirmBridge(
    { fetch: scriptedFetch({ [SUBMIT]: [no(502, "SUBMIT_UNKNOWN")] }).fetch, sign: async () => ({ ok: true, signedWireBase64: "s" }), runs: crossed.store, now: time.now },
    plan(time.now()),
    "t",
  );
  assert.deepEqual(unclear, { kind: "tracking", intentDigest: DIGEST });
  assert.deepEqual(crossed.log, ["save"]);
});

test("an order's state in the window's words; unknown is on its way, never arrived", async () => {
  assert.equal(orderPhase("COMPLETED"), "done");
  assert.equal(orderPhase("REFUNDED"), "refunded");
  assert.equal(orderPhase("SOURCE_FAILED"), "failed");
  assert.equal(orderPhase("EXPIRED_BEFORE_SUBMIT"), "failed");
  assert.equal(orderPhase("RECOVERY_REQUIRED"), "recovery");
  assert.equal(orderPhase("SOMETHING_NEW"), "moving");
  const order = { intentDigest: DIGEST, state: "COMPLETED", sourceTxHash: SIGNATURE };
  assert.equal((await readOrder(scriptedFetch({ [STATUS]: [ok({ order })] }).fetch, DIGEST)).state, "COMPLETED");
  assert.equal(await readOrder(scriptedFetch({ [STATUS]: [ok({ order: { ...order, intentDigest: "0xother" } })] }).fetch, DIGEST), null);
});
