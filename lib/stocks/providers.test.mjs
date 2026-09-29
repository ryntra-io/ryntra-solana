import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";

import { computeTransferFee } from "../solana/preflight.ts";
import { evaluatePlanReview } from "../plans/review.ts";
import { planAssetOf } from "../plans/service.ts";
import { primeOnchainMint, resetOnchainMintCache, transferFeeFromMint } from "./asset.server.ts";
import { compareRepresentations } from "./compare.server.ts";
import { lifecycleOf, markPremiumPct, transferFeeOf } from "./instrument.ts";
import { CATALOGUE_GRACE_MS, companyFromPreStocksName, issuerUrl, normalizePreStocksAsset, readPreStocksCatalogue, readPreStocksCatalogueShared, resetPreStocksCache } from "./issuer-prestocks.server.ts";
import { parseLatestBody } from "./pyth.server.ts";
import { quoteStock, resetStockQuoteCache } from "./quote.server.ts";
import { buildRepresentation, companyKeyOf, ISSUER_INSTRUMENT, issuerFromTags, STOCK_ISSUER_IDS, STOCK_ISSUERS } from "./representations.ts";
import { REFERENCE_UNAVAILABLE, referenceStateOf, UNKNOWN_SESSION } from "./session.ts";
import { sameCompanyOtherIssuer, sameUnderlying } from "./underlying-group.ts";
import { buildStockRow, buildStockUniverse, preStocksMark } from "./universe.server.ts";

/**
 * The pre-IPO issuer and the units — `RYN-STOCKS-PROVIDERS-001`, the
 * thirteen tests the task card names (§11): an issuer is never inferred from
 * a category, a look-alike is refused, a catalogue's failure has a state, a
 * stale observation is stale however fresh the fetch, no share is invented
 * where none is stated, the issuer's mark satisfies no reference rule, the
 * transfer fee is the chain's and is charged nowhere twice, an expired token
 * is not offered, old plans keep their unit, and a provider that is down
 * leaves the rest of the market standing. Since canon v5.2 (В25–В26) private
 * companies come through PreStocks only: a token of the disconnected pre-IPO
 * issuer is no representation, whatever the venue tags it.
 */

const OPENAI = "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF";
const SPACEX = "PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh";
/** A token of the disconnected pre-IPO issuer (`retired.ts`). */
const T_OPENAI = "oPAiAikWTaFj9RYoRFD35ccfwhnMcB3ThgBZRHSkjTZ";
const SPCXX = "Xs3oZwbHvqis4NYcf4YKWmEia2eC84wSiVrcYcTqpH8";
const NFLXX = "XsEH7wWfJJu2ZT3UCFeVfALnVA6CP5ur7Ee11KmzVpL";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const T0 = Date.UTC(2026, 8, 16, 8, 0, 0);
const NOW = new Date(T0).toISOString();
const realFetch = globalThis.fetch;

/* The issuers' answers of 2026-09-16, as the audit recorded them. */
const PRESTOCKS_ROWS = [
  { name: "OpenAI PreStocks", symbol: "OPENAI", description: "OpenAI builds…\n\nOPENAI is a PreStocks issued token.", image: "https://www.prestocks.com/logos/openai.png", external_url: "https://www.prestocks.com/openai", contract_address: OPENAI, markPrice: 958.2635907902561, markValuation: 1187221795954, tokenPrice: 974.2846424247193, impliedValuation: 1207070762227, supply: 2826.561704509759 },
  { name: "SpaceX PreStocks", symbol: "SPACEX", description: "SpaceX…", image: "https://www.prestocks.com/logos/spacex.png", external_url: "https://www.prestocks.com/spacex", contract_address: SPACEX, markPrice: 143.84899092132233, markValuation: 1886020103191, tokenPrice: 114.24448708497641, impliedValuation: 1497872164003, supply: 43712.579246454996 },
];

const market = (overrides = {}) => ({
  mint: OPENAI,
  symbol: "OPENAI",
  name: "OpenAI PreStocks",
  decimals: 9,
  tokenProgram: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  tags: ["stocks", "rwa", "pre-ipo", "prestocks", "token-2022", "verified"],
  verified: true,
  category: "stock",
  issuer: { label: "PreStocks", tag: "prestocks" },
  price: 971.48,
  change24hPct: 1.2,
  volume24hUsd: 521730,
  liquidityUsd: 630835,
  updatedAt: NOW,
  icon: null,
  audit: { suspicious: false },
  ...overrides,
});

const catalogues = () => ({
  xstocks: new Map(),
  prestocks: new Map(PRESTOCKS_ROWS.map((row) => [row.contract_address, normalizePreStocksAsset(row)])),
});

/** A Token-2022 mint as the chain states it: the PreStocks configuration (fee 0 → 50 bps from epoch 1032, scaled ×1.4861347, pausable, permanent delegate). */
const onchain = (overrides = {}) => ({
  programKind: "TOKEN_2022",
  decimals: 9,
  supplyRaw: "1901955256485",
  mintAuthority: "WV9PJN7XTmTLVwbutCLFxp8TyePee6Xq5mRq6Fti5Wc",
  freezeAuthority: "WV9PJN7XTmTLVwbutCLFxp8TyePee6Xq5mRq6Fti5Wc",
  extensions: ["PermanentDelegate", "DefaultAccountState", "TransferFeeConfig", "TransferHook", "ScaledUiAmountConfig", "PausableConfig", "TokenMetadata"],
  scaledUi: { multiplier: 1, newMultiplier: 1.4861347, newMultiplierEffectiveAt: "2026-07-17T20:30:00.000Z", authority: "WV9PJN7XTmTLVwbutCLFxp8TyePee6Xq5mRq6Fti5Wc" },
  transferFeeConfig: { older: { epoch: "848", basisPoints: 0, maximumFeeRaw: "0" }, newer: { epoch: "1032", basisPoints: 50, maximumFeeRaw: "18446744073709551615" }, withheldRaw: "128423376" },
  pausable: { paused: false, authority: "WV9PJN7XTmTLVwbutCLFxp8TyePee6Xq5mRq6Fti5Wc" },
  permanentDelegate: "WV9PJN7XTmTLVwbutCLFxp8TyePee6Xq5mRq6Fti5Wc",
  defaultAccountFrozen: false,
  observedAt: NOW,
  slot: "447469592",
  ...overrides,
});

beforeEach(() => {
  resetOnchainMintCache();
  resetPreStocksCache();
  resetStockQuoteCache();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

/* 1 ─ an issuer is its own tag; `pre-ipo` is a category; private companies come through PreStocks only (canon v5.2 В25–В26). */
test("1 · the bare pre-ipo tag names no issuer, PreStocks is confirmed by its own catalogue, and a token of the disconnected pre-IPO issuer is no representation at all", () => {
  assert.equal(issuerFromTags(["stocks", "pre-ipo", "verified"]), null);
  assert.equal(issuerFromTags(["stocks", "pre-ipo", "prestocks"]), "prestocks");
  assert.equal(issuerFromTags(["stocks", "rwa", "tessera", "verified"]), null, "the disconnected issuer's tag names no issuer");
  assert.deepEqual([...STOCK_ISSUER_IDS], ["xstocks", "backpack", "ondo", "prestocks"]);
  assert.deepEqual(Object.keys(STOCK_ISSUERS), ["xstocks", "backpack", "ondo", "prestocks"]);
  assert.deepEqual(ISSUER_INSTRUMENT.prestocks, { class: "pre-ipo", unitBasis: "token", rights: "economic-exposure" });
  assert.equal(STOCK_ISSUERS.prestocks.catalogue, true);

  const openai = buildRepresentation(market(), catalogues());
  assert.ok(openai);
  assert.equal(openai.issuer.id, "prestocks");
  assert.equal(openai.issuerConfirmation, "issuer-catalogue");
  assert.equal(openai.instrument.class, "pre-ipo");
  assert.equal(openai.underlying.name, "OpenAI");
  assert.equal(openai.companyKey, "openai");
  assert.equal(openai.issuerUrl, "https://www.prestocks.com/openai");
  assert.deepEqual(openai.sources, ["jupiter-verified", "prestocks-public-api"]);

  /* A token of the disconnected issuer, verified by the venue and tagged a stock: no representation, so no row, no page, no plan. */
  assert.equal(buildRepresentation(market({ mint: T_OPENAI, symbol: "tOpenAI", name: "T-OpenAI", tags: ["stocks", "rwa", "tessera", "verified", "token-2022"], issuer: null }), catalogues()), null);
  /* The same mint tagged prestocks by the venue is on no PreStocks list: nothing, not PreStocks. */
  assert.equal(buildRepresentation(market({ mint: T_OPENAI, symbol: "tOpenAI", name: "T-OpenAI" }), catalogues()), null);
  /* A row that only says pre-ipo is not a stock representation at all. */
  assert.equal(buildRepresentation(market({ tags: ["stocks", "pre-ipo", "verified"], issuer: null }), catalogues()), null);
});

/* 2 ─ look-alikes and wrong mints. */
test("2 · a look-alike symbol on another mint is refused, and a pre-IPO issuer whose catalogue could not be read confirms nothing", () => {
  const books = catalogues();
  assert.equal(buildRepresentation(market({ mint: "So11111111111111111111111111111111111111112" }), books), null, "OPENAI on a mint the issuer does not list is nobody's");
  assert.equal(buildRepresentation(market(), { ...books, prestocks: null }), null, "no catalogue, no confirmation — the row is absent, never guessed");
  assert.equal(buildRepresentation(market(), { ...books, prestocks: new Map() }), null, "an empty catalogue lists nothing");
  /* Only https on the issuer's own domain survives as a link. */
  assert.equal(issuerUrl("http://www.prestocks.com/openai"), null);
  assert.equal(issuerUrl("https://evil.example/prestocks.com/openai"), null);
  assert.equal(issuerUrl("https://www.prestocks.com/openai"), "https://www.prestocks.com/openai");
  assert.equal(companyFromPreStocksName("Figure AI PreStocks"), "Figure AI");
  assert.equal(companyFromPreStocksName("Something else"), null);
  assert.equal(companyKeyOf("Figure AI"), "figureai");
});

/* 3 ─ malformed rows and failed reads have defined states. */
test("3 · a row without a mint is dropped, a row without figures keeps its identity with null marks, and 429 / 5xx / timeout / bad shape are named failures with a stale copy under grace", async () => {
  assert.equal(normalizePreStocksAsset({ ...PRESTOCKS_ROWS[0], contract_address: "not-a-mint" }), null);
  assert.equal(normalizePreStocksAsset({ ...PRESTOCKS_ROWS[0], contract_address: undefined }), null);
  const bare = normalizePreStocksAsset({ name: "Anduril PreStocks", symbol: "ANDURIL", contract_address: "PresTj4Yc2bAR197Er7wz4UUKSfqt6FryBEdAriBoQB" });
  assert.ok(bare);
  assert.deepEqual(bare.mark, { tokenPriceUsd: null, markPriceUsd: null, impliedValuationUsd: null, markValuationUsd: null, supply: null });
  assert.equal(normalizePreStocksAsset({ ...PRESTOCKS_ROWS[0], markPrice: -1 }).mark.markPriceUsd, null, "a negative mark is no mark");

  let answer = () => new Response(JSON.stringify(PRESTOCKS_ROWS), { status: 200, headers: { "content-type": "application/json" } });
  const fetchImpl = async () => answer();
  const first = await readPreStocksCatalogue({ fetchImpl, now: () => new Date(T0) });
  assert.equal(first.ok, true);
  assert.equal(first.assets.length, 2);
  assert.equal(first.stale, false);

  answer = () => new Response("slow down", { status: 429 });
  const throttled = await readPreStocksCatalogue({ fetchImpl, now: () => new Date(T0 + 11 * 60_000), sleep: async () => { throw new Error("a 429 is never retried"); } });
  assert.equal(throttled.ok, true, "inside the grace the last complete copy is served");
  assert.equal(throttled.stale, true);

  const beyond = await readPreStocksCatalogue({ fetchImpl, now: () => new Date(T0 + CATALOGUE_GRACE_MS + 60_000) });
  assert.equal(beyond.ok, false);
  assert.equal(beyond.code, "RATE_LIMITED");

  resetPreStocksCache();
  answer = () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  const shape = await readPreStocksCatalogue({ fetchImpl, now: () => new Date(T0) });
  assert.equal(shape.ok, false);
  assert.equal(shape.code, "SHAPE");
  resetPreStocksCache();
  let calls = 0;
  answer = () => { calls += 1; return new Response("down", { status: 503 }); };
  const down = await readPreStocksCatalogue({ fetchImpl, now: () => new Date(T0), sleep: async () => {} });
  assert.equal(down.ok, false);
  assert.equal(down.code, "HTTP");
  assert.equal(calls, 2, "an issuer-side failure is asked once more, once");
  resetPreStocksCache();
  calls = 0;
  answer = () => { calls += 1; return calls === 1 ? new Response("down", { status: 500 }) : new Response(JSON.stringify(PRESTOCKS_ROWS), { status: 200, headers: { "content-type": "application/json" } }); };
  const recovered = await readPreStocksCatalogue({ fetchImpl, now: () => new Date(T0), sleep: async () => {} });
  assert.equal(recovered.ok, true, "the second read answers for the first");
  assert.equal(recovered.assets.length, 2);
  resetPreStocksCache();
  const timeout = await readPreStocksCatalogue({ fetchImpl: async () => { throw new Error("The operation was aborted due to timeout"); }, now: () => new Date(T0), sleep: async () => {} });
  assert.equal(timeout.ok, false);
  assert.equal(timeout.code, "NETWORK");

  /* Outside Next the deployment's shared layer is absent, and the shared read is the direct read — the same copy, the same failure. */
  resetPreStocksCache();
  globalThis.fetch = async () => new Response(JSON.stringify(PRESTOCKS_ROWS), { status: 200, headers: { "content-type": "application/json" } });
  const shared = await readPreStocksCatalogueShared(T0);
  assert.equal(shared.ok, true);
  assert.equal(shared.assets.length, 2);
  resetPreStocksCache();
  globalThis.fetch = async () => new Response("down", { status: 503 });
  const sharedDown = await readPreStocksCatalogueShared(T0);
  assert.equal(sharedDown.ok, false);
  assert.equal(sharedDown.code, "HTTP");
});

/* 4 ─ freshness is the observation's. */
test("4 · a fresh fetch of an old publish time is stale, and a publish time in the future is not a price", () => {
  const reference = { perShare: 212, observedAt: new Date(T0 - 20 * 60_000).toISOString(), fetchedAt: NOW };
  assert.equal(referenceStateOf(reference, true, T0), "stale");
  assert.equal(referenceStateOf({ ...reference, observedAt: new Date(T0 - 30_000).toISOString() }, true, T0), "current");
  assert.equal(referenceStateOf({ ...reference, observedAt: null, fetchedAt: new Date(T0 - 30_000).toISOString() }, false, T0), "last-available", "without an observation time the fetch is judged, as before");
  const id = "b".repeat(64);
  const body = (publishTime) => ({ parsed: [{ id, price: { price: "21205000000", conf: "1000000", expo: -8, publish_time: publishTime } }] });
  assert.equal(parseLatestBody(body(Math.floor(T0 / 1000) - 5), NOW).get(id)?.price, 212.05);
  assert.equal(parseLatestBody(body(Math.floor(T0 / 1000) + 3600), NOW).has(id), false, "an hour in the future is refused");
});

/* 5 ─ the unit. */
test("5 · no share is invented: a pre-IPO row has no per-share figure and prices its token; a listed row's per-share figure is the venue's scaled-unit price, not that price divided by the multiplier again", async () => {
  primeOnchainMint(OPENAI, onchain());
  const rep = buildRepresentation(market(), catalogues());
  const row = await buildStockRow(market(), rep, null, T0, null, { epoch: 1035n, issuerMark: preStocksMark(catalogues().prestocks.get(OPENAI), NOW, false), listedByIssuer: true, catalogueFetchedAt: NOW });
  assert.equal(row.tokenPerShareUsd, null);
  assert.equal(row.multiplier.current, 1.4861347, "the chain's multiplier is still read — it is what the wallet applies");
  assert.equal(row.reference.state, "unavailable");
  assert.match(row.reference.note, /private company/);
  assert.equal(row.deviationPct, null);
  assert.equal(row.issuerMark.perUnit, 958.2635907902561);
  assert.equal(Math.round(row.markPremiumPct * 100) / 100, Math.round(markPremiumPct(971.48, 958.2635907902561) * 100) / 100);
  assert.equal(row.transferFee.basisPoints, 50);
  assert.equal(row.lifecycle.state, "active");

  /* NFLXx at ×10: the venue's $75.81 is the price of one share. */
  primeOnchainMint(NFLXX, onchain({ scaledUi: { multiplier: 1, newMultiplier: 10, newMultiplierEffectiveAt: "2026-06-01T00:00:00.000Z", authority: "x" }, transferFeeConfig: null, pausable: null, permanentDelegate: null }));
  const xrep = { mint: NFLXX, symbol: "NFLXx", name: "Netflix xStock", issuer: STOCK_ISSUERS.xstocks, issuerConfirmation: "issuer-catalogue", instrument: ISSUER_INSTRUMENT.xstocks, underlying: { symbol: "NFLX", isin: null, listingCountry: "US", name: "Netflix" }, companyKey: "netflix", exchange: null, tokenProgram: null, decimals: 8, tradingHalted: false, issuerUrl: null, issuerNote: null, sources: [] };
  const xrow = await buildStockRow(market({ mint: NFLXX, symbol: "NFLXx", name: "Netflix xStock", price: 75.81, tags: ["xstocks", "stocks", "verified"] }), xrep, null, T0, null, { epoch: 1035n });
  assert.equal(xrow.multiplier.current, 10);
  assert.equal(xrow.tokenPerShareUsd, 75.81, "one scaled unit is one share; the figure is not divided by ten");
  assert.equal(xrow.transferFee, null);
});

/* 6 ─ the issuer's mark is not a reference. */
test("6 · a plan that requires a fresh market reference stays blocked on a pre-IPO token: the issuer's mark satisfies nothing, and the Review speaks per token", async () => {
  primeOnchainMint(OPENAI, onchain());
  const rep = buildRepresentation(market(), catalogues());
  const row = await buildStockRow(market(), rep, null, T0, null, { epoch: 1035n, issuerMark: preStocksMark(catalogues().prestocks.get(OPENAI), NOW, false), listedByIssuer: true, catalogueFetchedAt: NOW });
  const asset = planAssetOf(row);
  assert.equal(asset.unitBasis, "token");
  const plan = {
    id: "plan_test",
    version: 1,
    status: "active",
    side: "BUY",
    asset,
    current: {
      version: 1,
      rules: {
        entry: { plannedEntryPerShare: 960, maxPricePerShare: 1000, validUntil: null },
        capital: { budgetUsd: 2000, reserveForCostsUsd: 20 },
        risk: { invalidationPerShare: 800, plannedRiskUsd: 300, costBufferBps: 50 },
        execution: { maxSlippageBps: 100, maxQuoteAgeSeconds: 120, maxReferenceDeviationPct: null, referenceRequired: true, minLiquidityUsd: null },
      },
      sizing: { units: 1.5, notionalUsd: 1440, limitedBy: "risk" },
    },
  };
  /* $1,000 buys 0.692 base tokens = 1.028 tokens as shown at ×1.4861347. */
  const order = { inputMint: USDC, outputMint: OPENAI, inAmountRaw: "1000000000", outAmountRaw: "692000000", slippageBps: 50, priceImpactPct: "0.02", totalFeeBasisPoints: 10, observedAt: NOW, reviewExpiresAt: new Date(T0 + 60_000).toISOString(), requestId: "req_1" };
  const review = evaluatePlanReview({ plan, requestedVersion: 1, order, row, usdcMint: USDC, nowMs: T0 });
  const check = (id) => review.checks.find((entry) => entry.id === id);
  assert.equal(check("reference").outcome, "unknown");
  assert.equal(check("reference").required, true);
  assert.equal(review.verdict, "blocked", "an unknown required reference blocks — the mark does not stand in");
  assert.equal(review.quote.unit, "token");
  assert.match(check("entryPrice").actual, /\/ token$/);
  assert.match(check("units").actual, /tokens as the wallet shows them · chain multiplier 1\.486135/);
  /* The per-token price is the USD over the scaled amount — the same computation a share plan makes. */
  assert.equal(review.quote.amount, "1.028405");
  assert.equal(Math.round(review.quote.perShareUsd * 100) / 100, Math.round((1000 / 1.028405) * 100) / 100);

  /* The same plan without the reference rule proceeds on the money checks alone. */
  const advisory = { ...plan, current: { ...plan.current, rules: { ...plan.current.rules, execution: { ...plan.current.rules.execution, referenceRequired: false } } } };
  const open = evaluatePlanReview({ plan: advisory, requestedVersion: 1, order, row, usdcMint: USDC, nowMs: T0 });
  assert.notEqual(open.verdict, "blocked");
  assert.equal(open.checks.find((entry) => entry.id === "reference").required, false);
});

/* 7 ─ a feed of another listing is never substituted: kept in pyth-reference.test.mjs; here the pre-IPO rule. */
test("7 · a pre-IPO row takes no market feed even when a feed answers under its symbol", async () => {
  primeOnchainMint(OPENAI, onchain());
  const rep = buildRepresentation(market(), catalogues());
  const feed = { ok: true, id: "c".repeat(64), price: 500, confidence: 0.1, publishTime: NOW, fetchedAt: NOW };
  const row = await buildStockRow(market(), rep, null, T0, { price: feed }, { epoch: 1035n });
  assert.equal(row.reference.state, "unavailable");
  assert.equal(row.reference.source.id, "none");
  assert.equal(row.deviationPct, null);
});

/* 8 ─ the transfer fee. */
test("8 · the transfer fee is the config in force for the epoch, agrees with the kernel's fee math, is stated on the quote and subtracted from nothing", async () => {
  const config = { older: { epoch: "848", basisPoints: 0, maximumFeeRaw: "0" }, newer: { epoch: "1032", basisPoints: 50, maximumFeeRaw: "18446744073709551615" } };
  const before = transferFeeOf(config, 1000n);
  assert.equal(before.basisPoints, 0);
  assert.equal(before.configUsed, "OLDER");
  assert.deepEqual(before.pending, { basisPoints: 50, maximumFeeRaw: "18446744073709551615", fromEpoch: "1032" });
  const at = transferFeeOf(config, 1032n);
  assert.equal(at.basisPoints, 50);
  assert.equal(at.configUsed, "NEWER");
  assert.equal(at.pending, null);
  const unknown = transferFeeOf(config, null);
  assert.equal(unknown.configUsed, "NEWER");
  assert.equal(unknown.epoch, null, "an unknown epoch is recorded, never hidden");
  assert.equal(transferFeeOf(null, 1035n), null);
  assert.equal(transferFeeFromMint({ error: "x" }, 1035n), null);

  /* Parity with the kernel: the same config, the same epochs, the same choice. */
  const extension = {
    __kind: "TransferFeeConfig",
    transferFeeConfigAuthority: { __option: "None" },
    withdrawWithheldAuthority: { __option: "None" },
    withheldAmount: 0n,
    olderTransferFee: { epoch: 848n, maximumFee: 0n, transferFeeBasisPoints: 0 },
    newerTransferFee: { epoch: 1032n, maximumFee: 18446744073709551615n, transferFeeBasisPoints: 50 },
  };
  for (const epoch of [1000n, 1031n, 1032n, 1035n, null]) {
    const kernel = computeTransferFee([extension], 10_000n, epoch);
    const ours = transferFeeOf(config, epoch);
    assert.equal(ours.basisPoints, kernel.basisPoints, `epoch ${epoch}`);
    assert.equal(ours.configUsed, kernel.configUsed, `epoch ${epoch}`);
  }
  /* The kernel's rounding: 50 bps of 1,000,000,000 raw is 5,000,000; a cap applies when the config caps. */
  assert.equal(computeTransferFee([extension], 1_000_000_000n, 1035n).feeRaw, "5000000");
  assert.equal(computeTransferFee([{ ...extension, newerTransferFee: { ...extension.newerTransferFee, maximumFee: 1000n } }], 1_000_000_000n, 1035n).feeRaw, "1000");

  /* On the quote: stated beside the venue's figures, which are the venue's alone. */
  primeOnchainMint(OPENAI, onchain());
  const rep = buildRepresentation(market(), catalogues());
  const row = await buildStockRow(market(), rep, null, T0, null, { epoch: 1035n, listedByIssuer: true, catalogueFetchedAt: NOW });
  const findRow = async () => ({ ok: true, row, universe: { rows: [row], marketsObservedAt: NOW, issuerCatalogue: { ok: true, reason: null }, fetchedAt: NOW } });
  const order = async () => ({ ok: true, order: { inAmountRaw: "100000000", outAmountRaw: "69200000", minReceivedRaw: "68800000", priceImpactPct: "0.02", totalFeeBasisPoints: 10, slippageBps: 50, router: "metis", observedAt: NOW, reviewExpiresAt: new Date(T0 + 60_000).toISOString() } });
  const quote = await quoteStock({ ticker: OPENAI, side: "BUY", usd: 100 }, { findRow, order, referral: async () => null, now: () => new Date(T0) });
  assert.equal(quote.ok, true);
  assert.equal(quote.quote.unitBasis, "token");
  assert.equal(quote.quote.transferFee.basisPoints, 50);
  assert.equal(quote.quote.usd, 100, "the USD leg is the venue's");
  assert.equal(quote.quote.tokenRaw, "69200000", "the token leg is the venue's — nothing subtracted here");
  assert.equal(quote.quote.tokenScaled, "0.102840");
  assert.equal(quote.quote.minReceivedScaled, "0.102246");
  assert.equal(quote.quote.feeBasisPoints, 10, "the venue's fee is the venue's; the transfer fee is not added to it");
  assert.equal(quote.quote.deviationPct, null);
});

/* 9 ─ the life of a token. */
test("9 · a paused, redeem-only or expired token is not offered for purchase — no quote, no plan; a conversion window is offered with its state; a sale of what is held is still quoted", async () => {
  assert.equal(lifecycleOf({ paused: true, event: null, listedByIssuer: true, catalogueFetchedAt: NOW, chainObservedAt: NOW }).tradable, false);
  assert.equal(lifecycleOf({ paused: true, event: null, listedByIssuer: true, catalogueFetchedAt: NOW, chainObservedAt: NOW }).state, "paused");
  const expired = lifecycleOf({ paused: false, event: { mint: OPENAI, state: "expired", url: "https://www.prestocks.com/openai", observedAt: NOW, recheckBy: "2026-12-16", deadline: null, note: "The conversion deadline passed." }, listedByIssuer: true, catalogueFetchedAt: NOW, chainObservedAt: NOW });
  assert.equal(expired.state, "expired");
  assert.equal(expired.tradable, false);
  assert.equal(expired.source, "event-registry");
  assert.equal(lifecycleOf({ paused: false, event: { mint: OPENAI, state: "redeem-only", url: "u", observedAt: NOW, recheckBy: "2026-12-16", deadline: null, note: "n" }, listedByIssuer: true, catalogueFetchedAt: NOW, chainObservedAt: NOW }).tradable, false);
  assert.equal(lifecycleOf({ paused: false, event: { mint: OPENAI, state: "conversion-open", url: "u", observedAt: NOW, recheckBy: "2026-12-16", deadline: null, note: "n" }, listedByIssuer: true, catalogueFetchedAt: NOW, chainObservedAt: NOW }).tradable, true);
  /* A conversion window is offered until the issuer's cut-off and read as expired the moment the clock passes it. */
  const window = { mint: SPACEX, state: "conversion-open", url: "https://www.prestocks.com/spacex", observedAt: NOW, recheckBy: "2026-12-01", deadline: "2027-03-12T23:59:00.000Z", note: "n" };
  assert.equal(lifecycleOf({ paused: false, event: window, listedByIssuer: true, catalogueFetchedAt: NOW, chainObservedAt: NOW, nowMs: T0 }).tradable, true);
  assert.equal(lifecycleOf({ paused: false, event: window, listedByIssuer: true, catalogueFetchedAt: NOW, chainObservedAt: NOW, nowMs: Date.parse("2027-03-13T00:00:00.000Z") }).state, "expired");
  assert.equal(lifecycleOf({ paused: false, event: window, listedByIssuer: true, catalogueFetchedAt: NOW, chainObservedAt: NOW, nowMs: Date.parse("2027-03-13T00:00:00.000Z") }).tradable, false);
  assert.equal(lifecycleOf({ paused: null, event: null, listedByIssuer: true, catalogueFetchedAt: NOW, chainObservedAt: null }).state, "active");
  assert.equal(lifecycleOf({ paused: null, event: null, listedByIssuer: false, catalogueFetchedAt: null, chainObservedAt: null }).state, "unknown");

  primeOnchainMint(OPENAI, onchain({ pausable: { paused: true, authority: "x" } }));
  const rep = buildRepresentation(market(), catalogues());
  const row = await buildStockRow(market(), rep, null, T0, null, { epoch: 1035n, listedByIssuer: true, catalogueFetchedAt: NOW });
  assert.equal(row.lifecycle.state, "paused");
  const findRow = async () => ({ ok: true, row, universe: { rows: [row], marketsObservedAt: NOW, issuerCatalogue: { ok: true, reason: null }, fetchedAt: NOW } });
  let asked = 0;
  const order = async () => { asked += 1; return { ok: true, order: { inAmountRaw: "100000000", outAmountRaw: "69200000", minReceivedRaw: "68800000", priceImpactPct: "0", totalFeeBasisPoints: 10, slippageBps: 50, router: "metis", observedAt: NOW, reviewExpiresAt: NOW } }; };
  const buy = await quoteStock({ ticker: OPENAI, side: "BUY", usd: 100 }, { findRow, order, referral: async () => null, now: () => new Date(T0) });
  assert.equal(buy.ok, false);
  assert.equal(buy.code, "LIFECYCLE");
  assert.equal(asked, 0, "no venue call is spent on a token that is not offered");
  const sell = await quoteStock({ ticker: OPENAI, side: "SELL", usd: 100 }, { findRow, order, referral: async () => null, now: () => new Date(T0) });
  assert.equal(sell.ok, true, "what is held may still be sold");
  /* The sale is sized in scaled units over the multiplier: $100 at $971.48 is 0.102935 tokens as shown = 0.069264 base tokens. */
  assert.equal(asked, 1);
});

/* 10 ─ old plans keep their unit. */
test("10 · a plan written before 1.4.0 is a share plan and reads unchanged; a share row's plan asset says share", async () => {
  const oldAsset = { network: "solana:mainnet", mint: NFLXX, symbol: "NFLXx", issuer: { id: "xstocks", label: "xStocks" }, underlying: { symbol: "NFLX", name: "Netflix" }, decimals: 8 };
  const { planUnitBasis, PlanAssetSchema } = await import("../api/v1/contract.ts");
  assert.equal(planUnitBasis(oldAsset), "share");
  assert.equal(PlanAssetSchema.safeParse(oldAsset).success, true, "the old shape still parses");
  assert.equal(PlanAssetSchema.safeParse({ ...oldAsset, unitBasis: "token" }).success, true);
  assert.equal(PlanAssetSchema.safeParse({ ...oldAsset, unitBasis: "lots" }).success, false);
  primeOnchainMint(NFLXX, onchain({ scaledUi: null, transferFeeConfig: null, pausable: null, permanentDelegate: null }));
  const xrep = { mint: NFLXX, symbol: "NFLXx", name: "Netflix xStock", issuer: STOCK_ISSUERS.xstocks, issuerConfirmation: "issuer-catalogue", instrument: ISSUER_INSTRUMENT.xstocks, underlying: { symbol: "NFLX", isin: null, listingCountry: "US", name: "Netflix" }, companyKey: "netflix", exchange: null, tokenProgram: null, decimals: 8, tradingHalted: false, issuerUrl: null, issuerNote: null, sources: [] };
  const xrow = await buildStockRow(market({ mint: NFLXX, symbol: "NFLXx", price: 75.81, tags: ["xstocks", "verified"] }), xrep, null, T0, null, { epoch: 1035n });
  assert.equal(planAssetOf(xrow).unitBasis, "share");
});

/* 12 ─ the sale is sized on the scaled unit. */
test("12 · a $100 sale of a ×10 token is 1/10 of the base tokens the old sizing asked for", async () => {
  primeOnchainMint(NFLXX, onchain({ scaledUi: { multiplier: 1, newMultiplier: 10, newMultiplierEffectiveAt: "2026-06-01T00:00:00.000Z", authority: "x" }, transferFeeConfig: null, pausable: null, permanentDelegate: null }));
  const xrep = { mint: NFLXX, symbol: "NFLXx", name: "Netflix xStock", issuer: STOCK_ISSUERS.xstocks, issuerConfirmation: "issuer-catalogue", instrument: ISSUER_INSTRUMENT.xstocks, underlying: { symbol: "NFLX", isin: null, listingCountry: "US", name: "Netflix" }, companyKey: "netflix", exchange: null, tokenProgram: null, decimals: 8, tradingHalted: false, issuerUrl: null, issuerNote: null, sources: [] };
  const xrow = await buildStockRow(market({ mint: NFLXX, symbol: "NFLXx", price: 75.81, tags: ["xstocks", "verified"] }), xrep, null, T0, null, { epoch: 1035n });
  const findRow = async () => ({ ok: true, row: xrow, universe: { rows: [xrow], marketsObservedAt: NOW, issuerCatalogue: { ok: true, reason: null }, fetchedAt: NOW } });
  let request = null;
  const order = async (input) => { request = input; return { ok: true, order: { inAmountRaw: input.amountRaw, outAmountRaw: "99000000", minReceivedRaw: "98500000", priceImpactPct: "0", totalFeeBasisPoints: 10, slippageBps: 50, router: "metis", observedAt: NOW, reviewExpiresAt: NOW } }; };
  const sell = await quoteStock({ ticker: NFLXX, side: "SELL", usd: 100 }, { findRow, order, referral: async () => null, now: () => new Date(T0) });
  assert.equal(sell.ok, true);
  /* 100 / 75.81 = 1.319087 shares = 0.1319087 base tokens = 13,190,871 raw at 8 decimals. */
  assert.equal(request.amountRaw, "13190871");
  assert.equal(sell.quote.tokenScaled, "1.319087");
});

/* 13 ─ a provider that is down leaves the market standing. */
test("13 · with PreStocks unreachable the universe still builds from the venue and xStocks, names the failure, and carries no pre-IPO row — and a token of the disconnected issuer is never a row, whatever the venue lists", async () => {
  const { resetSpotMarketCaches } = await import("../spot/markets.server.ts");
  const { resetXStocksCaches } = await import("./issuer-xstocks.server.ts");
  const { resetPythCaches } = await import("./pyth.server.ts");
  const { resetEpochCache } = await import("./asset.server.ts");
  resetSpotMarketCaches();
  resetXStocksCaches();
  resetPythCaches();
  resetEpochCache();
  const nvdax = "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";
  const venueRow = (id, symbol, name, tags) => ({ id, name, symbol, decimals: 8, tags, isVerified: true, usdPrice: 212, stats24h: {}, audit: {} });
  const rows = [venueRow(nvdax, "NVDAx", "NVIDIA xStock", ["xstocks", "stocks", "verified"]), venueRow(OPENAI, "OPENAI", "OpenAI PreStocks", ["prestocks", "stocks", "verified"]), venueRow(T_OPENAI, "tOpenAI", "T-OpenAI", ["tessera", "stocks", "rwa", "verified"])];
  const xstocksPage = { nodes: [{ symbol: "NVDAx", name: "NVIDIA xStock", isin: "CH1", underlying: { symbol: "NVDA", isin: "US67066G1040", listingCountry: "US" }, deployments: [{ network: "Solana", address: nvdax }], isTradingHalted: false, trading: null, logo: null }], page: { hasNextPage: false } };
  const asked = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    asked.push(u);
    if (u.includes("prestocks.com")) return new Response("down", { status: 503 });
    if (u.includes("api.xstocks.fi")) return new Response(JSON.stringify(u.includes("page=0") ? xstocksPage : { nodes: [], page: { hasNextPage: false } }), { status: 200, headers: { "content-type": "application/json" } });
    if (u.includes("hermes.pyth.network")) return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    if (u.includes("/tokens/v2/")) return new Response(JSON.stringify(rows), { status: 200, headers: { "content-type": "application/json" } });
    /* The chain: no answer in this test — the multiplier is unknown, the epoch is unknown, nothing false is drawn. */
    return new Response("not in this test", { status: 503 });
  };
  const built = await buildStockUniverse({ now: () => new Date(T0) });
  assert.equal(built.ok, true);
  assert.deepEqual(built.universe.rows.map((row) => row.representation.symbol), ["NVDAx"], "the xStocks row stands; the PreStocks row is absent because its catalogue confirmed nothing");
  assert.equal(built.universe.issuerCatalogues.xstocks.ok, true);
  assert.equal(built.universe.issuerCatalogues.prestocks.ok, false);
  assert.match(built.universe.issuerCatalogues.prestocks.reason, /answered 503/);
  assert.deepEqual(Object.keys(built.universe.issuerCatalogues), ["xstocks", "prestocks"], "no other pre-IPO issuer is read or named");
  assert.equal(built.universe.issuerCatalogue.ok, true);
  assert.equal(asked.some((u) => /tessera/i.test(u)), false, "the disconnected issuer's API is never asked");
});

/* The comparison keeps instruments apart and names the other issuer's instrument on the same company. */
test("PreStocks SPACEX and the listed SpaceX xStock are never one underlying; the pre-IPO token names the listed one as the same company from another issuer, outside the comparison", async () => {
  primeOnchainMint(SPACEX, onchain({ scaledUi: { multiplier: 1, newMultiplier: 5, newMultiplierEffectiveAt: "2026-06-10T00:00:00.000Z", authority: "x" } }));
  primeOnchainMint(SPCXX, onchain({ scaledUi: null, transferFeeConfig: null, pausable: null, permanentDelegate: null }));
  const books = catalogues();
  const spacexMarket = market({ mint: SPACEX, symbol: "SPACEX", name: "SpaceX PreStocks", price: 116.15 });
  const pre = buildRepresentation(spacexMarket, books);
  const listed = { mint: SPCXX, symbol: "SPCXx", name: "SpaceX xStock", issuer: STOCK_ISSUERS.xstocks, issuerConfirmation: "issuer-catalogue", instrument: ISSUER_INSTRUMENT.xstocks, underlying: { symbol: "SPCX", isin: "US84615Q1031", listingCountry: "US", name: "SpaceX" }, companyKey: "spacex", exchange: null, tokenProgram: null, decimals: 8, tradingHalted: false, issuerUrl: null, issuerNote: null, sources: [] };
  assert.equal(pre.companyKey, "spacex");
  assert.equal(sameUnderlying(pre, listed), false, "a token priced per token and a listed share are never one underlying");
  const preRow = await buildStockRow(spacexMarket, pre, null, T0, null, { epoch: 1041n, issuerMark: preStocksMark(books.prestocks.get(SPACEX), NOW, false), listedByIssuer: true, catalogueFetchedAt: NOW });
  const listedRow = await buildStockRow(market({ mint: SPCXX, symbol: "SPCXx", name: "SpaceX xStock", price: 148.9, tags: ["xstocks", "stocks", "verified"] }), listed, null, T0, null, { epoch: 1041n });
  assert.deepEqual(sameCompanyOtherIssuer([preRow, listedRow], preRow).map((row) => row.representation.symbol), ["SPCXx"]);
  const universe = { rows: [preRow, listedRow], marketsObservedAt: NOW, issuerCatalogue: { ok: true, reason: null }, fetchedAt: NOW };
  const findRow = async (ticker) => ({ ok: true, row: universe.rows.find((row) => row.representation.mint === ticker || row.representation.symbol === ticker) ?? null, universe });
  const quote = async ({ ticker, side, usd }) => ({ ok: true, quote: { mint: ticker, symbol: "x", side, usd, tokenRaw: "1", tokenScaled: "1", minReceivedRaw: "1", minReceivedScaled: "1", multiplier: 1, unitBasis: "token", executablePerShare: usd, reference: REFERENCE_UNAVAILABLE, deviationPct: null, priceImpactPct: "0", feeBasisPoints: 10, slippageBps: 0, router: "metis", observedAt: NOW, reviewExpiresAt: NOW, source: { label: "Jupiter" }, transferFee: null, lifecycle: preRow.lifecycle } });
  const comparison = await compareRepresentations({ ticker: SPACEX, side: "BUY", usd: 100 }, { findRow, quote, now: () => new Date(T0) });
  assert.equal(comparison.ok, true);
  assert.equal(comparison.comparison.rows.length, 1, "nothing is compared against the PreStocks token");
  assert.equal(comparison.comparison.compared, false);
  assert.equal(comparison.comparison.related.length, 1);
  assert.equal(comparison.comparison.related[0].representation.issuer.id, "xstocks");
  assert.equal(comparison.comparison.related[0].priceUsd, 148.9);
});

/* The slim row the browser draws carries the class, the unit and the mark. */
test("the slim row says pre-IPO, per token, offered, with the issuer's mark — and re-judges the reference from its observation time", async () => {
  const { toSlimRow, collect } = await import("../../app/app/stocks/stock-model.ts");
  primeOnchainMint(OPENAI, onchain());
  const rep = buildRepresentation(market(), catalogues());
  const row = await buildStockRow(market(), rep, null, T0, null, { epoch: 1035n, issuerMark: preStocksMark(catalogues().prestocks.get(OPENAI), NOW, false), listedByIssuer: true, catalogueFetchedAt: NOW });
  const slim = toSlimRow(row, T0);
  assert.equal(slim.kind, "pre-ipo");
  assert.equal(slim.unitBasis, "token");
  assert.equal(slim.tradable, true);
  assert.equal(slim.mark, 958.264);
  assert.equal(slim.reference, null);
  assert.deepEqual(collect([slim], "preipo").map((entry) => entry.symbol), ["OPENAI"]);
  const stale = toSlimRow({ ...row, reference: { state: "current", perShare: 100, currency: "USD", source: { id: "pyth", label: "Pyth" }, observedAt: new Date(T0 - 20 * 60_000).toISOString(), fetchedAt: NOW, note: null }, session: { ...UNKNOWN_SESSION, exchangeOpen: true } }, T0);
  assert.equal(stale.referenceState, "stale");
});

/* The contract (1.11.0): every stock answer the routes serve — the row, the universe, the slim row, the asset and the quote — is the contract's shape on the wire. */
test("the stock answers — row, universe, slim row, asset and quote — are the contract's shapes on the wire", async () => {
  const { StockAssetResponseSchema, StockQuoteResponseSchema, StockRowSchema, StockUniverseResponseSchema, StockUniverseSlimResponseSchema } = await import("../api/v1/contract.ts");
  const { toSlimRow } = await import("../../app/app/stocks/stock-model.ts");
  const { DEFAULT_CATALOGUES } = await import("./universe.server.ts");
  const { multiplierFromChain, multiplierState } = await import("./units.ts");
  const wire = (value) => JSON.parse(JSON.stringify(value));
  const parses = (schema, value, label) => {
    const parsed = schema.safeParse(wire(value));
    assert.equal(parsed.success, true, `${label}: ${parsed.success ? "" : parsed.error.issues.slice(0, 3).map((issue) => `${issue.path.join(".")} ${issue.message}`).join("; ")}`);
  };
  primeOnchainMint(OPENAI, onchain());
  primeOnchainMint(SPACEX, onchain({ scaledUi: { multiplier: 1, newMultiplier: 5, newMultiplierEffectiveAt: "2026-06-10T00:00:00.000Z", authority: "x" } }));
  const books = catalogues();
  const pre = await buildStockRow(market(), buildRepresentation(market(), books), null, T0, null, { epoch: 1035n, issuerMark: preStocksMark(books.prestocks.get(OPENAI), NOW, false), listedByIssuer: true, catalogueFetchedAt: NOW });
  const spacexMarket = market({ mint: SPACEX, symbol: "SPACEX", name: "SpaceX PreStocks", price: 116.15 });
  const spacex = await buildStockRow(spacexMarket, buildRepresentation(spacexMarket, books), null, T0, null, { epoch: 1035n, issuerMark: preStocksMark(books.prestocks.get(SPACEX), NOW, false), listedByIssuer: true, catalogueFetchedAt: NOW });
  for (const row of [pre, spacex]) parses(StockRowSchema, row, row.representation.symbol);
  const universe = { rows: [pre, spacex], marketsObservedAt: NOW, issuerCatalogue: { ok: true, reason: null }, issuerCatalogues: DEFAULT_CATALOGUES, fetchedAt: NOW };
  parses(StockUniverseResponseSchema, universe, "universe");
  /* 1.14.0: a new answer names no disconnected issuer's catalogue; an answer written before still parses (the key is optional, never removed). */
  assert.deepEqual(Object.keys(universe.issuerCatalogues), ["xstocks", "prestocks"]);
  parses(StockUniverseResponseSchema, { ...universe, issuerCatalogues: { ...DEFAULT_CATALOGUES, tessera: { ok: true, stale: false, fetchedAt: null, reason: null } } }, "a universe answered before 1.14.0");
  parses(StockUniverseSlimResponseSchema, { rows: universe.rows.map((row) => toSlimRow(row, T0)), fetchedAt: NOW }, "slim");
  parses(StockUniverseSlimResponseSchema, { rows: [toSlimRow(pre, T0)], fetchedAt: NOW, query: "openai", total: 1 }, "slim search");
  const chain = multiplierFromChain(onchain().scaledUi, T0);
  const asset = { row: pre, onchain: onchain(), chainMultiplier: chain, chainMultiplierState: multiplierState(chain, T0), issuerMultiplier: null, multiplierAgreement: "unknown", reserves: null, pool: null, fetchedAt: NOW };
  parses(StockAssetResponseSchema, asset, "asset");
  parses(StockAssetResponseSchema, { ...asset, onchain: { error: "The mint could not be read." }, chainMultiplier: null, chainMultiplierState: null }, "asset without the chain");
  const findRow = async () => ({ ok: true, row: pre, universe });
  const order = async () => ({ ok: true, order: { inAmountRaw: "100000000", outAmountRaw: "69200000", minReceivedRaw: "68800000", priceImpactPct: "0.02", totalFeeBasisPoints: 10, slippageBps: 50, router: "metis", observedAt: NOW, reviewExpiresAt: new Date(T0 + 60_000).toISOString() } });
  for (const side of ["BUY", "SELL"]) {
    const read = await quoteStock({ ticker: OPENAI, side, usd: 100 }, { findRow, order, referral: async () => null, now: () => new Date(T0) });
    assert.equal(read.ok, true);
    parses(StockQuoteResponseSchema, read.quote, `quote ${side}`);
  }
});

/* A copy built while a pre-IPO issuer's API failed holds none of its rows; asking for one of them is "not known right now", never "does not exist" (RYN-FIRST-SCREEN-001: a private company answered the not-found page after a cold build on 2026-09-23). */
test("a ticker missing from a copy without every issuer's catalogue is a provider answer, never a not-found — and a retired token is known not to be a row", async () => {
  const { DEFAULT_CATALOGUES, findRowIn } = await import("./universe.server.ts");
  primeOnchainMint(OPENAI, onchain());
  const books = catalogues();
  const pre = await buildStockRow(market(), buildRepresentation(market(), books), null, T0, null, { epoch: 1035n, issuerMark: preStocksMark(books.prestocks.get(OPENAI), NOW, false), listedByIssuer: true, catalogueFetchedAt: NOW });
  const down = { ok: false, stale: false, fetchedAt: null, reason: "The issuer's API answered 500." };
  const universe = (issuerCatalogues) => ({ rows: [pre], marketsObservedAt: NOW, issuerCatalogue: { ok: true, reason: null }, issuerCatalogues, fetchedAt: NOW });

  const preStocksDown = findRowIn(universe({ ...DEFAULT_CATALOGUES, prestocks: down }), "NOPE123");
  assert.equal(preStocksDown.ok, false, "with any catalogue silent, no ticker can be said not to exist");
  assert.equal(preStocksDown.code, "ISSUER_CATALOGUE_UNAVAILABLE");
  assert.match(preStocksDown.reason, /PreStocks/);
  assert.doesNotMatch(preStocksDown.reason, /Tessera/i);

  /* A retired token is not a row whatever any catalogue did: its page says it is no longer supported, never "not known right now". */
  for (const ticker of ["tOpenAI", "TOPENAI", T_OPENAI]) {
    const retired = findRowIn(universe({ ...DEFAULT_CATALOGUES, prestocks: down }), ticker);
    assert.equal(retired.ok, true, ticker);
    assert.equal(retired.row, null, ticker);
  }

  const found = findRowIn(universe({ ...DEFAULT_CATALOGUES, prestocks: down }), pre.representation.symbol);
  assert.equal(found.ok, true, "a row that is there is served whatever the catalogue did on this build");
  assert.equal(found.row, pre);

  const complete = findRowIn(universe(DEFAULT_CATALOGUES), "NOPE123");
  assert.equal(complete.ok, true, "a complete copy can say a ticker does not exist");
  assert.equal(complete.row, null);
});
