import { test } from "node:test";
import assert from "node:assert/strict";

import {
  FORBIDDEN_ROBINHOOD_SURFACE_CLAIMS,
  ROBINHOOD_SURFACE_CUSTODY,
  ROBINHOOD_TRADING_MCP_AGENTIC_ACCOUNT,
  assertClaimAllowed,
} from "./custody.ts";

test("the Agentic account is provider custody authorized natively by the provider", function () {
  const surface = ROBINHOOD_TRADING_MCP_AGENTIC_ACCOUNT;
  assert.equal(surface.custodyModel, "PROVIDER_CUSTODY");
  assert.equal(surface.authorizationSurface, "PROVIDER_NATIVE");
  assert.equal(surface.providerBoundary, "DEDICATED_AGENTIC_ACCOUNT");
  assert.equal(surface.withdrawalCapability, "UNAVAILABLE_TO_AGENT");
  assert.ok(surface.evidence.length >= 2);
});

test("PROVIDER_NATIVE is not PROVIDER_CONFIRMATION, and the provider's own sentence is why", function () {
  /* Binance's Agentic sub-account authorizes each action by a human confirming
     it inside the client. Robinhood's own overview says the opposite is
     available: "if you've asked your agent to take action without asking your
     approval, it can place trades without your confirmation." So what authorizes
     an order here is the OAuth grant made once at connection time, not a
     per-order human act — and recording it as PROVIDER_CONFIRMATION would
     describe a control that the customer can switch off. */
  assert.notEqual(ROBINHOOD_TRADING_MCP_AGENTIC_ACCOUNT.authorizationSurface, "PROVIDER_CONFIRMATION");
  assert.match(
    ROBINHOOD_TRADING_MCP_AGENTIC_ACCOUNT.note,
    /without your confirmation|without asking your approval/,
  );
  assert.equal(ROBINHOOD_TRADING_MCP_AGENTIC_ACCOUNT.perOrderHumanApproval, "OPTIONAL_CLIENT_SIDE");
});

test("the blast radius is the funded balance, and funding is a human act", function () {
  const surface = ROBINHOOD_TRADING_MCP_AGENTIC_ACCOUNT;
  assert.equal(surface.agentFundingCapability, "UNAVAILABLE_TO_AGENT");
  assert.equal(surface.readScope, "ALL_ROBINHOOD_ACCOUNTS");
  assert.equal(surface.writeScope, "AGENTIC_ACCOUNT_ONLY");
  /* The read and write boundaries are deliberately different values. Collapsing
     them into one "scope" is how a reader concludes that an agent which can only
     trade one account can also only see one account. */
  assert.notEqual(surface.readScope, surface.writeScope);
});

test("self-custody copy is refused on a provider-custody surface", function () {
  for (const claim of FORBIDDEN_ROBINHOOD_SURFACE_CLAIMS) {
    assert.throws(
      function () { assertClaimAllowed(ROBINHOOD_TRADING_MCP_AGENTIC_ACCOUNT, claim); },
      /provider custody/,
      claim,
    );
  }
  assert.doesNotThrow(function () {
    assertClaimAllowed(
      ROBINHOOD_TRADING_MCP_AGENTIC_ACCOUNT,
      "Robinhood holds the assets in a dedicated Agentic account you fund yourself.",
    );
  });
});

test("both Robinhood surfaces are recorded together so the per-provider flag cannot come back", function () {
  assert.ok(ROBINHOOD_SURFACE_CUSTODY.length >= 2);
  const ids = ROBINHOOD_SURFACE_CUSTODY.map(function (s) { return s.id; });
  assert.ok(ids.includes("ROBINHOOD_TRADING_MCP_AGENTIC_ACCOUNT"));
  assert.ok(ids.includes("ROBINHOOD_CHAIN_STOCK_TOKEN"));
  const models = new Set(ROBINHOOD_SURFACE_CUSTODY.map(function (s) { return s.custodyModel; }));
  /* Robinhood operates a custodial brokerage and a self-custody token at the
     same time. "Robinhood is custodial" is false about one of them. */
  assert.equal(models.size, 2);
});

test("every surface names the exact source of every axis", function () {
  for (const surface of ROBINHOOD_SURFACE_CUSTODY) {
    assert.ok(surface.note.length > 80, surface.id + " must explain its axes");
    assert.ok(surface.evidence.length >= 1, surface.id + " must carry evidence");
    for (const reference of surface.evidence) {
      assert.match(reference, /^(docs|fixture|repo):/, surface.id + " evidence must name its kind");
    }
  }
});
