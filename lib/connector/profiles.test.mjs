import assert from "node:assert/strict";
import test from "node:test";

import { CONNECTOR_CATALOG_MCP_PATH, CONNECTOR_MCP_PATH, connectorProtectedResourceMetadata, isConnectorResource } from "./metadata.ts";
import { CATALOG_ROUTES, CATALOG_TOOL_NAMES, CONNECTOR_PROFILES, carriesSigningLink, profileTool, routesOf } from "./profiles.ts";
import { CONNECTOR_TOOLS, ENGINE_ROUTES, connectorTool, runConnectorTool } from "./tools.ts";

/**
 * The catalog's profile (CITY-170): the tools a connector directory lists — reads only, no tool that prepares anything
 * to sign, no link to sign, no Launch — and the three tools it was built around: a token's passport, a coin's tower,
 * the check before signing.
 */

const ORIGIN = "https://ryntra.io";
const MINT = "So11111111111111111111111111111111111111112";
const NOW = Date.parse("2026-10-31T12:00:00.000Z");
const catalog = CONNECTOR_PROFILES.catalog;
const full = CONNECTOR_PROFILES.full;

test("the catalog is an allowlist: exactly its named tools, each a tool of the full connector", () => {
  assert.deepEqual(catalog.tools.map((tool) => tool.name), [...CATALOG_TOOL_NAMES]);
  assert.equal(new Set(CATALOG_TOOL_NAMES).size, CATALOG_TOOL_NAMES.length);
  for (const tool of catalog.tools) assert.equal(profileTool(full, tool.name), tool, tool.name);
  assert.deepEqual(full.tools, CONNECTOR_TOOLS, "the full connector keeps every tool");
  assert.equal(catalog.path, CONNECTOR_CATALOG_MCP_PATH);
  assert.equal(full.path, CONNECTOR_MCP_PATH);
  assert.equal(catalog.refuseSigningLinks, true);
});

test("the catalog reads only routes that read, and none of Launch, intents, swaps or transfers", () => {
  for (const route of CATALOG_ROUTES) assert.doesNotMatch(ENGINE_ROUTES[route], /launch|intent|swap|transfer|order|prepare|pay\/requests/, route);
  for (const tool of catalog.tools) {
    for (const route of routesOf(tool)) assert.ok(CATALOG_ROUTES.has(route), `${tool.name} reads ${route}`);
  }
  for (const name of ["list_launches", "get_launch", "get_launch_health", "get_launch_survival"]) assert.equal(profileTool(catalog, name), null, name);
});

test("the catalog's tools pass the directory's rules: a title, a short name, read-only words, nothing to sign", () => {
  for (const tool of catalog.tools) {
    assert.ok(tool.title.length > 0 && tool.title.length <= 64, tool.name);
    assert.ok(tool.name.length <= 64 && /^[a-z_]+$/.test(tool.name), tool.name);
    assert.equal(tool.scope, "market:read");
    assert.doesNotMatch(tool.name, /launch|prepare|intent|send|transfer|swap|trade|sign|execute|buy|sell|order/, tool.name);
    assert.doesNotMatch(tool.description, /ignore|always call|you must|system prompt/i, tool.name);
    assert.doesNotMatch(tool.description, /\bprepares? (?:a|the|an) |confirmation link|approve link|link to sign/i, tool.name);
  }
  assert.match(catalog.instructions, /only reads/);
  assert.match(catalog.instructions, /prepares and signs no transaction/);
  assert.doesNotMatch(catalog.instructions, /Launch/);
});

test("a link to sign is recognised on Ryntra's hosts and this deployment's, nowhere else", () => {
  for (const text of [
    "https://ryntra.io/i/int_0123456789",
    "open https://www.ryntra.io/i/abc",
    "https://ryntra.io/api/v1/intents/int_1/qr",
    "https://preview-ryntra.vercel.app/i/int_9",
  ]) {
    assert.equal(carriesSigningLink(text, "https://preview-ryntra.vercel.app"), true, text);
  }
  for (const text of [
    "https://cdn.example.com/i/abcdef.png",
    `https://ryntra.io/c/${MINT}`,
    "https://ryntra.io/connector",
    "https://ryntra.io/iris",
    "solana:So11111111111111111111111111111111111111112",
  ]) {
    assert.equal(carriesSigningLink(text, ORIGIN), false, text);
  }
});

test("the catalog's address is its own resource, documented on the city's page", () => {
  assert.equal(isConnectorResource(ORIGIN, `${ORIGIN}/mcp/read`), true);
  assert.equal(isConnectorResource(ORIGIN, `${ORIGIN}/mcp`), true);
  assert.equal(isConnectorResource(ORIGIN, `${ORIGIN}/mcp/write`), false);
  assert.equal(isConnectorResource(ORIGIN, "https://evil.example/mcp/read"), false);
  const prm = connectorProtectedResourceMetadata(ORIGIN, CONNECTOR_CATALOG_MCP_PATH);
  assert.equal(prm.resource, `${ORIGIN}/mcp/read`);
  assert.deepEqual(prm.scopes_supported, ["market:read"]);
  assert.equal(prm.resource_documentation, `${ORIGIN}/connector`);
});

const city = {
  fetchedAt: "2026-10-31T11:59:00.000Z",
  source: "live",
  towers: [
    { id: "A".repeat(43), symbol: "AAA", name: "A", icon: "https://x/a.png", district: "core", price: 1, mcap: 10, liquidity: 5, holders: 3, change5m: 0, change1h: 0, change24h: 3, volume24h: 100, traders1h: 1, organic: 50, verified: true, launchedAt: null },
    { id: MINT, symbol: "SOL", name: "Wrapped SOL", icon: "https://x/sol.png", district: "core", price: 150, mcap: 9e10, liquidity: 1e9, holders: 0, change5m: 0, change1h: 0, change24h: 1, volume24h: 900, traders1h: 2, organic: 90, verified: true, launchedAt: null, unread: ["holders"] },
    { id: "B".repeat(43), symbol: "BBB", name: "B", icon: null, district: "docks", price: 2, mcap: 20, liquidity: 6, holders: 9, change5m: 0, change1h: 0, change24h: 1, volume24h: 1_000, traders1h: 2, organic: 40, verified: false, launchedAt: null },
  ],
};

test("get_tower: where a coin stands, its ranks and the address that opens the city on it", async () => {
  const tool = connectorTool("get_tower");
  const outcome = await runConnectorTool(tool, { mint: MINT }, { read: async (route) => (assert.equal(route, "city"), { status: 200, body: city }), origin: ORIGIN, nowMs: () => NOW });
  assert.equal(outcome.isError, false);
  const data = outcome.envelope.data;
  assert.equal(data.standing, true);
  assert.equal(data.tower.mint, MINT);
  assert.equal(data.tower.district, "core");
  assert.equal(data.tower.holders, null, "not measured is null, never zero");
  assert.equal("icon" in data.tower, false);
  assert.equal(data.rankInCity, 2);
  assert.equal(data.rankInDistrict, 1);
  assert.equal(data.towersInDistrict, 2);
  assert.equal(data.cityUrl, `${ORIGIN}/c/${MINT}`);
  assert.equal(outcome.envelope.observedAt, "2026-10-31T11:59:00.000Z");

  const absent = await runConnectorTool(tool, { mint: "C".repeat(43) }, { read: async () => ({ status: 200, body: city }), origin: ORIGIN });
  assert.equal(absent.isError, false, "a coin without a tower is an answer, not a failure");
  assert.equal(absent.envelope.data.standing, false);
  assert.equal(absent.envelope.data.tower, null);
  assert.equal(absent.envelope.data.cityUrl, `${ORIGIN}/c/${"C".repeat(43)}`);
});

test("get_token_passport: overview, risk and the city read at once; a part that failed is named in its slot", async () => {
  const tool = connectorTool("get_token_passport");
  const calls = [];
  const read = async (route, input) => {
    calls.push(`${route}:${input.query?.part ?? ""}`);
    if (route === "city") return { status: 200, body: city };
    if (input.query.part === "overview") return { status: 200, body: { observedAt: "2026-10-31T11:58:00.000Z", symbol: "SOL", price: 150 } };
    return { status: 503, body: { error: { code: "TOKEN_UNREACHABLE", message: "The risk source did not answer." } } };
  };
  const outcome = await runConnectorTool(tool, { mint: MINT }, { read, origin: ORIGIN, nowMs: () => NOW });
  assert.equal(outcome.isError, false);
  assert.deepEqual(calls.sort(), ["city:", "spot.token:overview", "spot.token:risk"]);
  const data = outcome.envelope.data;
  assert.equal(data.mint, MINT);
  assert.equal(data.overview.symbol, "SOL");
  assert.deepEqual(data.risk, { error: { code: "TOKEN_UNREACHABLE", message: "The risk source did not answer.", status: 503 } });
  assert.equal(data.city.standing, true);
  assert.equal(data.city.cityUrl, `${ORIGIN}/c/${MINT}`);
  assert.equal(outcome.envelope.observedAt, "2026-10-31T11:58:00.000Z");
  assert.equal(outcome.envelope.source.route, "GET /api/spot/token");
  assert.deepEqual(outcome.envelope.source.also.map((also) => also.route), ["GET /api/spot/token", "GET /api/city"]);
  assert.equal(outcome.envelope.source.also[0].url, `${ORIGIN}/api/spot/token?mint=${MINT}&part=risk`);

  const down = await runConnectorTool(tool, { mint: MINT }, { read: async () => ({ status: 503, body: { error: { code: "TOKEN_UNREACHABLE", message: "x" } } }), origin: ORIGIN });
  assert.equal(down.isError, true, "the overview decides whether the passport answered");
  assert.equal(down.envelope.error.code, "TOKEN_UNREACHABLE");
});

test("check_transaction: one POST to the pre-sign check on mainnet, the intent as one line, nothing else accepted", async () => {
  const tool = connectorTool("check_transaction");
  let sent = null;
  const read = async (route, input) => {
    sent = { route, input };
    return { status: 200, body: { schema: "ryntra.ward.check", verdict: "block", line: "It hands your token account to another wallet.", reasons: [{ code: "AUTHORITY_CHANGE" }], checkedAt: "2026-10-31T11:59:59.000Z" } };
  };
  const outcome = await runConnectorTool(tool, { transaction: "AQID", signer: MINT, intent: "send 1 SOL", known: [MINT] }, { read, origin: ORIGIN, nowMs: () => NOW });
  assert.equal(outcome.isError, false);
  assert.equal(sent.route, "ward.check");
  assert.deepEqual(sent.input.body, { transaction: "AQID", signer: MINT, intentText: "send 1 SOL", known: [MINT], network: "mainnet" });
  assert.equal(outcome.envelope.source.route, "POST /api/v1/ward/check");
  assert.equal(outcome.envelope.source.url, `${ORIGIN}/api/v1/ward/check`, "the bytes are never put in an address");
  assert.equal(outcome.envelope.observedAt, "2026-10-31T11:59:59.000Z");
  assert.equal(outcome.envelope.data.verdict, "block");

  const refused = await runConnectorTool(tool, { transaction: "AQID", network: "devnet" }, { read: async () => assert.fail("never read"), origin: ORIGIN });
  assert.equal(refused.reasonCode, "VALIDATION_ERROR");
  const both = await runConnectorTool(tool, { transaction: "AQID", link: MINT }, {
    read: async () => ({ status: 400, body: { error: { code: "VALIDATION_ERROR", message: "Send a transaction or a link — exactly one." } } }),
    origin: ORIGIN,
  });
  assert.equal(both.isError, true);
  assert.equal(both.envelope.error.code, "VALIDATION_ERROR", "the route's own refusal, by name");
});
