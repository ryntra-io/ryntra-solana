import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import type { GuardStore, GuardVersionedCollection } from "../../guard/store.ts";
import {
  AGENT_CONTROL_SCOPES,
  authenticateAgentKey,
  createAgentTenancy,
  isAgentControlScope,
  type AgentControlScope,
} from "../tenancy.ts";

/**
 * The authorization server for the hosted MCP endpoint.
 *
 * Ryntra is both the authorization server and the resource server here, which
 * is the ordinary shape for an MCP server that owns its own accounts. The
 * client half — challenge, metadata discovery, bearer verification — comes from
 * the installed SDK; this file is the part the SDK deliberately does not
 * provide, because who may be granted what is a product decision.
 *
 * Four decisions are structural rather than configured:
 *
 * 1. **Every client is public and must use PKCE.** Dynamic client registration
 *    hands out no client secret, so there is nothing to leak from a connector's
 *    configuration and nothing for this repository to rotate. `code_challenge`
 *    is required at authorize time and verified at exchange; a registration
 *    that asks for `client_secret_post` is refused rather than downgraded.
 *
 * 2. **The grant is decided by a human holding a Ryntra key.** The approval
 *    step authenticates an API key and takes the scopes from *that key*, capped
 *    by what the client requested. A client cannot ask its way into a scope the
 *    approving key does not hold, and the scope vocabulary has no member that
 *    could authorize, sign or move value — so no token can carry one, and that
 *    is a property of the type rather than of this file's care.
 *
 * 3. **A token names the resource it is for.** The MCP specification binds a
 *    token to an audience so a token minted for one server cannot be replayed
 *    at another. The `resource` is recorded at authorize time and compared at
 *    verification; a mismatch is `invalid_token`, not a warning.
 *
 * 4. **Nothing presentable is stored.** Codes, access tokens and refresh tokens
 *    persist only as SHA-256 digests, exactly as API keys do. A store dump is
 *    not a set of live sessions.
 *
 * Revocation is the criterion this packet was asked to prove, so it is a single
 * durable flag read on the verification path, before expiry and before scope —
 * a revoked token must not be able to answer "you lack that scope", because
 * that reply says the token was otherwise fine.
 */

export const OAUTH_ERRORS = [
  "invalid_request",
  "invalid_client",
  "invalid_grant",
  "unauthorized_client",
  "unsupported_grant_type",
  "invalid_scope",
  "invalid_token",
  "invalid_target",
  "access_denied",
  "server_error",
] as const;

export type OAuthErrorCode = (typeof OAUTH_ERRORS)[number];

export class AgentOAuthError extends Error {
  readonly code: OAuthErrorCode;
  readonly status: number;

  constructor(code: OAuthErrorCode, message: string, status = 400) {
    super(message);
    this.name = "AgentOAuthError";
    this.code = code;
    this.status = status;
  }
}

const timestamp = z.string().datetime({ offset: true });
const HTTPS_REDIRECT = /^https:\/\/[^\s]+$/;
const LOOPBACK_REDIRECT = /^http:\/\/(?:127\.0\.0\.1|\[::1\]|localhost)(?::\d+)?(?:\/[^\s]*)?$/;

/** RFC 7591 registration, narrowed to the one client shape this server issues. */
export const ClientRegistrationRequestSchema = z
  .object({
    client_name: z.string().min(1).max(120).optional(),
    redirect_uris: z.array(z.string().min(1).max(512)).min(1).max(4),
    grant_types: z.array(z.string()).max(4).optional(),
    response_types: z.array(z.string()).max(4).optional(),
    token_endpoint_auth_method: z.string().max(64).optional(),
    scope: z.string().max(256).optional(),
  })
  .strip();

export const AgentOAuthClientRecordSchema = z
  .object({
    version: z.number().int().nonnegative(),
    clientId: z.string().regex(/^cli_[0-9a-f]{24}$/),
    clientName: z.string().min(1).max(120),
    redirectUris: z.array(z.string().min(1).max(512)).min(1).max(4),
    createdAt: timestamp,
  })
  .strict();

export type AgentOAuthClientRecord = z.output<typeof AgentOAuthClientRecordSchema>;

export const AgentOAuthGrantRecordSchema = z
  .object({
    version: z.number().int().nonnegative(),
    codeId: z.string().regex(/^[0-9a-f]{24}$/),
    codeHash: z.string().regex(/^[0-9a-f]{64}$/),
    clientId: z.string().regex(/^cli_[0-9a-f]{24}$/),
    tenantId: z.string().min(1).max(64),
    keyId: z.string().regex(/^[0-9a-f]{24}$/),
    scopes: z.array(z.enum(AGENT_CONTROL_SCOPES)).min(1),
    redirectUri: z.string().min(1).max(512),
    resource: z.string().min(1).max(512),
    codeChallenge: z.string().min(43).max(128),
    createdAt: timestamp,
    expiresAt: timestamp,
    consumedAt: timestamp.nullable(),
  })
  .strict();

export type AgentOAuthGrantRecord = z.output<typeof AgentOAuthGrantRecordSchema>;

export const AGENT_OAUTH_TOKEN_TYPES = ["ACCESS", "REFRESH"] as const;

export const AgentOAuthTokenRecordSchema = z
  .object({
    version: z.number().int().nonnegative(),
    tokenId: z.string().regex(/^[0-9a-f]{24}$/),
    type: z.enum(AGENT_OAUTH_TOKEN_TYPES),
    tokenHash: z.string().regex(/^[0-9a-f]{64}$/),
    clientId: z.string().regex(/^cli_[0-9a-f]{24}$/),
    tenantId: z.string().min(1).max(64),
    keyId: z.string().regex(/^[0-9a-f]{24}$/),
    scopes: z.array(z.enum(AGENT_CONTROL_SCOPES)).min(1),
    resource: z.string().min(1).max(512),
    /** The grant both halves of a pair belong to, so revoking one revokes both. */
    grantId: z.string().regex(/^[0-9a-f]{24}$/),
    createdAt: timestamp,
    expiresAt: timestamp,
    revokedAt: timestamp.nullable(),
  })
  .strict();

export type AgentOAuthTokenRecord = z.output<typeof AgentOAuthTokenRecordSchema>;

export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
export const AUTHORIZATION_CODE_TTL_SECONDS = 60;

const ACCESS_PREFIX = "ryn_at_";
const REFRESH_PREFIX = "ryn_rt_";
const TOKEN_PATTERN = /^ryn_(at|rt)_([0-9a-f]{24})_([A-Za-z0-9_-]{43})$/;
const CODE_PATTERN = /^ryn_oc_([0-9a-f]{24})_([A-Za-z0-9_-]{43})$/;

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function digestsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * RFC 7636 `S256` only.
 *
 * `plain` is still in the RFC and is refused here: a challenge equal to its
 * verifier protects against nothing an attacker who can read the redirect
 * cannot already do, and supporting both would mean a client could choose the
 * weaker one.
 */
function pkceMatches(verifier: string, challenge: string): boolean {
  const computed = createHash("sha256").update(verifier, "ascii").digest("base64url");
  if (computed.length !== challenge.length) return false;
  return timingSafeEqual(Buffer.from(computed), Buffer.from(challenge));
}

export function parseScopeString(raw: string | null | undefined): AgentControlScope[] {
  if (!raw) return [];
  const requested = raw.split(/[\s+]+/).filter(Boolean);
  const scopes: AgentControlScope[] = [];
  for (const scope of requested) {
    if (!isAgentControlScope(scope)) {
      throw new AgentOAuthError("invalid_scope", `${scope} is not a scope this server issues.`);
    }
    if (!scopes.includes(scope)) scopes.push(scope);
  }
  return scopes;
}

function assertRedirectUri(value: string): void {
  if (!HTTPS_REDIRECT.test(value) && !LOOPBACK_REDIRECT.test(value)) {
    throw new AgentOAuthError(
      "invalid_request",
      "A redirect URI must be https, or http on a loopback address for a local connector.",
    );
  }
  if (value.includes("#")) {
    throw new AgentOAuthError("invalid_request", "A redirect URI may not carry a fragment.");
  }
}

export type AgentOAuthServer = Readonly<{
  registerClient(input: {
    request: unknown;
    nowMs: number;
  }): Promise<Readonly<{ clientId: string; record: AgentOAuthClientRecord }>>;
  readClient(clientId: string): Promise<AgentOAuthClientRecord | undefined>;
  approve(input: {
    clientId: string;
    apiKey: string;
    requestedScopes: readonly AgentControlScope[];
    redirectUri: string;
    resource: string;
    codeChallenge: string;
    codeChallengeMethod: string;
    nowMs: number;
  }): Promise<Readonly<{ code: string; scopes: readonly AgentControlScope[] }>>;
  exchangeCode(input: {
    code: string;
    clientId: string;
    redirectUri: string;
    codeVerifier: string;
    resource: string | null;
    nowMs: number;
  }): Promise<AgentOAuthTokenPair>;
  refresh(input: {
    refreshToken: string;
    clientId: string;
    resource: string | null;
    nowMs: number;
  }): Promise<AgentOAuthTokenPair>;
  verifyAccessToken(input: {
    token: string;
    resource: string;
    nowMs: number;
  }): Promise<AgentOAuthVerification>;
  revoke(input: { token: string; nowMs: number }): Promise<void>;
  revokeGrant(input: { grantId: string; nowMs: number }): Promise<number>;
}>;

export type AgentOAuthTokenPair = Readonly<{
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  scopes: readonly AgentControlScope[];
  tenantId: string;
}>;

export type AgentOAuthVerification = Readonly<{
  token: string;
  clientId: string;
  tenantId: string;
  keyId: string;
  grantId: string;
  scopes: readonly AgentControlScope[];
  expiresAtSeconds: number;
}>;

export function createAgentOAuthServer(store: GuardStore): AgentOAuthServer {
  const tenancy = createAgentTenancy(store);
  const clients = (): GuardVersionedCollection<AgentOAuthClientRecord> =>
    store.versioned<AgentOAuthClientRecord>("agentOauthClients");
  const grants = (): GuardVersionedCollection<AgentOAuthGrantRecord> =>
    store.versioned<AgentOAuthGrantRecord>("agentOauthGrants");
  const tokens = (): GuardVersionedCollection<AgentOAuthTokenRecord> =>
    store.versioned<AgentOAuthTokenRecord>("agentOauthTokens");

  async function mintPair(
    grant: Readonly<{
      grantId: string;
      clientId: string;
      tenantId: string;
      keyId: string;
      scopes: readonly AgentControlScope[];
      resource: string;
    }>,
    nowMs: number,
  ): Promise<AgentOAuthTokenPair> {
    const collection = tokens();
    const make = async (type: "ACCESS" | "REFRESH", ttlSeconds: number) => {
      const tokenId = randomBytes(12).toString("hex");
      const secret = randomBytes(32).toString("base64url");
      const presentable = `${type === "ACCESS" ? ACCESS_PREFIX : REFRESH_PREFIX}${tokenId}_${secret}`;
      const record = AgentOAuthTokenRecordSchema.parse({
        version: 0,
        tokenId,
        type,
        tokenHash: sha256Hex(secret),
        clientId: grant.clientId,
        tenantId: grant.tenantId,
        keyId: grant.keyId,
        scopes: [...grant.scopes],
        resource: grant.resource,
        grantId: grant.grantId,
        createdAt: iso(nowMs),
        expiresAt: iso(nowMs + ttlSeconds * 1_000),
        revokedAt: null,
      });
      if (!(await collection.insertIfAbsent(tokenId, record))) {
        throw new AgentOAuthError("server_error", "The generated token id was already claimed.", 500);
      }
      await collection.insertIfAbsent(`grant:${grant.grantId}:${tokenId}`, record);
      return presentable;
    };

    const accessToken = await make("ACCESS", ACCESS_TOKEN_TTL_SECONDS);
    const refreshToken = await make("REFRESH", REFRESH_TOKEN_TTL_SECONDS);
    return {
      accessToken,
      refreshToken,
      expiresInSeconds: ACCESS_TOKEN_TTL_SECONDS,
      scopes: grant.scopes,
      tenantId: grant.tenantId,
    };
  }

  async function readToken(
    presented: string,
  ): Promise<Readonly<{ record: AgentOAuthTokenRecord; type: "at" | "rt" }> | null> {
    const match = TOKEN_PATTERN.exec(presented ?? "");
    if (!match) return null;
    const [, kind, tokenId, secret] = match;
    const record = await tokens().get(tokenId);
    if (!record) return null;
    if (!digestsMatch(record.tokenHash, sha256Hex(secret))) return null;
    if (record.type !== (kind === "at" ? "ACCESS" : "REFRESH")) return null;
    return { record, type: kind as "at" | "rt" };
  }

  async function markRevoked(record: AgentOAuthTokenRecord, nowMs: number): Promise<void> {
    if (record.revokedAt !== null) return;
    const next = AgentOAuthTokenRecordSchema.parse({
      ...record,
      version: record.version + 1,
      revokedAt: iso(nowMs),
    });
    await tokens().compareAndSet(record.tokenId, record.version, next);
    const mirrorKey = `grant:${record.grantId}:${record.tokenId}`;
    const mirror = await tokens().get(mirrorKey);
    if (mirror) await tokens().compareAndSet(mirrorKey, mirror.version, next);
  }

  return {
    async registerClient({ request, nowMs }) {
      const parsed = ClientRegistrationRequestSchema.safeParse(request);
      if (!parsed.success) {
        throw new AgentOAuthError("invalid_request", "The registration request is not accepted.");
      }
      const body = parsed.data;
      if (body.token_endpoint_auth_method && body.token_endpoint_auth_method !== "none") {
        throw new AgentOAuthError(
          "invalid_request",
          "This server registers public PKCE clients only; it issues no client secret.",
        );
      }
      for (const type of body.grant_types ?? ["authorization_code"]) {
        if (type !== "authorization_code" && type !== "refresh_token") {
          throw new AgentOAuthError("invalid_request", `Grant type ${type} is not supported.`);
        }
      }
      for (const uri of body.redirect_uris) assertRedirectUri(uri);

      const clientId = `cli_${randomBytes(12).toString("hex")}`;
      const record = AgentOAuthClientRecordSchema.parse({
        version: 0,
        clientId,
        clientName: body.client_name ?? "Unnamed MCP client",
        redirectUris: body.redirect_uris,
        createdAt: iso(nowMs),
      });
      if (!(await clients().insertIfAbsent(clientId, record))) {
        throw new AgentOAuthError("server_error", "The generated client id was already claimed.", 500);
      }
      return { clientId, record };
    },

    readClient(clientId) {
      return clients().get(clientId);
    },

    async approve({
      clientId,
      apiKey,
      requestedScopes,
      redirectUri,
      resource,
      codeChallenge,
      codeChallengeMethod,
      nowMs,
    }) {
      if (codeChallengeMethod !== "S256") {
        throw new AgentOAuthError("invalid_request", "Only the S256 code challenge method is accepted.");
      }
      if (!/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge)) {
        throw new AgentOAuthError("invalid_request", "The code challenge is malformed.");
      }
      const client = await clients().get(clientId);
      if (!client) throw new AgentOAuthError("invalid_client", "No such client is registered.", 401);
      if (!client.redirectUris.includes(redirectUri)) {
        throw new AgentOAuthError("invalid_request", "The redirect URI is not registered for this client.");
      }

      const decision = await authenticateAgentKey(tenancy, apiKey, { nowMs });
      if (!decision.accepted) {
        throw new AgentOAuthError(
          "access_denied",
          `The approving key was refused: ${decision.reasonCode}.`,
          403,
        );
      }

      /* The key is the ceiling. A client may ask for less than the approving
         key holds and gets what it asked for; asking for more is refused rather
         than silently trimmed, because a connector that believes it has a scope
         it does not will fail later at a call site nobody is watching. */
      const granted = requestedScopes.length === 0 ? decision.principal.scopes : requestedScopes;
      for (const scope of granted) {
        if (!decision.principal.scopes.includes(scope)) {
          throw new AgentOAuthError(
            "invalid_scope",
            `The approving key does not hold ${scope}, so it cannot grant it.`,
          );
        }
      }
      if (granted.length === 0) {
        throw new AgentOAuthError("invalid_scope", "A grant with no scope would authorize nothing.");
      }

      const codeId = randomBytes(12).toString("hex");
      const secret = randomBytes(32).toString("base64url");
      const record = AgentOAuthGrantRecordSchema.parse({
        version: 0,
        codeId,
        codeHash: sha256Hex(secret),
        clientId,
        tenantId: decision.principal.tenantId,
        keyId: decision.principal.keyId,
        scopes: [...granted],
        redirectUri,
        resource,
        codeChallenge,
        createdAt: iso(nowMs),
        expiresAt: iso(nowMs + AUTHORIZATION_CODE_TTL_SECONDS * 1_000),
        consumedAt: null,
      });
      if (!(await grants().insertIfAbsent(codeId, record))) {
        throw new AgentOAuthError("server_error", "The generated code id was already claimed.", 500);
      }
      return { code: `ryn_oc_${codeId}_${secret}`, scopes: granted };
    },

    async exchangeCode({ code, clientId, redirectUri, codeVerifier, resource, nowMs }) {
      const match = CODE_PATTERN.exec(code ?? "");
      if (!match) throw new AgentOAuthError("invalid_grant", "The authorization code is malformed.");
      const [, codeId, secret] = match;
      const record = await grants().get(codeId);
      if (!record) throw new AgentOAuthError("invalid_grant", "The authorization code is not known.");
      if (!digestsMatch(record.codeHash, sha256Hex(secret))) {
        throw new AgentOAuthError("invalid_grant", "The authorization code is not known.");
      }

      /* A replayed code revokes the tokens the first exchange produced. RFC 6749
         §10.5 asks for exactly this: a second use means the code leaked, and the
         session it opened is no longer trustworthy. */
      if (record.consumedAt !== null) {
        await this.revokeGrant({ grantId: record.codeId, nowMs });
        throw new AgentOAuthError(
          "invalid_grant",
          "This authorization code was already exchanged; the session it opened has been revoked.",
        );
      }
      if (Date.parse(record.expiresAt) <= nowMs) {
        throw new AgentOAuthError("invalid_grant", "The authorization code has expired.");
      }
      if (record.clientId !== clientId) {
        throw new AgentOAuthError("invalid_grant", "The code was issued to a different client.");
      }
      if (record.redirectUri !== redirectUri) {
        throw new AgentOAuthError("invalid_grant", "The redirect URI does not match the one authorized.");
      }
      if (resource !== null && resource !== record.resource) {
        throw new AgentOAuthError("invalid_target", "The requested resource is not the one authorized.");
      }
      if (!codeVerifier || !pkceMatches(codeVerifier, record.codeChallenge)) {
        throw new AgentOAuthError("invalid_grant", "The code verifier does not match the challenge.");
      }

      const consumed = AgentOAuthGrantRecordSchema.parse({
        ...record,
        version: record.version + 1,
        consumedAt: iso(nowMs),
      });
      if (!(await grants().compareAndSet(codeId, record.version, consumed))) {
        throw new AgentOAuthError("invalid_grant", "The authorization code was exchanged concurrently.");
      }

      return mintPair(
        {
          grantId: record.codeId,
          clientId: record.clientId,
          tenantId: record.tenantId,
          keyId: record.keyId,
          scopes: record.scopes,
          resource: record.resource,
        },
        nowMs,
      );
    },

    async refresh({ refreshToken, clientId, resource, nowMs }) {
      const found = await readToken(refreshToken);
      if (!found || found.type !== "rt") {
        throw new AgentOAuthError("invalid_grant", "The refresh token is not known.");
      }
      const { record } = found;
      if (record.revokedAt !== null) {
        throw new AgentOAuthError("invalid_grant", "The refresh token has been revoked.");
      }
      if (Date.parse(record.expiresAt) <= nowMs) {
        throw new AgentOAuthError("invalid_grant", "The refresh token has expired.");
      }
      if (record.clientId !== clientId) {
        throw new AgentOAuthError("invalid_grant", "The refresh token belongs to a different client.");
      }
      if (resource !== null && resource !== record.resource) {
        throw new AgentOAuthError("invalid_grant", "The requested resource is not the one authorized.");
      }
      /* The key that approved the grant is still the ceiling. Revoking that key
         must end the sessions it opened, and a refresh is where a long-lived
         session next asks. */
      const key = await tenancy.readKey(record.keyId).catch(() => null);
      if (!key || key.revokedAt !== null) {
        await this.revokeGrant({ grantId: record.grantId, nowMs });
        throw new AgentOAuthError("invalid_grant", "The key that approved this session has been revoked.");
      }
      await markRevoked(record, nowMs);
      return mintPair(
        {
          grantId: record.grantId,
          clientId: record.clientId,
          tenantId: record.tenantId,
          keyId: record.keyId,
          scopes: record.scopes,
          resource: record.resource,
        },
        nowMs,
      );
    },

    async verifyAccessToken({ token, resource, nowMs }) {
      const found = await readToken(token);
      if (!found || found.type !== "at") {
        throw new AgentOAuthError("invalid_token", "The access token is not known.", 401);
      }
      const { record } = found;
      /* Revocation is read before expiry and before audience, because a revoked
         token must not be able to produce a reply that says it was otherwise
         fine. */
      if (record.revokedAt !== null) {
        throw new AgentOAuthError("invalid_token", "The access token has been revoked.", 401);
      }
      if (Date.parse(record.expiresAt) <= nowMs) {
        throw new AgentOAuthError("invalid_token", "The access token has expired.", 401);
      }
      if (record.resource !== resource) {
        throw new AgentOAuthError("invalid_token", "The access token was issued for another resource.", 401);
      }
      return {
        token,
        clientId: record.clientId,
        tenantId: record.tenantId,
        keyId: record.keyId,
        grantId: record.grantId,
        scopes: record.scopes,
        expiresAtSeconds: Math.floor(Date.parse(record.expiresAt) / 1_000),
      };
    },

    async revoke({ token, nowMs }) {
      const found = await readToken(token);
      /* RFC 7009: an unknown token is a successful revocation. Answering
         "unknown" would turn the endpoint into an oracle for guessing tokens. */
      if (!found) return;
      await markRevoked(found.record, nowMs);
    },

    async revokeGrant({ grantId, nowMs }) {
      const issued = await tokens().valuesWithPrefix(`grant:${grantId}:`);
      let revoked = 0;
      for (const record of issued) {
        if (record.revokedAt !== null) continue;
        const live = await tokens().get(record.tokenId);
        if (!live) continue;
        await markRevoked(live, nowMs);
        revoked += 1;
      }
      return revoked;
    },
  };
}
