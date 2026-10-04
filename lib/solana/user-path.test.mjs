/**
 * The money lanes belong to the person whose money it is.
 *
 * Swap was closed behind a Ryntra Telegram admin session and Bridge behind a
 * policy that bounds a $20 founder experiment. Neither was a product control —
 * both were left over from the period when the only person allowed to move
 * money here was the founder — and between them they meant that an ordinary
 * visitor could get a live quote, press the button, and never reach a wallet.
 *
 * These tests hold the doors open. They are source-greps on purpose: the thing
 * that must not come back is a *line of code*, and a behavioural test cannot
 * fail when somebody re-adds a session check above the behaviour it asserts.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  SOLANA_LANES,
  SOLANA_LANE_STATE_ENV,
  resolveSolanaLaneState,
} from "./lane-state.ts";
import { resolveSendState } from "./send-safety.ts";

const read = (path) => readFileSync(path, "utf8");

const SWAP_ROUTES = {
  order: "app/api/solana/swap/order/route.ts",
  execute: "app/api/solana/swap/execute/route.ts",
  cancelReview: "app/api/solana/swap/cancel-review/route.ts",
  recover: "app/api/solana/swap/recover/route.ts",
};

const SEND_ROUTES = {
  plan: "app/api/solana/transfer/plan/route.ts",
  adopt: "app/api/solana/transfer/adopt/route.ts",
  settle: "app/api/solana/transfer/settle/route.ts",
  recover: "app/api/solana/transfer/recover/route.ts",
};

/* ------------------------------------------------------------------ *
 * The operator stop that replaced the leftovers
 * ------------------------------------------------------------------ */

test("only the exact word OPEN opens a lane", () => {
  for (const lane of SOLANA_LANES) {
    const key = SOLANA_LANE_STATE_ENV[lane];
    /* Case and surrounding space are forgiven — that is Send's original
       semantics and an operator typing `open` means it. Nothing else is. */
    for (const value of ["OPEN", "open", "Open", "  OPEN  "]) {
      assert.equal(resolveSolanaLaneState(lane, { [key]: value }), "OPEN", `${lane}=${JSON.stringify(value)}`);
    }
    /* Everything else is closed, including the near misses somebody types at
       two in the morning. A stop that opens when its configuration is wrong is
       not a stop. */
    for (const value of ["OPEN!", "OPENED", "TRUE", "1", "YES", "PAUSED", "", "   "]) {
      assert.equal(resolveSolanaLaneState(lane, { [key]: value }), "PAUSED", `${lane}=${JSON.stringify(value)}`);
    }
    assert.equal(resolveSolanaLaneState(lane, {}), "PAUSED", `${lane} with nothing configured`);
  }
});

test("no lane inherits another lane's state", () => {
  /* Opening a money lane has to be something somebody did on purpose, for that
     lane, by name. Send's own switch used to open all three, which meant one
     variable written for one action family quietly opened the one that burns
     USDC on a second chain. */
  const sendOpen = { [SOLANA_LANE_STATE_ENV.SEND]: "OPEN" };
  assert.equal(resolveSolanaLaneState("SEND", sendOpen), "OPEN");
  assert.equal(resolveSolanaLaneState("SWAP", sendOpen), "PAUSED");
  assert.equal(resolveSolanaLaneState("BRIDGE", sendOpen), "PAUSED");

  /* And they are genuinely independent in both directions. */
  const swapOnly = { [SOLANA_LANE_STATE_ENV.SWAP]: "OPEN" };
  assert.equal(resolveSolanaLaneState("SWAP", swapOnly), "OPEN");
  assert.equal(resolveSolanaLaneState("SEND", swapOnly), "PAUSED");
  assert.equal(resolveSolanaLaneState("BRIDGE", swapOnly), "PAUSED");
});

test("Send's own stop keeps its name and its meaning", () => {
  assert.equal(resolveSendState({ [SOLANA_LANE_STATE_ENV.SEND]: "OPEN" }), "OPEN");
  assert.equal(resolveSendState({}), "PAUSED");
  assert.equal(resolveSendState({ [SOLANA_LANE_STATE_ENV.SEND]: "PAUSED" }), "PAUSED");
});

/* ------------------------------------------------------------------ *
 * Swap
 * ------------------------------------------------------------------ */

test("no swap route requires a Ryntra admin login", () => {
  for (const [name, path] of Object.entries(SWAP_ROUTES)) {
    assert.ok(
      !/getAdminSession/.test(read(path)),
      `${name} still refuses a person who is not logged into Ryntra as an operator`,
    );
  }
});

test("every swap route still refuses a cross-origin caller, and a native session only for its own wallet", () => {
  /* The gate moved into one helper when the phone arrived (the mobile line's
     request 13): a browser keeps the same-origin check, a bearer stands in
     for it and binds the bearer's wallet. The helper's own suite
     (`swap-carrier.test.mjs`) meets every outcome; this pin keeps the four
     routes on it. */
  for (const [name, path] of Object.entries(SWAP_ROUTES)) {
    const source = read(path);
    assert.match(source, /readSwapCarrier\(request, "/, `${name} lost its carrier gate`);
    assert.match(source, /walletMismatch\(carrier, /, `${name} lets a native session act for another wallet`);
  }
  assert.match(read("lib/solana/swap-carrier.ts"), /mutationOriginAllowed/, "the helper lost the same-origin gate");
});

test("the two routes that can reach a wallet carry the stop, and the two that rescue one do not", () => {
  for (const name of ["order", "execute"]) {
    const source = read(SWAP_ROUTES[name]);
    assert.match(source, /resolveSolanaLaneState\("SWAP"\)/, `${name} has no operator stop`);
    assert.match(source, /SWAP_PAUSED/, `${name} does not name the pause to the person`);
  }
  /* Recovery and cancellation must work while the lane is closed. A pause is
     for stopping new risk, never for stranding a wallet that already signed or
     is holding its own unclaimed Review. */
  for (const name of ["cancelReview", "recover"]) {
    assert.ok(
      !/resolveSolanaLaneState/.test(read(SWAP_ROUTES[name])),
      `${name} would strand a wallet behind a paused lane`,
    );
  }
});

test("Send keeps the same boundary: the stop is on the routes that act, never on the one that rescues", () => {
  /* The rule was written for Swap and is a property of the product, not of one
     lane. It arrives for Send with the route that made it testable: until
     `../transfer/recover` existed, Send had nowhere the rule could be broken,
     and a person whose tab reloaded after signing had no route at all. */
  for (const name of ["plan", "adopt", "settle"]) {
    assert.match(
      read(SEND_ROUTES[name]),
      /resolveSendState\(\)/,
      `${name} has no operator stop`,
    );
  }
  const recover = read(SEND_ROUTES.recover);
  assert.ok(
    !/resolveSendState|resolveSolanaLaneState/.test(recover),
    "send recovery would strand a wallet behind a paused lane",
  );
  /* And it cannot move anything, which is why it is allowed to run while the
     lane is closed. A recovery route that could submit would be a second
     submit path wearing a safe name. */
  for (const forbidden of ["sendTransaction", "submit-rpc", "signedWireBase64", "loadIssuerKey"]) {
    assert.ok(
      !recover.includes(forbidden),
      `send recovery references ${forbidden}; it must accept no bytes and hold no key`,
    );
  }
  assert.ok(
    recover.includes("DURABLE_MULTI_WRITER"),
    "send recovery must read the durable attempt ledger that records a submit crossing",
  );
});

test("recovery runs on the read budget, because acting needs the other one", () => {
  /*
   * Found by counting rather than by a failure. The action window is 12 a
   * minute; every recovery card polls its route every three seconds while an
   * outcome is open, which is twenty. On the action budget recovery answers 429
   * after about thirty seconds and takes `plan`, `settle`, `order` and `execute`
   * down with it for the rest of the minute — so the person whose money is in an
   * unknown state is the one person who cannot act.
   *
   * All three recovery routes submit nothing, which is what makes the cheaper
   * budget correct rather than merely convenient, and each says so in its own
   * comment. The assertion below is the one that keeps it true.
   */
  for (const path of [
    "app/api/solana/transfer/recover/route.ts",
    "app/api/solana/swap/recover/route.ts",
    "app/api/solana/bridge/recover/route.ts",
  ]) {
    const source = read(path);
    assert.match(source, /consumeSolanaReadRequest/, `${path} is not on the read budget`);
    assert.ok(
      !/consumeAgentControlRequest/.test(source),
      `${path} still spends the action budget a person needs to act`,
    );
    for (const forbidden of ["sendTransaction", "submit-rpc", "submitOnce"]) {
      assert.ok(!source.includes(forbidden), `${path} references ${forbidden}; a read may not submit`);
    }
  }
  /* Cancelling a review is not a read — it releases a reservation — so it stays
     where it is. The budget follows what a route does, not what it is near. */
  assert.match(read(SWAP_ROUTES.cancelReview), /consumeAgentControlRequest/);
});

test("opening the lane did not loosen anything that proves what the bytes do", () => {
  /* The guards live in the swap's steps of the core pipeline and its shared
     safety chain now; the route runs them. The chain has two halves — before
     the wallet and after it — and each route is held to its own half, by the
     calls themselves, not by an import line. */
  const chain = read("lib/core/solana-swap/guard.ts");
  const split = chain.indexOf("after the wallet */");
  assert.ok(split > 0, "the safety chain no longer marks its two halves");
  const order = [read(SWAP_ROUTES.order), read("lib/core/solana-swap/prepare.ts"), chain.slice(0, split)].join("\n");
  for (const guard of [
    "loadIssuerKey(",
    '!== "DURABLE_MULTI_WRITER"',
    "inspectJupiterSwapTransaction(",
    "evaluateSwapPolicy(",
    "assessSwapClientReview(",
    "reserveSwapOwnerReview(",
  ]) {
    assert.ok(order.includes(guard), `the order route no longer calls ${guard}`);
  }
  const execute = [read(SWAP_ROUTES.execute), chain.slice(split), read("lib/core/solana-swap/settle.ts")].join("\n");
  for (const guard of ["claimSwapOwnerSignature(", "markSwapOwnerSubmitted("]) {
    assert.ok(execute.includes(guard), `the execute route no longer calls ${guard}`);
  }
});

test("reading has its own budget, and acting keeps the tight one", () => {
  /* Opening the Swap card spent three of twelve before a person typed
     anything, so editing an amount twice and searching the picker once made
     the *quote* answer 429 — and the card blamed the venue for it. */
  for (const path of [
    "app/api/solana/holdings/route.ts",
    "app/api/solana/tokens/search/route.ts",
    "app/api/solana/swap/quote/route.ts",
  ]) {
    const source = read(path);
    assert.match(source, /consumeSolanaReadRequest/, `${path} is still on the action budget`);
    assert.ok(!/consumeAgentControlRequest/.test(source), `${path} still consumes the action budget too`);
  }
  /* Everything that builds, signs, submits or burns stays where it was. */
  for (const path of [SWAP_ROUTES.order, SWAP_ROUTES.execute, "app/api/solana/bridge/burn/route.ts"]) {
    assert.match(read(path), /consumeAgentControlRequest/, `${path} left the action budget`);
  }
});

/* ------------------------------------------------------------------ *
 * Bridge
 * ------------------------------------------------------------------ */

test("the burn gate reads the canary scope, never the bare decision", () => {
  const safety = read("lib/solana/cctp-safety.ts");
  assert.match(safety, /scope\.status === "OUTSIDE_ENVELOPE"/, "the burn gate ignores whose transfer this is");
  /* The meaning, not the wording. This pinned the exact sentence, and the
     sentence had to change: it named the owner-canary to a customer, which
     must never happen and which `cctp-safety.test.mjs` now guards directly. */
  assert.match(safety, /decide[s]? nothing/, "an outside-envelope verdict no longer says it decides nothing");
  /* The engine stays. Inside the envelope the founder's own canary is still
     decided, still bounded, still charged. */
  assert.match(safety, /canary === "ALLOW" \? "PASS"/, "the owner canary no longer decides its own transfers");
});

test("no canary amount band survives in the bridge plan builder", () => {
  const plan = read("lib/solana/cctp-plan.ts");
  assert.ok(!/amount < 2_000_000n/.test(plan), "the 2 USDC floor is still enforced on ordinary people");
  assert.ok(!/amount > 5_000_000n/.test(plan), "the 5 USDC ceiling is still enforced on ordinary people");
  assert.match(plan, /amount <= 0n/, "the plan builder accepts an amount that moves nothing");
  /* The limits that are real are derived, and all of them are still here. */
  for (const guard of ["PROVIDER_FACTS_UNAVAILABLE", "BALANCE_INSUFFICIENT", "LAMPORTS_INSUFFICIENT"]) {
    assert.ok(plan.includes(guard), `the plan builder no longer refuses on ${guard}`);
  }
});

test("the bridge amount is typed by a person, not compiled in", () => {
  const card = read("app/solana/workspace/bridge/bridge-card.tsx");
  assert.ok(!/AMOUNT_RAW\s*=\s*"2000000"/.test(card), "the card still hard-codes 2 USDC");
  assert.ok(!/AMOUNT_LABEL/.test(card), "the card still labels a compiled-in amount");
  assert.match(card, /parseHumanAmount/, "the card does not parse the amount, so it would round it");
  assert.match(card, /Enter an amount/, "the card does not ask for an amount");
});

test("every bridge route that acts re-derives the stop on the server, for the network the lane names", () => {
  /* Since 2026-09-05 the stop has two layers: the bridge lane, and beneath it
     the network's own switch (Ethereum stays PAUSED until its first verified
     transfer; Base has no switch of its own). The routes that act ask for the
     network's state by the lane's own EVM chain, and that resolver is built on
     the lane state rather than beside it — so a paused lane still closes every
     network, and nothing here is taken from the request. */
  for (const path of [
    "app/api/solana/bridge/plan/route.ts",
    "app/api/solana/bridge/burn/route.ts",
    "app/api/solana/bridge/base-burn/route.ts",
  ]) {
    assert.match(read(path), /resolveSolanaBridgeNetworkState\(lane\.evmChain\)/, `${path} takes the lane state on trust`);
  }
  const laneState = read("lib/solana/lane-state.ts");
  const resolver = laneState.slice(laneState.indexOf("export function resolveSolanaBridgeNetworkState"));
  assert.match(resolver, /resolveSolanaLaneState\("BRIDGE", env\)/, "the network switch no longer sits beneath the lane's stop");
  assert.match(resolver, /if \(lane !== "OPEN"\) return "PAUSED"/, "a paused lane no longer closes every network");
  /* Everything after a burn must stay reachable: a transfer whose money is
     already in flight is finished, not paused. */
  for (const path of [
    "app/api/solana/bridge/attestation/route.ts",
    "app/api/solana/bridge/mint/route.ts",
    "app/api/solana/bridge/observe/route.ts",
    "app/api/solana/bridge/receipt/route.ts",
    "app/api/solana/bridge/recover/route.ts",
  ]) {
    assert.ok(
      !/resolveSolanaLaneState|resolveSolanaBridgeNetworkState/.test(read(path)),
      `${path} would strand money in flight behind a pause`,
    );
  }
});

test("the burn boundary and the duplicate-burn claim are untouched by any of this", () => {
  const burn = read("app/api/solana/bridge/burn/route.ts");
  for (const guard of ["withCctpBurnBoundary", "evaluateCctpSafety", "canBurn", "settleCctpCanaryExposure"]) {
    assert.ok(burn.includes(guard), `the burn route no longer calls ${guard}`);
  }
  const claim = read("lib/solana/cctp-burn-claim.ts");
  assert.match(claim, /CCTP_BURN_CLAIM_STATES/, "a second burn of the same intent became possible");
  assert.match(claim, /markCctpBurnReverted/, "the one evidence-bound door back out of a claim is gone");
});
