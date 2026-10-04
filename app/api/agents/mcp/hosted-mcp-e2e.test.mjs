import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import test from "node:test";

import { Client } from "@modelcontextprotocol/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

import { readHostedCallReceipts } from "../../../../lib/agent-control/mcp/hosted.ts";
import { createAgentOAuthServer } from "../../../../lib/agent-control/oauth/server.ts";
import { getAgentControlRuntime } from "../../../../lib/agent-control/runtime.ts";
import { createAgentTenancy } from "../../../../lib/agent-control/tenancy.ts";
import { GET as protectedResourceMetadataRoute } from "../../../.well-known/oauth-protected-resource/api/agents/mcp/route.ts";
import { GET as authorizationServerMetadataRoute } from "../../../.well-known/oauth-authorization-server/route.ts";
import { POST as approveRoute } from "../oauth/authorize/route.ts";
import { POST as registerRoute } from "../oauth/register/route.ts";
import { POST as revokeRoute } from "../oauth/revoke/route.ts";
import { POST as tokenRoute } from "../oauth/token/route.ts";
import { POST as mcpRoute } from "./route.ts";

/**
 * The hosted endpoint exercised the way an external client actually reaches it.
 *
 * A real `@modelcontextprotocol/client` over the real Streamable HTTP transport,
 * pointed at the real route handler through an in-process fetch. Nothing is
 * stubbed except the socket, so `initialize`, `tools/list` and `tools/call` are
 * the protocol's own messages rather than a hand-written approximation of them.
 *
 * This is the machine half of the Grok criterion. The half that is a property
 * of somebody else's product — a connector added inside a Grok account — is a
 * manual step and is recorded as not performed rather than assumed.
 */

const ORIGIN = "https://ryntra.io";
const MCP_URL = `${ORIGIN}/api/agents/mcp`;
const REDIRECT = "https://grok.example/oauth/callback";

/**
 * A distinct caller address per test.
 *
 * The per-instance limiter in front of every route is keyed on
 * `x-forwarded-for` and is deliberately tight — twelve requests a minute, the
 * same number the edge firewall enforces. One shared address would make these
 * tests contend with each other over a bucket that has nothing to do with what
 * they are checking, and a suite that fails because of its own previous test is
 * a suite nobody trusts. Each test takes its own address, which is also what
 * separate callers actually look like.
 */
let callerOctet = 10;
function nextCaller() {
  callerOctet += 1;
  return `198.51.100.${callerOctet}`;
}

const HEADERS = { host: "ryntra.io", "x-forwarded-proto": "https" };

/** The route handlers, addressed by path, behind one fetch. */
async function route(url, init = {}, caller = "198.51.100.1") {
  /*
   * `init.headers` arrives as a `Headers` instance from the transport, and a
   * `Headers` does not spread — `{ ...headers }` is `{}`. Merging it as an
   * object silently dropped the `Authorization` the transport had set, and
   * every call came back `401` from a server that was behaving correctly.
   */
  const headers = new Headers(HEADERS);
  headers.set("x-forwarded-for", caller);
  for (const [name, value] of new Headers(init.headers ?? {})) headers.set(name, value);
  const request = new Request(url, { ...init, headers });
  const path = new URL(url).pathname;
  if (path === "/api/agents/mcp") return mcpRoute(request);
  if (path === "/api/agents/oauth/register") return registerRoute(request, {});
  if (path === "/api/agents/oauth/authorize") return approveRoute(request, {});
  if (path === "/api/agents/oauth/token") return tokenRoute(request, {});
  if (path === "/api/agents/oauth/revoke") return revokeRoute(request, {});
  if (path === "/.well-known/oauth-protected-resource/api/agents/mcp") {
    return protectedResourceMetadataRoute(request);
  }
  if (path === "/.well-known/oauth-authorization-server") {
    return authorizationServerMetadataRoute(request);
  }
  throw new Error(`no route for ${path}`);
}

/**
 * `fetch` is called with a string, a `URL` or a `Request`, and the transport
 * uses the second of those — which has `href`, not `url`. Reading `input.url`
 * gave `undefined` and every call failed on URL parsing, which is a good
 * reminder that a shim is only equivalent to the thing it stands in for if it
 * accepts the same inputs.
 */
function targetUrl(input) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

const routedFetch = (caller) => (input, init) =>
  route(
    targetUrl(input),
    init ?? (input instanceof Request
      ? { method: input.method, headers: Object.fromEntries(input.headers), body: input.body }
      : {}),
    caller,
  );

function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier, "ascii").digest("base64url") };
}

/**
 * A valid `AgentActionIntent 1.0.0`.
 *
 * Built here rather than imported from the demo module so the read tool is
 * exercised against the contract a real caller has to satisfy — including the
 * two cross-field rules, that expiry follows creation and that the action
 * deadline lands inside it.
 */
function sampleIntent(nowMs = Date.parse("2026-08-24T12:00:00.000Z")) {
  const at = (offsetMs) => new Date(nowMs + offsetMs).toISOString();
  return {
    schemaVersion: "1.0.0",
    id: "agent-intent_hosted-e2e-001",
    source: {
      kind: "MCP",
      agentId: "grok-connector",
      agentName: "Grok",
      requestId: "hosted-e2e-request-001",
    },
    subjectRef: "job-101",
    requestText: "Draft a bounded BNB testnet job intent and show every decision boundary.",
    action: {
      kind: "CREATE_JOB_DRAFT",
      provider: "BNB_APEX",
      chainRef: "eip155:97",
      jobType: "EVIDENCE_REVIEW",
      deliverable: "A deterministic evidence and policy assessment for one job draft.",
      budget: null,
      providerRef: null,
      evaluatorRef: null,
      deadline: at(15 * 60_000),
      expectedEffects: [
        "Create an integrity-checkable Action Passport Preview.",
        "Submit no provider action, wallet signature or blockchain transaction.",
      ],
    },
    policyRef: { id: "agent-control-demo-policy", version: 1 },
    evidenceRequirements: ["strict_intent_schema", "execution_boundary"],
    humanAuthorizationRequired: true,
    createdAt: at(0),
    expiresAt: at(20 * 60_000),
    revision: 1,
    idempotencyKey: "hosted-e2e-create-job-draft-v1",
  };
}

/**
 * The whole OAuth dance, through the routes, exactly as a connector runs it.
 * Returns the tokens plus the pieces a later assertion needs.
 */
async function connect(scopes = ["evidence:read", "proposal:write"], caller = nextCaller()) {
  const tenancy = createAgentTenancy(getAgentControlRuntime().guardStore);
  const tenant = await tenancy.createTenant({ displayName: "Grok", createdAtMs: Date.now() });
  const key = await tenancy.issueKey({
    tenantId: tenant.tenantId,
    label: "connector",
    scopes,
    createdAtMs: Date.now(),
  });

  const registered = await (
    await route(`${ORIGIN}/api/agents/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: "Grok", redirect_uris: [REDIRECT] }),
    }, caller)
  ).json();

  const { verifier, challenge } = pkce();
  const approval = await route(`${ORIGIN}/api/agents/oauth/authorize`, {
    method: "POST",
    body: new URLSearchParams({
      client_id: registered.client_id,
      redirect_uri: REDIRECT,
      state: "xyz",
      scope: scopes.join(" "),
      code_challenge: challenge,
      code_challenge_method: "S256",
      api_key: key.key,
      resource: MCP_URL,
    }),
  }, caller);
  assert.equal(approval.status, 303, await approval.text());
  const code = new URL(approval.headers.get("location")).searchParams.get("code");

  const tokens = await (
    await route(`${ORIGIN}/api/agents/oauth/token`, {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: registered.client_id,
        redirect_uri: REDIRECT,
        code_verifier: verifier,
        resource: MCP_URL,
      }),
    }, caller)
  ).json();

  return { tenant, key, tenancy, clientId: registered.client_id, tokens, caller };
}

async function mcpClient(accessToken, caller) {
  const client = new Client({ name: "grok-e2e", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    fetch: routedFetch(caller),
    requestInit: {
      headers: { ...HEADERS, "x-forwarded-for": caller, authorization: `Bearer ${accessToken}` },
    },
  });
  await client.connect(transport);
  return client;
}

/* ── discovery, before any credential exists ───────────────────────────── */

test("an unauthenticated call answers 401 and names where to discover the authorization server", async () => {
  const response = await route(MCP_URL, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
  });
  assert.equal(response.status, 401);
  const challengeHeader = response.headers.get("www-authenticate");
  assert.match(challengeHeader, /^Bearer /);
  assert.match(
    challengeHeader,
    /resource_metadata="https:\/\/ryntra\.io\/\.well-known\/oauth-protected-resource\/api\/agents\/mcp"/,
  );
});

test("the two discovery documents describe this deployment and only S256", async () => {
  const prm = await (
    await route(`${ORIGIN}/.well-known/oauth-protected-resource/api/agents/mcp`)
  ).json();
  assert.equal(prm.resource, MCP_URL);
  assert.deepEqual(prm.authorization_servers, [ORIGIN]);

  const asm = await (await route(`${ORIGIN}/.well-known/oauth-authorization-server`)).json();
  assert.equal(asm.issuer, ORIGIN);
  assert.deepEqual(asm.code_challenge_methods_supported, ["S256"]);
  assert.deepEqual(asm.token_endpoint_auth_methods_supported, ["none"]);
  assert.equal(asm.registration_endpoint, `${ORIGIN}/api/agents/oauth/register`);
});

/* ── the connected client ──────────────────────────────────────────────── */

test("a connected client sees only the tools its scopes grant", async () => {
  const readOnly = await connect(["evidence:read"]);
  const client = await mcpClient(readOnly.tokens.access_token, readOnly.caller);
  try {
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, [
      "draft_agent_action_intent",
      "run_agent_action_preflight",
      "verify_action_passport_preview",
    ]);
  } finally {
    await client.close();
  }
});

test("no tool on the hosted endpoint can execute, sign or move value", async () => {
  const full = await connect();
  const client = await mcpClient(full.tokens.access_token, full.caller);
  try {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      for (const banned of ["execute", "sign", "authorize", "transfer", "withdraw", "settle", "submit"]) {
        assert.ok(
          !tool.name.toLowerCase().includes(banned),
          `${tool.name} names ${banned}, which this surface must not expose`,
        );
      }
    }
    assert.equal(tools.length, 8, "three local reads and the five writes");
  } finally {
    await client.close();
  }
});

test("a read tool works and returns a source preview, never a receipt", async () => {
  const full = await connect();
  const client = await mcpClient(full.tokens.access_token, full.caller);
  try {
    const result = await client.callTool({
      name: "draft_agent_action_intent",
      arguments: { intent: sampleIntent() },
    });
    assert.ok(!result.isError, JSON.stringify(result));
    assert.equal(result.structuredContent.data.maturity, "SOURCE_PREVIEW");
    assert.ok(
      result.structuredContent.limitations.some((line) => line.includes("NOT A FINALIZED RECEIPT")),
    );
  } finally {
    await client.close();
  }
});

test("a write produces a proposal at PROPOSE and nothing that could authorize it", async () => {
  const full = await connect();
  const client = await mcpClient(full.tokens.access_token, full.caller);
  try {
    const result = await client.callTool({
      name: "propose_action",
      arguments: {
        actionRef: "action:bnb-apex/fund-job@1",
        subjectRef: "job-101",
        summary: "Fund the BNB APEX job so the release can close.",
        /* `fund-job` carries `budget: REQUIRED` in the registry, and the write
           gate refuses `BUDGET_REQUIRED_BY_ACTION` without one. Supplying it
           here rather than switching to an action that needs none is the point:
           the registry's own budget rule is exercised through the hosted path. */
        budget: { amount: "1.00", assetRef: "eip155:97/slip44:714" },
      },
    });
    assert.ok(!result.isError, JSON.stringify(result));
    const proposal = result.structuredContent.data;
    assert.equal(proposal.phase, "PROPOSE");
    assert.notEqual(proposal.ownerAuthorization, "GRANTED_BY_OWNER");
    assert.ok(
      result.structuredContent.limitations.some((line) => line.includes("NOT AN AUTHORIZATION")),
    );
  } finally {
    await client.close();
  }
});

test("a tool absent from the caller's list is refused by the gate, not by the filter", async () => {
  /*
   * End to end, the gate and not the filter refuses a tool outside the
   * token's scopes. The client below never saw `propose_action` in
   * `tools/list`; it calls it by name anyway, which is exactly what a generic
   * execute indirection would do.
   */
  const readOnly = await connect(["evidence:read"]);
  const client = await mcpClient(readOnly.tokens.access_token, readOnly.caller);
  try {
    const result = await client.callTool({
      name: "propose_action",
      arguments: { actionRef: "action:bnb-apex/fund-job@1", subjectRef: "s", summary: "x" },
    });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.error.code, "SCOPE_NOT_GRANTED");
  } finally {
    await client.close();
  }
});

test("a name this endpoint hosts nowhere is refused for a token holding every scope", async () => {
  const full = await connect(["evidence:read", "proposal:write", "metrics:read"]);
  const client = await mcpClient(full.tokens.access_token, full.caller);
  try {
    for (const name of ["observe_bnb_apex_testnet_job", "tool_execute", "sign_transaction"]) {
      const result = await client.callTool({ name, arguments: {} });
      assert.equal(result.isError, true, name);
      assert.equal(result.structuredContent.error.code, "TOOL_NOT_HOSTED", name);
    }
  } finally {
    await client.close();
  }
});

/* ── revocation, and the receipt ───────────────────────────────────────── */

test("revoking the token blocks the very next call", async () => {
  const full = await connect();
  const client = await mcpClient(full.tokens.access_token, full.caller);
  await client.listTools();
  await client.close();

  const revoked = await route(`${ORIGIN}/api/agents/oauth/revoke`, {
    method: "POST",
    body: new URLSearchParams({ token: full.tokens.access_token }),
  });
  assert.equal(revoked.status, 200);

  const after = await route(MCP_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${full.tokens.access_token}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
  assert.equal(after.status, 401);
  assert.match(after.headers.get("www-authenticate"), /error="invalid_token"/);
});

test("Ryntra keeps a receipt for every call, admitted and refused alike", async () => {
  const full = await connect();
  const client = await mcpClient(full.tokens.access_token, full.caller);
  try {
    await client.callTool({
      name: "propose_action",
      arguments: {
        actionRef: "action:bnb-apex/fund-job@1",
        subjectRef: "job-777",
        summary: "A proposal that leaves a receipt.",
        budget: { amount: "1.00", assetRef: "eip155:97/slip44:714" },
      },
    });
    await client.callTool({ name: "observe_bnb_apex_testnet_job", arguments: {} });
  } finally {
    await client.close();
  }

  const receipts = await readHostedCallReceipts(
    getAgentControlRuntime().guardStore,
    full.tenant.tenantId,
  );
  assert.equal(receipts.length, 2);
  const accepted = receipts.find((entry) => entry.toolName === "propose_action");
  const refused = receipts.find((entry) => entry.toolName === "observe_bnb_apex_testnet_job");
  assert.equal(accepted.outcome, "ACCEPTED");
  assert.equal(accepted.reasonCode, null);
  assert.equal(refused.outcome, "REFUSED");
  assert.equal(refused.reasonCode, "TOOL_NOT_HOSTED");
  for (const receipt of receipts) {
    assert.equal(receipt.tenantId, full.tenant.tenantId);
    assert.match(receipt.argumentsDigest, /^0x[0-9a-f]{64}$/);
  }
  assert.ok(
    !JSON.stringify(receipts).includes("A proposal that leaves a receipt"),
    "a caller's own text must not be copied into the audit row",
  );
});

test("a token minted for another resource is refused here", async () => {
  const full = await connect();
  const oauth = createAgentOAuthServer(getAgentControlRuntime().guardStore);
  await assert.rejects(
    () =>
      oauth.verifyAccessToken({
        token: full.tokens.access_token,
        resource: "https://someone-else.example/api/agents/mcp",
        nowMs: Date.now(),
      }),
    (error) => error.code === "invalid_token",
  );
});
