// Run from repo root: node --test app/api/agents/procurement/route.test.mjs
//
// The buying side. The two answers that matter are the dull one — this URL is
// nobody's registered resource — and the fail-closed one: nothing read a
// mandate, so a person signs.
import { test } from "node:test";
import assert from "node:assert/strict";

import { createProcurementHandler } from "./handler.ts";
import { AGENT_PROCUREMENT_CAPS } from "../../../../lib/agent-control/procurement/hub.ts";
import { splAssetRef } from "../../../../lib/agent-control/procurement/protocol.ts";
import {
  DEVNET,
  FIXTURE,
  USDC_DEVNET,
  fixtureSellerEnv,
  smartAccountLimit,
} from "../../../../lib/agent-control/procurement/fixtures.ts";

const ENDPOINT = "https://ryntra.io/api/agents/procurement";
const NOW = new Date("2026-10-26T12:00:00.000Z");

function body(overrides = {}) {
  return {
    resourceUrl: "https://ryntra.io/api/agents/services/token-report?mint=abc",
    scheme: "exact",
    facilitator: "COINBASE_CDP",
    network: DEVNET,
    assetRef: splAssetRef(DEVNET, USDC_DEVNET),
    mint: USDC_DEVNET,
    payTo: FIXTURE.payTo,
    quotedBaseUnits: "50000",
    capBaseUnits: null,
    maxTimeoutSeconds: 30,
    nonce: "procurement-nonce-0001",
    quoteIssuedAt: "2026-10-26T11:59:59.000Z",
    spender: FIXTURE.agent,
    ...overrides,
  };
}

function post(payload, { env = fixtureSellerEnv(), mandateReader } = {}) {
  const handle = createProcurementHandler({
    env,
    now: () => NOW,
    mandateReader: () => mandateReader ?? null,
  });
  return handle(
    new Request(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

test("a body that is not one x402 quote is a validation error", async () => {
  const response = await post({ resourceUrl: "https://ryntra.io/x" });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "VALIDATION_ERROR");
});

test("an arbitrary URL is refused at the provider stage", async () => {
  const response = await post(body({ resourceUrl: "https://pay-me-now.test/v1/anything" }));
  const { data } = await response.json();
  assert.equal(data.allowed, false);
  assert.equal(data.stage, "PROVIDER");
  assert.equal(data.reasonCode, "PROVIDER_NOT_REGISTERED");
});

test("with nothing configured the hub's registry is empty and pays nobody", async () => {
  const response = await post(body(), { env: {} });
  const { data } = await response.json();
  assert.equal(data.allowed, false);
  assert.equal(data.reasonCode, "PROVIDER_NOT_REGISTERED");
  assert.equal(data.registry.providers, 0);
});

test("Ryntra's own service is registered once the owner sets the four values", async () => {
  // GATE-PROVED: everything up to the mandate passes, which is what makes the
  // next test's answer meaningful.
  const response = await post(body());
  const { data } = await response.json();
  assert.equal(data.registry.providers, 1);
  assert.equal(data.stage, "MANDATE", JSON.stringify(data));
});

test("nothing reads a mandate, so the answer is that a person signs", async () => {
  const response = await post(body());
  const { data } = await response.json();
  assert.equal(data.allowed, false);
  assert.equal(data.stage, "MANDATE");
  assert.equal(data.reasonCode, "MANDATE_READ_UNKNOWN");
  assert.equal(data.mandateRead, false);
  assert.match(data.detail, /a person signs/);
});

test("with a mandate the program bounds, the agent is authorized alone", async () => {
  const reader = {
    read: async () => smartAccountLimit({ network: DEVNET, mint: USDC_DEVNET }, NOW.getTime()),
  };
  const response = await post(body(), { mandateReader: reader });
  const { data } = await response.json();
  assert.equal(data.allowed, true, JSON.stringify(data));
  assert.equal(data.authorization, "AGENT_ALONE");
  assert.equal(data.enforcement, "PROGRAM_ENFORCED");
  assert.equal(data.provider.id, "ryntra");
  assert.equal(data.amountBaseUnits, "50000");
  assert.ok(data.limitations.some((line) => /not a payment/i.test(line)));
});

test("a quote above the registered price is refused before any mandate is read", async () => {
  // The registered price is a bound rather than a suggestion: a seller asking
  // for more than it registered is refused at the price, whatever its mandate.
  const reader = { read: async () => smartAccountLimit({ network: DEVNET, mint: USDC_DEVNET }, NOW.getTime()) };
  const refused = await post(body({ quotedBaseUnits: "50001" }), { mandateReader: reader });
  const { data } = await refused.json();
  assert.equal(data.allowed, false);
  assert.equal(data.stage, "PRICE");
  assert.equal(data.reasonCode, "QUOTE_ABOVE_REGISTERED_PRICE");
});

test("above the agent's own bound the purchase is allowed and a person confirms it", async () => {
  // The Ledger Agent Intent model, at the route: the mandate is sound, the
  // action is simply larger than what the agent was handed.
  const over = String(BigInt(AGENT_PROCUREMENT_CAPS.agentBoundBaseUnits) + 1n);
  const reader = {
    read: async () =>
      smartAccountLimit(
        { network: DEVNET, mint: USDC_DEVNET, availableBaseUnits: AGENT_PROCUREMENT_CAPS.perCallBaseUnits },
        NOW.getTime(),
      ),
  };
  const response = await post(body({ quotedBaseUnits: over }), {
    env: fixtureSellerEnv({ RYNTRA_X402_PRICE_USDC_BASE_UNITS: over }),
    mandateReader: reader,
  });
  const { data } = await response.json();
  assert.equal(data.allowed, true, JSON.stringify(data));
  assert.equal(data.authorization, "HUMAN_CONFIRMATION");
  assert.equal(data.enforcement, "PROGRAM_ENFORCED");
});

test("a quote the owner's policy does not allow is refused at the route", async () => {
  const reader = { read: async () => smartAccountLimit({ network: DEVNET, mint: USDC_DEVNET }, NOW.getTime()) };
  const response = await post(body({ facilitator: "PAYAI" }), { mandateReader: reader });
  const { data } = await response.json();
  assert.equal(data.stage, "ROUTE");
  assert.equal(data.reasonCode, "FACILITATOR_NOT_ALLOWED_BY_POLICY");
});

test("the day's spend is counted from what the caller states", async () => {
  const reader = { read: async () => smartAccountLimit({ network: DEVNET, mint: USDC_DEVNET }, NOW.getTime()) };
  const response = await post(
    body({ spentTodayBaseUnits: AGENT_PROCUREMENT_CAPS.dailyBaseUnits }),
    { mandateReader: reader },
  );
  const { data } = await response.json();
  assert.equal(data.stage, "PRICE");
  assert.equal(data.reasonCode, "DAY_WOULD_EXCEED_CEILING");
});

test("nothing in a decision is a signature, a key or a payment", async () => {
  const reader = { read: async () => smartAccountLimit({ network: DEVNET, mint: USDC_DEVNET }, NOW.getTime()) };
  const response = await post(body(), { mandateReader: reader });
  const text = (await response.text()).toLowerCase();
  for (const word of ["signature", "privatekey", "secret", "payment-signature"]) {
    assert.equal(text.includes(word), false, word);
  }
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
});
