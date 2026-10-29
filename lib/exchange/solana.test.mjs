import assert from "node:assert/strict";
import test from "node:test";

import { SOLANA_NATIVE_SOL_MINT, SOLANA_USDC_MINT } from "../swap/catalog.ts";
import { serviceFeeAbsent, serviceFeeQuoted } from "../swap/service-fee.ts";
import { exchangeQuoteFromJupiter, feeSplit, jupiterSource, MANIFEST_DEX_LABEL, manifestSource } from "./sources/solana.ts";

const SOL = { network: "solana", asset: SOLANA_NATIVE_SOL_MINT, symbol: "SOL", decimals: 9, native: true };
const USDC = { network: "solana", asset: SOLANA_USDC_MINT, symbol: "USDC", decimals: 6, native: false };
const request = { intentId: "intent-b9-0002", from: SOL, to: USDC, amountRaw: "100000000", user: null, recipient: null };

/** The lane's quote, trimmed to what the Exchange reads: 0.1 SOL → USDC, a 0.10 % majors fee taken from the input. */
const quote = (overrides = {}) => ({
  inputMint: SOLANA_NATIVE_SOL_MINT,
  outputMint: SOLANA_USDC_MINT,
  inAmountRaw: "100000000",
  outAmountRaw: "10586311",
  minReceivedRaw: "10533380",
  ryntraFee: serviceFeeQuoted("JUPITER_PLATFORM_FEE", { basisPoints: 10, requestedBasisPoints: 10, asset: SOLANA_NATIVE_SOL_MINT, symbol: "SOL", decimals: 9, amountRaw: "100000", providerRetainedPercent: 0 }),
  signatureFeeLamports: "5000",
  signatureFeePayer: null,
  priorityFeeLamports: "1200",
  priorityFeePayer: null,
  taker: null,
  route: [{ label: "Meteora DLMM" }, { label: "Whirlpool" }],
  observedAt: "2026-10-15T12:00:00.000Z",
  reviewExpiresAt: "2026-10-15T12:00:30.000Z",
  ...overrides,
});

test("Jupiter's quote is the core's quote: what arrives, the least, Ryntra's fee and the network fee", () => {
  const mapped = exchangeQuoteFromJupiter("Jupiter", request, quote());
  assert.equal(mapped.executor, "Jupiter");
  assert.deepEqual(mapped.quote.out_expected, { units: "10586311", asset: SOLANA_USDC_MINT, decimals: 6 });
  assert.equal(mapped.quote.out_min.units, "10533380");
  assert.deepEqual(mapped.quote.fees.ryntra, { units: "100000", asset: SOLANA_NATIVE_SOL_MINT, decimals: 9 });
  assert.equal(mapped.quote.fees.venue, undefined);
  assert.deepEqual(mapped.quote.fees.gas, { units: "6200", asset: SOLANA_NATIVE_SOL_MINT, decimals: 9 });
  assert.equal(mapped.quote.route, "Jupiter · Meteora DLMM → Whirlpool");
  assert.equal(mapped.quote.expires_at - mapped.quote.at, 30_000);
});

test("a fee taken from the output is stated from the output it leaves", () => {
  const fee = serviceFeeQuoted("JUPITER_PLATFORM_FEE", { basisPoints: 50, asset: SOLANA_USDC_MINT, symbol: "USDC", decimals: 6, amountRaw: null });
  /* out is what arrives after the fee: 10 586 311 × 50 / 9 950. */
  assert.equal(feeSplit(fee, quote(), request).ryntra.units, String((10_586_311n * 50n) / 9_950n));
});

test("on a referral Jupiter's fifth is Jupiter's line, the rest is Ryntra's", () => {
  const fee = serviceFeeQuoted("JUPITER_REFERRAL", { basisPoints: 50, asset: SOLANA_NATIVE_SOL_MINT, decimals: 9, amountRaw: "500000", providerRetainedPercent: 20 });
  const split = feeSplit(fee, quote(), request);
  assert.equal(split.ryntra.units, "400000");
  assert.equal(split.venue.units, "100000");
});

test("a gasless order costs the wallet no network fee; a dollar-to-dollar swap carries no Ryntra line", () => {
  const mapped = exchangeQuoteFromJupiter("Jupiter", request, quote({ signatureFeePayer: "gasTzr94Pmp4Gf8vknQnqxeYxdgwFjbgdJa4msYRpnB", priorityFeePayer: "gasTzr94Pmp4Gf8vknQnqxeYxdgwFjbgdJa4msYRpnB", ryntraFee: serviceFeeAbsent("Dollar to dollar") }));
  assert.equal(mapped.quote.fees.gas, undefined);
  assert.equal(mapped.quote.fees.ryntra, undefined);
});

const deps = (overrides = {}) => ({
  policy: "v2",
  chooseQuote: async () => ({ ok: true, order: quote(), flow: "MAJOR", lane: "BUILD" }),
  flowOf: async () => "MAJOR",
  buildFee: async () => ({ ok: true, fee: { bps: 10, side: "INPUT", mint: SOLANA_NATIVE_SOL_MINT, owner: "FeeWa11et1111111111111111111111111111111111", account: "FeeAcc0unt111111111111111111111111111111111", decimals: 9, symbol: "SOL" } }),
  fetchBuild: async (asked) => ({ ok: true, answer: { request: asked, quote: quote({ route: [{ label: MANIFEST_DEX_LABEL }] }) } }),
  ...overrides,
});

test("Jupiter is the lane's own choice; the fee route names the lane's parameter", async () => {
  const answer = await jupiterSource(deps()).quote(request);
  assert.equal(answer.ok, true);
  assert.deepEqual([answer.fee.executor, answer.fee.parameter, answer.fee.bps, answer.fee.configured], ["Jupiter", "platformFeeBps + feeAccount", 10, true]);
  assert.equal(jupiterSource(deps()).serves({ ...request, to: { ...USDC, network: "arc" } }), false);
});

test("Manifest is asked for its book alone, with the flow's fee into the fee wallet", async () => {
  const asked = [];
  const answer = await manifestSource(deps({ fetchBuild: async (r) => (asked.push(r), { ok: true, answer: { request: r, quote: quote({ route: [{ label: MANIFEST_DEX_LABEL }] }) } }) })).quote(request);
  assert.deepEqual(asked[0].dexes, ["Manifest"]);
  assert.equal(asked[0].fee.bps, 10);
  assert.equal(asked[0].taker, null);
  assert.equal(answer.ok, true);
  assert.equal(answer.quote.executor, "Manifest");
  assert.equal(answer.quote.quote.route, "Manifest · order book");
});

test("a route through anything but the book is not Manifest's price", async () => {
  const answer = await manifestSource(deps({ fetchBuild: async (r) => ({ ok: true, answer: { request: r, quote: quote({ route: [{ label: "Manifest" }, { label: "Whirlpool" }] }) } }) })).quote(request);
  assert.deepEqual([answer.ok, answer.refusal.code], [false, "NO_ROUTE"]);
});

test("Manifest is not asked where it could not carry Ryntra's fee", async () => {
  let asked = 0;
  const fetchBuild = async () => (asked++, { ok: false, code: "NO_ROUTE", reason: "" });
  const ondo = await manifestSource(deps({ flowOf: async () => "ONDO", fetchBuild })).quote(request);
  const asNow = await manifestSource(deps({ policy: "as-now", fetchBuild })).quote(request);
  const noAccount = await manifestSource(deps({ buildFee: async () => ({ ok: false, reason: "The fee wallet has no account for this mint." }), fetchBuild })).quote(request);
  for (const answer of [ondo, asNow, noAccount]) assert.deepEqual([answer.ok, answer.refusal.code], [false, "FEE_NOT_CARRIED"]);
  assert.equal(asked, 0);
  /* A dollar-to-dollar pair has no fee to carry, so the book is asked with none. */
  const stable = [];
  await manifestSource(deps({ flowOf: async () => "STABLE", fetchBuild: async (r) => (stable.push(r), { ok: false, code: "NO_ROUTE", reason: "none" }) })).quote(request);
  assert.equal(stable[0].fee, null);
});
