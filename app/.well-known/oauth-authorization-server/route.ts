import { authorizationServerMetadata } from "../../../lib/agent-control/oauth/metadata.ts";
import { publicCacheHeaders } from "../../../lib/http-control.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * RFC 8414 authorization-server metadata.
 *
 * Ryntra is its own authorization server for this endpoint, so the issuer is
 * the deployment's own origin. Everything a client needs to run the code flow
 * is here; nothing here is a secret, and nothing here is configured — the
 * origin is derived from the request so a preview deployment describes itself
 * rather than production.
 */
export function GET(request: Request) {
  return Response.json(authorizationServerMetadata(request), {
    headers: {
      ...publicCacheHeaders(300, 3_600),
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "content-type",
    },
  });
}
