import { getGuardRuntime } from "../../../../lib/guard/runtime.ts";
import { FixedWindowLimiter, clientIp } from "../../../../lib/http-control.ts";
import { corsPreflight, oauthError, oauthJson } from "../../../../lib/connector/http.ts";
import { ConnectorOAuthError, createConnectorOAuthServer } from "../../../../lib/connector/oauth.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * RFC 7591 dynamic client registration for the connector (CITY-154).
 *
 * Registration grants nothing: a client id is a name. Every scope comes later, from a person signing with their
 * wallet at `/connect`, so a thousand registrations are a thousand names and zero access. Clients that publish a
 * client metadata document (CIMD) never come here at all. A registered client is public — no secret is minted — and
 * the per-address window bounds how fast names can be made.
 */
const LIMITER = new FixedWindowLimiter({ windowMs: 60_000, limit: 20, maxKeys: 5_000 });

export async function POST(request: Request) {
  const decision = LIMITER.consume(`connect-register:${clientIp(request.headers)}`);
  if (!decision.allowed) return oauthError(new ConnectorOAuthError("temporarily_unavailable", "Too many registrations from this address.", 429), { "Retry-After": String(decision.retryAfterSeconds) });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return oauthError(new ConnectorOAuthError("invalid_client_metadata", "The registration body is not JSON."));
  }
  try {
    const record = await createConnectorOAuthServer(getGuardRuntime().store).registerClient({ request: body, nowMs: Date.now() });
    return oauthJson(
      {
        client_id: record.clientId,
        client_id_issued_at: Math.floor(Date.parse(record.createdAt) / 1_000),
        client_name: record.clientName,
        redirect_uris: record.redirectUris,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        scope: "market:read",
      },
      201,
    );
  } catch (error) {
    if (error instanceof ConnectorOAuthError) return oauthError(error);
    throw error;
  }
}

export const OPTIONS = corsPreflight;
