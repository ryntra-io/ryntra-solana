import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryGuardStore } from "../guard/store.ts";
import {
  claimCrossSwapCanaryPlan,
  claimCrossSwapCanarySubmit,
  readCrossSwapCanary,
  resolveCrossSwapCanary,
  EMPTY_CANARY,
} from "./cross-swap-canary-record.ts";
import { effectiveCrossSwapRouteState, resolveSolanaCrossSwapRouteState } from "./lane-state.ts";
import { admitCrossSwapCanary, CROSS_SWAP_CANARY, CROSS_SWAP_CANARY_SOURCE_ENV, CROSS_SWAP_CANARY_DESTINATION_ENV } from "../swap/cross-swap-canary.ts";

const SOURCE = "2wmVCSfPxGPjrnMMn7rchp4uaeoTqN39mXFC2zhPdri9";
const DESTINATION = "0x1111111111111111111111111111111111111111";
const digest = (n) => `0x${String(n).padStart(64, "0")}`;
const at = (s) => new Date(Date.UTC(2026, 8, 9, 12, 0, s)).toISOString();

/** The environment a real canary runs in: lane open, route CANARY, wallets set. */
const canaryEnv = (extra = {}) => ({
  RYNTRA_SOLANA_CROSS_SWAP_STATE: "OPEN",
  RYNTRA_SOLANA_CROSS_SWAP_ROBINHOOD_STATE: "CANARY",
  [CROSS_SWAP_CANARY_SOURCE_ENV]: SOURCE,
  [CROSS_SWAP_CANARY_DESTINATION_ENV]: DESTINATION,
  ...extra,
});

/** The exact operation, as the plan route assembles it after quoting. */
const exactRequest = (over = {}) => ({
  fromNetwork: "solana",
  fromAsset: "SOL",
  amountRaw: "50000000",
  toNetwork: "robinhood",
  toAsset: CROSS_SWAP_CANARY.to.contract,
  provider: "RELAY",
  slippageBps: 50,
  appFeeUsd: 0,
  sourceWallet: SOURCE,
  destinationWallet: DESTINATION,
  ...over,
});

/* ── 2. PAUSED blocks ─────────────────────────────────────────────────── */

test("PAUSED blocks: no plan, no submit, and every misspelling reads as PAUSED", () => {
  for (const value of [undefined, "", " ", "open", "canary", "OPENED", "CANARY_MODE", "TRUE", "1", "PAUSED"]) {
    const env = { RYNTRA_SOLANA_CROSS_SWAP_STATE: "OPEN", RYNTRA_SOLANA_CROSS_SWAP_ROBINHOOD_STATE: value };
    const configured = resolveSolanaCrossSwapRouteState("solana", "robinhood", env);
    const expected = value === undefined ? "PAUSED" : value.trim().toUpperCase() === "OPEN" ? "OPEN" : value.trim().toUpperCase() === "CANARY" ? "CANARY" : "PAUSED";
    assert.equal(configured, expected, `value ${JSON.stringify(value)}`);
  }
  /* A route that resolves PAUSED is CLOSED whatever the ledger says. */
  assert.equal(effectiveCrossSwapRouteState("PAUSED", null), "CLOSED");
  assert.equal(effectiveCrossSwapRouteState("PAUSED", { state: "NONE" }), "CLOSED");
  /* And the lane's own stop still dominates: CANARY beneath a paused lane is paused. */
  assert.equal(resolveSolanaCrossSwapRouteState("solana", "robinhood", { RYNTRA_SOLANA_CROSS_SWAP_ROBINHOOD_STATE: "CANARY" }), "PAUSED");
});

test("the three states are distinct, and CANARY is not OPEN", () => {
  assert.equal(resolveSolanaCrossSwapRouteState("solana", "robinhood", canaryEnv()), "CANARY");
  assert.equal(resolveSolanaCrossSwapRouteState("solana", "robinhood", canaryEnv({ RYNTRA_SOLANA_CROSS_SWAP_ROBINHOOD_STATE: "OPEN" })), "OPEN");
  /* An ungated pair is unaffected by the Robinhood switch being CANARY. */
  assert.equal(resolveSolanaCrossSwapRouteState("solana", "base", canaryEnv()), "OPEN");
});

/* ── 3 & 4. CANARY admits only the exact tuple ────────────────────────── */

test("CANARY admits the exact operation", () => {
  const admitted = admitCrossSwapCanary(exactRequest(), canaryEnv());
  assert.equal(admitted.ok, true);
  assert.equal(admitted.sourceWallet, SOURCE);
  assert.equal(admitted.destinationWallet, DESTINATION);
  /* The destination may be named by code or by contract; both are the same asset. */
  assert.equal(admitCrossSwapCanary(exactRequest({ toAsset: "USDG" }), canaryEnv()).ok, true);
  assert.equal(admitCrossSwapCanary(exactRequest({ toAsset: CROSS_SWAP_CANARY.to.contract.toLowerCase() }), canaryEnv()).ok, true);
  /* Less slippage than the ceiling is fine. */
  assert.equal(admitCrossSwapCanary(exactRequest({ slippageBps: 25 }), canaryEnv()).ok, true);
});

test("every deviation fails closed, and names the field that differed", () => {
  const cases = [
    [{ amountRaw: "50000001" }, "CANARY_AMOUNT", "one lamport more"],
    [{ amountRaw: "49999999" }, "CANARY_AMOUNT", "one lamport less"],
    [{ amountRaw: "100000000" }, "CANARY_AMOUNT", "0.1 SOL"],
    [{ fromNetwork: "base" }, "CANARY_FROM_NETWORK", "another source chain"],
    [{ fromAsset: "USDC" }, "CANARY_FROM_ASSET", "another source asset"],
    [{ toNetwork: "ethereum" }, "CANARY_TO_NETWORK", "another destination chain"],
    [{ toAsset: "0x322f0929c4625ed5bad873c95208d54e1c003b2d" }, "CANARY_TO_ASSET", "a stock token"],
    [{ toAsset: "ETH" }, "CANARY_TO_ASSET", "the chain's own coin"],
    [{ provider: "MAYAN" }, "CANARY_PROVIDER", "another provider"],
    [{ slippageBps: 51 }, "CANARY_SLIPPAGE", "one basis point more"],
    [{ slippageBps: 200 }, "CANARY_SLIPPAGE", "the provider default"],
    [{ appFeeUsd: 0.01 }, "CANARY_APP_FEE", "a non-zero app fee"],
    [{ appFeeUsd: null }, "CANARY_APP_FEE", "an app fee nobody stated"],
    [{ sourceWallet: "So11111111111111111111111111111111111111112" }, "CANARY_SOURCE_WALLET", "another source wallet"],
    [{ destinationWallet: "0x000000000000000000000000000000000000dEaD" }, "CANARY_DESTINATION_WALLET", "another destination wallet"],
  ];
  for (const [over, code, what] of cases) {
    const result = admitCrossSwapCanary(exactRequest(over), canaryEnv());
    assert.equal(result.ok, false, `${what} must be refused`);
    assert.equal(result.code, code, what);
  }
});

test("with no wallets configured the controlled operation is refused, never defaulted", () => {
  const result = admitCrossSwapCanary(exactRequest(), { RYNTRA_SOLANA_CROSS_SWAP_STATE: "OPEN", RYNTRA_SOLANA_CROSS_SWAP_ROBINHOOD_STATE: "CANARY" });
  assert.equal(result.ok, false);
  assert.equal(result.code, "CANARY_WALLETS_NOT_CONFIGURED");
});

/* ── 5. A stale plan may be rebuilt, with no financial action ─────────── */

test("a plan that expired without a submit can be rebuilt, as often as needed", async () => {
  const store = createMemoryGuardStore();
  assert.deepEqual((await readCrossSwapCanary(store)).record, EMPTY_CANARY);

  const first = await claimCrossSwapCanaryPlan(store, digest(1), at(1));
  assert.equal(first.ok, true);
  assert.equal(first.record.state, "PLANNED");
  assert.equal(first.record.planCount, 1);
  assert.equal(first.record.submitCount, 0, "planning is not an attempt");

  /* The quote went stale; a fresh plan is a new intent and is allowed. */
  const second = await claimCrossSwapCanaryPlan(store, digest(2), at(2));
  assert.equal(second.ok, true);
  assert.equal(second.record.state, "PLANNED");
  assert.equal(second.record.planCount, 2);
  assert.equal(second.record.intentDigest, digest(2), "the ledger holds the newest plan");
  assert.equal(second.record.submitCount, 0, "still nothing attempted");

  const third = await claimCrossSwapCanaryPlan(store, digest(3), at(3));
  assert.equal(third.ok, true);
  assert.equal(third.record.planCount, 3);

  /* Rebuilding never opens the route further than it already was. */
  assert.equal(effectiveCrossSwapRouteState("CANARY", third.record), "PLAN_AND_SUBMIT");
});

/* ── 6. After the first submit, a second is impossible ────────────────── */

test("the first submit consumes the operation; a second is impossible", async () => {
  const store = createMemoryGuardStore();
  await claimCrossSwapCanaryPlan(store, digest(1), at(1));

  const submitted = await claimCrossSwapCanarySubmit(store, digest(1), at(2));
  assert.equal(submitted.ok, true);
  assert.equal(submitted.record.state, "SUBMIT_ATTEMPTED");
  assert.equal(submitted.record.submitCount, 1);

  /* The same intent again. */
  const again = await claimCrossSwapCanarySubmit(store, digest(1), at(3));
  assert.equal(again.ok, false);
  assert.equal(again.code, "CANARY_ALREADY_ATTEMPTED");

  /* A different intent — the loophole a per-intent record would leave open. */
  const other = await claimCrossSwapCanarySubmit(store, digest(9), at(4));
  assert.equal(other.ok, false);
  assert.equal(other.code, "CANARY_ALREADY_ATTEMPTED");

  /* And no new plan may be built either: the route is in its safe state. */
  const replan = await claimCrossSwapCanaryPlan(store, digest(9), at(5));
  assert.equal(replan.ok, false);
  assert.equal(replan.code, "CANARY_ALREADY_ATTEMPTED");
  assert.equal(effectiveCrossSwapRouteState("CANARY", submitted.record), "CLOSED", "behaves exactly as PAUSED");
});

test("only the plan the ledger is holding may be submitted", async () => {
  const store = createMemoryGuardStore();
  await claimCrossSwapCanaryPlan(store, digest(1), at(1));
  await claimCrossSwapCanaryPlan(store, digest(2), at(2));
  /* The first plan went stale and was rebuilt; submitting the stale one is a
     different operation from the one that was last reviewed. */
  const stale = await claimCrossSwapCanarySubmit(store, digest(1), at(3));
  assert.equal(stale.ok, false);
  assert.equal(stale.code, "CANARY_INTENT_MISMATCH");
  const current = await claimCrossSwapCanarySubmit(store, digest(2), at(4));
  assert.equal(current.ok, true);
});

test("two concurrent submits: exactly one wins", async () => {
  const store = createMemoryGuardStore();
  await claimCrossSwapCanaryPlan(store, digest(1), at(1));
  const [a, b] = await Promise.all([
    claimCrossSwapCanarySubmit(store, digest(1), at(2)),
    claimCrossSwapCanarySubmit(store, digest(1), at(2)),
  ]);
  assert.equal([a.ok, b.ok].filter(Boolean).length, 1, "exactly one submit may win");
  const loser = a.ok ? b : a;
  assert.equal(loser.code, "CANARY_ALREADY_ATTEMPTED");
  assert.equal((await readCrossSwapCanary(store)).record.submitCount, 1);
});

test("a submit with nothing planned is refused", async () => {
  const store = createMemoryGuardStore();
  const result = await claimCrossSwapCanarySubmit(store, digest(1), at(1));
  assert.equal(result.ok, false);
  assert.equal(result.code, "CANARY_NOT_PLANNED");
});

/* ── 7. Resolution closes; OPEN is never reached automatically ────────── */

test("every ending returns the route to closed, and none of them opens it", async () => {
  for (const resolution of ["SUCCESS", "FAILED", "REFUNDED", "RECOVERED"]) {
    const store = createMemoryGuardStore();
    await claimCrossSwapCanaryPlan(store, digest(1), at(1));
    await claimCrossSwapCanarySubmit(store, digest(1), at(2));
    const resolved = await resolveCrossSwapCanary(store, resolution, at(3));
    assert.equal(resolved.ok, true, resolution);
    assert.equal(resolved.record.state, "RESOLVED", resolution);
    assert.equal(resolved.record.resolution, resolution);

    /* Closed, for both plan and submit, and reading it says CLOSED. */
    assert.equal(effectiveCrossSwapRouteState("CANARY", resolved.record), "CLOSED", resolution);
    assert.equal((await claimCrossSwapCanaryPlan(store, digest(2), at(4))).ok, false, resolution);
    assert.equal((await claimCrossSwapCanarySubmit(store, digest(2), at(4))).ok, false, resolution);
  }
});

test("nothing in the ledger can produce OPEN — that is a person changing a variable", async () => {
  const store = createMemoryGuardStore();
  await claimCrossSwapCanaryPlan(store, digest(1), at(1));
  await claimCrossSwapCanarySubmit(store, digest(1), at(2));
  await resolveCrossSwapCanary(store, "SUCCESS", at(3));
  const record = (await readCrossSwapCanary(store)).record;

  /* Whatever the ledger holds, a CANARY route never becomes OPEN. The only
     input that produces OPEN is the configured state, and only a person sets
     that. */
  for (const state of ["NONE", "PLANNED", "SUBMIT_ATTEMPTED", "RESOLVED"]) {
    assert.notEqual(effectiveCrossSwapRouteState("CANARY", { state }), "OPEN");
  }
  assert.equal(effectiveCrossSwapRouteState("CANARY", record), "CLOSED");
  /* Only the variable does it. */
  assert.equal(effectiveCrossSwapRouteState("OPEN", record), "PLAN_AND_SUBMIT");
});

test("an unreadable ledger closes the route rather than opening it", () => {
  /* `null` is what a failed read hands the gate. A one-shot control whose
     counter cannot be read is not a one-shot control, so it refuses. */
  assert.equal(effectiveCrossSwapRouteState("CANARY", null), "CLOSED");
});

test("a resolution with nothing attempted is refused, and resolving twice is idempotent", async () => {
  const store = createMemoryGuardStore();
  const early = await resolveCrossSwapCanary(store, "SUCCESS", at(1));
  assert.equal(early.ok, false);
  assert.equal(early.code, "CANARY_NOT_PLANNED");

  await claimCrossSwapCanaryPlan(store, digest(1), at(2));
  await claimCrossSwapCanarySubmit(store, digest(1), at(3));
  const first = await resolveCrossSwapCanary(store, "REFUNDED", at(4));
  const second = await resolveCrossSwapCanary(store, "SUCCESS", at(5));
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.record.resolution, "REFUNDED", "the first ending is the one that stands");
});
