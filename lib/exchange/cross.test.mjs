import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ARC_USDC_CONTRACT, SOLANA_NATIVE_SOL_MINT, SOLANA_USDC_MINT } from "../swap/catalog.ts";
import { RYNTRA_SERVICE_FEE_POLICY } from "../swap/service-fee.ts";
import { collectExchangeQuotes } from "./quotes.ts";
import { ARC_USDC_SIDE, debridgeSource, debridgeTokenFor, exchangeQuoteFromDebridge, mayanSource, relaySource } from "./sources/cross.ts";
import { CROSS_NETWORK_FEE_BPS, normalizeExchangeFeeConfig } from "./fees.ts";
import { readDebridgeQuote } from "../debridge/quote-api.ts";

/*
 * Recorded live on 2026-10-15, nothing here reaches the network:
 * Relay — 0.05 SOL → USDC on Arc with a 25 bps app fee;
 * deBridge — 0.1 SOL → USDC on Arc (its native face, 18 decimals) with a 0.25 % affiliate fee.
 */
const RELAY_ARC = JSON.parse(readFileSync(new URL("./fixtures/relay-quote-sol-to-arc-usdc.json", import.meta.url), "utf8"));
const DEBRIDGE_ARC = JSON.parse(readFileSync(new URL("./fixtures/debridge-quote-sol-to-arc-usdc.json", import.meta.url), "utf8"));

const SOL = { network: "solana", asset: SOLANA_NATIVE_SOL_MINT, symbol: "SOL", decimals: 9, native: true };
const USER = "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1";
const RECIPIENT = "0x000000000000000000000000000000000000dEaD";
const FEES = normalizeExchangeFeeConfig({ relayAppFeeRecipient: "0x1111111111111111111111111111111111111111", debridgeAffiliateSolana: USER, mayanReferrerSolana: USER });
const NO_FEES = normalizeExchangeFeeConfig({ relayAppFeeRecipient: null, debridgeAffiliateSolana: null, mayanReferrerSolana: null });

const request = (amountRaw, to = ARC_USDC_SIDE) => ({ intentId: "intent-b9-0001", from: SOL, to, amountRaw, user: USER, recipient: RECIPIENT });

const answering = (body, seen = []) => async (url, init) => {
  seen.push({ url: String(url), init });
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
};

test("one cross-network rate for every executor (рішення 11)", () => {
  assert.equal(CROSS_NETWORK_FEE_BPS, 25);
  assert.equal(RYNTRA_SERVICE_FEE_POLICY.RELAY_APP_FEE, CROSS_NETWORK_FEE_BPS);
  assert.equal(RYNTRA_SERVICE_FEE_POLICY.MAYAN_REFERRER, CROSS_NETWORK_FEE_BPS);
});

test("a receiving address of the wrong shape is no address", () => {
  const config = normalizeExchangeFeeConfig({ relayAppFeeRecipient: USER, debridgeAffiliateSolana: RECIPIENT, mayanReferrerSolana: " " });
  assert.deepEqual(config, { relayAppFeeRecipient: null, debridgeAffiliateSolana: null, mayanReferrerSolana: null });
});

test("Relay: SOL → USDC on Arc becomes the core's quote, Ryntra's 25 bps on its own line", async () => {
  const seen = [];
  const answer = await relaySource({ fees: FEES, fetchImpl: answering(RELAY_ARC, seen) }).quote(request("50000000"));
  assert.equal(answer.ok, true);
  const body = JSON.parse(seen[0].init.body);
  assert.deepEqual(body.appFees, [{ recipient: "0x1111111111111111111111111111111111111111", fee: "25" }]);
  assert.equal(body.destinationChainId, 5042);
  const { quote, fee } = answer;
  assert.equal(quote.executor, "Relay");
  assert.equal(quote.quote.intent_id, "intent-b9-0001");
  assert.deepEqual(quote.quote.out_expected, { units: "5248122", asset: ARC_USDC_CONTRACT, decimals: 6 });
  assert.equal(quote.quote.out_min.units, "5221882");
  /* 25 bps of 0.05 SOL, as Relay states it, in SOL. */
  assert.deepEqual(quote.quote.fees.ryntra, { units: "125000", asset: SOLANA_NATIVE_SOL_MINT, decimals: 9 });
  assert.equal(quote.quote.fees.venue.units, "307427");
  assert.equal(quote.quote.fees.gas.units, "1570");
  assert.equal(quote.delivery_ms, 1_000);
  assert.ok(quote.quote.expires_at > quote.quote.at);
  assert.deepEqual(fee, { executor: "Relay", parameter: "appFees", bps: 25, paidTo: fee.paidTo, configured: true });
});

test("Relay without a wallet says what it needs instead of pricing another transaction", async () => {
  const answer = await relaySource({ fees: FEES, fetchImpl: answering(RELAY_ARC) }).quote({ ...request("50000000"), user: null });
  assert.deepEqual(answer, { ok: false, refusal: { executor: "Relay", code: "NEEDS_WALLET", reason: "Relay prices for the wallets it will use." } });
});

test("Relay without a claim address asks no fee and says so", async () => {
  const seen = [];
  const answer = await relaySource({ fees: NO_FEES, fetchImpl: answering(RELAY_ARC, seen) }).quote(request("50000000"));
  assert.equal(JSON.parse(seen[0].init.body).appFees, undefined);
  assert.equal(answer.fee.configured, false);
});

test("deBridge is asked for Arc's USDC by its native face, never with the amount raised", async () => {
  assert.deepEqual(debridgeTokenFor(ARC_USDC_SIDE), { token: "0x0000000000000000000000000000000000000000", decimals: 18 });
  assert.deepEqual(debridgeTokenFor(SOL), { token: "11111111111111111111111111111111", decimals: 9 });
  const seen = [];
  const answer = await debridgeSource({ fees: FEES, fetchImpl: answering(DEBRIDGE_ARC, seen) }).quote(request("100000000"));
  const url = new URL(seen[0].url);
  assert.equal(url.searchParams.get("srcChainId"), "7565164");
  assert.equal(url.searchParams.get("dstChainId"), "5042");
  assert.equal(url.searchParams.get("dstChainTokenOut"), "0x0000000000000000000000000000000000000000");
  assert.equal(url.searchParams.get("prependOperatingExpenses"), "false");
  assert.equal(url.searchParams.get("affiliateFeePercent"), "0.25");
  assert.equal(url.searchParams.get("affiliateFeeRecipient"), USER);
  assert.equal(answer.ok, true);
  assert.equal(answer.fee.configured, true);
});

test("deBridge's answer reads back at six decimals, every cost by who takes it", () => {
  const quote = readDebridgeQuote(DEBRIDGE_ARC);
  const mapped = exchangeQuoteFromDebridge(request("100000000"), quote, "2026-10-15T12:00:00.000Z");
  /* 9.824952774975101338 native USDC → 9.824952 at six, cut, never rounded up. */
  assert.deepEqual(mapped.quote.out_expected, { units: "9824952", asset: ARC_USDC_CONTRACT, decimals: 6 });
  assert.equal(mapped.quote.out_min.units, "9824952");
  /* Ryntra's 0.25 % as deBridge states it: 26 433 units of Solana USDC. */
  assert.deepEqual(mapped.quote.fees.ryntra, { units: "26433", asset: SOLANA_USDC_MINT, decimals: 6 });
  /* Protocol fee 4 230 (source, carried 1:1 to Arc's USDC) + taker margin 4 218 + operating expenses 717 624, at six decimals. */
  assert.equal(mapped.quote.fees.venue.units, String(4_230 + 4_218 + 717_624));
  /* The fixed 0.015 SOL is paid from the wallet on top, beside the signature fee. */
  assert.deepEqual(mapped.quote.fees.gas, { units: "15005000", asset: SOLANA_NATIVE_SOL_MINT, decimals: 9 });
  assert.match(mapped.quote.route, /fixed fee/);
  assert.equal(mapped.delivery_ms, 9_000);
});

test("an answer that raised the amount in is not an answer", () => {
  const raised = structuredClone(DEBRIDGE_ARC);
  raised.estimation.srcChainTokenIn.mutatedWithOperatingExpense = true;
  assert.equal(readDebridgeQuote(raised), null);
});

test("deBridge without a Solana key asks no affiliate fee", async () => {
  const seen = [];
  const answer = await debridgeSource({ fees: NO_FEES, fetchImpl: answering(DEBRIDGE_ARC, seen) }).quote(request("100000000"));
  assert.equal(new URL(seen[0].url).searchParams.get("affiliateFeePercent"), null);
  assert.equal(answer.fee.configured, false);
});

test("Mayan does not serve Arc and says so by name", async () => {
  let asked = false;
  const answer = await mayanSource({ fees: FEES, fetchImpl: async () => ((asked = true), new Response("{}")) }).quote(request("100000000"));
  assert.equal(answer.ok, false);
  assert.equal(answer.refusal.executor, "Mayan");
  assert.equal(answer.refusal.code, "NOT_SERVED");
  assert.equal(asked, false);
});

test("every source is asked at once; a slow or broken one never takes the others down", async () => {
  const quick = (executor, units) => ({
    executor,
    serves: () => true,
    quote: async (r) => ({
      ok: true,
      quote: { id: executor, executor, delivery_ms: 1, quote: { intent_id: r.intentId, out_expected: { units, asset: r.to.asset, decimals: 6 }, out_min: { units, asset: r.to.asset, decimals: 6 }, fees: {}, route: executor, at: 0, expires_at: 1 } },
      fee: { executor, parameter: "p", bps: 25, paidTo: "x", configured: true },
    }),
  });
  const slow = { executor: "Slow", serves: () => true, quote: () => new Promise(() => {}) };
  const broken = { executor: "Broken", serves: () => true, quote: async () => { throw new Error("boom"); } };
  const elsewhere = { executor: "Elsewhere", serves: () => false, quote: async () => { throw new Error("never asked"); } };
  const other = { ...quick("Other", "1"), quote: async (r) => ({ ...(await quick("Other", "1").quote(r)), quote: { ...(await quick("Other", "1").quote(r)).quote, quote: { ...(await quick("Other", "1").quote(r)).quote.quote, intent_id: "another" } } }) };
  const answer = await collectExchangeQuotes(request("1"), [quick("A", "10"), slow, broken, elsewhere, quick("B", "9"), other], { deadlineMs: 50 });
  assert.deepEqual(answer.quotes.map((q) => q.executor), ["A", "B"]);
  assert.deepEqual(answer.refusals.map((r) => [r.executor, r.code]), [["Slow", "UNAVAILABLE"], ["Broken", "UNAVAILABLE"], ["Other", "NO_ROUTE"]]);
  assert.deepEqual(answer.fees.map((f) => f.executor), ["A", "B"]);
});

test("this Exchange sends from Solana; deBridge passes the lane's gate like every rail", async () => {
  const fromBase = { ...request("1000000"), from: { network: "base", asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", symbol: "USDC", decimals: 6, native: false }, to: SOL };
  for (const source of [relaySource({ fees: FEES }), debridgeSource({ fees: FEES }), mayanSource({ fees: FEES })]) assert.equal(source.serves(fromBase), false, source.executor);
  /* A Stock Token Robinhood Chain's router refuses is never priced, whoever is asked. */
  const stock = { network: "robinhood", asset: "0x1111111111111111111111111111111111111111", symbol: "TSLA", decimals: 18, native: false };
  const answer = await debridgeSource({ fees: FEES, fetchImpl: async () => assert.fail("not asked") }).quote(request("100000000", stock));
  assert.deepEqual([answer.ok, answer.refusal.code], [false, "NOT_SERVED"]);
});

test("a deBridge answer for another amount in is another exchange", () => {
  const quote = readDebridgeQuote(DEBRIDGE_ARC);
  assert.equal(exchangeQuoteFromDebridge(request("99999999"), quote, "2026-10-15T12:00:00.000Z"), null);
});
