// Run from repo root: node --test lib/core/execution-truth.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { bpsOf, cashbackOf, directRouteOf, directRouteRead, launchExecutionTruth, swapExecutionTruth } from "./execution-truth.ts";
import { BUILD_PRIORITY_CEILING_LAMPORTS, VENUES, cashbackShareOfFee, launchPoolFee, onHundred, ryntraFlowRows } from "./fee-comparison.ts";
import { LAUNCH_PRESETS, PEOPLE_PRESET_IDS } from "./venues/meteora-dbc/presets.ts";
import { FEE_POLICY_V2 } from "./fee-policy.ts";
import { fetchJupiterBuild, PRIORITY_FEE_CEILING_LAMPORTS } from "../solana/jupiter-build.ts";
import { JUPITER_SWAP_V2_BASE_URL, normalizeJupiterOrder } from "../solana/quotes.ts";
import { buildSwapReceiptFacts, swapReceiptFactsToEffects, SWAP_RECEIPT_FACTS_SOURCE } from "../solana/swap-receipt.ts";
import { buildSwapQuoteReview } from "../solana/swap-review.ts";
import { receiptTruth, SWAP_FACTS_SOURCE } from "../solana/receipt-truth.ts";
import { cashbackByTrade } from "../solana/trade-cashback.ts";
import { launchTradeFactsToEffects } from "./venues/meteora-dbc/trade-receipt.ts";

const WSOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SIGNATURE = "5".repeat(88);

/* ---- a /build swap, the fee on the input side (SOL → USDC, 10 bps), built by the real receipt builder */

const BUILD_FIXTURE = JSON.parse(readFileSync(new URL("../solana/fixtures/jupiter-build-sol-usdc.json", import.meta.url), "utf8"));
const ENDPOINT = {
  ok: true,
  access: "production",
  tier: "pro",
  baseUrl: JUPITER_SWAP_V2_BASE_URL,
  orderUrl: `${JUPITER_SWAP_V2_BASE_URL}/order`,
  buildUrl: `${JUPITER_SWAP_V2_BASE_URL}/build`,
  executeUrl: `${JUPITER_SWAP_V2_BASE_URL}/execute`,
  label: "Jupiter Swap API V2, keyed production",
  authorizationHeaders: () => ({}),
};

async function buildFacts(patch = {}) {
  const result = await fetchJupiterBuild(
    { inputMint: WSOL, outputMint: USDC, amountRaw: "10000000", taker: "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9", fee: { bps: 10, side: "INPUT", mint: WSOL, owner: "5sWCoxARMPyGdqTu9ru6z69REZ1ZZLojcb1rfABDP2Ne", account: "4kbERimV3PwxwiL72n1NBRpX5HG2Mwja1QNhb4yEp578", decimals: 9, symbol: "SOL" } },
    ENDPOINT,
    { fetchImpl: async () => new Response(JSON.stringify(BUILD_FIXTURE), { status: 200, headers: { "content-type": "application/json" } }), now: () => new Date("2026-10-05T12:00:00.000Z") },
  );
  assert.equal(result.ok, true);
  const quote = result.answer.quote;
  const review = buildSwapQuoteReview({ ...quote, priorityFeeLamports: "600" }, new Date("2026-10-05T12:00:01.000Z"));
  const observation = {
    signature: SIGNATURE,
    slot: "453400000",
    finality: "confirmed",
    actualInputRaw: quote.inAmountRaw,
    actualOutputRaw: quote.outAmountRaw,
    baseFeeLamports: "5000",
    priorityFeeLamports: "600",
    programs: ["JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"],
    observedAt: "2026-10-05T12:00:20.000Z",
    serviceFeeCollectedRaw: "10000",
    source: { ref: "solana:mainnet:transaction:independent", label: "Independent Solana RPC transaction read" },
    ...(typeof patch === "function" ? patch(quote) : patch),
  };
  const deviates = observation.actualOutputRaw !== quote.outAmountRaw || observation.actualInputRaw !== quote.inAmountRaw;
  return { quote, facts: buildSwapReceiptFacts({ review, provider: null, observation, reconciliation: deviates ? "DEVIATION_RECORDED" : "MATCHED" }) };
}

test("a /build swap: what arrived, the same route without the fee (an estimate on the input side, rounded up), every fee", async () => {
  const { quote, facts } = await buildFacts();
  const truth = swapExecutionTruth(facts);
  assert.equal(truth.lane, "BUILD");
  assert.equal(truth.received.raw, quote.outAmountRaw);
  assert.equal(truth.quoteGapRaw, "0");
  assert.equal(truth.quoteGapBps, 0);
  assert.equal(truth.minimumMet, true);
  assert.deepEqual([truth.ryntra.state, truth.ryntra.bps, truth.ryntra.paidRaw, truth.ryntra.keptRaw, truth.ryntra.mint], ["CHARGED", 10, "10000", "10000", WSOL]);
  /* The fee left the 0.01 SOL spent: the route priced 0.00999 SOL. */
  const spent = BigInt(quote.inAmountRaw);
  const received = BigInt(quote.outAmountRaw);
  const expected = (received * spent + (spent - 10000n) - 1n) / (spent - 10000n);
  assert.equal(truth.direct.basis, "ESTIMATE");
  assert.equal(truth.direct.raw, expected.toString());
  assert.ok(BigInt(truth.direct.raw) * (spent - 10000n) >= received * spent, "never below the linear figure: the estimate does not flatter Ryntra");
  assert.equal(truth.direct.gapBps, 10, "10 bps of the fee is 10 bps of what arrives");
  assert.equal(truth.protocol.jupiterBps, 0, "Jupiter takes nothing on /build");
  assert.deepEqual(truth.network, { baseLamports: "5000", priorityLamports: "600", tipLamports: "0" });
});

test("a fee the chain shows was not taken: the person paid none of it, and the same route is what arrived", async () => {
  const { facts } = await buildFacts({ serviceFeeCollectedRaw: "0" });
  const truth = swapExecutionTruth(facts);
  assert.equal(truth.ryntra.state, "NOT_CHARGED");
  assert.equal(truth.direct.basis, "SAME");
  assert.equal(truth.direct.gapRaw, "0");
});

test("SOL spent beyond the quote (the rent of an account the swap opened) never shrinks the fee's gap: the estimate rests on the quote", async () => {
  const { quote, facts } = await buildFacts((built) => ({ actualInputRaw: (BigInt(built.inAmountRaw) + 2_039_280n).toString() }));
  const truth = swapExecutionTruth(facts);
  assert.equal(truth.direct.gapBps, 10, "the 10 bps fee reads 10 bps, rent or not");
  assert.equal(truth.direct.raw, swapExecutionTruth((await buildFacts()).facts).direct.raw);
  assert.notEqual(truth.spent.raw, quote.inAmountRaw, "what left the wallet is still what the chain shows");
});

test("a charged fee whose amount is not stated is not sized — never read as no fee", async () => {
  const { facts } = await buildFacts();
  const fee = facts.fees.serviceFee;
  const truth = swapExecutionTruth({ ...facts, fees: { ...facts.fees, serviceFee: { ...fee, amountRaw: null, settlement: null } } });
  assert.equal(truth.ryntra.state, "CHARGED");
  assert.equal(truth.direct, null);
  assert.equal(truth.directNotSized, "FEE_AMOUNT_UNREAD", "the reason is carried, not guessed by the words");
});

test("a fill below the quote is a signed gap in raw units and basis points", async () => {
  const { quote, facts } = await buildFacts((built) => ({ actualOutputRaw: (BigInt(built.outAmountRaw) - 100n).toString() }));
  const truth = swapExecutionTruth(facts);
  assert.equal(truth.quoteGapRaw, "-100");
  assert.equal(truth.quoteGapBps, bpsOf(-100n, BigInt(quote.outAmountRaw)));
});

/* ---- an /order swap with Ryntra's referral (50 bps, SOL), Jupiter's fifth inside it */

const ORDER = JSON.parse(readFileSync(new URL("../solana/fixtures/jupiter-order-v2-sol-usdc.json", import.meta.url), "utf8"));
function orderFacts({ referral = true, collected = "5000" } = {}) {
  const body = referral
    ? { ...ORDER, signatureFeeLamports: 5000, prioritizationFeeLamports: 1000, referralAccount: "18LeLp3B8yGctKtWKAXXqdB6Lf1GxmEa2fRL5xxa1ta", feeBps: 50, platformFee: { ...ORDER.platformFee, feeBps: 50 } }
    : { ...ORDER, signatureFeeLamports: 5000, prioritizationFeeLamports: 1000 };
  const normalized = normalizeJupiterOrder(body, {
    access: "production",
    latencyMs: 118,
    observedAt: "2026-08-27T10:00:00.000Z",
    reviewWindowMs: 15_000,
    sourceHost: "api.jup.ag",
    routeAffectingOptions: referral ? ["referralFee=50", "referralAccount=set"] : [],
    ...(referral ? { referral: { account: "18LeLp3B8yGctKtWKAXXqdB6Lf1GxmEa2fRL5xxa1ta", feeBps: 50 } } : {}),
  });
  const review = buildSwapQuoteReview(normalized, new Date("2026-08-27T10:00:01.000Z"));
  const signature = "3".repeat(88);
  return buildSwapReceiptFacts({
    review,
    provider: { requestId: normalized.requestId, signature, status: "Success", inputRaw: "1000000", outputRaw: "104497", source: { ref: "jupiter:mainnet:swap-v2:execute:x", label: "Jupiter Swap API V2 execute response", observedAt: "2026-08-27T10:00:55.000Z" } },
    observation: {
      signature,
      slot: "123456789",
      finality: "finalized",
      actualInputRaw: "1000000",
      actualOutputRaw: "104497",
      baseFeeLamports: "5000",
      priorityFeeLamports: "1000",
      programs: ["JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"],
      observedAt: "2026-08-27T10:01:00.000Z",
      ...(referral ? { serviceFeeCollectedRaw: collected } : {}),
      source: { ref: "solana:mainnet:transaction:independent", label: "Independent Solana RPC transaction read" },
    },
    reconciliation: "DEVIATION_RECORDED",
  });
}

test("an /order swap: the referral is what the person paid, Jupiter's fifth is inside it, not on top; no tip is claimed", () => {
  const truth = swapExecutionTruth(orderFacts());
  assert.equal(truth.lane, "ORDER");
  assert.deepEqual([truth.ryntra.state, truth.ryntra.bps, truth.ryntra.paidRaw, truth.ryntra.providerRaw, truth.ryntra.keptRaw, truth.ryntra.providerPercent], ["CHARGED", 50, "5000", "1000", "4000", 20]);
  assert.equal(truth.protocol.jupiterBps, 0, "with a referral Jupiter's total is Ryntra's rate");
  assert.equal(truth.network.tipLamports, null, "Jupiter built the transaction: a tip there is not on this receipt");
  assert.equal(truth.direct.basis, "ESTIMATE", "the referral left the SOL spent");
  assert.equal(truth.direct.orderDefaultFee, true, "without Ryntra's referral Jupiter's own default fee applies on /order");
});

test("an /order swap with no Ryntra fee: Jupiter's own fee is the protocol's part, and the same route is what arrived", () => {
  const truth = swapExecutionTruth(orderFacts({ referral: false }));
  assert.equal(truth.ryntra.state, "NONE");
  assert.equal(truth.direct.basis, "SAME");
  assert.equal(truth.protocol.jupiterBps, 2, "the fixture's own 2 bps, Jupiter's");
});

/* ---- the same route, by where the fee left */

test("directRouteOf: exact on the output side, rounded-up estimate on the input side, null for a third mint", () => {
  const spent = { raw: "1000", mint: "A" };
  const received = { raw: "990", mint: "B" };
  assert.deepEqual(directRouteOf({ spent, received, feeMint: "B", feeRaw: 10n }), { raw: "1000", basis: "EXACT", gapRaw: "10", gapBps: 100 });
  assert.deepEqual(directRouteOf({ spent, received, feeMint: "A", feeRaw: 10n }), { raw: "1000", basis: "ESTIMATE", gapRaw: "10", gapBps: 100 });
  assert.equal(directRouteOf({ spent, received: { raw: "991", mint: "B" }, feeMint: "A", feeRaw: 10n }).raw, "1002", "991 × 1000 / 990 = 1001.01 → 1002");
  assert.equal(directRouteOf({ spent, received, feeMint: "C", feeRaw: 10n }), null);
  assert.deepEqual(directRouteOf({ spent, received, feeMint: null, feeRaw: 0n }), { raw: "990", basis: "SAME", gapRaw: "0", gapBps: 0 });
  assert.equal(directRouteRead({ spent, received, feeMint: "C", feeRaw: 10n }).notSized, "FEE_IN_THIRD_TOKEN");
  assert.equal(directRouteRead({ spent, received, feeMint: null, feeRaw: 10n }).notSized, "FEE_MINT_UNSTATED");
  assert.equal(directRouteRead({ spent, received, feeMint: "A", feeRaw: 1000n }).notSized, "FEE_NOT_BELOW_SPENT");
  assert.equal(directRouteRead({ spent, received, feeMint: "B", feeRaw: 10n }).notSized, null);
});

/* ---- the receipt itself, the way the browser reads it */

test("receiptTruth reads a stored swap receipt's chunks without the server's builder, and names the source tag the builder writes", async () => {
  assert.equal(SWAP_FACTS_SOURCE, SWAP_RECEIPT_FACTS_SOURCE);
  const { facts } = await buildFacts();
  const effects = swapReceiptFactsToEffects({ facts, sourceRef: "swap:abc", observedAt: "2026-10-05T12:00:20.000Z" });
  const read = receiptTruth({ outcome: { observedEffects: effects } });
  assert.deepEqual(read.truth, swapExecutionTruth(facts));
  assert.deepEqual(read.assets[WSOL], { symbol: "SOL", decimals: 9 });
  assert.equal(receiptTruth({ outcome: { observedEffects: effects.slice(1) } }), null, "a missing chunk is no truth, never a partial one");
  assert.equal(receiptTruth({ outcome: { observedEffects: [] } }), null);
});

const LAUNCH = {
  schema: "ryntra.solana.launch-trade-receipt-facts",
  network: "mainnet",
  signature: "4".repeat(88),
  slot: 1,
  at: "2026-10-20T10:00:00.000Z",
  wallet: "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9",
  side: "buy",
  venue: "curve",
  token: { mint: "WickQaMint1111111111111111111111111111111", symbol: "WICK", decimals: 6 },
  pair: { mint: USDC, symbol: "USDC", decimals: 6, dollar: true },
  curve: "CurveQa1111111111111111111111111111111111",
  config: "CurveQa1111111111111111111111111111111111",
  pool: null,
  quote: { amountInRaw: "100000000", amountOutRaw: "5000000000", minimumOutRaw: "4900000000", slippageBps: 200, feeRaw: "1000000", ryntraRaw: "480000" },
  observed: { tokensRaw: "4990000000", pairRaw: "100000000", feeRaw: "1000000", ryntraRaw: "480000", priceAfter: 0.02 },
  minimumMet: true,
};

test("a launch trade from its token page: no Ryntra fee on top, the pool's fee with Ryntra's part inside it, the same route", () => {
  const truth = launchExecutionTruth(LAUNCH);
  assert.equal(truth.lane, "CURVE");
  assert.equal(truth.received.raw, "4990000000");
  assert.equal(truth.quoteGapRaw, "-10000000");
  assert.equal(truth.quoteGapBps, -20);
  assert.equal(truth.ryntra.state, "NONE");
  assert.equal(truth.direct.basis, "SAME");
  assert.deepEqual([truth.protocol.poolFeeRaw, truth.protocol.poolRyntraRaw, truth.protocol.poolMint], ["1000000", "480000", USDC]);
  const read = receiptTruth({ outcome: { observedEffects: launchTradeFactsToEffects({ facts: LAUNCH, sourceRef: "launch:x", observedAt: LAUNCH.at }) } });
  assert.equal(read.truth.kind, "launch");
  assert.deepEqual(read.assets[LAUNCH.token.mint], { symbol: "WICK", decimals: 6 });
  const sell = launchExecutionTruth({ ...LAUNCH, side: "sell", quote: { ...LAUNCH.quote, amountOutRaw: "99000000" } });
  assert.deepEqual([sell.spent.mint, sell.received.mint, sell.received.raw], [LAUNCH.token.mint, USDC, "100000000"]);
});

/* ---- the cashback, from the ledger's own rows */

const WALLET = "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9";
const entry = (patch) => ({
  type: "CASHBACK",
  recipient: WALLET,
  rateBps: 5000,
  shareRaw: "5000",
  usdMicros: "250000",
  valuation: null,
  source: { mechanism: "JUPITER_PLATFORM_FEE", operationRef: SIGNATURE, trader: WALLET, grossRaw: "10000", asset: WSOL, symbol: "SOL", decimals: 9, settledAt: "2026-10-21T10:00:00.000Z" },
  createdAt: "2026-10-21T10:00:01.000Z",
  claimId: null,
  signature: null,
  ...patch,
});

test("cashbackByTrade sums a trade's cashback rows, keeps an unvalued sum unvalued, marks a held rest, and lists no one else's", () => {
  const rows = cashbackByTrade(
    [
      entry({}),
      entry({ window: "FIRST_TEN_REST", usdMicros: "100000" }),
      entry({ source: { ...entry({}).source, operationRef: "6".repeat(88) }, usdMicros: null, createdAt: "2026-10-21T11:00:00.000Z" }),
      entry({ type: "REFERRAL_L1", source: { ...entry({}).source, operationRef: "7".repeat(88) } }),
      entry({ recipient: "9".repeat(44), source: { ...entry({}).source, operationRef: "8".repeat(88) } }),
    ],
    WALLET,
  );
  assert.deepEqual(rows, [
    { signature: "6".repeat(88), usdMicros: null, held: false },
    { signature: SIGNATURE, usdMicros: "350000", held: true },
  ]);
  assert.deepEqual(cashbackOf(SIGNATURE, rows), { state: "CREDITED", usdMicros: "350000", held: true });
  assert.deepEqual(cashbackOf("1".repeat(88), rows), { state: "NONE_ON_RECORD" });
  assert.deepEqual(cashbackOf(SIGNATURE, null), { state: "NOT_SHOWN" });
  const voided = cashbackByTrade([entry({}), entry({ window: "FIRST_TEN_REST", usdMicros: "100000" }), entry({ window: "FIRST_TEN_VOID", usdMicros: "-100000", source: null })], WALLET);
  assert.deepEqual(voided, [{ signature: SIGNATURE, usdMicros: "250000", held: false }], "a cancelled window's rest is not the wallet's");
  const passed = cashbackByTrade([entry({}), entry({ window: "FIRST_TEN_REST", usdMicros: "100000" }), entry({ window: "FIRST_TEN_PASSED", usdMicros: "0", source: null })], WALLET);
  assert.deepEqual(passed, [{ signature: SIGNATURE, usdMicros: "350000", held: false }], "once the check passed, nothing is held");
  const many = cashbackByTrade(Array.from({ length: 150 }, (_, i) => entry({ source: { ...entry({}).source, operationRef: `${"2".repeat(85)}${String(i).padStart(3, "0")}` }, createdAt: new Date(Date.UTC(2026, 9, 21, 0, i)).toISOString() })), WALLET);
  assert.equal(many.length, 150, "no trade is left out: a missing one would read «none on record»");
});

/* ---- $100, read from the policy */

test("$100 through Ryntra: the fee is the gap to the direct route, the round trip pays twice, the cashback is of what Ryntra received", () => {
  const meme = onHundred(FEE_POLICY_V2.MEME.bps);
  assert.deepEqual([meme.buy, meme.sell, Number(meme.round.toFixed(4))], [1, 1, 1.99]);
  assert.equal(cashbackShareOfFee("BUILD"), 0.5);
  assert.equal(cashbackShareOfFee("ORDER"), 0.4, "Jupiter keeps its fifth before Ryntra receives the fee");
  const rows = ryntraFlowRows();
  const memeRow = rows.find((row) => row.flow === "MEME");
  assert.deepEqual([memeRow.cashback.buy, memeRow.net.buy], [0.5, 0.5]);
  assert.deepEqual(rows.find((row) => row.flow === "STABLE").fee, { buy: 0, sell: 0, round: 0 });
  const ondo = rows.find((row) => row.flow === "ONDO");
  assert.equal(Number(ondo.cashback.buy.toFixed(4)), 0.2);
  assert.equal(rows.at(-1).flow, "LAUNCH_PAGE");
  /* A launch adds nothing on top, but its own pool fee is real and shown — never a bare $0 beside Pump.fun's pool fee. */
  const launch = rows.at(-1);
  assert.deepEqual(launch.fee, { buy: 0, sell: 0, round: 0 });
  assert.deepEqual(launch.pool.bps, launchPoolFee().range);
  assert.ok(launch.pool.low.buy > 0 && launch.pool.high.buy >= launch.pool.low.buy);
  assert.ok(rows.slice(0, -1).every((row) => row.pool === null), "a swap's pool fees are inside the route's price");
  assert.equal(BigInt(BUILD_PRIORITY_CEILING_LAMPORTS), PRIORITY_FEE_CEILING_LAMPORTS, "the page's ceiling is the builder's");
});

test("every other venue's figure has a source and the day it was read; only Ryntra's come from the code", () => {
  for (const venue of VENUES) {
    assert.ok(venue.sources.length > 0, venue.id);
    for (const source of venue.sources) {
      assert.match(source.readAt, /^\d{4}-\d{2}-\d{2}$/);
      if (venue.id.startsWith("ryntra")) assert.equal(source.kind, "CODE", venue.id);
      else {
        assert.notEqual(source.kind, "CODE", venue.id);
        assert.match(source.url, /^https:\/\//, venue.id);
      }
    }
  }
  assert.deepEqual(VENUES.find((venue) => venue.id === "ryntra-spot").interfaceBps, { low: FEE_POLICY_V2.MAJOR.bps, high: FEE_POLICY_V2.MEME.bps });
  for (const venue of VENUES) for (const source of venue.sources) assert.doesNotMatch(source.label, /\.(ts|md|mjs)\b|\blib\/|audit\//, `${venue.id}: no file path in a label a person reads`);
  const jupiter = VENUES.find((venue) => venue.id === "jupiter");
  assert.equal(jupiter.name, "Jupiter API (/order)");
  assert.deepEqual([jupiter.sources[0].url, jupiter.sources[0].kind], ["https://developers.jup.ag/docs/swap/order-and-execute#fees", "OFFICIAL"]);
});

test("a launch's pool fee is read from the presets a person may pick: the curve 1 % (+ up to a fifth), the DEX pool 2 % falling to its end", () => {
  const presets = PEOPLE_PRESET_IDS.map((id) => LAUNCH_PRESETS[id]);
  const fee = launchPoolFee();
  assert.deepEqual(fee.curve, { baseBps: 100, withDynamicBps: 120 }, "audit §4.1: 1 % + a volatility fee up to 0.2 %");
  assert.equal(fee.pool.startBps, Math.max(...presets.map((preset) => preset.graduatedPool.startFeeBps)));
  assert.equal(fee.pool.endLowBps, Math.min(...presets.map((preset) => preset.graduatedPool.endFeeBps)));
  assert.deepEqual([fee.pool.startBps, fee.pool.endHighBps], [200, 50], "Classic, Protected, Community: 2 % → 0.5 %");
  assert.equal(fee.pool.endLowBps, LAUNCH_PRESETS.micro.graduatedPool.endFeeBps, "Micro's pool ends lower, at 0.25 %");
  assert.deepEqual(fee.range, { low: fee.pool.endLowBps, high: fee.pool.startBps });
  assert.deepEqual(VENUES.find((venue) => venue.id === "ryntra-launch").poolBps, fee.range, "the comparison shows the launch's pool fee as Pump.fun's is shown");
});

test("a launch's truth says Ryntra takes nothing on top of the pool — true while no config charges Ryntra's own pool fee", () => {
  const config = readFileSync(new URL("../launch/config.server.ts", import.meta.url), "utf8");
  const charged = [...config.matchAll(/poolFeeCharged:\s*(true|false)/g)].map((match) => match[1]);
  assert.ok(charged.length >= 2);
  assert.ok(charged.every((value) => value === "false"), "a network charges Ryntra's pool fee: launchExecutionTruth and «Комісії» must show it on top");
});
