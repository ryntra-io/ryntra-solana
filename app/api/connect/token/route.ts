import { getGuardRuntime } from "../../../../lib/guard/runtime.ts";
import { FixedWindowLimiter, clientIp } from "../../../../lib/http-control.ts";
import { corsPreflight, oauthError, oauthJson, readForm } from "../../../../lib/connector/http.ts";
import { ConnectorOAuthError, createConnectorOAuthServer } from "../../../../lib/connector/oauth.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * RFC 6749 token endpoint for the connector: the code grant with PKCE, and refresh with rotation. There is no client
 * authentication because there is no client secret — a public client proves possession with the PKCE verifier, checked
 * inside `lib/connector/oauth.ts`.
 */
const LIMITER = new FixedWindowLimiter({ windowMs: 60_000, limit: 60, maxKeys: 5_000 });

export async function POST(request: Request) {
  const decision = LIMITER.consume(`connect-token:${clientIp(request.headers)}`);
  if (!decision.allowed) return oauthError(new ConnectorOAuthError("temporarily_unavailable", "Too many token requests from this address.", 429), { "Retry-After": String(decision.retryAfterSeconds) });
  const form = await readForm(request);
  if (!form) return oauthError(new ConnectorOAuthError("invalid_request", "The token request must be form-encoded."));
  const oauth = createConnectorOAuthServer(getGuardRuntime().store);
  const grantType = form.grant_type ?? "";
  /* RFC 8707: a token request may name its resource or not. Named, it must be the one the grant was made for; not named,
     the grant's own — `/mcp` or the catalog's `/mcp/read` (CITY-170) — is what the token is bound to. */
  const resource = form.resource ? form.resource : null;
  try {
    const pair =
      grantType === "authorization_code"
        ? await oauth.exchangeCode({
            code: form.code ?? "",
            clientId: form.client_id ?? "",
            redirectUri: form.redirect_uri ?? "",
            codeVerifier: form.code_verifier ?? "",
            resource,
            nowMs: Date.now(),
          })
        : grantType === "refresh_token"
          ? await oauth.refresh({ refreshToken: form.refresh_token ?? "", clientId: form.client_id ?? "", resource, nowMs: Date.now() })
          : null;
    if (!pair) return oauthError(new ConnectorOAuthError("unsupported_grant_type", `${(grantType || "none").slice(0, 64)} is not a supported grant.`));
    return oauthJson({
      access_token: pair.accessToken,
      token_type: "Bearer",
      expires_in: pair.expiresInSeconds,
      refresh_token: pair.refreshToken,
      scope: pair.scopes.join(" "),
    });
  } catch (error) {
    if (error instanceof ConnectorOAuthError) return oauthError(error);
    throw error;
  }
}

export const OPTIONS = corsPreflight;
