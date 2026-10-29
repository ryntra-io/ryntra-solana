// Run from repo root: node --test app/api/agents/services/route.test.mjs
//
// The catalogue, and the two things it must never get wrong: it must not price
// a service the owner has not priced, and it must not read as if a material
// risk fact were behind the payment.
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildServicesCatalogue, createServicesCatalogueHandler } from "./handler.ts";
import { FREE_RISK_FACT_IDS, SELLER_ENV } from "../../../../lib/agent-control/procurement/seller.ts";
import { fixtureSellerEnv } from "../../../../lib/agent-control/procurement/fixtures.ts";

test("with nothing set the one service carries no price and every blocker", () => {
  const catalogue = buildServicesCatalogue({});
  assert.equal(catalogue.services.length, 1);
  const [service] = catalogue.services;
  assert.equal(service.serviceId, "token-deep-report");
  assert.equal(service.sellable, false);
  assert.equal(service.price, null, "a price nobody set was printed anyway");
  const codes = service.blockers.map((blocker) => blocker.code);
  assert.ok(codes.includes("PRICE_NOT_SET_BY_OWNER"));
  assert.ok(codes.includes("DELIVERABLE_NOT_BUILT"));
});

test("once the owner sets the four values the price is shown and the deliverable still blocks", () => {
  const catalogue = buildServicesCatalogue(fixtureSellerEnv());
  const [service] = catalogue.services;
  assert.equal(service.sellable, false);
  assert.equal(service.price.baseUnits, "50000");
  assert.equal(service.price.assetSymbol, "USDC");
  assert.deepEqual(
    service.blockers.map((blocker) => blocker.code),
    ["DELIVERABLE_NOT_BUILT"],
  );
});

test("the protocol facts are complete enough to pay without guessing", () => {
  const { protocol } = buildServicesCatalogue({});
  assert.equal(protocol.version, 2);
  assert.equal(protocol.soldUnder, "exact");
  assert.equal(protocol.headers.requirements, "PAYMENT-REQUIRED");
  assert.equal(protocol.headers.authorization, "PAYMENT-SIGNATURE");
  assert.equal(protocol.headers.response, "PAYMENT-RESPONSE");
  assert.equal(protocol.refusedHeader.name, "X-PAYMENT");
  assert.equal(protocol.networks.mainnet, "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp");
  assert.equal(protocol.networks.devnet, "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1");
  assert.deepEqual(
    protocol.clientPackages.map((entry) => entry.name),
    ["@x402/core", "@x402/svm", "@x402/fetch"],
  );
  assert.equal(protocol.facilitators.length, 2);
  assert.equal(protocol.ownFacilitator, false);
  for (const facilitator of protocol.facilitators) {
    assert.equal(facilitator.ryntraCredential, "NONE");
  }
});

test("the free facts are listed, and the catalogue says they stay free", () => {
  const { free } = buildServicesCatalogue({});
  assert.deepEqual(
    free.facts.map((fact) => fact.id),
    [...FREE_RISK_FACT_IDS],
  );
  assert.match(free.note, /free and stays free/);
  assert.ok(free.neverMonetised.some((line) => /Hiding a material risk fact/.test(line)));
});

test("the catalogue is a read: it never stores anything and is never cached", async () => {
  const response = createServicesCatalogueHandler({ env: fixtureSellerEnv() })();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  const body = await response.json();
  assert.equal(body.data.services.length, 1);
  // No environment name in this catalogue is a credential: the facilitator's
  // key belongs to a client this repository does not hold.
  assert.equal(
    Object.values(SELLER_ENV).some((name) => /KEY|SECRET|TOKEN/.test(name)),
    false,
  );
  assert.equal(JSON.stringify(body).toLowerCase().includes("secret"), false);
});
