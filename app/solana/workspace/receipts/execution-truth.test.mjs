// Run from repo root: node --test app/solana/workspace/receipts/execution-truth.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { launchTradeFactsToEffects } from "../../../../lib/core/venues/meteora-dbc/trade-receipt.ts";
import { fetchJupiterBuild } from "../../../../lib/solana/jupiter-build.ts";
import { JUPITER_SWAP_V2_BASE_URL, normalizeJupiterOrder } from "../../../../lib/solana/quotes.ts";
import { receiptTruth } from "../../../../lib/solana/receipt-truth.ts";
import { buildSwapReceiptFacts, swapReceiptFactsToEffects } from "../../../../lib/solana/swap-receipt.ts";
import { buildSwapQuoteReview } from "../../../../lib/solana/swap-review.ts";
import { truthHero, truthLines } from "./truth-lines.ts";
import { usdMicrosText } from "./truth-format.ts";
import { TRUTH_WORDS } from "./truth-words.ts";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SIGNATURE = "4".repeat(88);
const LAUNCH = {
  schema: "ryntra.solana.launch-trade-receipt-facts",
  network: "mainnet",
  signature: SIGNATURE,
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
const read = receiptTruth({ outcome: { observedEffects: launchTradeFactsToEffects({ facts: LAUNCH, sourceRef: "launch:x", observedAt: LAUNCH.at }) } });
const byKey = (lines) => Object.fromEntries(lines.map((line) => [line.key, line.value]));
/* The figures carry no-break spaces before a code or a per cent; the expectations below are written with plain ones. */
const sp = (text) => text.replaceAll("\u00a0", " ");
const plain = (lines) => Object.fromEntries(lines.map((line) => [line.key, sp(line.value)]));

test("a launch trade's truth reads in both languages, every line from its facts", () => {
  assert.deepEqual(truthHero(read, "en"), { label: "Received", value: "4,990 WICK" });
  assert.deepEqual(truthHero(read, "uk"), { label: "Отримано", value: "4 990 WICK" });
  const en = byKey(truthLines(read, [{ signature: SIGNATURE, usdMicros: "120000", held: true }], "en"));
  assert.equal(en.direct, "the same — Ryntra adds nothing on top; its part is inside the pool fee", "a launch's pool fee carries Ryntra's part: never «took no fee»");
  assert.doesNotMatch(en.direct, /took no fee/);
  assert.match(en.quote, /5,000 WICK → 4,990 WICK · −0\.20 % · your minimum kept/);
  assert.equal(sp(en.ryntra), "0 on top · 0.48 USDC of the pool fee", "Ryntra's part named, never «None»");
  assert.equal(en.protocol, "Pool fee 1 USDC · Ryntra's part 0.48 USDC, inside it");
  assert.equal(en.network, TRUTH_WORDS.notInReceipt.en);
  assert.equal(en.tip, TRUTH_WORDS.tipZero.en);
  assert.equal(en.cashback, "+$0.12 · part after the wallet check");
  const uk = byKey(truthLines(read, null, "uk"));
  assert.equal(uk.direct, "так само — Ryntra нічого не додає зверху; її частка — всередині комісії пулу");
  assert.equal(sp(uk.ryntra), "0 зверху · 0,48 USDC з комісії пулу");
  assert.match(uk.quote, /−0,20 % · мінімум дотримано/);
  assert.equal(uk.cashback, TRUTH_WORDS.cashbackNotShown.uk, "an unproven wallet is told why, not shown a zero");
  assert.equal(byKey(truthLines(read, [], "en")).cashback, TRUTH_WORDS.cashbackNone.en);
  assert.equal(byKey(truthLines(read, "PENDING", "en")).cashback, TRUTH_WORDS.cashbackPending.en);
});

/* ---- a swap's receipt, built by the real receipt builder and read back the way the browser reads it */

const WSOL = "So11111111111111111111111111111111111111112";
const fixture = (name) => JSON.parse(readFileSync(new URL(`../../../../lib/solana/fixtures/${name}`, import.meta.url), "utf8"));
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
const ASSETS = { [WSOL]: { symbol: "SOL", decimals: 9 }, [USDC]: { symbol: "USDC", decimals: 6 } };
const asStored = (facts) => receiptTruth({ outcome: { observedEffects: swapReceiptFactsToEffects({ facts, sourceRef: "swap:ui", observedAt: "2026-10-05T12:00:20.000Z" }) } }, ASSETS);

/** A `/build` SOL → USDC swap with Ryntra's 10 bps taken from the SOL spent. */
async function buildSwap(observed = {}) {
  const result = await fetchJupiterBuild(
    { inputMint: WSOL, outputMint: USDC, amountRaw: "10000000", taker: "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9", fee: { bps: 10, side: "INPUT", mint: WSOL, owner: "5sWCoxARMPyGdqTu9ru6z69REZ1ZZLojcb1rfABDP2Ne", account: "4kbERimV3PwxwiL72n1NBRpX5HG2Mwja1QNhb4yEp578", decimals: 9, symbol: "SOL" } },
    ENDPOINT,
    { fetchImpl: async () => new Response(JSON.stringify(fixture("jupiter-build-sol-usdc.json")), { status: 200, headers: { "content-type": "application/json" } }), now: () => new Date("2026-10-05T12:00:00.000Z") },
  );
  assert.equal(result.ok, true);
  const quote = result.answer.quote;
  const review = buildSwapQuoteReview({ ...quote, priorityFeeLamports: "600" }, new Date("2026-10-05T12:00:01.000Z"));
  const observation = {
    signature: "5".repeat(88),
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
    ...observed,
  };
  return buildSwapReceiptFacts({ review, provider: null, observation, reconciliation: "MATCHED" });
}

/** An `/order` SOL → USDC swap with Ryntra's 50 bps referral; `feeMint` — where Jupiter takes it. */
function orderSwap({ feeMint = WSOL } = {}) {
  const ORDER = fixture("jupiter-order-v2-sol-usdc.json");
  const body = { ...ORDER, signatureFeeLamports: 5000, prioritizationFeeLamports: 1000, referralAccount: "18LeLp3B8yGctKtWKAXXqdB6Lf1GxmEa2fRL5xxa1ta", feeBps: 50, feeMint, platformFee: { ...ORDER.platformFee, feeBps: 50, feeMint } };
  const normalized = normalizeJupiterOrder(body, {
    access: "production",
    latencyMs: 118,
    observedAt: "2026-08-27T10:00:00.000Z",
    reviewWindowMs: 15_000,
    sourceHost: "api.jup.ag",
    routeAffectingOptions: ["referralFee=50", "referralAccount=set"],
    referral: { account: "18LeLp3B8yGctKtWKAXXqdB6Lf1GxmEa2fRL5xxa1ta", feeBps: 50 },
  });
  const review = buildSwapQuoteReview(normalized, new Date("2026-08-27T10:00:01.000Z"));
  const signature = "3".repeat(88);
  const collected = feeMint === WSOL ? "5000" : "522";
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
      serviceFeeCollectedRaw: collected,
      source: { ref: "solana:mainnet:transaction:independent", label: "Independent Solana RPC transaction read" },
    },
    reconciliation: "DEVIATION_RECORDED",
  });
}

test("a /build swap's receipt words: a fee from what was spent reads «at most», the fee charged, Jupiter 0, no tip", async () => {
  const read = asStored(await buildSwap());
  assert.ok(read, "the stored receipt reads back");
  const en = plain(truthLines(read, [], "en"));
  assert.match(en.direct, /^at most [0-9.,]+ USDC · up to 0\.10 % more$/, "scaled from the amount spent: an upper bound, said so");
  assert.equal(en.ryntra, "0.10 % · 0.00001 SOL");
  assert.equal(en.protocol, TRUTH_WORDS.jupiterNone.en);
  assert.equal(en.tip, TRUTH_WORDS.tipZero.en);
  assert.equal(en.cashback, TRUTH_WORDS.cashbackNone.en);
  const uk = plain(truthLines(read, null, "uk"));
  assert.match(uk.direct, /^не більше [0-9 ,]+ USDC · до 0,10 % більше$/);
});

test("a fee from what arrived reads exact on /build; the same on /order reads as an estimate, with why", async () => {
  /* /build with the fee on the output side: what arrived plus the fee, exactly. */
  const built = await buildSwap();
  const fee = built.fees.serviceFee;
  const onOutput = { ...built, fees: { ...built.fees, serviceFee: { ...fee, asset: USDC, decimals: 6, symbol: "USDC", amountRaw: "100", settlement: fee.settlement ? { ...fee.settlement, asset: USDC, userPaidRaw: "100", ryntraRaw: "100" } : null } } };
  const exact = plain(truthLines(asStored(onOutput), [], "en"));
  assert.match(exact.direct, /^[0-9.,]+ USDC · 0\.\d\d % more$/, "exact: no «at most»");
  assert.doesNotMatch(exact.direct, /at most|estimate/);
  /* /order with the fee in USDC, what arrived: without Ryntra Jupiter's own fee applies, so the figure is at most. */
  const order = asStored(orderSwap({ feeMint: USDC }));
  assert.equal(order.truth.lane, "ORDER");
  const en = plain(truthLines(order, [], "en"));
  assert.match(en.direct, /^at most [0-9.,]+ USDC · up to [0-9.,]+ % more · estimate — without Ryntra, Jupiter charges its own fee on this route$/);
  const uk = plain(truthLines(order, [], "uk"));
  assert.match(uk.direct, /оцінка — без Ryntra Jupiter бере на цьому маршруті власну комісію$/);
});

test("an /order swap's receipt: Jupiter's share is inside the fee, and the tip is «not recorded apart», never 0", () => {
  const en = plain(truthLines(asStored(orderSwap()), [], "en"));
  assert.match(en.ryntra, /^0\.50 % · 0\.000005 SOL · Jupiter keeps 20 % of it — inside the fee, not on top$/);
  assert.equal(en.tip, TRUTH_WORDS.tipUnknown.en);
  assert.notEqual(en.tip, TRUTH_WORDS.tipZero.en);
  assert.match(en.direct, /estimate — without Ryntra, Jupiter charges its own fee on this route$/);
});

test("a fee the chain shows not taken, and a fee not yet read: each said as it is, never a figure", async () => {
  const notCharged = plain(truthLines(asStored(await buildSwap({ serviceFeeCollectedRaw: "0" })), [], "en"));
  assert.equal(notCharged.ryntra, "0.10 % quoted — the chain shows none taken");
  assert.equal(notCharged.direct, TRUTH_WORDS.directSame.en);
  assert.equal(notCharged.cashback, TRUTH_WORDS.cashbackNoFee.en);
  const built = await buildSwap();
  const unread = { ...built, fees: { ...built.fees, serviceFee: { ...built.fees.serviceFee, state: "QUOTED", amountRaw: null, settlement: null } } };
  const words = plain(truthLines(asStored(unread), null, "en"));
  assert.equal(words.ryntra, "0.10 % — not yet read from the chain");
  assert.equal(words.direct, TRUTH_WORDS.directUnread.en);
  assert.equal(words.cashback, TRUTH_WORDS.cashbackNotShown.en, "an unproven wallet's cashback is not shown, never «none»");
});

test("a fee in a third token is «not sized» with that reason, carried from the model", async () => {
  const built = await buildSwap();
  const fee = built.fees.serviceFee;
  const third = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
  const elsewhere = { ...built, fees: { ...built.fees, serviceFee: { ...fee, asset: third, settlement: fee.settlement ? { ...fee.settlement, asset: third } : null } } };
  const read = asStored(elsewhere);
  assert.equal(read.truth.directNotSized, "FEE_IN_THIRD_TOKEN");
  assert.equal(plain(truthLines(read, [], "en")).direct, TRUTH_WORDS.directUnknown.en);
});

test("«Комісії» never shows a launch as costing nothing: the pool fee, the first minutes and the volatility fee are named, EN and UA", async () => {
  const { flowLines, launchNoteLine, sameTokenLine, venueLines, hundredNoteLine } = await import("../../../app/fees/fees-model.ts");
  const { launchPoolFee } = await import("../../../../lib/core/fee-comparison.ts");
  const fee = launchPoolFee();
  for (const lang of ["en", "uk"]) {
    const launch = flowLines(lang).find((line) => line.key === "LAUNCH_PAGE");
    for (const cell of [launch.rate, launch.buy, launch.round, launch.net]) assert.match(sp(cell), lang === "en" ? /on top/ : /зверху/, `${lang}: «on top», never a bare 0`);
    assert.match(sp(launch.rate), new RegExp(`${String(fee.sniperStartBps / 100)} %`), `${lang}: the first minutes' fee in the row itself`);
    assert.match(sp(launch.buy), lang === "en" ? /\$0\.25–\$2\.00 in the pool/ : /\$0,25–\$2,00 у пулі/);
    const note = sp(launchNoteLine(lang));
    assert.match(note, /50 %/, `${lang}: the sniper start`);
    assert.match(note, /1[.,]2 %/, `${lang}: the volatility fee at its most on the curve`);
    assert.match(note, /\$50[.,]00/, `${lang}: what $100 can cost in the first minutes`);
    const same = sp(sameTokenLine(lang));
    assert.match(same, lang === "en" ? /0 on top from its token page; the pool's own fee — 2 % falling to 0[.,]25–0[.,]5 %/ : /0 зверху зі сторінки токена; власна комісія пулу — 2 %/);
    assert.match(sp(hundredNoteLine(lang)), lang === "en" ? /«−\$1\.00»/ : /«−\$1,00»/, "the example is the MEME row's own figure");
  }
  /* One figure per trade: the comparison's «after» dollars for Ryntra's Spot are the $100 table's net. */
  const rows = flowLines("en");
  const spot = venueLines("en").find((venue) => venue.key === "ryntra-spot");
  const major = rows.find((row) => row.key === "MAJOR").net.replace("−", "");
  const meme = rows.find((row) => row.key === "MEME").net.replace("−", "");
  assert.ok(sp(spot.after).endsWith(`${major}–${meme}`), `${spot.after} against ${major}–${meme}`);
  const launchVenue = venueLines("en").find((venue) => venue.key === "ryntra-launch");
  for (const cell of [launchVenue.interfaceFee, launchVenue.buy, launchVenue.round]) assert.match(sp(cell), /after the first minutes \(up to 50 % in them\)$/);
  assert.doesNotMatch(sp(venueLines("en").find((venue) => venue.key === "pump-fun").buy), /first minutes/);
});

test("every word of the truth and of «Комісії» has both languages", async () => {
  const { FEES_WORDS } = await import("../../../app/fees/fees-words.ts");
  for (const [key, value] of Object.entries({ ...TRUTH_WORDS, ...FEES_WORDS })) {
    assert.ok(value.en.length > 0 && value.uk.length > 0, key);
  }
});

test("a cashback under a cent is shown to the hundredth of a cent, rounded down — never as nothing, never larger", () => {
  assert.equal(usdMicrosText("810", "en"), "$0.0008");
  assert.equal(usdMicrosText("129999", "en"), "$0.12");
  assert.equal(usdMicrosText("50", "uk"), "<$0,0001");
});

test("the receipts page, History and the swap card each draw the truth from the receipt itself", () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
  assert.match(read("./local-receipts.tsx"), /<ExecutionTruth receipt=\{receipt\}/);
  assert.match(read("../history/history-card.tsx"), /<ExecutionTruth receipt=\{receipt\.receipt\}/);
  assert.match(read("../trade/swap-card.tsx"), /<ExecutionTruth\s+receipt=\{settled\.receipt\}/);
});
