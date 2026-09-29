import assert from "node:assert/strict";
import test from "node:test";

import { normalizeMayanQuote } from "../mayan/price-api.ts";
import { mayanReferrerCollectable } from "../mayan/build.server.ts";
import { buildRelayQuoteBody, normalizeRelayQuote } from "../relay/quote-api.ts";
import { normalizeJupiterOrder } from "../solana/quotes.ts";
import { CROSS_SWAP_TUPLES, RELAY_CROSS_SWAP_TUPLES } from "./catalog.ts";
import { serviceFeeRateFor } from "./service-fee.ts";

const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const REFERRAL = "18LeLp3B8yGctKtWKAXXqdB6Lf1GxmEa2fRL5xxa1ta";
const CLAIM = "0x999999cf1046e68e36E1aA2E0E07105eDDD1f08E";

const meta = (referral) => ({
  access: "production",
  latencyMs: 12,
  observedAt: "2026-09-10T00:00:00.000Z",
  reviewWindowMs: 45_000,
  sourceHost: "api.jup.ag",
  routeAffectingOptions: [],
  referral,
});

/**
 * A recorded `/order` answer, trimmed to the fields this lane reads.
 *
 * The figures are from live keyless calls to `api.jup.ag` on 2026-09-10 — 1 SOL
 * into USDC, once with a referral account and once without. Two details in here
 * are the live truth rather than the documented one, and both matter: the
 * response carries **no `platformFee.amount` at all**, and with a referral active
 * `platformFee.feeBps` mirrors the top-level total rather than stating Jupiter's
 * own cut. Nothing here reaches the network.
 */
function jupiterOrder(over = {}) {
  return {
    swapMode: "ExactIn",
    inputMint: SOL,
    outputMint: USDC,
    inAmount: "1000000000",
    outAmount: "639502082",
    otherAmountThreshold: "636304571",
    slippageBps: 50,
    priceImpactPct: "0.0001",
    routePlan: [
      { bps: 10_000, swapInfo: { ammKey: "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1", label: "Raydium", inputMint: SOL, outputMint: USDC, inAmount: "1000000000", outAmount: "639502082" } },
    ],
    feeMint: SOL,
    feeBps: 50,
    platformFee: { feeBps: 50, feeMint: SOL },
    referralAccount: REFERRAL,
    signatureFeeLamports: 0,
    signatureFeePayer: null,
    prioritizationFeeLamports: 0,
    prioritizationFeePayer: null,
    rentFeeLamports: 0,
    rentFeePayer: null,
    swapType: "aggregator",
    router: "okx",
    guaranteedPrice: false,
    transaction: null,
    taker: null,
    gasless: false,
    jitOptimized: false,
    requestId: "req-1",
    inUsdValue: 642.4,
    outUsdValue: 639.5,
    swapUsdValue: 639.5,
    mode: "ultra",
    ...over,
  };
}

test("Jupiter: the fee exists exactly when Jupiter echoes the referral account", () => {
  const applied = normalizeJupiterOrder(jupiterOrder(), meta({ account: REFERRAL, feeBps: 50 }));
  assert.equal(applied.ryntraFee.mechanism, "JUPITER_REFERRAL");
  assert.equal(applied.ryntraFee.state, "QUOTED");
  assert.equal(applied.ryntraFee.basisPoints, 50);
  assert.equal(applied.ryntraFee.asset, SOL, "the fee mint is Jupiter's choice, not ours");
  assert.equal(applied.ryntraFee.providerRetainedPercent, 20, "Jupiter documents keeping a fifth");
  assert.equal(applied.providerReferralAccount, REFERRAL);
  /* Live truth: `/order` states no amount, with or without a taker. So the rate
     is all a Review can honestly show, and inventing one is the failure mode. */
  assert.equal(applied.ryntraFee.amountRaw, null);
});

test("Jupiter: an order that quietly dropped our referral is not earnings", () => {
  /* Jupiter's documented behaviour when the referral token account for the fee
     mint does not exist: the swap executes and the fee is not taken. It shows up
     as the account not being echoed and the total falling back to the platform
     fee — 2 bps on SOL→stable, read live the same day. */
  const dropped = normalizeJupiterOrder(
    jupiterOrder({ referralAccount: undefined, feeBps: 2, platformFee: { feeBps: 2, feeMint: SOL } }),
    meta({ account: REFERRAL, feeBps: 50 }),
  );
  assert.equal(dropped.ryntraFee.state, "NOT_APPLIED");
  assert.equal(dropped.ryntraFee.basisPoints, 0);
  assert.equal(dropped.ryntraFee.requestedBasisPoints, serviceFeeRateFor("JUPITER_REFERRAL"), "what was asked for stays on the record");
  assert.match(dropped.ryntraFee.note, /referral token account/i);
});

test("Jupiter: a different account than the one requested is somebody else's fee", () => {
  const other = normalizeJupiterOrder(
    jupiterOrder({ referralAccount: "1EVK1VSyJGm1SSkmn7B6tgdwwkMZRmZGgn1MUzCqBeZ" }),
    meta({ account: REFERRAL, feeBps: 50 }),
  );
  assert.equal(other.ryntraFee.state, "NOT_APPLIED");
  assert.equal(other.ryntraFee.basisPoints, 0);
});

test("Jupiter: a total below what was asked for is the platform-fee fallback", () => {
  const short = normalizeJupiterOrder(
    jupiterOrder({ feeBps: 10, platformFee: { feeBps: 10, feeMint: SOL } }),
    meta({ account: REFERRAL, feeBps: 50 }),
  );
  assert.equal(short.ryntraFee.state, "NOT_APPLIED");
  assert.match(short.ryntraFee.note, /10 bps against the 50 bps requested/);
});

test("Jupiter: with nothing configured the answer is unconfigured, not zero-by-accident", () => {
  const none = normalizeJupiterOrder(jupiterOrder({ referralAccount: undefined, feeBps: 2, platformFee: { feeBps: 2, feeMint: SOL } }), meta(null));
  assert.equal(none.ryntraFee.state, "UNCONFIGURED");
  assert.equal(none.ryntraFee.mechanism, "JUPITER_REFERRAL");
  assert.equal(none.ryntraFee.basisPoints, 0);
});

test("Relay: the app fee goes on the wire only with a real EVM claim address", () => {
  const request = {
    fromNetwork: "solana",
    fromToken: SOL,
    toNetwork: "robinhood",
    toToken: "0x0000000000000000000000000000000000000000",
    amountRaw: "50000000",
    user: "HZj6nyfWqFYZVjgQHXzsqkvPnUoY3gTs87QzptrJNVDa",
    recipient: CLAIM,
  };
  assert.equal("appFees" in buildRelayQuoteBody(request), false, "no configuration, no fee parameter");

  const withFee = buildRelayQuoteBody({ ...request, appFee: { recipient: CLAIM, bps: serviceFeeRateFor("RELAY_APP_FEE") } });
  assert.deepEqual(withFee.appFees, [{ recipient: CLAIM, fee: "25" }], "Bridge stays at 25 bps whatever Jupiter charges");

  /* Relay requires an EVM claim address even on a Solana route. A Solana address
     in that slot is dropped rather than sent, so a configuration mistake costs a
     fee and never a swap. */
  const wrongShape = buildRelayQuoteBody({ ...request, appFee: { recipient: "HZj6nyfWqFYZVjgQHXzsqkvPnUoY3gTs87QzptrJNVDa", bps: 50 } });
  assert.equal("appFees" in wrongShape, false);
});

/** A Relay answer trimmed to what this lane reads, with and without an app fee. */
function relayQuote(app) {
  return {
    requestId: "0x" + "ab".repeat(32),
    steps: [
      {
        id: "deposit",
        kind: "transaction",
        items: [{ status: "incomplete", data: { instructions: [{ programId: "99vQwtBwYtrqqD9YSXbdum3KBdxPAVxYTaQ3cfnJSrN2", keys: [], data: "" }] } }],
      },
    ],
    fees: {
      gas: { amountUsd: "0.0001" },
      relayer: { amountUsd: "0.24" },
      relayerGas: { amountUsd: "0.02" },
      relayerService: { amountUsd: "0.22" },
      ...(app ? { app } : {}),
    },
    details: {
      currencyIn: { currency: { chainId: 792703809, address: SOL, symbol: "SOL", decimals: 9 }, amount: "50000000", amountFormatted: "0.05" },
      currencyOut: { currency: { chainId: 4663, address: "0x0000000000000000000000000000000000000000", symbol: "USDG", decimals: 18 }, amount: "4981152000000000000", amountFormatted: "4.981152", minimumAmount: "4956246240000000000" },
      totalImpact: { percent: "-0.54" },
      slippageTolerance: { destination: { percent: "0.5" } },
      timeEstimate: 12,
    },
  };
}

const relayTuple = RELAY_CROSS_SWAP_TUPLES[0];
const relayContext = { fromDecimals: 9, toDecimals: 18, observedAt: "2026-09-10T00:00:00.000Z" };

test("Relay: a quoted app fee is read from the provider's own currency and amount", () => {
  const quote = normalizeRelayQuote(
    relayQuote({ currency: { chainId: 8453, address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", symbol: "USDC", decimals: 6 }, amount: "16000", amountFormatted: "0.016", amountUsd: "0.016" }),
    relayTuple,
    { ...relayContext, appFee: { recipient: CLAIM, bps: 50 } },
  );
  assert.equal(quote.serviceFee.mechanism, "RELAY_APP_FEE");
  assert.equal(quote.serviceFee.state, "QUOTED");
  assert.equal(quote.serviceFee.basisPoints, 50);
  assert.equal(quote.serviceFee.amountRaw, "16000");
  assert.equal(quote.serviceFee.symbol, "USDC");
  assert.equal(quote.serviceFee.usd, 0.016);
  assert.equal(quote.serviceFee.accrual, "RELAY_APP_BALANCE_USDC", "Relay pays into an off-chain balance, not per swap");
  /* Mayan's word for an integrator fee stays zero on a Relay quote; the two
     rails do not share a field. */
  assert.equal(quote.fees.referrerBps, 0);
});

test("Relay: silence is not a fee, because Relay's silence is documented", () => {
  const quote = normalizeRelayQuote(relayQuote(null), relayTuple, { ...relayContext, appFee: { recipient: CLAIM, bps: 50 } });
  assert.equal(quote.serviceFee.state, "NOT_APPLIED");
  assert.equal(quote.serviceFee.basisPoints, 0);

  const zero = normalizeRelayQuote(
    relayQuote({ currency: { chainId: 8453, address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", symbol: "USDC", decimals: 6 }, amount: "0" }),
    relayTuple,
    { ...relayContext, appFee: { recipient: CLAIM, bps: 50 } },
  );
  assert.equal(zero.serviceFee.state, "NOT_APPLIED", "a zero amount is Relay saying it took nothing");

  const unset = normalizeRelayQuote(relayQuote(null), relayTuple, relayContext);
  assert.equal(unset.serviceFee.state, "UNCONFIGURED");
});

/** A Mayan Swift quote from Solana, trimmed to what this lane reads. */
function mayanQuote(over = {}) {
  return {
    type: "SWIFT",
    swiftVersion: "V2",
    quoteId: "q-1",
    fromChain: "solana",
    toChain: "base",
    fromToken: { symbol: "SOL", contract: SOL, decimals: 9 },
    toToken: { symbol: "USDC", contract: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", decimals: 6 },
    effectiveAmountIn64: "1000000000",
    expectedAmountOut: 639.5,
    minAmountOut: 636.3,
    expectedAmountOutBaseUnits: "639500000",
    minAmountOutBaseUnits: "636300000",
    slippageBps: 50,
    etaSeconds: 12,
    deadline64: "1789000000",
    priceImpact: -0.54,
    protocolBps: 0,
    referrerBps: 50,
    referrerFeeUsd: 3.2,
    clientRelayerFeeSuccess: 0.2,
    rentCost: "3000000",
    ...over,
  };
}

const mayanTuple = CROSS_SWAP_TUPLES.find((tuple) => tuple.provider === "MAYAN");
const mayanContext = { fromDecimals: 9, toDecimals: 6, observedAt: "2026-09-10T00:00:00.000Z", approvals: 0 };

test("Mayan: the echoed rate is the fee, and its dollar figure is Mayan's own", () => {
  const quote = normalizeMayanQuote(mayanQuote(), mayanTuple, { ...mayanContext, referrerBps: 50 });
  assert.equal(quote.serviceFee.mechanism, "MAYAN_REFERRER");
  assert.equal(quote.serviceFee.state, "QUOTED");
  assert.equal(quote.serviceFee.basisPoints, 50);
  assert.equal(quote.serviceFee.usd, 3.2);
  assert.equal(quote.serviceFee.accrual, "MAYAN_ONCHAIN_REFERRER");
  /* No raw amount is stated by Mayan and none is invented from the rate. */
  assert.equal(quote.serviceFee.amountRaw, null);
});

test("Mayan: a zero rate is an answer, and two of its routes always give it", () => {
  /* A plain USDC-to-USDC MCTP transfer has no destination swap, so nothing is
     earned however the rate is set. Mayan says so by echoing zero. */
  const quote = normalizeMayanQuote(mayanQuote({ referrerBps: 0, referrerFeeUsd: 0 }), mayanTuple, { ...mayanContext, referrerBps: 50 });
  assert.equal(quote.serviceFee.state, "NOT_APPLIED");
  assert.equal(quote.serviceFee.basisPoints, 0);

  const unset = normalizeMayanQuote(mayanQuote(), mayanTuple, mayanContext);
  assert.equal(unset.serviceFee.state, "UNCONFIGURED");
});

test("Mayan: one Solana address is only collectable on the routes this lane uses", () => {
  /* Read from the SDK's own `getQuoteSuitableReferrerAddress`: the Solana key is
     picked for Swift V2 out of Solana and for Fast MCTP into Solana. Anything
     else resolves to the `evm` key and earns nothing — which is why the quote
     surface is told in advance rather than a receipt discovering it. */
  assert.equal(mayanReferrerCollectable({ type: "SWIFT", swiftVersion: "V2", fromChain: "solana", toChain: "base" }), true);
  assert.equal(mayanReferrerCollectable({ type: "FAST_MCTP", fromChain: "base", toChain: "solana" }), true);
  assert.equal(mayanReferrerCollectable({ type: "SWIFT", swiftVersion: "V2", fromChain: "base", toChain: "solana" }), false);
  assert.equal(mayanReferrerCollectable({ type: "SWIFT", swiftVersion: "V1", fromChain: "solana", toChain: "base" }), false);
  assert.equal(mayanReferrerCollectable({ type: "WH", fromChain: "solana", toChain: "base" }), false);
});

/* ── Mayan pays on a different chain per method ────────────────────────────
   Owner instruction, 2026-09-10: do not assume every method pays out on Solana.
   The address on the quote, the address at build and the actual recipient have
   to agree for the specific method. */

test("Mayan: each method states where it pays, and the two we use agree by different routes", async () => {
  const { mayanReferrerRoute, MAYAN_REFERRER_RULES } = await import("../mayan/referrer.ts");
  const configured = { solana: "HZj6nyfWqFYZVjgQHXzsqkvPnUoY3gTs87QzptrJNVDa" };

  /* Swift pays on the SOURCE chain. Ours is Solana, so it lands on Solana. */
  const swift = mayanReferrerRoute({ type: "SWIFT", swiftVersion: "V2", fromChain: "solana", toChain: "base" }, configured);
  assert.equal(swift.collectable, true);
  assert.equal(swift.chain, "solana");
  assert.match(swift.asset, /locked source asset/);

  /* Fast MCTP pays on the DESTINATION chain. Ours is Solana, so it also lands
     on Solana — for the opposite reason, which is why the reason is recorded. */
  const fast = mayanReferrerRoute({ type: "FAST_MCTP", fromChain: "base", toChain: "solana" }, configured);
  assert.equal(fast.collectable, true);
  assert.equal(fast.chain, "solana");
  assert.match(fast.asset, /stablecoin minted/);

  /* Swap the direction and the same method pays somewhere we hold nothing. */
  const swiftFromEvm = mayanReferrerRoute({ type: "SWIFT", swiftVersion: "V2", fromChain: "base", toChain: "solana" }, configured);
  assert.equal(swiftFromEvm.collectable, false);
  assert.match(swiftFromEvm.reason, /pays its referrer fee on base/);

  const fastToEvm = mayanReferrerRoute({ type: "FAST_MCTP", fromChain: "solana", toChain: "base" }, configured);
  assert.equal(fastToEvm.collectable, false);

  /* Wormhole Swap takes its rate from an on-chain setting, so a rate on the
     quote earns nothing however it is set. */
  assert.equal(MAYAN_REFERRER_RULES.WH.rateSetOnQuote, false);
  assert.equal(mayanReferrerRoute({ type: "WH", fromChain: "solana", toChain: "base" }, configured).collectable, false);

  /* And with no address configured, nothing is collectable anywhere. */
  assert.equal(mayanReferrerRoute({ type: "SWIFT", swiftVersion: "V2", fromChain: "solana", toChain: "base" }, { solana: null }).collectable, false);
});

test("Mayan: MCTP earns nothing on a transfer with no destination swap, and the rule says so", async () => {
  const { MAYAN_REFERRER_RULES } = await import("../mayan/referrer.ts");
  assert.match(MAYAN_REFERRER_RULES.MCTP.paidOnlyIf, /destination chain/);
  /* 100 bps from a Solana origin and 50 from anywhere else; the rule takes the
     lower, because a rate a method may refuse silently earns nothing. */
  assert.equal(MAYAN_REFERRER_RULES.MCTP.maximumBps, 50);
  assert.equal(MAYAN_REFERRER_RULES.SWIFT.maximumBps, 200);
  assert.equal(MAYAN_REFERRER_RULES.FAST_MCTP.maximumBps, 100);
});

/* ── The balance is gross, and the share is read rather than believed ──────
   Owner instruction, 2026-09-10: a referral token account holds the whole fee,
   so its balance must never be reported as Ryntra's. The split uses the
   project's own `default_share_bps` rather than a hard-coded 80%. */

test("a Jupiter balance splits into gross, provider share and what Ryntra can claim", async () => {
  const { fetchJupiterReferralBalance } = await import("./fee-balances.server.ts");
  /* Stands in for the chain: one account holding the 50,000 raw a real 0.01 SOL
     swap put there on 2026-09-10, and a project whose share reads 8000 bps. */
  const handle = {
    rpc: {
      getMultipleAccounts: () => ({ send: async () => ({ value: [{ data: { parsed: { info: { tokenAmount: { amount: "50000" } } } } }] }) }),
      getAccountInfo: () => ({ send: async () => ({ value: { data: [projectAccount(8000, "Jupiter Ultra"), "base64"] } }) }),
    },
    timeoutMs: 1000,
    endpoints: [{ host: "test" }],
    retries: 0,
  };
  const read = await fetchJupiterReferralBalance("F9pV233uBksW4U1BKiK7u9qShgXkwoR6F8MzU4FZYPUv", [{ mint: "So11111111111111111111111111111111111111112", symbol: "SOL", decimals: 9 }], { handle });
  assert.equal(read.ok, true);
  const [balance] = read.balances;
  assert.equal(balance.amountRaw, "50000", "the account holds the whole fee");
  assert.equal(balance.split.grossRaw, "50000");
  assert.equal(balance.split.providerRaw, "10000", "Jupiter's fifth, taken at claim");
  assert.equal(balance.split.ryntraClaimableRaw, "40000", "the only figure worth calling ours");
  assert.equal(balance.split.ryntraShareBps, 8000);
  assert.equal(balance.split.shareSource, "PROJECT_ACCOUNT", "read from the project, never hard-coded");
  assert.equal(BigInt(balance.split.providerRaw) + BigInt(balance.split.ryntraClaimableRaw), BigInt(balance.split.grossRaw));
});

test("a share the project does not yield makes no claim about the split", async () => {
  const { fetchJupiterReferralBalance } = await import("./fee-balances.server.ts");
  const handle = {
    rpc: {
      getMultipleAccounts: () => ({ send: async () => ({ value: [{ data: { parsed: { info: { tokenAmount: { amount: "50000" } } } } }] }) }),
      getAccountInfo: () => ({ send: async () => { throw new Error("rpc down"); } }),
    },
    timeoutMs: 1000,
    endpoints: [{ host: "test" }],
    retries: 0,
  };
  const read = await fetchJupiterReferralBalance("F9pV233uBksW4U1BKiK7u9qShgXkwoR6F8MzU4FZYPUv", [{ mint: "So11111111111111111111111111111111111111112", symbol: "SOL", decimals: 9 }], { handle });
  const [balance] = read.balances;
  /* A wrong share is worse than a missing one, so nothing is asserted about it. */
  assert.equal(balance.split.shareSource, "WHOLE_BALANCE");
  assert.equal(balance.split.grossRaw, "50000");
});

/** A Borsh `Project` account: 8 disc + base(32) + admin(32) + name + u16 share. */
function projectAccount(shareBps, name) {
  const nameBytes = Buffer.from(name, "utf8");
  const data = Buffer.alloc(76 + nameBytes.length + 2 + 8);
  data.writeUInt32LE(nameBytes.length, 72);
  nameBytes.copy(data, 76);
  data.writeUInt16LE(shareBps, 76 + nameBytes.length);
  return data.toString("base64");
}
