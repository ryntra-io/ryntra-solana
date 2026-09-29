import assert from "node:assert/strict";
import test from "node:test";

import { SOLANA_BRIDGE_NETWORK_STATE_ENV, SOLANA_LANE_STATE_ENV, resolveSolanaBridgeNetworkState, resolveSolanaCrossSwapRouteState, resolveSolanaLaneState } from "./lane-state.ts";

test("a lane opens only on the exact word OPEN in its own variable", () => {
  assert.equal(resolveSolanaLaneState("BRIDGE", {}), "PAUSED");
  assert.equal(resolveSolanaLaneState("BRIDGE", { RYNTRA_SOLANA_BRIDGE_STATE: "open" }), "OPEN", "case is forgiven");
  assert.equal(resolveSolanaLaneState("BRIDGE", { RYNTRA_SOLANA_BRIDGE_STATE: " OPEN " }), "OPEN", "padding is forgiven");
  assert.equal(resolveSolanaLaneState("BRIDGE", { RYNTRA_SOLANA_BRIDGE_STATE: "OPENED" }), "PAUSED");
  /* No inheritance between lanes. */
  assert.equal(resolveSolanaLaneState("BRIDGE", { RYNTRA_SOLANA_SEND_STATE: "OPEN" }), "PAUSED");
  assert.equal(SOLANA_LANE_STATE_ENV.BRIDGE, "RYNTRA_SOLANA_BRIDGE_STATE");
});

/**
 * The Ethereum network's stop, 2026-09-05.
 *
 * Base has no switch of its own and answers with the lane's state, exactly as
 * before Ethereum existed. Ethereum needs the lane open *and* its own variable,
 * fails closed on anything but the exact word, and inherits nothing — opening
 * a money route is a thing somebody does on purpose, for that route, by name.
 */
test("Base follows the bridge lane alone, as it always has", () => {
  assert.equal(resolveSolanaBridgeNetworkState("base", {}), "PAUSED");
  assert.equal(resolveSolanaBridgeNetworkState("base", { RYNTRA_SOLANA_BRIDGE_STATE: "OPEN" }), "OPEN");
  /* An Ethereum switch changes nothing about Base in either direction. */
  assert.equal(
    resolveSolanaBridgeNetworkState("base", { RYNTRA_SOLANA_BRIDGE_STATE: "OPEN", RYNTRA_SOLANA_BRIDGE_ETHEREUM_STATE: "PAUSED" }),
    "OPEN",
  );
  assert.equal(resolveSolanaBridgeNetworkState("base", { RYNTRA_SOLANA_BRIDGE_ETHEREUM_STATE: "OPEN" }), "PAUSED");
});

test("Ethereum needs the lane open and its own exact OPEN, and fails closed otherwise", () => {
  assert.equal(SOLANA_BRIDGE_NETWORK_STATE_ENV.ethereum, "RYNTRA_SOLANA_BRIDGE_ETHEREUM_STATE");
  assert.equal(resolveSolanaBridgeNetworkState("ethereum", {}), "PAUSED");
  assert.equal(resolveSolanaBridgeNetworkState("ethereum", { RYNTRA_SOLANA_BRIDGE_STATE: "OPEN" }), "PAUSED", "no inheritance from the lane");
  assert.equal(resolveSolanaBridgeNetworkState("ethereum", { RYNTRA_SOLANA_BRIDGE_ETHEREUM_STATE: "OPEN" }), "PAUSED", "a paused lane closes every network");
  assert.equal(
    resolveSolanaBridgeNetworkState("ethereum", { RYNTRA_SOLANA_BRIDGE_STATE: "OPEN", RYNTRA_SOLANA_BRIDGE_ETHEREUM_STATE: "OPEN" }),
    "OPEN",
  );
  assert.equal(
    resolveSolanaBridgeNetworkState("ethereum", { RYNTRA_SOLANA_BRIDGE_STATE: "OPEN", RYNTRA_SOLANA_BRIDGE_ETHEREUM_STATE: " open " }),
    "OPEN",
  );
  assert.equal(
    resolveSolanaBridgeNetworkState("ethereum", { RYNTRA_SOLANA_BRIDGE_STATE: "OPEN", RYNTRA_SOLANA_BRIDGE_ETHEREUM_STATE: "yes" }),
    "PAUSED",
  );
});

/**
 * The cross-chain swap lane, 2026-09-07 (`RYN-SOL-MONEY-FLOWS-001F`).
 *
 * A fourth lane with its own variable and no inheritance: Swap and Bridge both
 * open says nothing about a route that moves money through a new provider.
 */
test("the cross-swap lane has its own variable and inherits from no other lane", () => {
  assert.equal(SOLANA_LANE_STATE_ENV.CROSS_SWAP, "RYNTRA_SOLANA_CROSS_SWAP_STATE");
  assert.equal(resolveSolanaLaneState("CROSS_SWAP", {}), "PAUSED");
  assert.equal(
    resolveSolanaLaneState("CROSS_SWAP", { RYNTRA_SOLANA_SWAP_STATE: "OPEN", RYNTRA_SOLANA_BRIDGE_STATE: "OPEN" }),
    "PAUSED",
    "no inheritance from Swap or Bridge",
  );
  assert.equal(resolveSolanaLaneState("CROSS_SWAP", { RYNTRA_SOLANA_CROSS_SWAP_STATE: " open " }), "OPEN");
  assert.equal(resolveSolanaLaneState("CROSS_SWAP", { RYNTRA_SOLANA_CROSS_SWAP_STATE: "OPENED" }), "PAUSED");
});

test("Robinhood Chain opens only when its own switch says so, in both directions", () => {
  const open = { RYNTRA_SOLANA_CROSS_SWAP_STATE: "OPEN", RYNTRA_SOLANA_CROSS_SWAP_ROBINHOOD_STATE: "OPEN" };
  assert.equal(resolveSolanaCrossSwapRouteState("solana", "robinhood", open), "OPEN");
  assert.equal(resolveSolanaCrossSwapRouteState("robinhood", "solana", open), "OPEN");

  /* The lane open and the network silent is the shipping state: a new provider
     does not arrive open because the lane it joined happened to be. */
  const laneOnly = { RYNTRA_SOLANA_CROSS_SWAP_STATE: "OPEN" };
  assert.equal(resolveSolanaCrossSwapRouteState("solana", "robinhood", laneOnly), "PAUSED");
  assert.equal(resolveSolanaCrossSwapRouteState("robinhood", "solana", laneOnly), "PAUSED");

  /* And the network open with the lane paused stays shut: the lane is still
     the emergency stop over everything beneath it. */
  assert.equal(
    resolveSolanaCrossSwapRouteState("solana", "robinhood", { RYNTRA_SOLANA_CROSS_SWAP_ROBINHOOD_STATE: "OPEN" }),
    "PAUSED",
  );
});

test("the Robinhood switch fails closed on anything that is not exactly OPEN", () => {
  for (const value of [undefined, "", " ", "open", "Open", " OPEN ", "TRUE", "1", "OPENED", "PAUSED"]) {
    const env = { RYNTRA_SOLANA_CROSS_SWAP_STATE: "OPEN", RYNTRA_SOLANA_CROSS_SWAP_ROBINHOOD_STATE: value };
    const expected = value !== undefined && value.trim().toUpperCase() === "OPEN" ? "OPEN" : "PAUSED";
    assert.equal(resolveSolanaCrossSwapRouteState("solana", "robinhood", env), expected, `value ${JSON.stringify(value)}`);
  }
});

test("the pairs Mayan carries answer to the lane alone, and the new switch cannot close them", () => {
  const laneOnly = { RYNTRA_SOLANA_CROSS_SWAP_STATE: "OPEN" };
  for (const [from, to] of [
    ["solana", "base"],
    ["base", "solana"],
    ["solana", "ethereum"],
    ["ethereum", "solana"],
  ]) {
    assert.equal(resolveSolanaCrossSwapRouteState(from, to, laneOnly), "OPEN", `${from} -> ${to}`);
    assert.equal(
      resolveSolanaCrossSwapRouteState(from, to, { ...laneOnly, RYNTRA_SOLANA_CROSS_SWAP_ROBINHOOD_STATE: "PAUSED" }),
      "OPEN",
      `${from} -> ${to} must not be gated by another network's switch`,
    );
  }
});
