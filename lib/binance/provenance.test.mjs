// Run from repo root: node --test lib/binance/provenance.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  observe,
  observationFreshness,
  provenanceLabel,
  assertProvenanceHonest,
  MCP_TRANSPORT,
  REST_TRANSPORT,
} from "./provenance.ts";

const market = JSON.parse(readFileSync(new URL("./fixtures/market-data.json", import.meta.url), "utf8"));

const AT = Date.parse(market.capturedAt);

test("an observation carries its transport, endpoint, auth state and both timestamps", () => {
  const obs = observe({
    value: market.ticker.body,
    transport: REST_TRANSPORT,
    endpoint: market.ticker.endpoint,
    authenticated: false,
    observedAt: AT,
    venueTimestamp: market.ticker.body.closeTime,
  });

  assert.equal(obs.provenance.transport, "rest");
  assert.equal(obs.provenance.endpoint, market.ticker.endpoint);
  assert.equal(obs.provenance.authenticated, false);
  assert.equal(obs.observedAt, AT);
  assert.equal(obs.venueTimestamp, market.ticker.body.closeTime);
});

/**
 * The freshness of a venue quote is the age of the VENUE's own timestamp, not the age of our
 * request. Using the request time would report a five-minute-old book as fresh simply because
 * we asked for it recently.
 */
test("freshness is measured from the venue timestamp when the venue supplies one", () => {
  const venueStamp = AT - 60_000;
  const obs = observe({
    value: {},
    transport: REST_TRANSPORT,
    endpoint: "GET /api/v3/depth",
    authenticated: false,
    observedAt: AT, // we fetched it just now …
    venueTimestamp: venueStamp, // … but the venue stamped it a minute ago
  });

  assert.equal(observationFreshness(obs, AT, 30_000), "stale");
  assert.equal(observationFreshness(obs, AT, 120_000), "fresh");
});

test("with no venue timestamp freshness falls back to our own receipt time", () => {
  const obs = observe({
    value: {},
    transport: REST_TRANSPORT,
    endpoint: "GET /api/v3/depth",
    authenticated: false,
    observedAt: AT - 10_000,
    venueTimestamp: null,
  });

  assert.equal(observationFreshness(obs, AT, 30_000), "fresh");
  assert.equal(observationFreshness(obs, AT, 5_000), "stale");
});

test("an unmeasured observation is unknown, never fresh", () => {
  const obs = observe({
    value: {},
    transport: REST_TRANSPORT,
    endpoint: "GET /api/v3/depth",
    authenticated: false,
    observedAt: null,
    venueTimestamp: null,
  });

  assert.equal(observationFreshness(obs, AT, 30_000), "unknown");
});

/**
 * This is the honesty gate for this whole packet. Every market-data payload in the fixture came
 * from the public REST API, not from an MCP tool call, because `tools/list` is OAuth-gated.
 * Labelling any of it as MCP-obtained would be a fabricated integration claim.
 */
test("a REST observation may not be labelled as MCP-obtained", () => {
  const rest = observe({
    value: market.ticker.body,
    transport: REST_TRANSPORT,
    endpoint: market.ticker.endpoint,
    authenticated: false,
    observedAt: AT,
    venueTimestamp: null,
  });

  assert.match(provenanceLabel(rest), /REST/);
  assert.ok(!/MCP/i.test(provenanceLabel(rest)), "a REST observation must not mention MCP");
  assert.doesNotThrow(() => assertProvenanceHonest(rest, { mcpToolCallsPerformed: 0 }));
});

test("claiming an MCP observation while no MCP tool call was performed throws", () => {
  const pretend = observe({
    value: market.ticker.body,
    transport: MCP_TRANSPORT,
    endpoint: "tools/call get_spot_ticker24hr",
    authenticated: true,
    observedAt: AT,
    venueTimestamp: null,
  });

  assert.throws(
    () => assertProvenanceHonest(pretend, { mcpToolCallsPerformed: 0 }),
    /no MCP tool call/i,
  );
});

test("every stored market-data fixture records the endpoint it actually came from", () => {
  for (const key of ["ticker", "orderBook", "candles", "funding", "fundingHistory", "serverTime"]) {
    const entry = market[key];
    assert.ok(entry, `fixture is missing ${key}`);
    assert.match(entry.endpoint, /^GET https:\/\/(api|fapi)\.binance\.com\//);
    assert.equal(entry.httpStatus, 200);
  }
});

/**
 * Binance's own MARKET_DATA endpoints for the Stocks surface still require an API key. The
 * fixture records the rejection rather than a value, because "we could not read it" is a
 * finding and an empty object would read as "there is nothing there".
 */
test("the equity market-data rejection is stored as a rejection, not as empty data", () => {
  assert.equal(market.equityMarketDataUnauthenticated.httpStatus, 400);
  assert.equal(market.equityMarketDataUnauthenticated.body.code, -2014);
});
