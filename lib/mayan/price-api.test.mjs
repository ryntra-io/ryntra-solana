import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { CROSS_SWAP_TUPLES } from "../swap/catalog.ts";
import {
  MAYAN_NATIVE_TOKEN,
  MAYAN_PRICE_API_ORIGIN,
  MAYAN_SDK_VERSION,
  admissibleMayanRoutes,
  buildMayanQuoteUrl,
  crossSwapQuoteMaterialChange,
  fetchMayanQuotes,
  normalizeMayanQuote,
  selectMayanQuote,
} from "./price-api.ts";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/price-api-quote-sol-to-base-usdc.json", import.meta.url), "utf8"));
const SOL_TO_BASE_USDC = CROSS_SWAP_TUPLES.find((tuple) => tuple.id === "SOLANA_SOL_TO_BASE_USDC");
const BASE_USDC_TO_SOL = CROSS_SWAP_TUPLES.find((tuple) => tuple.id === "BASE_USDC_TO_SOLANA_SOL");
const ETH_TO_SOL = CROSS_SWAP_TUPLES.find((tuple) => tuple.id === "ETHEREUM_ETH_TO_SOLANA_SOL");

const stubFetch = (status, body) => async (url) => {
  stubFetch.calls.push(String(url));
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
};
stubFetch.calls = [];

test("the quote URL pins the verified SDK version, asks every mechanism, and names the native coin by Mayan's zero address", () => {
  const url = new URL(
    buildMayanQuoteUrl({ fromChain: "solana", fromToken: MAYAN_NATIVE_TOKEN, toChain: "base", toToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", amountIn: "0.1" }),
  );
  assert.equal(url.origin, MAYAN_PRICE_API_ORIGIN);
  assert.equal(url.pathname, "/v3/quote");
  assert.equal(url.searchParams.get("sdkVersion"), MAYAN_SDK_VERSION);
  assert.equal(url.searchParams.get("fromChain"), "solana");
  assert.equal(url.searchParams.get("toChain"), "base");
  assert.equal(url.searchParams.get("fromToken"), MAYAN_NATIVE_TOKEN);
  assert.equal(url.searchParams.get("slippageBps"), "auto");
  assert.equal(url.searchParams.get("swift"), "true");
  assert.equal(url.searchParams.get("fastMctp"), "true");
  assert.equal(url.searchParams.get("wormhole"), "false", "wrapped assets are never asked for");
  assert.equal(url.searchParams.get("fullList"), "true");
  assert.equal(url.searchParams.get("referrer"), null, "no referrer until one is configured");
});

test("a recorded answer parses into raw quotes and nothing else is trusted", async () => {
  const result = await fetchMayanQuotes(
    { fromChain: "solana", fromToken: MAYAN_NATIVE_TOKEN, toChain: "base", toToken: "0x8335", amountIn: "0.1" },
    { fetchImpl: stubFetch(200, fixture), now: () => new Date("2026-09-07T12:00:00Z") },
  );
  assert.equal(result.ok, true);
  assert.equal(result.quotes.length, 2);
  assert.deepEqual(result.quotes.map((quote) => quote.type), ["SWIFT", "FAST_MCTP"]);
  assert.equal(result.unreadable, 0);
  assert.equal(result.observedAt, "2026-09-07T12:00:00.000Z");
  assert.match(stubFetch.calls.at(-1), /price-api\.mayan\.finance\/v3\/quote/);
});

test("provider failures are named, not guessed: 406 is the SDK gate, 429 the rate limit, an empty list is no route", async () => {
  const gate = await fetchMayanQuotes({ fromChain: "solana", fromToken: MAYAN_NATIVE_TOKEN, toChain: "base", toToken: "x", amountIn: "1" }, {
    fetchImpl: stubFetch(406, { code: 1006, msg: "Swift v2 is only avilable from sdk 13.0.0 upwards" }),
  });
  assert.equal(gate.ok, false);
  assert.equal(gate.code, "SDK_VERSION");
  assert.equal(gate.provider.code, 1006);
  const limited = await fetchMayanQuotes({ fromChain: "solana", fromToken: MAYAN_NATIVE_TOKEN, toChain: "base", toToken: "x", amountIn: "1" }, {
    fetchImpl: stubFetch(429, {}),
  });
  assert.equal(limited.code, "RATE_LIMITED");
  const empty = await fetchMayanQuotes({ fromChain: "solana", fromToken: MAYAN_NATIVE_TOKEN, toChain: "base", toToken: "x", amountIn: "1" }, {
    fetchImpl: stubFetch(200, { quotes: [] }),
  });
  assert.equal(empty.code, "NO_QUOTES");
  const broken = await fetchMayanQuotes({ fromChain: "solana", fromToken: MAYAN_NATIVE_TOKEN, toChain: "base", toToken: "x", amountIn: "1" }, {
    fetchImpl: stubFetch(200, { hello: "world" }),
  });
  assert.equal(broken.code, "UNREADABLE");
  const down = await fetchMayanQuotes({ fromChain: "solana", fromToken: MAYAN_NATIVE_TOKEN, toChain: "base", toToken: "x", amountIn: "1" }, {
    fetchImpl: async () => {
      throw new Error("ECONNRESET");
    },
  });
  assert.equal(down.code, "TRANSPORT");
});

test("Solana-origin admits Swift only and EVM-origin admits Fast MCTP only; the highest signed minimum wins", () => {
  assert.deepEqual(admissibleMayanRoutes(SOL_TO_BASE_USDC), ["SWIFT"]);
  assert.deepEqual(admissibleMayanRoutes(BASE_USDC_TO_SOL), ["FAST_MCTP"]);
  assert.deepEqual(admissibleMayanRoutes(ETH_TO_SOL), ["FAST_MCTP"]);

  const fromSolana = selectMayanQuote(fixture.quotes, SOL_TO_BASE_USDC);
  assert.equal(fromSolana.selected?.type, "SWIFT", "Fast MCTP from Solana would need a key this process may not hold");
  assert.deepEqual(fromSolana.declined, ["FAST_MCTP"]);

  const twoSwifts = [
    { ...fixture.quotes[0], minAmountOutBaseUnits: "10300000" },
    { ...fixture.quotes[0], minAmountOutBaseUnits: "10331472" },
  ];
  assert.equal(selectMayanQuote(twoSwifts, SOL_TO_BASE_USDC).selected?.minAmountOutBaseUnits, "10331472");

  const gasless = [{ ...fixture.quotes[0], gasless: true }];
  assert.equal(selectMayanQuote(gasless, SOL_TO_BASE_USDC).selected, null, "gasless orders are relayer-submitted and not part of V1");
});

test("normalization keeps raw integers, the signed minimum, the deadline and the fee facts a person can read", () => {
  const quote = normalizeMayanQuote(fixture.quotes[0], SOL_TO_BASE_USDC, {
    fromDecimals: 9,
    toDecimals: 6,
    observedAt: "2026-09-07T12:00:00.000Z",
    approvals: 0,
  });
  assert.equal(quote.provider, "MAYAN");
  assert.equal(quote.route, "SWIFT");
  assert.equal(quote.tupleId, "SOLANA_SOL_TO_BASE_USDC");
  assert.equal(quote.from.amountRaw, "100000000");
  assert.equal(quote.to.expectedRaw, "10388583");
  assert.equal(quote.to.minimumRaw, "10331472");
  assert.equal(quote.slippageBps, 55);
  assert.equal(quote.etaSeconds, 3);
  assert.equal(quote.deadlineUnix, 1788804505);
  assert.equal(quote.fees.protocolBps, 0);
  assert.equal(quote.fees.relayerUsd, null, "Swift carries no relayer fee on success");
  assert.equal(quote.fees.rentLamports, "3000000");
  assert.equal(quote.approvals, 0);
  assert.equal(quote.walletPrompts, 1);
  assert.equal(quote.priceImpactBps, null);
  assert.equal(quote.priceStatus, "GOOD");
  assert.equal(quote.quoteId, "0xe4b868d4c313e825aa7101f19cf526ba");

  const fast = normalizeMayanQuote(fixture.quotes[1], BASE_USDC_TO_SOL, { fromDecimals: 6, toDecimals: 9, observedAt: "x", approvals: 1 });
  assert.equal(fast.routeLabel, "Mayan Fast MCTP (Circle CCTP v2)");
  assert.equal(fast.fees.protocolBps, 3);
  assert.equal(fast.fees.relayerUsd, 0.00457716);
  assert.equal(fast.fees.rentLamports, null, "rent is a Solana-source fact only");
  assert.equal(fast.walletPrompts, 2, "an ERC-20 approval plus the swap");
});

test("a material change is a lower signed minimum beyond tolerance, a different route or a different input", () => {
  const reviewed = { route: "SWIFT", from: { amountRaw: "100000000" }, to: { minimumRaw: "10000000" } };
  assert.deepEqual(crossSwapQuoteMaterialChange(reviewed, { ...reviewed, to: { minimumRaw: "10020000" } }), { changed: false }, "a better minimum is never material");
  assert.deepEqual(crossSwapQuoteMaterialChange(reviewed, { ...reviewed, to: { minimumRaw: "9990000" } }), { changed: false }, "10 bps is within tolerance");
  assert.deepEqual(crossSwapQuoteMaterialChange(reviewed, { ...reviewed, to: { minimumRaw: "9900000" } }), {
    changed: true,
    reason: "MINIMUM_DROPPED",
    dropBps: 100,
  });
  assert.deepEqual(crossSwapQuoteMaterialChange(reviewed, { ...reviewed, route: "FAST_MCTP" }), { changed: true, reason: "ROUTE" });
  assert.deepEqual(crossSwapQuoteMaterialChange(reviewed, { ...reviewed, from: { amountRaw: "1" } }), { changed: true, reason: "AMOUNT_IN" });
});
