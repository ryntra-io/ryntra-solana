import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { isAddress } from "@solana/kit";
import { z } from "zod";

import type { GuardStore } from "../guard/store.ts";
import { fetchClientMetadataDocument, isCimdClientId, redirectUriShapeOk, type CimdDeps } from "./cimd.ts";
import { buildConsentInput, cleanClientName, consentMessageText, consentStatement, redirectHost, verifyConsentSignature } from "./consent.ts";
import { CONNECTOR_SCOPES, IGNORED_SCOPES, connectorResource, isConnectorResource, isConnectorScope, type ConnectorScope } from "./metadata.ts";

/**
 * The connector's authorization server: who may connect, and what a connection may do (CITY-154).
 *
 * The shape is the one Agent Control's hosted MCP proved in August (`lib/agent-control/oauth/server.ts`) — public
 * clients with PKCE S256, a token bound to the resource it was minted for, revocation read before expiry, nothing
 * presentable stored — with the one change the Solana product needs: **the grant is decided by a wallet, not by an API
 * key.** The person signs one Sign In With Solana message that names the client and says nothing can move
 * (`./consent.ts`); that signature, over a nonce this server issued for exactly this request, is the approval. The
 * grant is bound to the wallet that signed, so quotas and receipts know whose connection it is, and later phases can
 * add private reads for that wallet without a second identity.
 *
 * Its own records, beside Agent Control's rather than inside them: a wallet grant is not a tenant key grant, and a scan
 * of one must never return the other. They live in the same generic Guard table — new values in its collection column,
 * no DDL.
 *
 * Five decisions are structural:
 *
 * 1. **Every client is public.** Dynamic registration hands out no secret; a CIMD document that asks for one is
 *    refused. A client proves possession by the PKCE verifier whose challenge it published before the code existed.
 * 2. **The scope vocabulary can only read.** `market:read` is the only member; nothing a client asks for can grant a
 *    signature, a transfer or a trade, because no such word exists here.
 * 3. **A token names its resource.** `resource` is fixed at consent and compared on every call.
 * 4. **Nothing presentable is stored.** Codes and tokens persist as SHA-256 digests.
 * 5. **A refresh token is used once.** Each refresh rotates the pair; presenting a rotated refresh token again means it
 *    leaked, and the whole grant it belongs to is revoked (RFC 9700 §4.14).
 */

export const CONNECTOR_OAUTH_ERRORS = [
  "invalid_request",
  "invalid_client",
  "invalid_grant",
  "unauthorized_client",
  "unsupported_grant_type",
  "unsupported_response_type",
  "invalid_scope",
  "invalid_token",
  "invalid_target",
  "access_denied",
  "invalid_client_metadata",
  "invalid_redirect_uri",
  "temporarily_unavailable",
  "server_error",
] as const;

export type ConnectorOAuthErrorCode = (typeof CONNECTOR_OAUTH_ERRORS)[number];

export class ConnectorOAuthError extends Error {
  readonly code: ConnectorOAuthErrorCode;
  readonly status: number;

  constructor(code: ConnectorOAuthErrorCode, message: string, status = 400) {
    super(message);
    this.name = "ConnectorOAuthError";
    this.code = code;
    this.status = status;
  }
}

export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
export const AUTHORIZATION_CODE_TTL_SECONDS = 60;
export const CONSENT_TTL_SECONDS = 5 * 60;

const timestamp = z.string().datetime({ offset: true });
const WALLET = z.string().min(32).max(44).refine((value) => isAddress(value), "a Solana address");
const CLIENT_ID = z.string().min(1).max(512);
const SCOPES = z.array(z.enum(CONNECTOR_SCOPES)).min(1);

export const ConnectorClientRecordSchema = z
  .object({
    version: z.number().int().nonnegative(),
    clientId: z.string().regex(/^rcc_[0-9a-f]{24}$/),
    clientName: z.string().min(1).max(120),
    redirectUris: z.array(z.string().min(1).max(512)).min(1).max(10),
    createdAt: timestamp,
  })
  .strict();
export type ConnectorClientRecord = z.output<typeof ConnectorClientRecordSchema>;

export const ConnectorConsentRecordSchema = z
  .object({
    version: z.number().int().nonnegative(),
    nonce: z.string().regex(/^[0-9a-f]{32}$/),
    clientId: CLIENT_ID,
    address: WALLET,
    redirectUri: z.string().min(1).max(512),
    state: z.string().max(1_024),
    scopes: SCOPES,
    resource: z.string().min(1).max(512),
    codeChallenge: z.string().min(43).max(128),
    domain: z.string().min(1).max(256),
    uri: z.string().min(1).max(512),
    statement: z.string().min(1).max(400),
    issuedAt: timestamp,
    expiresAt: timestamp,
    consumedAt: timestamp.nullable(),
  })
  .strict();
export type ConnectorConsentRecord = z.output<typeof ConnectorConsentRecordSchema>;

export const ConnectorCodeRecordSchema = z
  .object({
    version: z.number().int().nonnegative(),
    codeId: z.string().regex(/^[0-9a-f]{24}$/),
    codeHash: z.string().regex(/^[0-9a-f]{64}$/),
    clientId: CLIENT_ID,
    wallet: WALLET,
    scopes: SCOPES,
    redirectUri: z.string().min(1).max(512),
    resource: z.string().min(1).max(512),
    codeChallenge: z.string().min(43).max(128),
    createdAt: timestamp,
    expiresAt: timestamp,
    consumedAt: timestamp.nullable(),
  })
  .strict();
export type ConnectorCodeRecord = z.output<typeof ConnectorCodeRecordSchema>;

export const ConnectorTokenRecordSchema = z
  .object({
    version: z.number().int().nonnegative(),
    tokenId: z.string().regex(/^[0-9a-f]{24}$/),
    type: z.enum(["ACCESS", "REFRESH"]),
    tokenHash: z.string().regex(/^[0-9a-f]{64}$/),
    clientId: CLIENT_ID,
    wallet: WALLET,
    scopes: SCOPES,
    resource: z.string().min(1).max(512),
    /** The grant every token of one consent belongs to, so revoking one revokes the session. */
    grantId: z.string().regex(/^[0-9a-f]{24}$/),
    createdAt: timestamp,
    expiresAt: timestamp,
    revokedAt: timestamp.nullable(),
  })
  .strict();
export type ConnectorTokenRecord = z.output<typeof ConnectorTokenRecordSchema>;

const ACCESS_PREFIX = "rca_";
const REFRESH_PREFIX = "rcr_";
const TOKEN_PATTERN = /^rc(a|r)_([0-9a-f]{24})_([A-Za-z0-9_-]{43})$/;
const CODE_PATTERN = /^rcc_oc_([0-9a-f]{24})_([A-Za-z0-9_-]{43})$/;

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

/** RFC 7636 `S256` only; `plain` protects against nothing an attacker who reads the redirect cannot already do. */
function pkceMatches(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  const computed = createHash("sha256").update(verifier, "ascii").digest("base64url");
  if (computed.length !== challenge.length) return false;
  return timingSafeEqual(Buffer.from(computed), Buffer.from(challenge));
}

/**
 * A redirect URI matches a registered one exactly — except a loopback one, whose port is the client's to choose at
 * run time (RFC 8252 §7.3): local clients listen on whatever port is free.
 */
export function redirectMatches(registered: readonly string[], asked: string): boolean {
  if (registered.includes(asked)) return true;
  let target: URL;
  try {
    target = new URL(asked);
  } catch {
    return false;
  }
  if (target.protocol !== "http:" || !["127.0.0.1", "[::1]", "localhost"].includes(target.hostname)) return false;
  return registered.some((candidate) => {
    try {
      const url = new URL(candidate);
      return url.protocol === "http:" && url.hostname === target.hostname && url.pathname === target.pathname && url.search === target.search;
    } catch {
      return false;
    }
  });
}

/** The scopes a request asks for, narrowed to this server's vocabulary. Empty means all of it. */
export function parseConnectorScopes(raw: string | null | undefined): ConnectorScope[] {
  if (!raw || !raw.trim()) return [...CONNECTOR_SCOPES];
  const scopes: ConnectorScope[] = [];
  for (const word of raw.split(/[\s+]+/).filter(Boolean)) {
    if ((IGNORED_SCOPES as readonly string[]).includes(word)) continue;
    if (!isConnectorScope(word)) throw new ConnectorOAuthError("invalid_scope", `${word.slice(0, 64)} is not a scope this server issues.`);
    if (!scopes.includes(word)) scopes.push(word);
  }
  return scopes.length ? scopes : [...CONNECTOR_SCOPES];
}

export type ResolvedClient = Readonly<{ clientId: string; clientName: string; redirectUris: readonly string[]; kind: "REGISTERED" | "METADATA_DOCUMENT" }>;

/** An authorization request as the consent page receives it, every field a string. */
export type AuthorizationParams = Readonly<{
  response_type?: string | null;
  client_id?: string | null;
  redirect_uri?: string | null;
  scope?: string | null;
  state?: string | null;
  code_challenge?: string | null;
  code_challenge_method?: string | null;
  resource?: string | null;
}>;

export type AuthorizationRequest = Readonly<{
  client: ResolvedClient;
  redirectUri: string;
  scopes: readonly ConnectorScope[];
  state: string;
  codeChallenge: string;
  resource: string;
  /** What the wallet will show, and what the page repeats. */
  statement: string;
  host: string;
  clientName: string;
}>;

/**
 * The outcome of checking an authorization request.
 *
 * `PAGE` errors are answered on Ryntra's own page and never redirected: an unknown client or an unregistered redirect
 * URI is exactly when bouncing the browser elsewhere would build an open redirector. `REDIRECT` errors go back to the
 * client's verified redirect URI, as OAuth asks.
 */
export type AuthorizationCheck =
  | Readonly<{ ok: true; request: AuthorizationRequest }>
  | Readonly<{ ok: false; mode: "PAGE"; code: ConnectorOAuthErrorCode; message: string }>
  | Readonly<{ ok: false; mode: "REDIRECT"; code: ConnectorOAuthErrorCode; message: string; redirectTo: string }>;

/** The URL a refusal or a denial goes back to: the verified redirect URI with the error and the client's state. */
export function errorRedirect(redirectUri: string, code: string, message: string, state: string): string {
  const target = new URL(redirectUri);
  target.searchParams.set("error", code);
  target.searchParams.set("error_description", message);
  if (state) target.searchParams.set("state", state);
  return target.toString();
}

export type ConnectorOAuthServer = Readonly<{
  registerClient(input: { request: unknown; nowMs: number }): Promise<ConnectorClientRecord>;
  resolveClient(clientId: string): Promise<ResolvedClient | null>;
  checkAuthorization(params: AuthorizationParams, origin: string): Promise<AuthorizationCheck>;
  issueConsent(input: { params: AuthorizationParams; address: string; origin: string; domain: string; nowMs: number }): Promise<
    Readonly<{ nonce: string; input: ReturnType<typeof buildConsentInput>; message: string; statement: string }>
  >;
  approveConsent(input: { nonce: string; address: string; signedMessage: Uint8Array; signature: Uint8Array; nowMs: number }): Promise<
    Readonly<{ redirectTo: string; wallet: string; clientId: string }>
  >;
  exchangeCode(input: { code: string; clientId: string; redirectUri: string; codeVerifier: string; resource: string | null; nowMs: number }): Promise<ConnectorTokenPair>;
  refresh(input: { refreshToken: string; clientId: string; resource: string | null; nowMs: number }): Promise<ConnectorTokenPair>;
  verifyAccessToken(input: { token: string; resource: string; nowMs: number }): Promise<ConnectorVerification>;
  revoke(input: { token: string; nowMs: number }): Promise<void>;
  revokeGrant(input: { grantId: string; nowMs: number }): Promise<number>;
}>;

export type ConnectorTokenPair = Readonly<{
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  scopes: readonly ConnectorScope[];
}>;

export type ConnectorVerification = Readonly<{
  clientId: string;
  wallet: string;
  grantId: string;
  tokenId: string;
  scopes: readonly ConnectorScope[];
  expiresAtSeconds: number;
}>;

const RegistrationSchema = z
  .object({
    client_name: z.string().min(1).max(200).optional(),
    redirect_uris: z.array(z.string().min(1).max(512)).min(1).max(10),
    grant_types: z.array(z.string().max(64)).max(4).optional(),
    response_types: z.array(z.string().max(32)).max(4).optional(),
    token_endpoint_auth_method: z.string().max(64).optional(),
    scope: z.string().max(256).optional(),
  })
  .strip();

export type ConnectorOAuthOptions = Readonly<{ cimd?: CimdDeps }>;

export function createConnectorOAuthServer(store: GuardStore, options: ConnectorOAuthOptions = {}): ConnectorOAuthServer {
  const clients = () => store.versioned<ConnectorClientRecord>("connectorClients");
  const consents = () => store.versioned<ConnectorConsentRecord>("connectorConsents");
  const codes = () => store.versioned<ConnectorCodeRecord>("connectorCodes");
  const tokens = () => store.versioned<ConnectorTokenRecord>("connectorTokens");

  async function resolveClient(clientId: string): Promise<ResolvedClient | null> {
    if (!clientId || clientId.length > 512) return null;
    if (isCimdClientId(clientId)) {
      const read = await fetchClientMetadataDocument(clientId, options.cimd);
      if (!read.ok) return null;
      return { clientId, clientName: read.client.clientName, redirectUris: read.client.redirectUris, kind: "METADATA_DOCUMENT" };
    }
    if (!/^rcc_[0-9a-f]{24}$/.test(clientId)) return null;
    const record = await clients().get(clientId);
    return record ? { clientId, clientName: record.clientName, redirectUris: record.redirectUris, kind: "REGISTERED" } : null;
  }

  async function mintPair(
    grant: Readonly<{ grantId: string; clientId: string; wallet: string; scopes: readonly ConnectorScope[]; resource: string }>,
    nowMs: number,
  ): Promise<ConnectorTokenPair> {
    const make = async (type: "ACCESS" | "REFRESH", ttlSeconds: number) => {
      const tokenId = randomBytes(12).toString("hex");
      const secret = randomBytes(32).toString("base64url");
      const record = ConnectorTokenRecordSchema.parse({
        version: 0,
        tokenId,
        type,
        tokenHash: sha256Hex(secret),
        clientId: grant.clientId,
        wallet: grant.wallet,
        scopes: [...grant.scopes],
        resource: grant.resource,
        grantId: grant.grantId,
        createdAt: iso(nowMs),
        expiresAt: iso(nowMs + ttlSeconds * 1_000),
        revokedAt: null,
      });
      if (!(await tokens().insertIfAbsent(tokenId, record))) {
        throw new ConnectorOAuthError("server_error", "The generated token id was already claimed.", 500);
      }
      /* A mirror keyed by grant, so a whole session can be found and revoked with the one scan the store has. */
      await tokens().insertIfAbsent(`grant:${grant.grantId}:${tokenId}`, record);
      return `${type === "ACCESS" ? ACCESS_PREFIX : REFRESH_PREFIX}${tokenId}_${secret}`;
    };
    const accessToken = await make("ACCESS", ACCESS_TOKEN_TTL_SECONDS);
    const refreshToken = await make("REFRESH", REFRESH_TOKEN_TTL_SECONDS);
    return { accessToken, refreshToken, expiresInSeconds: ACCESS_TOKEN_TTL_SECONDS, scopes: grant.scopes };
  }

  async function readToken(presented: string): Promise<Readonly<{ record: ConnectorTokenRecord; kind: "a" | "r" }> | null> {
    const match = TOKEN_PATTERN.exec(presented ?? "");
    if (!match) return null;
    const [, kind, tokenId, secret] = match;
    const record = await tokens().get(tokenId);
    if (!record) return null;
    if (!digestsMatch(record.tokenHash, sha256Hex(secret))) return null;
    if (record.type !== (kind === "a" ? "ACCESS" : "REFRESH")) return null;
    return { record, kind: kind as "a" | "r" };
  }

  async function markRevoked(record: ConnectorTokenRecord, nowMs: number): Promise<void> {
    if (record.revokedAt !== null) return;
    const next = ConnectorTokenRecordSchema.parse({ ...record, version: record.version + 1, revokedAt: iso(nowMs) });
    await tokens().compareAndSet(record.tokenId, record.version, next);
    const mirrorKey = `grant:${record.grantId}:${record.tokenId}`;
    const mirror = await tokens().get(mirrorKey);
    if (mirror) await tokens().compareAndSet(mirrorKey, mirror.version, next);
  }

  async function revokeGrant({ grantId, nowMs }: { grantId: string; nowMs: number }): Promise<number> {
    const issued = await tokens().valuesWithPrefix(`grant:${grantId}:`);
    let revoked = 0;
    for (const mirror of issued) {
      const live = await tokens().get(mirror.tokenId);
      if (!live || live.revokedAt !== null) continue;
      await markRevoked(live, nowMs);
      revoked += 1;
    }
    return revoked;
  }

  async function checkAuthorization(params: AuthorizationParams, origin: string): Promise<AuthorizationCheck> {
    const clientId = params.client_id ?? "";
    const client = await resolveClient(clientId);
    if (!client) return { ok: false, mode: "PAGE", code: "invalid_client", message: "This app is not known to Ryntra, or its details could not be read." };
    const redirectUri = params.redirect_uri ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : "");
    if (!redirectUri || !redirectUriShapeOk(redirectUri) || !redirectMatches(client.redirectUris, redirectUri)) {
      return { ok: false, mode: "PAGE", code: "invalid_request", message: "This app asked to return to an address it never registered." };
    }
    const state = (params.state ?? "").slice(0, 1_024);
    const back = (code: ConnectorOAuthErrorCode, message: string): AuthorizationCheck => ({
      ok: false,
      mode: "REDIRECT",
      code,
      message,
      redirectTo: errorRedirect(redirectUri, code, message, state),
    });
    if ((params.response_type ?? "") !== "code") return back("unsupported_response_type", "Only the authorization code flow is supported.");
    const challenge = params.code_challenge ?? "";
    if ((params.code_challenge_method ?? "") !== "S256") return back("invalid_request", "PKCE with the S256 method is required.");
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(challenge)) return back("invalid_request", "The code challenge is missing or malformed.");
    const resource = params.resource && params.resource.length > 0 ? params.resource : connectorResource(origin);
    /* `/mcp` or the catalog's `/mcp/read` (CITY-170): the grant names the one it was asked for, and a token for one is
       refused at the other. */
    if (!isConnectorResource(origin, resource)) return back("invalid_target", "This server issues tokens for its own MCP endpoints only.");
    let scopes: ConnectorScope[];
    try {
      scopes = parseConnectorScopes(params.scope);
    } catch (error) {
      return back("invalid_scope", error instanceof ConnectorOAuthError ? error.message : "The requested scope is not accepted.");
    }
    const host = redirectHost(redirectUri);
    const clientName = cleanClientName(client.clientName);
    return {
      ok: true,
      request: { client, redirectUri, scopes, state, codeChallenge: challenge, resource, statement: consentStatement(clientName, host), host, clientName },
    };
  }

  return {
    async registerClient({ request, nowMs }) {
      const parsed = RegistrationSchema.safeParse(request);
      if (!parsed.success) throw new ConnectorOAuthError("invalid_client_metadata", "The registration request is not accepted.");
      const body = parsed.data;
      if (body.token_endpoint_auth_method && body.token_endpoint_auth_method !== "none") {
        throw new ConnectorOAuthError("invalid_client_metadata", "This server registers public PKCE clients only; it issues no client secret.");
      }
      for (const type of body.grant_types ?? ["authorization_code"]) {
        if (type !== "authorization_code" && type !== "refresh_token") {
          throw new ConnectorOAuthError("invalid_client_metadata", `Grant type ${type.slice(0, 64)} is not supported.`);
        }
      }
      if (body.response_types && body.response_types.some((type) => type !== "code")) {
        throw new ConnectorOAuthError("invalid_client_metadata", "Only the code response type is supported.");
      }
      for (const uri of body.redirect_uris) {
        if (!redirectUriShapeOk(uri)) {
          throw new ConnectorOAuthError("invalid_redirect_uri", "A redirect URI must be https, or http on a loopback address for a local client.");
        }
      }
      const clientId = `rcc_${randomBytes(12).toString("hex")}`;
      const record = ConnectorClientRecordSchema.parse({
        version: 0,
        clientId,
        clientName: cleanClientName(body.client_name ?? "MCP client", 120),
        redirectUris: body.redirect_uris,
        createdAt: iso(nowMs),
      });
      if (!(await clients().insertIfAbsent(clientId, record))) {
        throw new ConnectorOAuthError("server_error", "The generated client id was already claimed.", 500);
      }
      return record;
    },

    resolveClient,
    checkAuthorization,

    async issueConsent({ params, address, origin, domain, nowMs }) {
      if (!isAddress(address)) throw new ConnectorOAuthError("invalid_request", "That is not a Solana wallet address.");
      const check = await checkAuthorization(params, origin);
      if (!check.ok) throw new ConnectorOAuthError(check.code, check.message);
      const { request } = check;
      const nonce = randomBytes(16).toString("hex");
      const input = buildConsentInput({ domain, uri: origin, address, nonce, statement: request.statement, nowMs });
      const record = ConnectorConsentRecordSchema.parse({
        version: 0,
        nonce,
        clientId: request.client.clientId,
        address,
        redirectUri: request.redirectUri,
        state: request.state,
        scopes: [...request.scopes],
        resource: request.resource,
        codeChallenge: request.codeChallenge,
        domain,
        uri: origin,
        statement: request.statement,
        issuedAt: input.issuedAt,
        expiresAt: iso(nowMs + CONSENT_TTL_SECONDS * 1_000),
        consumedAt: null,
      });
      if (!(await consents().insertIfAbsent(nonce, record))) {
        throw new ConnectorOAuthError("server_error", "The generated nonce was already claimed.", 500);
      }
      return { nonce, input, message: consentMessageText(input), statement: request.statement };
    },

    async approveConsent({ nonce, address, signedMessage, signature, nowMs }) {
      if (!/^[0-9a-f]{32}$/.test(nonce)) throw new ConnectorOAuthError("invalid_request", "The consent is not known.");
      const record = await consents().get(nonce);
      if (!record) throw new ConnectorOAuthError("invalid_request", "The consent is not known.");
      if (record.consumedAt !== null) throw new ConnectorOAuthError("invalid_request", "This consent was already used. Start again from the app.");
      if (Date.parse(record.expiresAt) <= nowMs) throw new ConnectorOAuthError("invalid_request", "This consent expired. Start again from the app.");
      if (record.address !== address) throw new ConnectorOAuthError("access_denied", "A different wallet signed than the one this consent was issued for.", 403);
      const verdict = await verifyConsentSignature({
        signedMessage,
        signature,
        expected: { domain: record.domain, uri: record.uri, nonce: record.nonce, address: record.address, statement: record.statement },
        nowMs,
      });
      if (!verdict.ok) throw new ConnectorOAuthError("access_denied", `The wallet signature was not accepted (${verdict.reason}).`, 403);
      /* Spent before the code exists: a captured signature finds its nonce gone, and two concurrent approvals of one
         nonce cannot both mint a code. */
      const consumed = ConnectorConsentRecordSchema.parse({ ...record, version: record.version + 1, consumedAt: iso(nowMs) });
      if (!(await consents().compareAndSet(nonce, record.version, consumed))) {
        throw new ConnectorOAuthError("invalid_request", "This consent was already used. Start again from the app.");
      }
      const codeId = randomBytes(12).toString("hex");
      const secret = randomBytes(32).toString("base64url");
      const code = ConnectorCodeRecordSchema.parse({
        version: 0,
        codeId,
        codeHash: sha256Hex(secret),
        clientId: record.clientId,
        wallet: record.address,
        scopes: record.scopes,
        redirectUri: record.redirectUri,
        resource: record.resource,
        codeChallenge: record.codeChallenge,
        createdAt: iso(nowMs),
        expiresAt: iso(nowMs + AUTHORIZATION_CODE_TTL_SECONDS * 1_000),
        consumedAt: null,
      });
      if (!(await codes().insertIfAbsent(codeId, code))) {
        throw new ConnectorOAuthError("server_error", "The generated code id was already claimed.", 500);
      }
      const target = new URL(record.redirectUri);
      target.searchParams.set("code", `rcc_oc_${codeId}_${secret}`);
      if (record.state) target.searchParams.set("state", record.state);
      return { redirectTo: target.toString(), wallet: record.address, clientId: record.clientId };
    },

    async exchangeCode({ code, clientId, redirectUri, codeVerifier, resource, nowMs }) {
      const match = CODE_PATTERN.exec(code ?? "");
      if (!match) throw new ConnectorOAuthError("invalid_grant", "The authorization code is malformed.");
      const [, codeId, secret] = match;
      const record = await codes().get(codeId);
      if (!record || !digestsMatch(record.codeHash, sha256Hex(secret))) {
        throw new ConnectorOAuthError("invalid_grant", "The authorization code is not known.");
      }
      /* A replayed code revokes what the first exchange produced (RFC 6749 §10.5): a second use means it leaked. */
      if (record.consumedAt !== null) {
        await revokeGrant({ grantId: record.codeId, nowMs });
        throw new ConnectorOAuthError("invalid_grant", "This authorization code was already exchanged; the session it opened has been revoked.");
      }
      if (Date.parse(record.expiresAt) <= nowMs) throw new ConnectorOAuthError("invalid_grant", "The authorization code has expired.");
      if (record.clientId !== clientId) throw new ConnectorOAuthError("invalid_grant", "The code was issued to a different client.");
      if (record.redirectUri !== redirectUri) throw new ConnectorOAuthError("invalid_grant", "The redirect URI does not match the one authorized.");
      if (resource !== null && resource !== record.resource) throw new ConnectorOAuthError("invalid_target", "The requested resource is not the one authorized.");
      if (!codeVerifier || !pkceMatches(codeVerifier, record.codeChallenge)) {
        throw new ConnectorOAuthError("invalid_grant", "The code verifier does not match the challenge.");
      }
      const consumed = ConnectorCodeRecordSchema.parse({ ...record, version: record.version + 1, consumedAt: iso(nowMs) });
      if (!(await codes().compareAndSet(codeId, record.version, consumed))) {
        throw new ConnectorOAuthError("invalid_grant", "The authorization code was exchanged concurrently.");
      }
      return mintPair({ grantId: record.codeId, clientId: record.clientId, wallet: record.wallet, scopes: record.scopes, resource: record.resource }, nowMs);
    },

    async refresh({ refreshToken, clientId, resource, nowMs }) {
      const found = await readToken(refreshToken);
      if (!found || found.kind !== "r") throw new ConnectorOAuthError("invalid_grant", "The refresh token is not known.");
      const { record } = found;
      if (record.clientId !== clientId) throw new ConnectorOAuthError("invalid_grant", "The refresh token belongs to a different client.");
      if (record.revokedAt !== null) {
        /* Reuse of a rotated refresh token: whoever holds it is not necessarily the client. End the whole session. */
        await revokeGrant({ grantId: record.grantId, nowMs });
        throw new ConnectorOAuthError("invalid_grant", "The refresh token was already used; the session has been revoked.");
      }
      if (Date.parse(record.expiresAt) <= nowMs) throw new ConnectorOAuthError("invalid_grant", "The refresh token has expired.");
      if (resource !== null && resource !== record.resource) throw new ConnectorOAuthError("invalid_target", "The requested resource is not the one authorized.");
      await markRevoked(record, nowMs);
      /* The access token the old pair carried ends with it: one live pair per grant. */
      const siblings = await tokens().valuesWithPrefix(`grant:${record.grantId}:`);
      for (const mirror of siblings) {
        if (mirror.type !== "ACCESS" || mirror.revokedAt !== null) continue;
        const live = await tokens().get(mirror.tokenId);
        if (live) await markRevoked(live, nowMs);
      }
      return mintPair({ grantId: record.grantId, clientId: record.clientId, wallet: record.wallet, scopes: record.scopes, resource: record.resource }, nowMs);
    },

    async verifyAccessToken({ token, resource, nowMs }) {
      const found = await readToken(token);
      if (!found || found.kind !== "a") throw new ConnectorOAuthError("invalid_token", "The access token is not known.", 401);
      const { record } = found;
      /* Revocation first: a revoked token must not hear a reply that says it was otherwise fine. */
      if (record.revokedAt !== null) throw new ConnectorOAuthError("invalid_token", "The access token has been revoked.", 401);
      if (Date.parse(record.expiresAt) <= nowMs) throw new ConnectorOAuthError("invalid_token", "The access token has expired.", 401);
      if (record.resource !== resource) throw new ConnectorOAuthError("invalid_token", "The access token was issued for another resource.", 401);
      return {
        clientId: record.clientId,
        wallet: record.wallet,
        grantId: record.grantId,
        tokenId: record.tokenId,
        scopes: record.scopes,
        expiresAtSeconds: Math.floor(Date.parse(record.expiresAt) / 1_000),
      };
    },

    async revoke({ token, nowMs }) {
      const found = await readToken(token);
      /* RFC 7009: an unknown token is a successful revocation; "unknown" would make this an oracle. */
      if (!found) return;
      await revokeGrant({ grantId: found.record.grantId, nowMs });
    },

    revokeGrant,
  };
}
