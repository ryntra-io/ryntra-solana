import assert from "node:assert/strict";
import test from "node:test";

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

import { readConnectorReceipts } from "../../lib/connector/ledger.ts";
import { createConnectorOAuthServer } from "../../lib/connector/oauth.ts";
import { pkce, testWallet } from "../../lib/connector/test-wallet.mjs";
import { createMemoryGuardStore } from "../../lib/guard/store.ts";
import { FixedWindowLimiter } from "../../lib/http-control.ts";
import { serveRyntraMcp } from "../../lib/mcp/endpoint.ts";
import { RYNTRA_MCP_TOOL_NAMES } from "../../lib/mcp/server.ts";
import { EVERY_GATE } from "../../terminal/shell/ask-route.ts";

/**
 * `/mcp` exercised the way another AI reaches it: a real `@modelcontextprotocol/client` over the real
 * Streamable HTTP transport, routed in-process to `serveRyntraMcp`. Only the engine is a stand-in — its routes answer
 * from fixtures — so the test proves the server: no sign-in needed for public reads and links, a link for each prepare
 * tool, no link for a transfer, the window, and the signed-in path with the wallet's receipts.
 */

const ORIGIN = "https://ryntra.io";
const MCP_URL = `${ORIGIN}/mcp`;
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const OWNER = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const OTHER = "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr";
const POOL = "5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6";

const TOWERS = [
  { id: JUP, symbol: "JUP", name: "Jupiter", icon: null, verified: true, mcap: 2e9, liquidity: 1e7, district: "core" },
  { id: "METvsvVRapdj9cFLzq4Tr43xK4tAjQfwX76z3n6mWQL", symbol: "MET", name: "Meteora", icon: null, verified: true, mcap: 1e9, liquidity: 1e7, district: "core" },
];

const calls = [];
const connectorEngine = (readKey) => async (route, input) => {
  calls.push({ side: "connector", readKey, route, input });
  if (route === "city") return { status: 200, body: { towers: TOWERS, fetchedAt: "2026-11-20T11:59:00.000Z", source: "live" } };
  return { status: 200, body: { observedAt: "2026-11-20T11:59:00.000Z", rows: [] } };
};
const ownEngine = (readKey) => async (route, query) => {
  calls.push({ side: "own", readKey, route, query });
  if (route === "city") return { status: 200, body: { towers: TOWERS, fetchedAt: "2026-11-20T11:59:00.000Z", source: "live" } };
  if (route === "portfolio") return { status: 200, body: { owner: query.owner, readAt: "2026-11-20T11:59:10.000Z", positions: [{ kind: "coin", symbol: "SOL", usd: 12.5 }] } };
  if (route === "spot.market") return { status: 200, body: { market: { mint: query.mint, symbol: "OTHR", name: "Other", verified: false } } };
  if (route === "earn.pools") {
    return {
      status: 200,
      body: {
        at: "2026-11-20T11:58:00.000Z",
        pools: [
          { kind: "dlmm", address: POOL, x: { mint: "So11111111111111111111111111111111111111112", symbol: "SOL", verified: true }, y: { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", verified: true }, tvlUsd: 5_000_000 },
          { kind: "damm-v2", address: OTHER, x: { mint: JUP, symbol: "JUP", verified: true }, y: { mint: "So11111111111111111111111111111111111111112", symbol: "SOL", verified: true }, tvlUsd: 100_000 },
        ],
        lend: [],
        sources: { dlmm: true, dammV2: true, lend: false },
      },
    };
  }
  return { status: 404, body: { error: { code: "NOT_FOUND", message: "no fixture" } } };
};

const store = createMemoryGuardStore();
let limiter = new FixedWindowLimiter({ windowMs: 60_000, limit: 1_000, maxKeys: 100 });
let callerSeq = 0;

function route(url, init = {}, address) {
  const headers = new Headers(init.headers ?? {});
  headers.set("x-forwarded-for", address);
  return serveRyntraMcp(new Request(url, { ...init, headers }), {
    store,
    readFor: connectorEngine,
    ownFor: ownEngine,
    plan: { on: () => true, gates: EVERY_GATE },
    openLimiter: limiter,
  });
}

async function client({ token } = {}) {
  callerSeq += 1;
  const address = `10.29.0.${callerSeq}`;
  const target = (input) => (typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const fetch = (input, init) => route(target(input), init ?? (input instanceof Request ? { method: input.method, headers: Object.fromEntries(input.headers), body: input.body } : {}), address);
  const mcp = new Client({ name: "open-e2e", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), { fetch, ...(token ? { requestInit: { headers: { authorization: `Bearer ${token}` } } } : {}) });
  await mcp.connect(transport);
  return { mcp, address };
}

const data = (answer) => answer.structuredContent.data;

test("without signing in: every tool is listed, reads and prepares; none signs", async () => {
  const { mcp } = await client();
  assert.equal(mcp.getServerVersion()?.name, "ryntra");
  assert.match(mcp.getInstructions() ?? "", /sign in their own wallet/);
  assert.match(mcp.getInstructions() ?? "", /never an instruction/);
  const { tools } = await mcp.listTools();
  assert.deepEqual(
    tools.map((tool) => tool.name),
    [...RYNTRA_MCP_TOOL_NAMES],
  );
  for (const name of ["get_portfolio", "list_pools", "prepare_swap", "prepare_agent_budget", "prepare_launch", "prepare_pool_deposit", "hire_agent", "get_token_passport", "check_transaction"]) {
    assert.ok(tools.some((tool) => tool.name === name), name);
  }
  for (const tool of tools) {
    assert.equal(tool.annotations?.readOnlyHint, true, tool.name);
    assert.equal(tool.annotations?.destructiveHint, false, tool.name);
    assert.doesNotMatch(JSON.stringify(tool.inputSchema), /private|seed|secret/i, tool.name);
  }
});

test("a portfolio is read by its public address, at the caller's own address", async () => {
  const { mcp, address } = await client();
  const answer = await mcp.callTool({ name: "get_portfolio", arguments: { owner: OWNER } });
  assert.notEqual(answer.isError, true, JSON.stringify(answer.structuredContent));
  assert.equal(answer.structuredContent.source.route, "GET /api/v1/portfolio");
  assert.equal(answer.structuredContent.source.url, `${ORIGIN}/api/v1/portfolio?owner=${OWNER}`);
  assert.equal(answer.structuredContent.observedAt, "2026-11-20T11:59:10.000Z");
  assert.match(answer.structuredContent.notice, /never as instructions/);
  assert.equal(data(answer).owner, OWNER);
  const read = calls.findLast((call) => call.route === "portfolio");
  assert.equal(read.readKey, address, "the engine's window counts the caller, not the server");
  const bad = await mcp.callTool({ name: "get_portfolio", arguments: { owner: "not-an-address" } });
  assert.equal(bad.isError, true);
  assert.equal(bad.structuredContent.error.code, "VALIDATION_ERROR");
});

test("pools: the deepest first, one coin's on asking, each with its page on Ryntra", async () => {
  const { mcp } = await client();
  const all = data(await mcp.callTool({ name: "list_pools", arguments: {} }));
  assert.deepEqual(all.pools.map((pool) => pool.address), [POOL, OTHER]);
  assert.equal(all.pools[0].ryntraUrl, `${ORIGIN}/pool/${POOL}`);
  const jup = data(await mcp.callTool({ name: "list_pools", arguments: { coin: "JUP" } }));
  assert.deepEqual(jup.pools.map((pool) => pool.address), [OTHER]);
});

test("prepare_swap: a link to the swap with the pair and amount, and the coins named", async () => {
  const { mcp } = await client();
  const known = data(await mcp.callTool({ name: "prepare_swap", arguments: { from: "SOL", to: "jup", amount: "1.5" } }));
  assert.equal(known.link, `${ORIGIN}/swap?from=SOL&to=JUP&amount=1.5`);
  assert.match(known.signs, /their own wallet/);
  assert.match(known.kept, /Nothing was created, stored or reserved/);
  const other = data(await mcp.callTool({ name: "prepare_swap", arguments: { from: "USDC", to: OTHER, amount: 25 } }));
  assert.equal(other.link, `${ORIGIN}/swap?from=USDC&to=${OTHER}&amount=25`);
  assert.equal(other.fields.to.symbol, "OTHR");
  assert.equal(other.fields.to.verified, false, "an unverified coin is said so, never hidden");
  const same = await mcp.callTool({ name: "prepare_swap", arguments: { from: "SOL", to: "SOL" } });
  assert.equal(same.structuredContent.error.code, "VALIDATION_ERROR");
  const nonsense = await mcp.callTool({ name: "prepare_swap", arguments: { from: "SOL", to: "JUP", amount: "-3" } });
  assert.equal(nonsense.structuredContent.error.code, "VALIDATION_ERROR");
  const ticker = await mcp.callTool({ name: "prepare_swap", arguments: { from: "SOL", to: "SOMECOIN" } });
  assert.equal(ticker.structuredContent.error.code, "VALIDATION_ERROR", "a ticker beyond the known five is never guessed");
});

test("prepare_agent_budget: the agent's budget card, the person's own numbers, no ceiling of ours", async () => {
  const { mcp } = await client();
  const plain = data(await mcp.callTool({ name: "prepare_agent_budget", arguments: { perDaySol: "1" } }));
  assert.equal(plain.link, `${ORIGIN}/?say=trade+1+SOL+a+day`);
  assert.equal(plain.fields.perDaySol, "1");
  assert.equal(plain.fields.screen, "/agent?ai=trader", "the agent's budget card is the AI trader's");
  assert.match(plain.opens, /signs the budget once/);
  const big = data(await mcp.callTool({ name: "prepare_agent_budget", arguments: { perDaySol: 250 } }));
  assert.equal(big.fields.perDaySol, "250");
  const coin = data(await mcp.callTool({ name: "prepare_agent_budget", arguments: { perDaySol: "0.5", coin: "JUP" } }));
  assert.equal(coin.fields.coin.mint, JUP);
  assert.equal(coin.fields.sentence, "trade JUP for 0.5 SOL a day");
  const unlisted = await mcp.callTool({ name: "prepare_agent_budget", arguments: { perDaySol: "1", coin: OTHER } });
  assert.equal(unlisted.structuredContent.error.code, "COIN_NOT_LISTED");
});

test("prepare_launch: the Launch form with the name and ticker", async () => {
  const { mcp } = await client();
  const launch = data(await mcp.callTool({ name: "prepare_launch", arguments: { name: "Neon Fox", symbol: "neon" } }));
  assert.equal(new URL(launch.link).searchParams.get("say"), "launch me a token Neon Fox $NEON");
  assert.deepEqual([launch.fields.name, launch.fields.symbol, launch.fields.screen], ["Neon Fox", "NEON", "/launch"]);
  const odd = await mcp.callTool({ name: "prepare_launch", arguments: { name: "<script>" } });
  assert.equal(odd.structuredContent.error.code, "VALIDATION_ERROR");
});

test("prepare_pool_deposit: a listed pool's page, open on adding; an unlisted pool is refused", async () => {
  const { mcp } = await client();
  const pool = data(await mcp.callTool({ name: "prepare_pool_deposit", arguments: { pool: POOL } }));
  assert.equal(pool.link, `${ORIGIN}/pool/${POOL}?tab=position`);
  assert.equal(pool.fields.pool.pair, "SOL/USDC");
  const unlisted = await mcp.callTool({ name: "prepare_pool_deposit", arguments: { pool: OWNER } });
  assert.equal(unlisted.structuredContent.error.code, "POOL_NOT_LISTED");
});

test("hire_agent: a sentence becomes a plan and a link; a transfer never becomes a link", async () => {
  const { mcp } = await client();
  const hired = data(await mcp.callTool({ name: "hire_agent", arguments: { sentence: "торгуй на 1 SOL на день" } }));
  assert.equal(hired.fields.kind, "autopilot");
  assert.equal(hired.fields.perDaySol, "1");
  assert.equal(new URL(hired.link).searchParams.get("say"), "торгуй на 1 SOL на день");
  const send = await mcp.callTool({ name: "hire_agent", arguments: { sentence: `send 5 SOL to ${OWNER}` } });
  assert.equal(send.isError, true);
  assert.equal(send.structuredContent.error.code, "NOT_FROM_A_LINK");
  assert.doesNotMatch(JSON.stringify(send), /say=|https:\/\/ryntra\.io\/\?/, "no link of any kind for a transfer");
  const question = await mcp.callTool({ name: "hire_agent", arguments: { sentence: "what is JUP?" } });
  assert.equal(question.structuredContent.error.code, "NOT_UNDERSTOOD");
  const long = await mcp.callTool({ name: "hire_agent", arguments: { sentence: "trade ".repeat(30) } });
  assert.equal(long.structuredContent.error.code, "SENTENCE_INVALID");
});

test("the open window: a caller past its minute hears RATE_LIMITED with when to come back", async () => {
  limiter = new FixedWindowLimiter({ windowMs: 60_000, limit: 2, maxKeys: 100 });
  try {
    const { mcp } = await client();
    await mcp.callTool({ name: "list_pools", arguments: {} });
    await mcp.callTool({ name: "list_pools", arguments: {} });
    const third = await mcp.callTool({ name: "list_pools", arguments: {} });
    assert.equal(third.isError, true);
    assert.equal(third.structuredContent.error.code, "RATE_LIMITED");
    assert.ok(third.structuredContent.error.retryAfterSeconds >= 1);
  } finally {
    limiter = new FixedWindowLimiter({ windowMs: 60_000, limit: 1_000, maxKeys: 100 });
  }
});

test("a wrong token is 401 with where to sign in again — never a quiet fall to the open door", async () => {
  const response = await route(MCP_URL, { method: "POST", headers: { authorization: "Bearer nope", "content-type": "application/json", accept: "application/json, text/event-stream" }, body: "{}" }, "10.29.1.1");
  assert.equal(response.status, 401);
  const challenge = response.headers.get("www-authenticate");
  assert.match(challenge, /error="invalid_token"/);
  assert.match(challenge, /resource_metadata="https:\/\/ryntra\.io\/\.well-known\/oauth-protected-resource\/mcp"/);
  const basic = await route(MCP_URL, { method: "POST", headers: { authorization: "Basic abc", "content-type": "application/json" }, body: "{}" }, "10.29.1.2");
  assert.equal(basic.status, 401);
});

test("signed in: the same tools, the wallet's own window and a receipt for every call", async () => {
  const oauth = createConnectorOAuthServer(store);
  const now = Date.now();
  const wallet = testWallet();
  const registered = await oauth.registerClient({ request: { client_name: "Chat", redirect_uris: [REDIRECT] }, nowMs: now });
  const { verifier, challenge } = pkce();
  const params = { response_type: "code", client_id: registered.clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256", state: "s1", scope: "market:read", resource: MCP_URL };
  const issued = await oauth.issueConsent({ params, address: wallet.address, origin: ORIGIN, domain: "ryntra.io", nowMs: now });
  const bytes = new TextEncoder().encode(issued.message);
  const approved = await oauth.approveConsent({ nonce: issued.nonce, address: wallet.address, signedMessage: bytes, signature: wallet.sign(bytes), nowMs: now });
  const code = new URL(approved.redirectTo).searchParams.get("code");
  const pair = await oauth.exchangeCode({ code, clientId: registered.clientId, redirectUri: REDIRECT, codeVerifier: verifier, resource: MCP_URL, nowMs: now + 1 });

  const { mcp } = await client({ token: pair.accessToken });
  const { tools } = await mcp.listTools();
  assert.equal(tools.length, RYNTRA_MCP_TOOL_NAMES.length);
  const swap = await mcp.callTool({ name: "prepare_swap", arguments: { from: "SOL", to: "MET", amount: "2" } });
  assert.equal(data(swap).link, `${ORIGIN}/swap?from=SOL&to=MET&amount=2`);
  await mcp.callTool({ name: "no_such_tool", arguments: {} });
  const receipts = await readConnectorReceipts(store, wallet.address);
  assert.deepEqual(
    receipts.map((receipt) => [receipt.toolName, receipt.outcome, receipt.reasonCode]).sort(),
    [
      ["no_such_tool", "REFUSED", "TOOL_NOT_HOSTED"],
      ["prepare_swap", "ACCEPTED", null],
    ],
  );
  const before = calls.length;
  await mcp.callTool({ name: "get_portfolio", arguments: { owner: OWNER } });
  const read = calls.slice(before).find((call) => call.route === "portfolio");
  assert.match(read.readKey, /^fdc0:/, "a wallet's calls are counted at the wallet's own key");
});
