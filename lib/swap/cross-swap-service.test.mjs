import assert from "node:assert/strict";
import test from "node:test";

import {
  approvalsFor,
  crossSwapImpactBand,
  mayanTokenFor,
  relayTokenFor,
  resolveCrossSwapRoute,
  CROSS_SWAP_IMPACT_NOTABLE_BPS,
  CROSS_SWAP_IMPACT_SEVERE_BPS,
} from "./cross-swap-service.ts";
import { resolveSwapAsset } from "./catalog.ts";

const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const DEGEN = "0x4ed4e862860bed51a9570b96d89af5e1b0efefed";
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";

/** A token index that answers from a table, so no test reaches the network. */
const index = {
  [`solana:${BONK}`]: { network: "solana", address: BONK, symbol: "BONK", name: "Bonk", decimals: 5, verified: true, native: false },
  [`base:${DEGEN}`]: { network: "base", address: DEGEN, symbol: "DEGEN", name: "Degen", decimals: 18, verified: true, native: false },
  [`solana:FAKEUSDCmintFAKEUSDCmintFAKEUSDCmintFAKE`]: {
    network: "solana",
    address: "FAKEUSDCmintFAKEUSDCmintFAKEUSDCmintFAKE",
    symbol: "USDC",
    name: "USD Coin",
    decimals: 9,
    verified: false,
    native: false,
  },
};
const resolveToken = async ({ network, address }) => index[`${network}:${address}`] ?? null;

test("decimals of an unlisted token come from the index, and the pair is only usable once they do", async () => {
  const ok = await resolveCrossSwapRoute({ network: "solana", asset: BONK }, { network: "robinhood", asset: USDG }, { resolveToken });
  assert.equal(ok.ok, true);
  /* BONK has five decimals. Read as eighteen — the commonest default — the
     amount a person typed would be off by thirteen orders of magnitude. */
  assert.equal(ok.route.fromDecimals, 5);
  assert.equal(ok.route.from.symbol, "BONK");
  assert.equal(ok.route.toDecimals, 6, "USDG from the catalog, six not eighteen");
});

test("a token the index cannot describe is refused, never defaulted", async () => {
  const missing = await resolveCrossSwapRoute(
    { network: "base", asset: "0x000000000000000000000000000000000000beef" },
    { network: "robinhood", asset: USDG },
    { resolveToken },
  );
  assert.equal(missing.ok, false);
  assert.equal(missing.code, "TOKEN_UNKNOWN");
  /* The reason names the consequence, not the mechanism: without decimals
     there is no amount, so there is nothing to show a person. */
  assert.match(missing.reason, /amount/i);
});

test("an unvouched token still resolves, and says it is unvouched", async () => {
  const spoofed = await resolveCrossSwapRoute(
    { network: "solana", asset: "FAKEUSDCmintFAKEUSDCmintFAKEUSDCmintFAKE" },
    { network: "robinhood", asset: USDG },
    { resolveToken },
  );
  /* Hiding it would be its own defect — somebody may genuinely hold it. What
     must never happen is that it passes as the token whose name it wears. */
  assert.equal(spoofed.ok, true);
  assert.equal(spoofed.route.from.symbol, "USDC");
  assert.equal(spoofed.route.fromVerified, false, "the surface has to be able to mark it");
  assert.equal(spoofed.route.toVerified, true);
});

test("the impact band is the control that replaced the fixed pair list", () => {
  assert.equal(crossSwapImpactBand(-50), "ORDINARY");
  assert.equal(crossSwapImpactBand(-(CROSS_SWAP_IMPACT_NOTABLE_BPS - 1)), "ORDINARY");
  assert.equal(crossSwapImpactBand(-CROSS_SWAP_IMPACT_NOTABLE_BPS), "NOTABLE");
  assert.equal(crossSwapImpactBand(-(CROSS_SWAP_IMPACT_SEVERE_BPS - 1)), "NOTABLE");
  assert.equal(crossSwapImpactBand(-CROSS_SWAP_IMPACT_SEVERE_BPS), "SEVERE");
  /* Real figures read from live quotes on 2026-09-09. */
  assert.equal(crossSwapImpactBand(-8479), "SEVERE", "Base DEGEN to Robinhood USDG");
  assert.equal(crossSwapImpactBand(-5939), "SEVERE", "Ethereum PEPE to Solana JUP");
  assert.equal(crossSwapImpactBand(-54), "ORDINARY", "10 SOL to USDG, a real-sized liquid trade");
  /* A better-than-quoted outcome is never a warning. */
  assert.equal(crossSwapImpactBand(0), "ORDINARY");
  assert.equal(crossSwapImpactBand(120), "ORDINARY");
});

test("a token outside the catalog is still named to the provider, and still counted for approvals", () => {
  /* Both of these read the catalog first and the address second. Ending at the
     catalog sent `undefined` to the provider and counted an ERC-20 as needing
     no approval — two bugs that only existed once any token could be named,
     and both of which reported a working pair as impossible. */
  const degen = resolveSwapAsset({ network: "base", asset: DEGEN });
  assert.equal(mayanTokenFor(degen), DEGEN);
  assert.equal(relayTokenFor(degen), DEGEN);

  const bonk = resolveSwapAsset({ network: "solana", asset: BONK });
  assert.equal(mayanTokenFor(bonk), BONK);

  const nativeOnBase = resolveSwapAsset({ network: "base", asset: "ETH" });
  assert.equal(mayanTokenFor(nativeOnBase), "0x0000000000000000000000000000000000000000");
  assert.equal(relayTokenFor(resolveSwapAsset({ network: "solana", asset: "SOL" })), "11111111111111111111111111111111");

  const route = (from) => ({ from, to: resolveSwapAsset({ network: "solana", asset: "SOL" }) });
  assert.equal(approvalsFor(route(degen)), 1, "an arbitrary ERC-20 needs an approval");
  assert.equal(approvalsFor(route(resolveSwapAsset({ network: "base", asset: "USDC" }))), 1, "so does a catalog ERC-20");
  assert.equal(approvalsFor(route(nativeOnBase)), 0, "the chain's own coin does not");
  assert.equal(approvalsFor(route(bonk)), 0, "and Solana never does");
});

test("a refusal for a missing address names the one that is missing", async () => {
  /* Found on production 2026-09-10: a Robinhood Chain source with a perfectly
     good Solana destination typed in, and the surface said *add the
     destination address* — the one field the person had already got right.
     Both addresses were named on every refusal, so the sentence could only
     ever be about one of them and was wrong half the time. Nothing here
     reaches the network: the refusal happens before the provider is asked. */
  const { quoteCrossSwap } = await import("./cross-swap-service.ts");
  const resolved = await resolveCrossSwapRoute({ network: "robinhood", asset: "USDG" }, { network: "solana", asset: "SOL" }, { resolveToken });
  assert.equal(resolved.ok, true);

  const neither = await quoteCrossSwap(resolved.route, "5000000", {});
  assert.equal(neither.ok, false);
  assert.equal(neither.code, "QUOTE_ADDRESSES_REQUIRED");
  assert.deepEqual(neither.detail.needs, ["sourceAddress", "destinationAddress"]);

  const noWallet = await quoteCrossSwap(resolved.route, "5000000", {
    destinationAddress: "BfM79fYoDrDa4FUJDARpypfagk828YbHqCnnSNLMPYjP",
  });
  assert.deepEqual(noWallet.detail.needs, ["sourceAddress"], "a connected destination is not the missing thing");

  const noDestination = await quoteCrossSwap(resolved.route, "5000000", {
    sourceAddress: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
  });
  assert.deepEqual(noDestination.detail.needs, ["destinationAddress"]);
});

test("an allowance that already stands is not a reason to refuse the swap", async () => {
  /*
   * The defect a real swap found, and the worst kind: the product broke itself.
   *
   * An ERC-20 origin needs one `approve`. The person grants it — the product
   * working exactly as designed — and from that moment Relay stops including the
   * approve step, because the allowance stands. The guard compared with `!==`,
   * so `expected 1, quoted 0` refused every later quote for that pair, forever.
   * It reached the surface as "The price could not be read right now", which is
   * neither true nor actionable, and the money was fine the whole time.
   *
   * The count is a property of the wallet, not of the route. Fewer prompts than
   * stated is strictly better and is accepted; more is still the surprise this
   * guard exists to catch.
   */
  const { approvalsFor } = await import("./cross-swap-service.ts");
  const erc20 = { from: { network: "base", catalog: { kind: "TOKEN" } } };
  const native = { from: { network: "base", catalog: { kind: "NATIVE" } } };
  const solana = { from: { network: "solana", catalog: null } };

  assert.equal(approvalsFor(erc20), 1, "an ERC-20 origin states one approval up front");
  assert.equal(approvalsFor(native), 0);
  assert.equal(approvalsFor(solana), 0);

  /* The predicate the guard now uses, asserted directly so the regression cannot
     come back through a refactor of the sentence around it. */
  const refuses = (quoted, expected) => quoted > expected;
  assert.equal(refuses(0, 1), false, "already approved: the swap must go ahead");
  assert.equal(refuses(1, 1), false, "not yet approved: one prompt, as stated");
  assert.equal(refuses(2, 1), true, "more prompts than stated is still refused");
  assert.equal(refuses(1, 0), true, "a native origin that suddenly wants an approval is refused");
});
