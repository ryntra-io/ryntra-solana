import assert from "node:assert/strict";
import test from "node:test";

import { classifySwapRoute } from "./classify.ts";

const side = (network, asset) => ({ network, asset });

test("two Solana assets are Swap's work, and this classifier says so instead of carrying them", () => {
  /* Owner decision 2026-09-10: Swap is Solana-only and Jupiter-only, Bridge is
     cross-chain and Relay-only, and neither reaches for the other. The refusal
     is a signpost rather than a wall — the surface turns this exact reason into
     a link to Swap — but it is a refusal, because Relay's own Solana route is
     Jupiter with 6 bps in front of it and carrying the pair here would charge
     somebody more for the same liquidity without telling them. */
  for (const [from, to] of [
    [side("solana", "SOL"), side("solana", "USDC")],
    [side("solana", "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN"), side("solana", "USDC")],
  ]) {
    const result = classifySwapRoute(from, to);
    assert.equal(result.ok, false, `${from.asset} -> ${to.asset}`);
    assert.equal(result.reason, "SAME_NETWORK_IS_SWAP");
  }
});

test("the same asset on the same network is refused, and so is any EVM same-network pair", () => {
  assert.deepEqual(
    (() => {
      const result = classifySwapRoute(side("solana", "USDC"), side("solana", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"));
      return [result.ok, result.reason];
    })(),
    [false, "SAME_ASSET_SAME_NETWORK"],
  );
  const baseSwap = classifySwapRoute(side("base", "USDC"), side("base", "ETH"));
  assert.equal(baseSwap.ok, false);
  assert.equal(baseSwap.reason, "EVM_SAME_NETWORK");
});

test("USDC across networks is a Relay bridge now — CCTP left default routing with its code kept", () => {
  /* The four lanes below were the ones Circle CCTP served, and preferring it was
     right while it was one rail among several: it moves native USDC without
     changing what it is. The Owner's split removes the second rail rather than
     the reasoning — one provider per page, one failure, one status model — and
     `cctpDirection` stays exported so restoring it is one edit rather than an
     excavation. */
  for (const [from, to] of [
    [side("solana", "USDC"), side("base", "USDC")],
    [side("base", "USDC"), side("solana", "USDC")],
    [side("solana", "USDC"), side("ethereum", "USDC")],
    [side("ethereum", "USDC"), side("solana", "USDC")],
  ]) {
    const result = classifySwapRoute(from, to);
    assert.equal(result.ok, true, `${from.network} → ${to.network}`);
    assert.equal(result.kind, "CROSS_SWAP");
    assert.equal(result.engine, "RELAY");
  }
});

test("the CCTP lane decider is still there to be restored, and still answers", async () => {
  const { cctpDirection } = await import("./classify.ts");
  const resolve = (network, asset) => ({ network, asset, economicAsset: asset });
  assert.equal(cctpDirection(resolve("solana", "USDC"), resolve("base", "USDC")), "SOLANA_TO_BASE");
  assert.equal(cctpDirection(resolve("ethereum", "USDC"), resolve("solana", "USDC")), "ETHEREUM_TO_SOLANA");
  assert.equal(cctpDirection(resolve("base", "USDC"), resolve("ethereum", "USDC")), null);
});

test("a same-asset move across networks is a swap, not a refusal", () => {
  /* These two used to be refused — `TRANSFER_WITHOUT_SOLANA` and
     `TRANSFER_ASSET_NOT_USDC` — because CCTP was the only rail asked about a
     matching pair of names. Both moves are real and both rails do them, so
     since `RYN-SOL-MONEY-FLOWS-001I` they are carried rather than declined.
     What must not change is that they are carried as *swaps*: a price, a
     slippage and a signed minimum, never presented as the same money arriving
     on another chain the way a CCTP transfer genuinely is. */
  const evmOnly = classifySwapRoute(side("base", "USDC"), side("ethereum", "USDC"));
  assert.equal(evmOnly.ok, true);
  assert.equal(evmOnly.kind, "CROSS_SWAP");
  assert.equal(evmOnly.engine, "RELAY");

  const eth = classifySwapRoute(side("base", "ETH"), side("ethereum", "ETH"));
  assert.equal(eth.ok, true);
  assert.equal(eth.kind, "CROSS_SWAP");

});

test("the shortlisted pairs keep their names, and everything else on those chains is ordinary now", () => {
  const approved = [
    [side("ethereum", "ETH"), side("solana", "SOL"), "ETHEREUM_ETH_TO_SOLANA_SOL"],
    [side("solana", "SOL"), side("ethereum", "ETH"), "SOLANA_SOL_TO_ETHEREUM_ETH"],
    [side("base", "USDC"), side("solana", "SOL"), "BASE_USDC_TO_SOLANA_SOL"],
    [side("solana", "SOL"), side("base", "USDC"), "SOLANA_SOL_TO_BASE_USDC"],
  ];
  for (const [from, to, id] of approved) {
    const result = classifySwapRoute(from, to);
    assert.equal(result.ok, true, id);
    assert.equal(result.kind, "CROSS_SWAP");
    /* The written name survives; the rail is whatever routing says today. */
    assert.equal(result.engine, "RELAY");
    assert.equal(result.tuple.id, id);
  }
  /* Pairs the Owner had not written down used to be refused here.
     `RYN-SOL-MONEY-FLOWS-001I` removed that list, so they are ordinary now. The
     shortlisted four keep their written ids above; everything else gets one
     derived from its own two sides. */
  const nowOrdinary = [
    [side("solana", "USDC"), side("base", "ETH")],
    [side("ethereum", "USDC"), side("solana", "SOL")],
    [side("base", "ETH"), side("solana", "SOL")],
    [side("solana", "SOL"), side("base", "ETH")],
    [side("solana", "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN"), side("base", "USDC")],
    [side("base", "0x4ed4e862860bed51a9570b96d89af5e1b0efefed"), side("solana", "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263")],
  ];
  for (const [from, to] of nowOrdinary) {
    const result = classifySwapRoute(from, to);
    assert.equal(result.ok, true, `${from.network}:${from.asset} → ${to.network}:${to.asset}`);
    assert.equal(result.kind, "CROSS_SWAP");
    assert.equal(result.engine, "RELAY", "one rail carries every cross-network pair");
    assert.match(result.tuple.id, /_TO_/);
  }
});

test("an unknown asset is named as such rather than guessed", () => {
  const result = classifySwapRoute(side("base", "USDT"), side("solana", "SOL"));
  assert.equal(result.ok, false);
  assert.equal(result.reason, "UNKNOWN_ASSET");
});

test("a Robinhood Chain pair is carried by Relay, and the engine comes from the tuple", () => {
  const cases = [
    [side("solana", "SOL"), side("robinhood", "USDG"), "SOLANA_SOL_TO_ROBINHOOD_USDG"],
    [side("robinhood", "USDG"), side("solana", "SOL"), "ROBINHOOD_USDG_TO_SOLANA_SOL"],
    [side("solana", "USDC"), side("robinhood", "USDG"), "SOLANA_USDC_TO_ROBINHOOD_USDG"],
    [side("robinhood", "USDG"), side("solana", "USDC"), "ROBINHOOD_USDG_TO_SOLANA_USDC"],
    [side("robinhood", "ETH"), side("solana", "SOL"), "ROBINHOOD_ETH_TO_SOLANA_SOL"],
    [side("solana", "SOL"), side("robinhood", "ETH"), "SOLANA_SOL_TO_ROBINHOOD_ETH"],
  ];
  for (const [from, to, id] of cases) {
    const result = classifySwapRoute(from, to);
    assert.equal(result.ok, true, id);
    assert.equal(result.kind, "CROSS_SWAP", id);
    assert.equal(result.engine, "RELAY", id);
    assert.equal(result.tuple.id, id);
  }
});

test("the pairs Mayan used to carry keep their written names and change their rail", () => {
  /* Both halves matter. The **id** survives because it is in stored order
     records and on issued receipts, and renaming it would rename history. The
     **provider** changes because routing is a current decision, not a property
     of a name — and every pair goes to the one rail Bridge has. */
  const cases = [
    [side("solana", "SOL"), side("base", "USDC"), "SOLANA_SOL_TO_BASE_USDC"],
    [side("base", "USDC"), side("solana", "SOL"), "BASE_USDC_TO_SOLANA_SOL"],
    [side("solana", "SOL"), side("ethereum", "ETH"), "SOLANA_SOL_TO_ETHEREUM_ETH"],
    [side("ethereum", "ETH"), side("solana", "SOL"), "ETHEREUM_ETH_TO_SOLANA_SOL"],
  ];
  for (const [from, to, id] of cases) {
    const result = classifySwapRoute(from, to);
    const where = `${from.network} ${from.asset} -> ${to.network} ${to.asset}`;
    assert.equal(result.ok && result.engine, "RELAY", where);
    assert.equal(result.tuple.id, id, where);
    assert.equal(result.tuple.provider, "RELAY", where);
  }
});

test("nothing reachable from the classifier routes to Mayan or CCTP any more", () => {
  /* The invariant of the split, asserted rather than trusted: whatever pair is
     put in, the engine that comes out is Relay. A future edit that restores a
     second rail has to change this test, which is the point of it. */
  const networks = ["solana", "base", "ethereum", "robinhood"];
  const assets = ["SOL", "ETH", "USDC", "USDG"];
  for (const fromNetwork of networks) {
    for (const toNetwork of networks) {
      for (const fromAsset of assets) {
        for (const toAsset of assets) {
          const result = classifySwapRoute(side(fromNetwork, fromAsset), side(toNetwork, toAsset));
          if (!result.ok) continue;
          assert.equal(result.kind, "CROSS_SWAP", `${fromNetwork} ${fromAsset} -> ${toNetwork} ${toAsset}`);
          assert.equal(result.engine, "RELAY", `${fromNetwork} ${fromAsset} -> ${toNetwork} ${toAsset}`);
        }
      }
    }
  }
});

test("Robinhood Chain is never a CCTP transfer, whatever the asset is called", () => {
  /* ETH exists on Robinhood Chain and on Ethereum and Base, so a naive reading
     makes those pairs look like the same money moving. Circle has no domain
     for chain 4663, so they are swaps — which they now are, rather than the
     refusal they used to be. The invariant this test exists for is unchanged
     and is the one asserted: nothing touching 4663 is ever `TRANSFER`/`CCTP`,
     because presenting a priced swap as a transfer would tell somebody their
     money arrives intact when it is being traded. */
  for (const [from, to] of [
    [side("ethereum", "ETH"), side("robinhood", "ETH")],
    [side("robinhood", "ETH"), side("base", "ETH")],
    [side("robinhood", "USDG"), side("base", "USDC")],
    [side("solana", "USDC"), side("robinhood", "USDG")],
  ]) {
    const result = classifySwapRoute(from, to);
    assert.equal(result.ok, true, `${from.network} -> ${to.network}`);
    assert.equal(result.kind, "CROSS_SWAP", `${from.network} -> ${to.network} must never be a transfer`);
    assert.notEqual(result.engine, "CCTP");
    assert.equal(result.engine, "RELAY", "and only Relay reaches chain 4663");
  }
});

test("the neighbours of the shortlist are ordinary pairs now, and still Relay's", () => {
  /* Every one of these was refused as "not one of the six" until
     `RYN-SOL-MONEY-FLOWS-001I`. None of them was ever impossible — the list
     was ours, not the rail's. */
  for (const [from, to] of [
    [side("base", "USDC"), side("robinhood", "USDG")],
    [side("robinhood", "USDG"), side("ethereum", "ETH")],
    [side("ethereum", "ETH"), side("robinhood", "USDG")],
    [side("robinhood", "ETH"), side("solana", "USDC")],
    [side("base", "0x4ed4e862860bed51a9570b96d89af5e1b0efefed"), side("robinhood", "USDG")],
  ]) {
    const result = classifySwapRoute(from, to);
    assert.equal(result.ok, true, `${from.network} ${from.asset} -> ${to.network} ${to.asset}`);
    assert.equal(result.engine, "RELAY");
  }
});

test("what is refused now is refused for a reason that is true by inspection", () => {
  /* Three, and only three. Each is a fact about the request rather than a
     policy about which pairs somebody wrote down, which is the whole change:
     a price nobody should accept is a price, and it is answered by the quote
     and the impact band, not by this function. */
  const sameThing = classifySwapRoute(side("robinhood", "USDG"), side("robinhood", "USDG"));
  assert.equal(sameThing.ok, false);
  assert.equal(sameThing.reason, "SAME_ASSET_SAME_NETWORK");

  const evmSameChain = classifySwapRoute(side("robinhood", "USDG"), side("robinhood", "ETH"));
  assert.equal(evmSameChain.ok, false);
  assert.equal(evmSameChain.reason, "EVM_SAME_NETWORK", "no same-chain engine off Solana");

  const notAnAsset = classifySwapRoute(side("base", "not-an-address"), side("solana", "SOL"));
  assert.equal(notAnAsset.ok, false);
  assert.equal(notAnAsset.reason, "UNKNOWN_ASSET");
});

test("Robinhood Stock Tokens are refused before any quote, in both directions", () => {
  /* The router answers `UNSUPPORTED_CURRENCY` to every one of these, both ways,
     probed 2026-09-09 — while the token index knows them all by name. Offering
     one would promise something no signature could ever produce, so the refusal
     happens here rather than at a quote nobody should have been able to ask
     for. Owner instruction of the same day: do not show them as available
     while execution refuses them. */
  for (const [name, address] of [
    ["TSLA", "0x322f0929c4625ed5bad873c95208d54e1c003b2d"],
    ["NVDA", "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec"],
    ["AAPL", "0xaf3d76f1834a1d425780943c99ea8a608f8a93f9"],
    ["SPY", "0x117cc2133c37b721f49de2a7a74833232b3b4c0c"],
    ["SGOV", "0x92fd66527192e3e61d4ddd13322aa222de86f9b5"],
  ]) {
    const inbound = classifySwapRoute(side("solana", "SOL"), side("robinhood", address));
    const outbound = classifySwapRoute(side("robinhood", address), side("solana", "SOL"));
    assert.equal(inbound.ok, false, `${name} inbound must not be offered`);
    assert.equal(inbound.reason, "ASSET_NOT_ROUTABLE_ON_NETWORK", name);
    assert.equal(outbound.ok, false, `${name} outbound must not be offered`);
    assert.equal(outbound.reason, "ASSET_NOT_ROUTABLE_ON_NETWORK", name);
  }

  /* What the router does take is untouched, so the restriction is a statement
     about those tokens and not about the chain. */
  const usdg = classifySwapRoute(side("solana", "SOL"), side("robinhood", "USDG"));
  assert.equal(usdg.ok, true);
  assert.equal(usdg.engine, "RELAY");
});

test("only Robinhood Chain is restricted; the other three take what their providers take", async () => {
  const { NETWORK_ROUTABLE_ASSETS, assetRoutableOnNetwork } = await import("./catalog.ts");
  assert.deepEqual(Object.keys(NETWORK_ROUTABLE_ASSETS), ["robinhood"]);
  for (const network of ["solana", "base", "ethereum"]) {
    assert.equal(assetRoutableOnNetwork(network, "0x4ed4e862860bed51a9570b96d89af5e1b0efefed"), true, network);
  }
});
