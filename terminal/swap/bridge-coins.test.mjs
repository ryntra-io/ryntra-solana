import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { DEPOSIT_NETWORKS } from "../../lib/relay/deposit-address.ts";
import { assetsOf } from "../../city/lib/money/assets.ts";
import { arrivalCode, bridgeRoute, quoteBridge, quoteFacts } from "../../city/lib/money/bridge.ts";
import { setMoneyEnv, useMoneyStore } from "../../city/lib/money/store.ts";
import { memoryStorage, ok, OWNER, scriptedFetch } from "../../city/lib/money/test-fixtures.mjs";

/* The bridge out of Solana carries SOL as well as USDC, and brings USDC or
   the other network's own coin — every pair one the engine already prices and builds on Relay. The engine's own answers
   of 17.11 are the fixtures (read only: no plan, no signature). The server's checks — recipient, currencies, amount,
   refunds — are the engine's and stand as they are. */

const recorded = JSON.parse(readFileSync(new URL("./fixtures/bridge-quotes-2026-11-17.json", import.meta.url), "utf8")).quotes;
const QUOTE = "/api/solana/cross-swap/quote";
const THERE = "0x000000000000000000000000000000000000dEaD";

test("every network carries USDC and SOL out, into USDC or its own coin; USDC to USDC stays the default", () => {
  for (const network of DEPOSIT_NETWORKS) {
    for (const coin of ["USDC", "SOL"]) {
      for (const arrive of ["USDC", "NATIVE"]) {
        const route = bridgeRoute(network, coin, arrive);
        assert.ok(route, `${coin} → ${network} ${arrive}`);
        assert.equal(route.tuple.id, `SOLANA_${coin}_TO_${network.toUpperCase()}_${arrivalCode(network, arrive)}`);
        assert.equal(route.from.network, "solana");
      }
    }
    assert.equal(bridgeRoute(network).tuple.id, `SOLANA_USDC_TO_${network.toUpperCase()}_USDC`, "the default is the bridge as it was");
  }
  assert.deepEqual(DEPOSIT_NETWORKS.map((network) => arrivalCode(network, "NATIVE")), ["ETH", "ETH", "ETH", "ETH", "POL", "BNB"]);
});

test("the engine's recorded prices read as the form says them: the coin, its decimals, the time", async () => {
  for (const [tuple, body] of Object.entries(recorded)) {
    assert.equal(body.buildable, true, tuple);
    const network = body.quote.to.network;
    const coin = body.quote.from.symbol;
    const arrive = body.quote.to.symbol === "USDC" ? "USDC" : "NATIVE";
    const route = bridgeRoute(network, coin, arrive);
    assert.equal(route.tuple.id, tuple);
    const engine = scriptedFetch({ [QUOTE]: [ok(body)] });
    const answer = await quoteBridge(engine.fetch, { route, amountRaw: body.quote.from.amountRaw, owner: OWNER, destination: THERE });
    assert.equal(answer.ok, true, tuple);
    const asked = engine.asked(QUOTE)[0].body;
    assert.deepEqual(asked.from, { network: "solana", asset: coin });
    assert.deepEqual(asked.to, { network, asset: arrivalCode(network, arrive) });
    const facts = quoteFacts(answer.body.quote);
    assert.equal(facts.symbol, body.quote.to.symbol);
    assert.equal(facts.decimals, body.quote.to.decimals);
    assert.ok(BigInt(facts.minimumRaw) <= BigInt(body.quote.to.expectedRaw));
  }
});

test("the form asks the price of the coin chosen: SOL out, ETH there — and holds the coin still once a transfer is built", async () => {
  const body = recorded.SOLANA_SOL_TO_BASE_ETH;
  const engine = scriptedFetch({ [QUOTE]: [ok(body)] });
  setMoneyEnv({ open: true, fetch: engine.fetch, storage: () => memoryStorage(), now: () => 0, refreshCity: () => {}, connection: () => ({ wallet: "Stub", address: OWNER }) });
  const wallet = {
    owner: OWNER,
    assets: assetsOf([{ kind: "NATIVE_SOL", mint: null, amountRaw: "2400000000", spendableRaw: "2390000000", decimals: 9, catalog: { usdPrice: "150" } }]),
    complete: true,
    at: 0,
  };
  useMoneyStore.setState({ owner: OWNER, wallet, walletRead: "ready" });
  const store = useMoneyStore.getState();
  store.setBridgeNetwork("base");
  store.setBridgeCoin("SOL");
  store.setBridgeArrive("NATIVE");
  store.setBridgeTo(THERE);
  store.setBridgeAmount("0.1");
  await useMoneyStore.getState().quoteBridge();
  const asked = engine.asked(QUOTE)[0].body;
  assert.deepEqual([asked.from.asset, asked.to.asset, asked.amountRaw, asked.destinationAddress], ["SOL", "ETH", "100000000", THERE]);
  assert.equal(useMoneyStore.getState().bridge.quote?.body.quote.to.symbol, "ETH");
  // More SOL than the wallet may spend is refused before any price.
  useMoneyStore.getState().setBridgeAmount("3");
  assert.equal(useMoneyStore.getState().bridge.quote, null);
  // Once a transfer is being built, the coins hold still.
  useMoneyStore.setState({ bridge: { ...useMoneyStore.getState().bridge, phase: "planning" } });
  useMoneyStore.getState().setBridgeCoin("USDC");
  useMoneyStore.getState().setBridgeArrive("USDC");
  assert.deepEqual([useMoneyStore.getState().bridge.coin, useMoneyStore.getState().bridge.arrive], ["SOL", "NATIVE"]);
  useMoneyStore.getState().follow(null);
});
