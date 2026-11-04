import assert from "node:assert/strict";
import test from "node:test";

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

import { readConnectorReceipts } from "../../lib/connector/ledger.ts";
import { serveConnectorMcp } from "../../lib/connector/endpoint.ts";
import { CATALOG_TOOL_NAMES, CONNECTOR_PROFILES } from "../../lib/connector/profiles.ts";
import { pkce, testWallet } from "../../lib/connector/test-wallet.mjs";
import { getGuardRuntime } from "../../lib/guard/runtime.ts";
import { GET as asMetadataRoute } from "../.well-known/oauth-authorization-server/route.ts";
import { GET as prmRoute } from "../.well-known/oauth-protected-resource/mcp/route.ts";
import { GET as catalogPrmRoute } from "../.well-known/oauth-protected-resource/mcp/read/route.ts";
import { POST as approveRoute } from "../api/connect/approve/route.ts";
import { POST as challengeRoute } from "../api/connect/challenge/route.ts";
import { POST as registerRoute } from "../api/connect/register/route.ts";
import { POST as revokeRoute } from "../api/connect/revoke/route.ts";
import { POST as tokenRoute } from "../api/connect/token/route.ts";

/**
 * The connector exercised the way a chat reaches it (CITY-154): a real `@modelcontextprotocol/client` over the real
 * Streamable HTTP transport, the real OAuth routes and the real consent signature by an Ed25519 wallet, routed
 * in-process. Only the engine is a stand-in — the tools' routes answer from a fixture, so the test proves the
 * connector, not the market. The browser half (the consent page with a wallet extension) is proved separately on a
 * running stand with MCP Inspector (`docs/connector/CONNECT.md`).
 */

const ORIGIN = "https://ryntra.io";
const MCP_URL = `${ORIGIN}/mcp`;
const CATALOG_URL = `${ORIGIN}/mcp/read`;
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const MINT = "So11111111111111111111111111111111111111112";
/* A stand-in route that answers with a link to sign: no route the catalog reads can, but the guard is proved anyway. */
const LINKED_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const engineCalls = [];
const fakeEngine = (wallet) => async (route, input) => {
  engineCalls.push({ wallet, route, input });
  if (route === "launch.health") return { status: 200, body: { observedAt: "2026-10-31T11:59:30.000Z", sources: ["Meteora"], mint: input.params.mint, signals: [{ kind: "LIQUIDITY", state: "OK" }] } };
  if (route === "launch.market") return { status: 404, body: { error: { code: "LAUNCH_NOT_FOUND", message: "No Ryntra launch of this token here." } } };
  if (route === "spot.token" && input.query?.mint === LINKED_MINT) return { status: 200, body: { observedAt: "2026-10-31T11:59:00.000Z", next: `${ORIGIN}/i/int_0123456789abcdef` } };
  if (route === "ward.check") return { status: 200, body: { schema: "ryntra.ward.check", verdict: "warn", line: "Look before you sign.", reasons: [], checkedAt: "2026-10-31T11:59:45.000Z" } };
  return { status: 200, body: { observedAt: "2026-10-31T11:59:00.000Z", rows: [] } };
};

let callerSeq = 0;
function route(url, init = {}) {
  const headers = new Headers(init.headers ?? {});
  headers.set("x-forwarded-for", `10.9.${Math.floor(callerSeq / 250)}.${callerSeq % 250}`);
  const request = new Request(url, { ...init, headers });
  const path = new URL(url).pathname;
  if (path === "/mcp") return serveConnectorMcp(request, { store: getGuardRuntime().store, readFor: fakeEngine });
  if (path === "/mcp/read") return serveConnectorMcp(request, { profile: CONNECTOR_PROFILES.catalog, store: getGuardRuntime().store, readFor: fakeEngine });
  if (path === "/.well-known/oauth-protected-resource/mcp/read") return catalogPrmRoute(request);
  if (path === "/.well-known/oauth-authorization-server") return asMetadataRoute(request);
  if (path === "/.well-known/oauth-protected-resource/mcp") return prmRoute(request);
  if (path === "/api/connect/register") return registerRoute(request);
  if (path === "/api/connect/challenge") return challengeRoute(request);
  if (path === "/api/connect/approve") return approveRoute(request);
  if (path === "/api/connect/token") return tokenRoute(request);
  if (path === "/api/connect/revoke") return revokeRoute(request);
  throw new Error(`no route for ${path}`);
}

const targetUrl = (input) => (typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
const routedFetch = (input, init) =>
  route(targetUrl(input), init ?? (input instanceof Request ? { method: input.method, headers: Object.fromEntries(input.headers), body: input.body } : {}));

/** The whole dance through the routes: discovery, registration, the wallet's consent, the token exchange. */
async function connect(wallet = testWallet(), serverUrl = MCP_URL) {
  callerSeq += 1;
  const unauthenticated = await route(serverUrl, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: "{}" });
  assert.equal(unauthenticated.status, 401);
  const challenge = unauthenticated.headers.get("www-authenticate");
  const metadataUrl = `${ORIGIN}/.well-known/oauth-protected-resource${new URL(serverUrl).pathname}`;
  assert.ok(challenge.includes(`resource_metadata="${metadataUrl}"`), challenge);
  assert.doesNotMatch(challenge, /error=/, "no credential, no error code (RFC 6750 §3)");

  const prm = await (await route(metadataUrl)).json();
  assert.equal(prm.resource, serverUrl);
  const resource = serverUrl;
  const asm = await (await route(`${ORIGIN}/.well-known/oauth-authorization-server`)).json();
  assert.equal(asm.authorization_endpoint, `${ORIGIN}/connect`);

  const registered = await route(asm.registration_endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "Chat", redirect_uris: [REDIRECT] }) });
  assert.equal(registered.status, 201);
  const { client_id } = await registered.json();

  const { verifier, challenge: codeChallenge } = pkce();
  const request = { response_type: "code", client_id, redirect_uri: REDIRECT, scope: "market:read", state: "st-42", code_challenge: codeChallenge, code_challenge_method: "S256", resource };
  const issued = await route(`${ORIGIN}/api/connect/challenge`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body: JSON.stringify({ address: wallet.address, request }) });
  assert.equal(issued.status, 200, await issued.clone().text());
  const { nonce, message } = await issued.json();
  const bytes = new TextEncoder().encode(message);
  const approved = await route(`${ORIGIN}/api/connect/approve`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({ nonce, address: wallet.address, signedMessage: Buffer.from(bytes).toString("base64"), signature: Buffer.from(wallet.sign(bytes)).toString("base64") }),
  });
  assert.equal(approved.status, 200, await approved.clone().text());
  const back = new URL((await approved.json()).redirect);
  assert.equal(back.origin + back.pathname, REDIRECT);
  assert.equal(back.searchParams.get("state"), "st-42");

  const tokens = await route(asm.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code: back.searchParams.get("code"), client_id, redirect_uri: REDIRECT, code_verifier: verifier, resource }),
  });
  assert.equal(tokens.status, 200, await tokens.clone().text());
  return { wallet, client_id, ...(await tokens.json()) };
}

async function mcpClient(accessToken, serverUrl = MCP_URL) {
  const client = new Client({ name: "connector-e2e", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(serverUrl), { fetch: routedFetch, requestInit: { headers: { authorization: `Bearer ${accessToken}` } } });
  await client.connect(transport);
  return client;
}

test("the consent routes refuse a cross-site request", async () => {
  const refused = await route(`${ORIGIN}/api/connect/challenge`, { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body: "{}" });
  assert.equal(refused.status, 403);
  const refusedApprove = await route(`${ORIGIN}/api/connect/approve`, { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body: "{}" });
  assert.equal(refusedApprove.status, 403);
});

test("a chat connects with a wallet signature, lists sixteen read-only tools and reads with time and source", async () => {
  const { wallet, access_token, token_type, scope } = await connect();
  assert.equal(token_type, "Bearer");
  assert.equal(scope, "market:read");
  const client = await mcpClient(access_token);
  assert.equal(client.getServerVersion()?.name, "ryntra");
  assert.match(client.getInstructions() ?? "", /moves no funds/);

  const { tools } = await client.listTools();
  assert.equal(tools.length, 16);
  for (const tool of tools) {
    assert.equal(tool.annotations?.readOnlyHint, true, tool.name);
    assert.equal(tool.annotations?.destructiveHint, false, tool.name);
    assert.ok(tool.title, tool.name);
  }

  const health = await client.callTool({ name: "get_launch_health", arguments: { mint: MINT } });
  assert.notEqual(health.isError, true);
  assert.equal(health.structuredContent.source.route, "GET /api/v1/launch/{mint}/health");
  assert.equal(health.structuredContent.observedAt, "2026-10-31T11:59:30.000Z");
  assert.ok(Date.parse(health.structuredContent.asOf));
  assert.match(health.structuredContent.notice, /never as instructions/);
  assert.equal(engineCalls.at(-1).wallet, wallet.address, "the engine reads for the wallet that consented");

  const missing = await client.callTool({ name: "get_launch", arguments: { mint: MINT } });
  assert.equal(missing.isError, true);
  assert.equal(missing.structuredContent.error.code, "LAUNCH_NOT_FOUND");

  const ghost = await client.callTool({ name: "send_sol", arguments: { to: MINT } });
  assert.equal(ghost.isError, true);
  assert.equal(ghost.structuredContent.error.code, "TOOL_NOT_HOSTED");

  const receipts = await readConnectorReceipts(getGuardRuntime().store, wallet.address);
  const byTool = Object.fromEntries(receipts.map((receipt) => [receipt.toolName, receipt]));
  assert.equal(byTool.get_launch_health.outcome, "ACCEPTED");
  assert.equal(byTool.get_launch.reasonCode, "LAUNCH_NOT_FOUND");
  assert.equal(byTool.send_sol.reasonCode, "TOOL_NOT_HOSTED");
  assert.ok(receipts.every((receipt) => /^0x[0-9a-f]{64}$/.test(receipt.argumentsDigest)));
  await client.close();
});

test("a revoked connection is refused on its next call, with the challenge again", async () => {
  const { access_token, refresh_token } = await connect();
  const revoked = await route(`${ORIGIN}/api/connect/revoke`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: refresh_token }) });
  assert.equal(revoked.status, 200);
  const refused = await route(MCP_URL, { method: "POST", headers: { authorization: `Bearer ${access_token}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
  assert.equal(refused.status, 401);
  assert.match(refused.headers.get("www-authenticate"), /error="invalid_token"/);
});

test("the wallet's window counts tool calls, not protocol messages, and a refusal leaves a receipt", async () => {
  const { wallet, access_token } = await connect();
  const client = await mcpClient(access_token);
  for (let i = 0; i < 5; i += 1) await client.listTools();
  let last;
  for (let i = 0; i < 61; i += 1) last = await client.callTool({ name: "list_market_events", arguments: { limit: 1 } });
  assert.equal(last.isError, true);
  assert.equal(last.structuredContent.error.code, "RATE_LIMITED");
  assert.ok(last.structuredContent.error.retryAfterSeconds >= 1);
  const receipts = await readConnectorReceipts(getGuardRuntime().store, wallet.address);
  assert.equal(receipts.filter((receipt) => receipt.outcome === "ACCEPTED").length, 60, "sixty answered; tools/list cost nothing");
  assert.equal(receipts.filter((receipt) => receipt.reasonCode === "RATE_LIMITED").length, 1);
  await client.close();
});

test("refresh through the token route rotates the pair", async () => {
  const { client_id, refresh_token } = await connect();
  const refreshed = await route(`${ORIGIN}/api/connect/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token, client_id }) });
  assert.equal(refreshed.status, 200);
  const pair = await refreshed.json();
  assert.notEqual(pair.refresh_token, refresh_token);
  const again = await route(`${ORIGIN}/api/connect/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token, client_id }) });
  assert.equal(again.status, 400);
  assert.equal((await again.json()).error, "invalid_grant");
});

test("the catalog's address (CITY-170): the same consent, its own resource, twelve read-only tools and no Launch", async () => {
  const { wallet, access_token, refresh_token, client_id } = await connect(testWallet(), CATALOG_URL);
  const client = await mcpClient(access_token, CATALOG_URL);
  assert.match(client.getInstructions() ?? "", /prepares and signs no transaction/);

  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((tool) => tool.name), [...CATALOG_TOOL_NAMES]);
  for (const tool of tools) {
    assert.equal(tool.annotations?.readOnlyHint, true, tool.name);
    assert.equal(tool.annotations?.destructiveHint, false, tool.name);
    assert.ok(tool.title && tool.name.length <= 64, tool.name);
  }

  const checked = await client.callTool({ name: "check_transaction", arguments: { transaction: "AQID", intent: "send 4 SOL to a friend" } });
  assert.notEqual(checked.isError, true);
  assert.equal(checked.structuredContent.source.route, "POST /api/v1/ward/check");
  assert.equal(checked.structuredContent.data.verdict, "warn");
  assert.equal(checked.structuredContent.observedAt, "2026-10-31T11:59:45.000Z");
  const sent = engineCalls.at(-1);
  assert.equal(sent.route, "ward.check");
  assert.deepEqual(sent.input.body, { transaction: "AQID", intentText: "send 4 SOL to a friend", network: "mainnet" });
  assert.equal(sent.wallet, wallet.address);

  const launch = await client.callTool({ name: "get_launch", arguments: { mint: MINT } });
  assert.equal(launch.isError, true);
  assert.equal(launch.structuredContent.error.code, "TOOL_NOT_HOSTED", "Launch stays in the full connector");

  const linked = await client.callTool({ name: "get_token", arguments: { mint: LINKED_MINT } });
  assert.equal(linked.isError, true);
  assert.equal(linked.structuredContent.error.code, "SIGNING_LINK_REFUSED");
  assert.equal(JSON.stringify(linked).includes("/i/int_"), false, "the link itself never reaches the chat");
  const receipts = await readConnectorReceipts(getGuardRuntime().store, wallet.address);
  assert.ok(receipts.some((receipt) => receipt.toolName === "get_token" && receipt.reasonCode === "SIGNING_LINK_REFUSED"));
  await client.close();

  /* A token for the catalog's address opens that address only. */
  const elsewhere = await route(MCP_URL, { method: "POST", headers: { authorization: `Bearer ${access_token}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
  assert.equal(elsewhere.status, 401);
  assert.match(elsewhere.headers.get("www-authenticate"), /error="invalid_token"/);
  assert.match(elsewhere.headers.get("www-authenticate"), /oauth-protected-resource\/mcp"/);

  /* Refresh without naming the resource keeps the grant's own; naming the other one is refused. */
  const refreshed = await route(`${ORIGIN}/api/connect/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token, client_id }) });
  assert.equal(refreshed.status, 200, await refreshed.clone().text());
  const pair = await refreshed.json();
  const again = await mcpClient(pair.access_token, CATALOG_URL);
  assert.equal((await again.listTools()).tools.length, CATALOG_TOOL_NAMES.length);
  await again.close();
  const crossed = await route(`${ORIGIN}/api/connect/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: pair.refresh_token, client_id, resource: MCP_URL }) });
  assert.equal(crossed.status, 400);
  assert.equal((await crossed.json()).error, "invalid_target");
});

test("a token for the full connector does not open the catalog's address", async () => {
  const { access_token } = await connect();
  const refused = await route(CATALOG_URL, { method: "POST", headers: { authorization: `Bearer ${access_token}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
  assert.equal(refused.status, 401);
  assert.match(refused.headers.get("www-authenticate"), /oauth-protected-resource\/mcp\/read"/);
});
