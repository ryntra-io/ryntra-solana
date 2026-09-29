import { AGENT_CONTROL_SCOPES } from "../tenancy.ts";

/**
 * The two discovery documents an MCP client reads before it ever authenticates.
 *
 * `MCP 2026-07-28` makes the server a resource server: an unauthenticated
 * request answers `401` with a `WWW-Authenticate` challenge naming a
 * protected-resource metadata URL (RFC 9728), the client fetches that, learns
 * which authorization server to talk to, fetches the AS metadata (RFC 8414),
 * registers itself (RFC 7591) and runs the code flow. None of that requires the
 * client to be told anything out of band, which is the whole point: a connector
 * a person pastes a URL into can finish the handshake on its own.
 *
 * The origin is derived from the request rather than configured. A hard-coded
 * base URL is a value that has to be kept true across preview deployments, and
 * this repository has spent enough sessions on values that had to be kept true.
 */

export const AGENT_MCP_PATH = "/api/agents/mcp";
/* The authorization endpoint is a page, not an API route: the browser opens it
   and a person reads it. The form it renders posts to the API path below. */
export const OAUTH_AUTHORIZE_PATH = "/agents/connect";
export const OAUTH_APPROVE_PATH = "/api/agents/oauth/authorize";
export const OAUTH_TOKEN_PATH = "/api/agents/oauth/token";
export const OAUTH_REGISTER_PATH = "/api/agents/oauth/register";
export const OAUTH_REVOKE_PATH = "/api/agents/oauth/revoke";

/**
 * The canonical origin for a request.
 *
 * `x-forwarded-proto` and `host` are what a platform proxy sets; `request.url`
 * behind that proxy can carry the internal scheme. A resource identifier that
 * disagreed with the one a client saw would fail audience validation for a
 * reason nobody could see from either side.
 */
export function requestOrigin(request: Request): string {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host;
  const proto =
    request.headers.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  return `${proto}://${host}`;
}

export function mcpResourceIdentifier(request: Request): string {
  return `${requestOrigin(request)}${AGENT_MCP_PATH}`;
}

export function protectedResourceMetadataUrl(request: Request): string {
  return `${requestOrigin(request)}/.well-known/oauth-protected-resource${AGENT_MCP_PATH}`;
}

export function protectedResourceMetadata(request: Request) {
  const origin = requestOrigin(request);
  return {
    resource: mcpResourceIdentifier(request),
    authorization_servers: [origin],
    scopes_supported: [...AGENT_CONTROL_SCOPES],
    bearer_methods_supported: ["header"],
    resource_documentation: `${origin}/developers/agent-control`,
    /* Stated in the document a client reads before it asks for anything, so a
       connector's own consent screen can repeat it accurately. */
    resource_policy_uri: `${origin}/legal/terms`,
  };
}

export function authorizationServerMetadata(request: Request) {
  const origin = requestOrigin(request);
  return {
    issuer: origin,
    authorization_endpoint: `${origin}${OAUTH_AUTHORIZE_PATH}`,
    token_endpoint: `${origin}${OAUTH_TOKEN_PATH}`,
    registration_endpoint: `${origin}${OAUTH_REGISTER_PATH}`,
    revocation_endpoint: `${origin}${OAUTH_REVOKE_PATH}`,
    scopes_supported: [...AGENT_CONTROL_SCOPES],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    /* `none` only. Every client this server registers is public and proves
       possession with PKCE, so there is no client secret to transmit, store or
       rotate — and no weaker method for a client to choose. */
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    revocation_endpoint_auth_methods_supported: ["none"],
  };
}
