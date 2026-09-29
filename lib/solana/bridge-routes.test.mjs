import assert from "node:assert/strict";
import test from "node:test";

import { bridgeNetworkAvailable, resolveBridgeRouteMatrix } from "./bridge-routes.ts";

/**
 * The matrix is the one place the 2026-09-05 route research lives, and the
 * card draws whatever it says. So what it says has to be exactly this: Base
 * open when the lane is, Ethereum built and gated behind its own switch,
 * Robinhood Chain named as having no USDC route, and ETH/SOL named as swaps
 * rather than being listed as bridgeable tickers.
 */

test("with the bridge lane open, Base is available and Ethereum waits for its own switch", () => {
  const matrix = resolveBridgeRouteMatrix({ RYNTRA_SOLANA_BRIDGE_STATE: "OPEN" }, new Date("2026-09-05T12:00:00Z"));
  assert.equal(matrix.asset, "USDC");
  assert.deepEqual(matrix.networks.map((network) => network.id), ["base", "ethereum", "robinhood-chain"]);
  const [base, ethereum, robinhood] = matrix.networks;
  assert.equal(base.state, "AVAILABLE");
  assert.equal(base.reason, null);
  assert.equal(base.provider, "CIRCLE_CCTP_V2");
  assert.deepEqual([...base.directions], ["SOLANA_TO_BASE", "BASE_TO_SOLANA"]);
  assert.equal(ethereum.state, "NOT_OPEN");
  assert.equal(ethereum.reason, "AWAITING_FIRST_VERIFIED_TRANSFER");
  assert.equal(ethereum.provider, "CIRCLE_CCTP_V2");
  assert.deepEqual([...ethereum.directions], ["SOLANA_TO_ETHEREUM", "ETHEREUM_TO_SOLANA"]);
  assert.equal(robinhood.state, "UNAVAILABLE");
  assert.equal(robinhood.reason, "NO_NATIVE_USDC_ROUTE");
  assert.equal(robinhood.provider, null);
  assert.deepEqual([...robinhood.directions], []);
  assert.equal(bridgeNetworkAvailable(matrix, "base"), true);
  assert.equal(bridgeNetworkAvailable(matrix, "ethereum"), false);
  assert.equal(bridgeNetworkAvailable(matrix, "robinhood-chain"), false);
  assert.equal(matrix.observedAt, "2026-09-05T12:00:00.000Z");
});

test("Ethereum opens only when its own variable says so, and never opens a paused lane", () => {
  const open = resolveBridgeRouteMatrix({ RYNTRA_SOLANA_BRIDGE_STATE: "OPEN", RYNTRA_SOLANA_BRIDGE_ETHEREUM_STATE: "OPEN" });
  assert.equal(open.networks[1].state, "AVAILABLE");
  assert.equal(open.networks[1].reason, null);
  assert.equal(bridgeNetworkAvailable(open, "ethereum"), true);

  /* The lane's stop beats the network's switch: an Ethereum variable set to
     OPEN on a paused deployment opens nothing, and says why. */
  const paused = resolveBridgeRouteMatrix({ RYNTRA_SOLANA_BRIDGE_ETHEREUM_STATE: "OPEN" });
  assert.equal(paused.networks[0].state, "NOT_OPEN");
  assert.equal(paused.networks[0].reason, "LANE_PAUSED");
  assert.equal(paused.networks[1].state, "NOT_OPEN");
  assert.equal(paused.networks[1].reason, "LANE_PAUSED");
  /* Robinhood Chain is unavailable for a reason no switch changes. */
  assert.equal(paused.networks[2].state, "UNAVAILABLE");
  assert.equal(open.networks[2].state, "UNAVAILABLE");
});

test("ETH and SOL are named as swaps, not offered as bridgeable assets", () => {
  const matrix = resolveBridgeRouteMatrix({ RYNTRA_SOLANA_BRIDGE_STATE: "OPEN" });
  assert.deepEqual(
    matrix.otherAssets.map((entry) => [entry.symbol, entry.reason]),
    [
      ["ETH", "CROSS_CHAIN_SWAP_NOT_A_BRIDGE"],
      ["SOL", "CROSS_CHAIN_SWAP_NOT_A_BRIDGE"],
    ],
  );
  /* One asset on the bridge. A second one here would be a claim this row did
     not earn. */
  assert.equal(matrix.asset, "USDC");
});
