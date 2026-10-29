import assert from "node:assert/strict";
import test from "node:test";

import { RELAY_CROSS_SWAP_TUPLES } from "../swap/catalog.ts";
import {
  buildRelayQuoteBody,
  fetchRelayQuote,
  normalizeRelayQuote,
  relayApprovalCount,
  relayQuoteMatchesRequest,
  RELAY_QUOTE_VALIDITY_SECONDS,
  RELAY_SLIPPAGE_BPS,
  RELAY_REFERRER,
} from "./quote-api.ts";

const tuple = (id) => RELAY_CROSS_SWAP_TUPLES.find((entry) => entry.id === id);

/**
 * A recorded Solana-origin answer, trimmed to the fields this lane reads. The
 * figures are from a live quote on 2026-09-09 (1 SOL in, USDG out); nothing
 * here reaches the network.
 */
const SOLANA_ORIGIN = {
  requestId: "0x1788962454b083648662e66ed3964577100c536c8d1a4a762082eedd4934c730",
  steps: [
    {
      id: "deposit",
      kind: "transaction",
      items: [
        {
          status: "incomplete",
          data: {
            instructions: [
              { programId: "99vQwtBwYtrqqD9YSXbdum3KBdxPAVxYTaQ3cfnJSrN2", keys: [{ pubkey: "Dodg2HifwU8rmaVVyMyUZDGTRbqAJTyVYxXPwcbNpBKc", isSigner: false, isWritable: false }], data: "0d9e0ddf5fd51c06" },
            ],
            addressLookupTableAddresses: ["Hm9fUgcn7qwDaiNTFiGh6pNtVATgnaRcmK6Bbx6EMZfP"],
          },
          check: { endpoint: "/intents/status?requestId=0x1788", method: "GET" },
        },
      ],
    },
  ],
  fees: {
    gas: { amountUsd: "0.002474" },
    relayer: { amountUsd: "0.384789" },
    relayerService: { amountUsd: "0.342172" },
  },
  details: {
    operation: "swap",
    currencyIn: { currency: { chainId: 792703809, address: "11111111111111111111111111111111", symbol: "SOL", decimals: 9 }, amount: "1000000000", amountFormatted: "1.0", amountUsd: "104.052578" },
    currencyOut: {
      currency: { chainId: 4663, address: "0x5fc5360d0400a0fd4f2af552add042d716f1d168", symbol: "USDG", decimals: 6 },
      amount: "103414936",
      amountFormatted: "103.414936",
      amountUsd: "103.413075",
      minimumAmount: "102714996",
    },
    totalImpact: { usd: "-0.719934", percent: "-0.61" },
    slippageTolerance: { destination: { percent: "0.50", value: "516156" } },
    timeEstimate: 1,
  },
};

const respond = (status, body) =>
  async () =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("the quote body states this lane's own slippage rather than accepting the provider's default", () => {
  const body = buildRelayQuoteBody({
    fromNetwork: "solana",
    fromToken: "11111111111111111111111111111111",
    toNetwork: "robinhood",
    toToken: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
    amountRaw: "1000000000",
    user: "So11111111111111111111111111111111111111112",
    recipient: "0x000000000000000000000000000000000000dEaD",
  });
  assert.equal(body.originChainId, 792703809);
  assert.equal(body.destinationChainId, 4663);
  assert.equal(body.tradeType, "EXACT_INPUT");
  assert.equal(body.slippageTolerance, String(RELAY_SLIPPAGE_BPS));
  /* A referrer needs an API key this lane does not hold; sending one is a 401. */
  assert.equal("referrer" in body, false);
});

test("a signed minimum becomes the promise, and the expected amount never stands in for it", () => {
  const quote = normalizeRelayQuote(SOLANA_ORIGIN, tuple("SOLANA_SOL_TO_ROBINHOOD_USDG"), {
    fromDecimals: 9,
    toDecimals: 6,
    observedAt: "2026-09-09T12:00:00.000Z",
  });
  assert.equal(quote.provider, "RELAY");
  assert.equal(quote.route, "RELAY_DEPOSIT");
  assert.equal(quote.to.minimumRaw, "102714996");
  assert.equal(quote.to.expectedRaw, "103414936");
  assert.equal(quote.from.amountRaw, "1000000000");
  assert.equal(quote.slippageBps, 50);
  assert.equal(quote.priceImpactBps, -61);
  assert.equal(quote.quoteId, SOLANA_ORIGIN.requestId);

  const withoutMinimum = structuredClone(SOLANA_ORIGIN);
  delete withoutMinimum.details.currencyOut.minimumAmount;
  assert.equal(
    normalizeRelayQuote(withoutMinimum, tuple("SOLANA_SOL_TO_ROBINHOOD_USDG"), { fromDecimals: 9, toDecimals: 6, observedAt: "2026-09-09T12:00:00.000Z" }),
    null,
    "an answer with no signed minimum is refused rather than promoted from the estimate",
  );
});

test("a Relay deadline is labelled as freshness, never as a refund guarantee", () => {
  const quote = normalizeRelayQuote(SOLANA_ORIGIN, tuple("SOLANA_SOL_TO_ROBINHOOD_USDG"), {
    fromDecimals: 9,
    toDecimals: 6,
    observedAt: "2026-09-09T12:00:00.000Z",
  });
  assert.equal(quote.deadlineKind, "QUOTE_VALIDITY");
  assert.equal(quote.deadlineUnix, Math.floor(Date.parse("2026-09-09T12:00:00.000Z") / 1000) + RELAY_QUOTE_VALIDITY_SECONDS);
  /* Relay opens no order account on Solana, so nothing is withheld for rent. */
  assert.equal(quote.fees.rentLamports, null);
});

test("a Solana origin asks for one wallet prompt; an ERC-20 origin asks for two", () => {
  assert.equal(relayApprovalCount(SOLANA_ORIGIN), 0);
  const evmOrigin = {
    ...SOLANA_ORIGIN,
    steps: [
      { id: "approve", kind: "transaction", items: [{ status: "incomplete", data: { from: "0x00", to: "0x5fc5", data: "0x095ea7b3", value: "0", chainId: 4663 } }] },
      { id: "deposit", kind: "transaction", items: [{ status: "incomplete", data: { from: "0x00", to: "0x4cd0", data: "0xdead", value: "0", chainId: 4663 } }] },
    ],
  };
  assert.equal(relayApprovalCount(evmOrigin), 1);
  const quote = normalizeRelayQuote(evmOrigin, tuple("ROBINHOOD_USDG_TO_SOLANA_SOL"), { fromDecimals: 6, toDecimals: 9, observedAt: "2026-09-09T12:00:00.000Z" });
  assert.equal(quote.approvals, 1);
  assert.equal(quote.walletPrompts, 2);
});

test("every provider failure is a value with a code, and a routing refusal is told apart from a bug", async () => {
  const cases = [
    [429, { message: "slow down" }, "RATE_LIMITED"],
    [401, { errorCode: "UNAUTHORIZED_QUOTE", message: "Please provide an api key" }, "UNAUTHORIZED"],
    [400, { errorCode: "NO_SWAP_ROUTES_FOUND", message: "no route" }, "NO_ROUTE"],
    [400, { errorCode: "FST_ERR_VALIDATION", message: "bad field" }, "HTTP_ERROR"],
    [500, { message: "boom" }, "HTTP_ERROR"],
  ];
  const request = {
    fromNetwork: "solana",
    fromToken: "11111111111111111111111111111111",
    toNetwork: "robinhood",
    toToken: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
    amountRaw: "1000000000",
    user: "So11111111111111111111111111111111111111112",
    recipient: "0x000000000000000000000000000000000000dEaD",
  };
  for (const [status, body, code] of cases) {
    const result = await fetchRelayQuote(request, { fetchImpl: respond(status, body) });
    assert.equal(result.ok, false, `${status} should not be ok`);
    assert.equal(result.code, code, `HTTP ${status} ${body.errorCode ?? ""}`);
  }

  const unreadable = await fetchRelayQuote(request, { fetchImpl: respond(200, { steps: [] }) });
  assert.equal(unreadable.ok, false);
  assert.equal(unreadable.code, "UNREADABLE");

  const good = await fetchRelayQuote(request, { fetchImpl: respond(200, SOLANA_ORIGIN), now: () => new Date("2026-09-09T12:00:00.000Z") });
  assert.equal(good.ok, true);
  assert.equal(good.quote.requestId, SOLANA_ORIGIN.requestId);
  assert.equal(good.observedAt, "2026-09-09T12:00:00.000Z");
});

test("a transport failure is reported as one, not as an empty market", async () => {
  const result = await fetchRelayQuote(
    {
      fromNetwork: "solana",
      fromToken: "11111111111111111111111111111111",
      toNetwork: "robinhood",
      toToken: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
      amountRaw: "1000000000",
      user: "So11111111111111111111111111111111111111112",
      recipient: "0x000000000000000000000000000000000000dEaD",
    },
    {
      fetchImpl: async () => {
        throw new Error("connect ECONNREFUSED");
      },
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, "TRANSPORT");
  assert.match(result.provider.message, /ECONNREFUSED/);
});

test("the referrer travels with the key, and never without it", async () => {
  /* Relay refuses a referrer that comes with no valid key (`401
     UNAUTHORIZED_QUOTE`). That is what makes a successful quote proof the key
     works — and what would break every quote on a deployment that has no key,
     which is Production until the founder moves it. So the two are one thing. */
  const seen = [];
  const fetchImpl = async (_url, init) => {
    seen.push(JSON.parse(init.body));
    return { ok: true, status: 200, json: async () => ({ steps: [], fees: {}, details: {} }) };
  };
  const request = {
    fromNetwork: "solana",
    fromToken: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    toNetwork: "base",
    toToken: "0x0000000000000000000000000000000000000000",
    amountRaw: "5000000",
    user: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
    recipient: "0x9fc4e320a181e88644a302d11f1f158ef0699e37",
  };

  await fetchRelayQuote(request, { fetchImpl, apiKey: "a-key" });
  assert.equal(seen.at(-1).referrer, RELAY_REFERRER, "an authenticated quote must be attributable in the Dashboard");

  await fetchRelayQuote(request, { fetchImpl });
  assert.equal("referrer" in seen.at(-1), false, "an anonymous quote must not carry one, or Relay refuses it");

  await fetchRelayQuote(request, { fetchImpl, apiKey: "   " });
  assert.equal("referrer" in seen.at(-1), false, "whitespace is not a key");
});

/* ── FIX-XSWAP-1 (SEC-1 P2): the answer is read back against the question ── */

const OWNER = "2wmVCSfPxGPjrnMMn7rchp4uaeoTqN39mXFC2zhPdri9";
const RECIPIENT = "0x000000000000000000000000000000000000dEaD";
const ASKED = {
  fromNetwork: "solana",
  fromToken: "11111111111111111111111111111111",
  toNetwork: "robinhood",
  toToken: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
  amountRaw: "1000000000",
  user: OWNER,
  recipient: RECIPIENT,
};
const answered = (details = {}, extra = {}) => ({ ...SOLANA_ORIGIN, ...extra, details: { ...SOLANA_ORIGIN.details, sender: OWNER, recipient: RECIPIENT, ...details } });

test("a quote that answers the question asked passes, whatever case Relay writes an EVM address in", () => {
  assert.deepEqual(relayQuoteMatchesRequest(answered(), ASKED), { ok: true });
  assert.deepEqual(relayQuoteMatchesRequest(answered({ recipient: RECIPIENT.toLowerCase() }), ASKED), { ok: true });
});

test("a quote paying out to someone else is refused — on a Solana origin nothing in the signed bytes would show it", () => {
  const result = relayQuoteMatchesRequest(answered({ recipient: "0x1111111111111111111111111111111111111111" }), ASKED);
  assert.equal(result.ok, false);
  assert.equal(result.code, "QUOTE_MISMATCH");
  assert.equal(result.field, "recipient");
});

test("a quote that names no recipient at all is refused rather than assumed", () => {
  const { recipient: _omitted, ...details } = answered().details;
  assert.equal(relayQuoteMatchesRequest({ ...SOLANA_ORIGIN, details }, ASKED).field, "recipient");
});

test("a quote for another token, another network, another sender or a larger amount is refused", () => {
  const out = SOLANA_ORIGIN.details.currencyOut;
  const inn = SOLANA_ORIGIN.details.currencyIn;
  assert.equal(relayQuoteMatchesRequest(answered({ currencyOut: { ...out, currency: { ...out.currency, address: "0x4ed4e862860bed51a9570b96d89af5e1b0efefed" } } }), ASKED).field, "currencyOut");
  assert.equal(relayQuoteMatchesRequest(answered({ currencyOut: { ...out, currency: { ...out.currency, chainId: 8453 } } }), ASKED).field, "currencyOut");
  assert.equal(relayQuoteMatchesRequest(answered({ currencyIn: { ...inn, currency: { ...inn.currency, address: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263" } } }), ASKED).field, "currencyIn");
  assert.equal(relayQuoteMatchesRequest(answered({ currencyIn: { ...inn, amount: "1000000001" } }), ASKED).field, "amount");
  assert.equal(relayQuoteMatchesRequest(answered({ sender: "8ZUczUAUSLDxEqS6DkU8n1LwUr3y9ZcB8iS1xNqgH3Pk" }), ASKED).field, "sender");
});

test("a refund to anyone but the sending wallet is refused", () => {
  const refundTo = (recipient) => ({ protocol: { v2: { orderData: { inputs: [{ refunds: [{ chainId: "solana", recipient }] }] } } } });
  assert.deepEqual(relayQuoteMatchesRequest(answered({}, refundTo(OWNER)), ASKED), { ok: true });
  assert.equal(relayQuoteMatchesRequest(answered({}, refundTo("8ZUczUAUSLDxEqS6DkU8n1LwUr3y9ZcB8iS1xNqgH3Pk")), ASKED).field, "refund");
});
