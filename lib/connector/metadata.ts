/**
 * Ryntra's Solana connector for AI chats (CITY-154, phase 1): its addresses, its one scope and the two discovery
 * documents a client reads before it ever authenticates.
 *
 * A person pastes `https://ryntra.io/mcp` into an AI chat (claude.ai, ChatGPT) or any MCP client. The first call answers `401` with a
 * `WWW-Authenticate` challenge naming the protected-resource metadata (RFC 9728); the client reads it, learns that
 * Ryntra itself is the authorization server, reads that server's metadata (RFC 8414), identifies itself — by its own
 * client metadata document (CIMD) when it has one, by dynamic registration (RFC 7591) otherwise — and opens the
 * consent at `/connect`, where the person approves with their wallet. Nothing is told to the client out of band.
 *
 * The origin is the request's own, so a preview deployment describes itself rather than production, and a token minted
 * for one deployment names that deployment's resource.
 *
 * Pure data and string work, no imports: the consent page, the routes and node tests all read it.
 */

/** The MCP endpoint a person pastes into a chat: the full connector (the custom connector). */
export const CONNECTOR_MCP_PATH = "/mcp";
/**
 * The catalog's endpoint (CITY-170): the same server with only its read-only profile — no tool that prepares anything
 * to sign and no link to sign — the address a connector directory lists. Its own resource, so a token minted for one
 * endpoint is refused at the other.
 */
export const CONNECTOR_CATALOG_MCP_PATH = "/mcp/read";
/** Every MCP endpoint this server issues tokens for. */
export const CONNECTOR_MCP_PATHS = [CONNECTOR_MCP_PATH, CONNECTOR_CATALOG_MCP_PATH] as const;
export type ConnectorMcpPath = (typeof CONNECTOR_MCP_PATHS)[number];
/** The connector's documentation, a page of the city (CITY-170). */
export const CONNECTOR_DOCS_PATH = "/connector";
/** The consent page — the authorization endpoint. A browser opens it and a person decides there. */
export const CONNECT_PAGE_PATH = "/connect";
export const CONNECT_CHALLENGE_PATH = "/api/connect/challenge";
export const CONNECT_APPROVE_PATH = "/api/connect/approve";
export const CONNECT_REGISTER_PATH = "/api/connect/register";
export const CONNECT_TOKEN_PATH = "/api/connect/token";
export const CONNECT_REVOKE_PATH = "/api/connect/revoke";

/**
 * The scopes this connector issues. Phase 1 has one, and it reads public market facts only. There is no scope that
 * could sign, send, trade or reach a wallet's private data — so no token can carry one, whatever a client asks for.
 */
export const CONNECTOR_SCOPES = ["market:read"] as const;
export type ConnectorScope = (typeof CONNECTOR_SCOPES)[number];

export function isConnectorScope(value: string): value is ConnectorScope {
  return (CONNECTOR_SCOPES as readonly string[]).includes(value);
}

/**
 * Scopes a client may ask for that this server answers by ignoring. `offline_access` is what some clients send to get
 * a refresh token; this server issues one with every grant, so the word adds nothing and refusing it would break them.
 */
export const IGNORED_SCOPES = ["offline_access"] as const;

/**
 * The canonical origin for a request. `x-forwarded-host` and `x-forwarded-proto` are what the platform proxy sets;
 * `request.url` behind that proxy can carry the internal scheme. A resource identifier that disagreed with the one a
 * client saw would fail audience validation for a reason nobody could see from either side.
 */
export function connectorOrigin(request: Request): string {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host;
  const proto =
    request.headers.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : url.protocol.replace(":", ""));
  return `${proto}://${host}`;
}

/** The resource a token is bound to: one of this deployment's MCP endpoints (the full one unless named). */
export function connectorResource(origin: string, path: ConnectorMcpPath = CONNECTOR_MCP_PATH): string {
  return `${origin}${path}`;
}

/** Whether `resource` is one of this deployment's MCP endpoints — the only resources it issues tokens for. */
export function isConnectorResource(origin: string, resource: string): boolean {
  return CONNECTOR_MCP_PATHS.some((path) => resource === connectorResource(origin, path));
}

export function connectorResourceMetadataUrl(origin: string, path: ConnectorMcpPath = CONNECTOR_MCP_PATH): string {
  return `${origin}/.well-known/oauth-protected-resource${path}`;
}

/** RFC 9728 protected-resource metadata for `/mcp` or `/mcp/read`. */
export function connectorProtectedResourceMetadata(origin: string, path: ConnectorMcpPath = CONNECTOR_MCP_PATH) {
  return {
    resource: connectorResource(origin, path),
    resource_name: "Ryntra",
    authorization_servers: [origin],
    scopes_supported: [...CONNECTOR_SCOPES],
    bearer_methods_supported: ["header"],
    resource_documentation: `${origin}${CONNECTOR_DOCS_PATH}`,
    resource_policy_uri: `${origin}/legal/privacy`,
    resource_tos_uri: `${origin}/legal/terms`,
  };
}

/**
 * RFC 8414 authorization-server metadata. Ryntra is its own authorization server, so the issuer is the origin.
 *
 * `client_id_metadata_document_supported` with `none` as the only token endpoint method is what claude.ai and ChatGPT
 * read to identify themselves by their own metadata URL instead of registering a new client on every connection.
 */
export function connectorAuthorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}${CONNECT_PAGE_PATH}`,
    token_endpoint: `${origin}${CONNECT_TOKEN_PATH}`,
    registration_endpoint: `${origin}${CONNECT_REGISTER_PATH}`,
    revocation_endpoint: `${origin}${CONNECT_REVOKE_PATH}`,
    scopes_supported: [...CONNECTOR_SCOPES],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    /* `none` only: every client is public and proves possession with PKCE, so there is no client secret to send,
       store or rotate — and no weaker method for a client to choose. */
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    client_id_metadata_document_supported: true,
    service_documentation: `${origin}${CONNECTOR_DOCS_PATH}`,
    op_policy_uri: `${origin}/legal/privacy`,
    op_tos_uri: `${origin}/legal/terms`,
  };
}
