import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createMemoryGuardStore } from "../../guard/store.ts";
import { createAgentTenancy } from "../tenancy.ts";
import { AgentOAuthError, createAgentOAuthServer, parseScopeString } from "./server.ts";

const NOW = Date.parse("2026-08-24T12:00:00.000Z");
const RESOURCE = "https://ryntra.io/api/agents/mcp";
const REDIRECT = "https://grok.example/oauth/callback";

function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier, "ascii").digest("base64url") };
}

function presentableSecretMaterial(value) {
  const token = /^ryn_(?:oc|at|rt)_[0-9a-f]{24}_(.+)$/.exec(value);
  return token?.[1] ?? value;
}

async function fixture(scopes = ["evidence:read", "proposal:write"]) {
  const store = createMemoryGuardStore();
  const tenancy = createAgentTenancy(store);
  const oauth = createAgentOAuthServer(store);
  const tenant = await tenancy.createTenant({ displayName: "Grok", createdAtMs: NOW });
  const key = await tenancy.issueKey({
    tenantId: tenant.tenantId,
    label: "connector",
    scopes,
    createdAtMs: NOW,
  });
  const { clientId } = await oauth.registerClient({
    request: { client_name: "Grok", redirect_uris: [REDIRECT] },
    nowMs: NOW,
  });
  return { store, tenancy, oauth, tenant, key, clientId };
}

async function authorized(context, requestedScopes = []) {
  const { verifier, challenge } = pkce();
  const { code } = await context.oauth.approve({
    clientId: context.clientId,
    apiKey: context.key.key,
    requestedScopes,
    redirectUri: REDIRECT,
    resource: RESOURCE,
    codeChallenge: challenge,
    codeChallengeMethod: "S256",
    nowMs: NOW,
  });
  return { code, verifier };
}

/* ── registration ──────────────────────────────────────────────────────── */

test("registration issues a public PKCE client and no client secret", async () => {
  const { oauth, clientId } = await fixture();
  const record = await oauth.readClient(clientId);
  assert.match(clientId, /^cli_[0-9a-f]{24}$/);
  assert.deepEqual(record.redirectUris, [REDIRECT]);
  assert.ok(!("clientSecret" in record), "a public client must have no secret to leak");
  assert.ok(!JSON.stringify(record).toLowerCase().includes("secret"));
});

test("a client asking for a secret-bearing auth method is refused, not downgraded", async () => {
  const { oauth } = await fixture();
  await assert.rejects(
    () =>
      oauth.registerClient({
        request: {
          client_name: "x",
          redirect_uris: [REDIRECT],
          token_endpoint_auth_method: "client_secret_post",
        },
        nowMs: NOW,
      }),
    (error) => error instanceof AgentOAuthError && error.code === "invalid_request",
  );
});

test("a redirect URI must be https or loopback, and may carry no fragment", async () => {
  const { oauth } = await fixture();
  for (const uri of ["http://grok.example/cb", "https://grok.example/cb#frag", "ftp://x/y"]) {
    await assert.rejects(
      () => oauth.registerClient({ request: { redirect_uris: [uri] }, nowMs: NOW }),
      (error) => error instanceof AgentOAuthError,
      uri,
    );
  }
  await oauth.registerClient({ request: { redirect_uris: ["http://127.0.0.1:6274/cb"] }, nowMs: NOW });
});

/* ── the approval step, where a human decides ──────────────────────────── */

test("the approving key is the ceiling on what can be granted", async () => {
  const context = await fixture(["evidence:read"]);
  await assert.rejects(
    () => authorized(context, ["proposal:write"]),
    (error) => error instanceof AgentOAuthError && error.code === "invalid_scope",
  );
  const ok = await authorized(context, ["evidence:read"]);
  assert.match(ok.code, /^ryn_oc_[0-9a-f]{24}_[A-Za-z0-9_-]{43}$/);
});

test("a refused key cannot approve anything", async () => {
  const context = await fixture();
  await context.tenancy.revokeKey(context.key.keyId, { revokedAtMs: NOW });
  await assert.rejects(
    () => authorized(context),
    (error) => error instanceof AgentOAuthError && error.code === "access_denied",
  );
});

test("only S256 is accepted", async () => {
  const context = await fixture();
  await assert.rejects(
    () =>
      context.oauth.approve({
        clientId: context.clientId,
        apiKey: context.key.key,
        requestedScopes: [],
        redirectUri: REDIRECT,
        resource: RESOURCE,
        codeChallenge: "x".repeat(43),
        codeChallengeMethod: "plain",
        nowMs: NOW,
      }),
    (error) => error instanceof AgentOAuthError && error.code === "invalid_request",
  );
});

/* ── exchange ──────────────────────────────────────────────────────────── */

test("a code exchanges once, for a bound pair", async () => {
  const context = await fixture();
  const { code, verifier } = await authorized(context);
  const pair = await context.oauth.exchangeCode({
    code,
    clientId: context.clientId,
    redirectUri: REDIRECT,
    codeVerifier: verifier,
    resource: RESOURCE,
    nowMs: NOW,
  });
  assert.match(pair.accessToken, /^ryn_at_[0-9a-f]{24}_[A-Za-z0-9_-]{43}$/);
  assert.match(pair.refreshToken, /^ryn_rt_[0-9a-f]{24}_[A-Za-z0-9_-]{43}$/);
  assert.equal(pair.expiresInSeconds, 3_600);
  assert.deepEqual([...pair.scopes], ["evidence:read", "proposal:write"]);

  const verified = await context.oauth.verifyAccessToken({
    token: pair.accessToken,
    resource: RESOURCE,
    nowMs: NOW + 1_000,
  });
  assert.equal(verified.tenantId, context.tenant.tenantId);
  assert.deepEqual([...verified.scopes], ["evidence:read", "proposal:write"]);
});

test("a wrong verifier, client or redirect refuses the exchange", async () => {
  for (const mutate of [
    (input) => ({ ...input, codeVerifier: randomBytes(32).toString("base64url") }),
    (input) => ({ ...input, redirectUri: "https://grok.example/other" }),
    (input) => ({ ...input, clientId: "cli_" + "0".repeat(24) }),
    (input) => ({ ...input, resource: "https://evil.example/mcp" }),
  ]) {
    const context = await fixture();
    const { code, verifier } = await authorized(context);
    await assert.rejects(
      () =>
        context.oauth.exchangeCode(
          mutate({
            code,
            clientId: context.clientId,
            redirectUri: REDIRECT,
            codeVerifier: verifier,
            resource: RESOURCE,
            nowMs: NOW,
          }),
        ),
      (error) => error instanceof AgentOAuthError,
    );
  }
});

test("replaying a code revokes the session the first exchange opened", async () => {
  /* RFC 6749 §10.5. A second use means the code leaked, so the tokens it
     produced are no longer trustworthy — refusing the replay while leaving the
     first pair live would protect nobody. */
  const context = await fixture();
  const { code, verifier } = await authorized(context);
  const input = {
    code,
    clientId: context.clientId,
    redirectUri: REDIRECT,
    codeVerifier: verifier,
    resource: RESOURCE,
    nowMs: NOW,
  };
  const pair = await context.oauth.exchangeCode(input);
  await assert.rejects(
    () => context.oauth.exchangeCode({ ...input, nowMs: NOW + 1_000 }),
    (error) => error instanceof AgentOAuthError && error.code === "invalid_grant",
  );
  await assert.rejects(
    () => context.oauth.verifyAccessToken({ token: pair.accessToken, resource: RESOURCE, nowMs: NOW + 2_000 }),
    (error) => error instanceof AgentOAuthError && error.code === "invalid_token",
  );
});

test("an expired code is refused", async () => {
  const context = await fixture();
  const { code, verifier } = await authorized(context);
  await assert.rejects(
    () =>
      context.oauth.exchangeCode({
        code,
        clientId: context.clientId,
        redirectUri: REDIRECT,
        codeVerifier: verifier,
        resource: RESOURCE,
        nowMs: NOW + 61_000,
      }),
    (error) => error instanceof AgentOAuthError && error.code === "invalid_grant",
  );
});

/* ── revocation, which is the criterion this packet had to prove ───────── */

test("revoking an access token blocks the very next call", async () => {
  const context = await fixture();
  const { code, verifier } = await authorized(context);
  const pair = await context.oauth.exchangeCode({
    code,
    clientId: context.clientId,
    redirectUri: REDIRECT,
    codeVerifier: verifier,
    resource: RESOURCE,
    nowMs: NOW,
  });
  await context.oauth.verifyAccessToken({ token: pair.accessToken, resource: RESOURCE, nowMs: NOW });
  await context.oauth.revoke({ token: pair.accessToken, nowMs: NOW + 10 });
  await assert.rejects(
    () => context.oauth.verifyAccessToken({ token: pair.accessToken, resource: RESOURCE, nowMs: NOW + 20 }),
    (error) => error instanceof AgentOAuthError && error.code === "invalid_token",
  );
});

test("revoking the approving key ends the session at its next refresh", async () => {
  const context = await fixture();
  const { code, verifier } = await authorized(context);
  const pair = await context.oauth.exchangeCode({
    code,
    clientId: context.clientId,
    redirectUri: REDIRECT,
    codeVerifier: verifier,
    resource: RESOURCE,
    nowMs: NOW,
  });
  await context.tenancy.revokeKey(context.key.keyId, { revokedAtMs: NOW + 5 });
  await assert.rejects(
    () =>
      context.oauth.refresh({
        refreshToken: pair.refreshToken,
        clientId: context.clientId,
        resource: RESOURCE,
        nowMs: NOW + 10,
      }),
    (error) => error instanceof AgentOAuthError && error.code === "invalid_grant",
  );
  await assert.rejects(
    () => context.oauth.verifyAccessToken({ token: pair.accessToken, resource: RESOURCE, nowMs: NOW + 20 }),
    (error) => error instanceof AgentOAuthError && error.code === "invalid_token",
    "revoking the key must also end the access token it opened",
  );
});

test("revoking an unknown token succeeds silently rather than confirming it exists", async () => {
  const { oauth } = await fixture();
  await oauth.revoke({ token: `ryn_at_${"0".repeat(24)}_${"a".repeat(43)}`, nowMs: NOW });
  await oauth.revoke({ token: "nonsense", nowMs: NOW });
});

test("a refresh rotates the refresh token and retires the old one", async () => {
  const context = await fixture();
  const { code, verifier } = await authorized(context);
  const first = await context.oauth.exchangeCode({
    code,
    clientId: context.clientId,
    redirectUri: REDIRECT,
    codeVerifier: verifier,
    resource: RESOURCE,
    nowMs: NOW,
  });
  const second = await context.oauth.refresh({
    refreshToken: first.refreshToken,
    clientId: context.clientId,
    resource: RESOURCE,
    nowMs: NOW + 60_000,
  });
  assert.notEqual(second.refreshToken, first.refreshToken);
  await assert.rejects(
    () =>
      context.oauth.refresh({
        refreshToken: first.refreshToken,
        clientId: context.clientId,
        resource: RESOURCE,
        nowMs: NOW + 61_000,
      }),
    (error) => error instanceof AgentOAuthError && error.code === "invalid_grant",
  );
});

/* ── what is stored, and what is not ───────────────────────────────────── */

test("credential storage checks keep the complete base64url secret material", () => {
  const material = "alpha_beta_gamma_delta";
  assert.equal(presentableSecretMaterial(`ryn_at_${"a".repeat(24)}_${material}`), material);
  assert.equal(presentableSecretMaterial(material), material);
});

test("no presentable credential is stored", async () => {
  const context = await fixture();
  const { code, verifier } = await authorized(context);
  const pair = await context.oauth.exchangeCode({
    code,
    clientId: context.clientId,
    redirectUri: REDIRECT,
    codeVerifier: verifier,
    resource: RESOURCE,
    nowMs: NOW,
  });
  const dumped = [];
  for (const name of ["agentOauthGrants", "agentOauthTokens", "agentOauthClients"]) {
    dumped.push(JSON.stringify(await context.store.collection(name).valuesWithPrefix("")));
  }
  const dump = dumped.join("");
  for (const secret of [code, pair.accessToken, pair.refreshToken, verifier]) {
    const material = presentableSecretMaterial(secret);
    assert.ok(!dump.includes(material), "a presentable credential survives in the store");
  }
});

test("the scope parser refuses anything outside the closed vocabulary", () => {
  assert.deepEqual(parseScopeString("evidence:read proposal:write"), [
    "evidence:read",
    "proposal:write",
  ]);
  assert.deepEqual(parseScopeString(null), []);
  for (const bad of ["action:execute", "admin", "evidence:read wallet:sign"]) {
    assert.throws(
      () => parseScopeString(bad),
      (error) => error instanceof AgentOAuthError && error.code === "invalid_scope",
      bad,
    );
  }
});

test("the module never logs and never reads process.env", () => {
  const source = readFileSync("lib/agent-control/oauth/server.ts", "utf8");
  assert.ok(!/console\.(log|info|warn|error)/.test(source));
  assert.ok(!/process\.env/.test(source), "the authorization server holds no configured secret");
});
