import assert from "node:assert/strict";
import test from "node:test";

import { SOLANA_CCTP_MAINNET_REGISTRY } from "../solana/cctp-registry.ts";
import {
  BASE_USDC_CONTRACT,
  CROSS_SWAP_TUPLES,
  ETHEREUM_USDC_CONTRACT,
  MAYAN_CROSS_SWAP_TUPLES,
  RELAY_CROSS_SWAP_TUPLES,
  ROBINHOOD_USDG_CONTRACT,
  SOLANA_USDC_MINT,
  SWAP_CATALOG,
  catalogAssets,
  formatRawAmount,
  parseHumanAmount,
  resolveSwapAsset,
} from "./catalog.ts";

test("the catalog's USDC addresses are the CCTP registry's, never a second copy that drifted", () => {
  const chains = SOLANA_CCTP_MAINNET_REGISTRY.chains;
  assert.equal(SOLANA_USDC_MINT, chains.solana.asset.address);
  assert.equal(BASE_USDC_CONTRACT, chains.base.asset.address);
  assert.equal(ETHEREUM_USDC_CONTRACT, chains.ethereum.asset.address);
  /*
   * USDC is a six-decimal token on every network here except **BNB Chain**,
   * where it has eighteen. That is not a typo to be normalised away: it is what
   * Relay's own `erc20Currencies` states for chain 56, read live on 2026-09-10,
   * and carrying the six-decimal assumption one network further would have made
   * every BNB amount wrong by a factor of 10^12 — a mistake that reads as a
   * working swap right up until somebody sends money.
   *
   * The exception is pinned by name so it cannot spread quietly: any *other*
   * network growing an eighteen-decimal USDC fails this test.
   */
  for (const usdc of SWAP_CATALOG.filter((asset) => asset.code === "USDC")) {
    assert.equal(usdc.economicAsset, "USDC", usdc.network);
    assert.equal(usdc.decimals, usdc.network === "bnb" ? 18 : 6, usdc.network);
  }
  assert.equal(SWAP_CATALOG.filter((asset) => asset.code === "USDC" && asset.decimals !== 6).length, 1, "exactly one network departs from six");
});

test("every network names exactly one native coin and one dollar", () => {
  for (const network of ["solana", "base", "ethereum"]) {
    const assets = catalogAssets(network);
    assert.equal(assets.length, 2, network);
    assert.equal(assets.filter((asset) => asset.kind === "NATIVE").length, 1, network);
    assert.equal(assets.filter((asset) => asset.code === "USDC").length, 1, network);
  }
  /* Robinhood Chain is the same shape with a different dollar. There is no
     USDC on chain 4663 at all — that absence is the reason it is a swap
     destination and never a bridge one — and its money is Paxos USDG at six
     decimals, the quote asset of Arcus spot. */
  const robinhood = catalogAssets("robinhood");
  assert.equal(robinhood.length, 2);
  assert.equal(robinhood.filter((asset) => asset.kind === "NATIVE").length, 1);
  assert.equal(robinhood.filter((asset) => asset.code === "USDC").length, 0, "there is no USDC on Robinhood Chain");
  const usdg = robinhood.find((asset) => asset.code === "USDG");
  assert.equal(usdg.decimals, 6);
  assert.equal(usdg.address, ROBINHOOD_USDG_CONTRACT);
  assert.equal(usdg.economicAsset, "USDG");
});

test("every approved tuple names its own provider, and no pair is claimed by two", () => {
  const byProvider = (provider) => CROSS_SWAP_TUPLES.filter((tuple) => tuple.provider === provider).map((tuple) => tuple.id);
  assert.deepEqual(byProvider("MAYAN"), MAYAN_CROSS_SWAP_TUPLES.map((tuple) => tuple.id));
  assert.deepEqual(byProvider("RELAY"), RELAY_CROSS_SWAP_TUPLES.map((tuple) => tuple.id));
  assert.equal(new Set(CROSS_SWAP_TUPLES.map((tuple) => tuple.id)).size, CROSS_SWAP_TUPLES.length, "no id appears twice");
  /* Every Relay tuple touches chain 4663 and nothing else does: Mayan cannot
     reach it, and a Mayan tuple that did would be a pair handed to a
     provider that answers HTTP 500 for the chain. */
  for (const tuple of RELAY_CROSS_SWAP_TUPLES) {
    assert.equal(tuple.from.network === "robinhood" || tuple.to.network === "robinhood", true, tuple.id);
  }
  for (const tuple of MAYAN_CROSS_SWAP_TUPLES) {
    assert.equal(tuple.from.network === "robinhood" || tuple.to.network === "robinhood", false, tuple.id);
  }
});

test("the four Owner-approved Mayan tuples are present, directional and resolvable", () => {
  assert.deepEqual(
    MAYAN_CROSS_SWAP_TUPLES.map((tuple) => tuple.id),
    ["ETHEREUM_ETH_TO_SOLANA_SOL", "SOLANA_SOL_TO_ETHEREUM_ETH", "BASE_USDC_TO_SOLANA_SOL", "SOLANA_SOL_TO_BASE_USDC"],
  );
  for (const tuple of CROSS_SWAP_TUPLES) {
    assert.ok(resolveSwapAsset(tuple.from), `${tuple.id} from`);
    assert.ok(resolveSwapAsset(tuple.to), `${tuple.id} to`);
    assert.notEqual(tuple.from.network, tuple.to.network);
    assert.ok(tuple.from.network === "solana" || tuple.to.network === "solana", "every tuple has a Solana side");
  }
});

test("any side may be a catalog code, a mint or a contract; anything else is not an asset", () => {
  assert.equal(resolveSwapAsset({ network: "solana", asset: "SOL" })?.solanaMint, "So11111111111111111111111111111111111111112");
  assert.equal(resolveSwapAsset({ network: "solana", asset: "So11111111111111111111111111111111111111112" })?.asset, "SOL");
  assert.equal(resolveSwapAsset({ network: "solana", asset: SOLANA_USDC_MINT })?.economicAsset, "USDC");

  const arbitraryMint = resolveSwapAsset({ network: "solana", asset: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN" });
  assert.equal(arbitraryMint?.economicAsset, "SPL:JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN");
  assert.equal(arbitraryMint?.decimals, null, "decimals of an arbitrary mint are read live, never guessed");

  /* An EVM contract by address used to resolve to nothing, which is what made
     the lane a fixed list. Since `RYN-SOL-MONEY-FLOWS-001I` it resolves — to
     the catalog entry when there is one, so a pasted USDC address and the code
     `USDC` are the same asset and not two. */
  const pasted = resolveSwapAsset({ network: "base", asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" });
  assert.equal(pasted?.asset, "USDC");
  assert.equal(pasted?.economicAsset, "USDC");
  assert.equal(pasted?.decimals, 6);
  const mixedCase = resolveSwapAsset({ network: "base", asset: "0x833589FCD6EDB6E08F4C7C32D4F71B54BDA02913" });
  assert.equal(mixedCase?.asset, "USDC", "an address is an address whatever its casing");

  const arbitraryContract = resolveSwapAsset({ network: "base", asset: "0x4ed4e862860bed51a9570b96d89af5e1b0efefed" });
  assert.equal(arbitraryContract?.economicAsset, "ERC20:base:0x4ed4e862860bed51a9570b96d89af5e1b0efefed");
  assert.equal(arbitraryContract?.decimals, null, "decimals of an arbitrary contract are read live too");
  /* The same contract address on two chains is two assets, never one — that
     confusion is how a swap would be offered as a transfer. */
  const onEthereum = resolveSwapAsset({ network: "ethereum", asset: "0x4ed4e862860bed51a9570b96d89af5e1b0efefed" });
  assert.notEqual(onEthereum?.economicAsset, arbitraryContract?.economicAsset);

  assert.equal(resolveSwapAsset({ network: "base", asset: "SOL" }), null, "a code that chain does not have");
  assert.equal(resolveSwapAsset({ network: "solana", asset: "not-a-mint" }), null);
  assert.equal(resolveSwapAsset({ network: "base", asset: "0xnope" }), null, "a malformed contract is not an asset");
  assert.equal(resolveSwapAsset({ network: "base", asset: "So11111111111111111111111111111111111111112" }), null, "a mint is not a contract");
});

test("amount conversion is exact in both directions", () => {
  assert.equal(formatRawAmount("100000000", 9), "0.1");
  assert.equal(formatRawAmount("10388583", 6), "10.388583");
  assert.equal(formatRawAmount(0n, 18), "0");
  assert.equal(formatRawAmount("10000000000000000", 18), "0.01");
  assert.equal(parseHumanAmount("0.1", 9), "100000000");
  assert.equal(parseHumanAmount("10", 6), "10000000");
  assert.equal(parseHumanAmount("0.0000001", 6), null, "more digits than the asset has is refused, not rounded");
  assert.equal(parseHumanAmount("1e3", 6), null);
  assert.throws(() => formatRawAmount(-1n, 6), RangeError);
});

test("display amounts are exact up to eight decimals and truncated, never rounded up, beyond", async () => {
  const { displayRawAmount } = await import("./catalog.ts");
  assert.equal(displayRawAmount("41504837300179800", 18), "0.04150483");
  assert.equal(displayRawAmount("41194069830894700", 18), "0.04119406", "a minimum shown never exceeds the signed one");
  assert.equal(displayRawAmount("10388583", 6), "10.388583");
  assert.equal(displayRawAmount("100000000", 9), "0.1");
  assert.equal(displayRawAmount("1000000000000000000", 18), "1");
});

test("what a cross-chain swap may offer leaves the provider's own cost behind", async () => {
  const { crossSwapOfferableRaw, SOLANA_CROSS_SWAP_RENT_RESERVE_LAMPORTS, ETHEREUM_CROSS_SWAP_GAS_RESERVE_WEI } = await import("./catalog.ts");
  /* The bug this closes: MAX filled the whole spendable balance, the Swift order
     then needed its account rent out of the same lamports, and the order could
     not be built at all. The largest amount offered is the largest one signable. */
  assert.equal(crossSwapOfferableRaw("solana", "SOL", "32363700"), "29363700");
  /* A quote that states its own rent wins over the constant — and the reserve is
     the rent **plus the fee the transaction still has to pay**. Reserving rent
     alone was the defect: MAX came out short by exactly one signature fee, every
     time, so the button produced an amount that could not be signed. 5,000,000
     rent + 5,000 signature + 15,000 priority headroom = 5,020,000 withheld. */
  assert.equal(crossSwapOfferableRaw("solana", "SOL", "32363700", "5000000"), "27343700", "rent alone is not signable; the fee comes out of the same lamports");
  assert.equal(crossSwapOfferableRaw("solana", "SOL", "1000000"), "0", "a balance under the reserve offers nothing rather than a negative amount");
  assert.equal(SOLANA_CROSS_SWAP_RENT_RESERVE_LAMPORTS, 3000000n);

  /* USDC pays its gas in another asset, so its whole balance stays offerable. */
  assert.equal(crossSwapOfferableRaw("base", "USDC", "10000000"), "10000000");
  assert.equal(crossSwapOfferableRaw("solana", "USDC", "10000000"), "10000000");

  /* Native ETH pays gas out of itself. */
  assert.equal(crossSwapOfferableRaw("ethereum", "ETH", "1000000000000000000"), (1000000000000000000n - ETHEREUM_CROSS_SWAP_GAS_RESERVE_WEI).toString());

  /* So does ETH on Robinhood Chain — but it is an Arbitrum L2, where the
     dearest observed origin cost about 4.1e13 wei. Withholding Ethereum's
     figure there would keep fifty times the cost of the transaction back
     from anyone swapping their whole balance out. */
  const { ROBINHOOD_CROSS_SWAP_GAS_RESERVE_WEI } = await import("./catalog.ts");
  assert.equal(crossSwapOfferableRaw("robinhood", "ETH", "1000000000000000000"), (1000000000000000000n - ROBINHOOD_CROSS_SWAP_GAS_RESERVE_WEI).toString());
  assert.equal(ROBINHOOD_CROSS_SWAP_GAS_RESERVE_WEI < ETHEREUM_CROSS_SWAP_GAS_RESERVE_WEI, true);
  assert.equal(ROBINHOOD_CROSS_SWAP_GAS_RESERVE_WEI > 41_000_000_000_000n, true, "still above the dearest observed origin cost");

  /* USDG pays its gas in ETH, from a different balance. */
  assert.equal(crossSwapOfferableRaw("robinhood", "USDG", "10000000"), "10000000");
});

test("every network opens on an asset it actually has, and never on the other leg's", async () => {
  /* Found on production 2026-09-10. The card's own default was
     `network === "solana" ? SOL : "USDC"`, and Robinhood Chain is the one
     network in this catalogue with no USDC at all — it is why the chain is a
     swap destination rather than a bridge one. Pressing its tab therefore
     seeded an asset that does not exist there, `resolveSwapAsset` answered
     null, and the whole card went to `UNKNOWN_ASSET`: no balance, no
     25/50/75/MAX, no route. The tab was not broken; the default was. */
  const { defaultSwapAssetFor, SWAP_NETWORKS, resolveSwapAsset } = await import("./catalog.ts");

  for (const network of SWAP_NETWORKS) {
    const opening = defaultSwapAssetFor(network, null);
    assert.ok(resolveSwapAsset({ network, asset: opening }), `${network} opens on an asset it has`);
    /* And the fallback, for when the other leg already holds the opening one. */
    const clash = defaultSwapAssetFor(network, { network, asset: opening });
    assert.ok(resolveSwapAsset({ network, asset: clash }), `${network} falls back to an asset it has`);
    assert.notEqual(clash, opening, `${network} does not offer the same asset on both legs`);
  }

  /* The lane's own asset, by name: USDG is what Arcus spot is quoted in. */
  assert.equal(defaultSwapAssetFor("robinhood", null), "USDG");

  /* A clash is only a clash on the same network. USDC on Base against USDC on
     Solana is a transfer, and SOL against Base ETH is a swap; neither should
     be talked out of itself. */
  assert.equal(defaultSwapAssetFor("base", { network: "solana", asset: "USDC" }), "USDC");
  assert.equal(defaultSwapAssetFor("solana", { network: "robinhood", asset: "USDG" }), "So11111111111111111111111111111111111111112");
});

test("Base ETH keeps back its own gas, like every other native coin", async () => {
  /* Base reserved nothing until 2026-09-10, so MAX on a Base-ETH origin
     offered the entire balance and left no wei for the gas that balance has to
     pay. It was unreachable while `BASE_USDC_TO_SOLANA_SOL` was the only Base
     pair anyone used — USDC pays its gas from a different coin — and became
     reachable the day any token could be paired with any other. */
  const { crossSwapOfferableRaw, BASE_CROSS_SWAP_GAS_RESERVE_WEI } = await import("./catalog.ts");
  assert.ok(BASE_CROSS_SWAP_GAS_RESERVE_WEI > 0n, "Base withholds something");
  assert.equal(
    crossSwapOfferableRaw("base", "ETH", "1000000000000000000"),
    (1000000000000000000n - BASE_CROSS_SWAP_GAS_RESERVE_WEI).toString(),
  );
  /* A balance under the reserve offers nothing rather than going negative. */
  assert.equal(crossSwapOfferableRaw("base", "ETH", "1000"), "0");
});
