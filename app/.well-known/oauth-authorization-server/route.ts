import { connectorAuthorizationServerMetadata, connectorOrigin } from "../../../lib/connector/metadata.ts";
import { publicCacheHeaders } from "../../../lib/http-control.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * RFC 8414 authorization-server metadata for this origin.
 *
 * The origin's authorization server is the Solana connector's: the consent is `/connect`, in the city's
 * design, approved with the person's wallet (the old consent `/agents/connect` has led into the city).
 * Agent Control's own OAuth routes under `/api/agents/oauth/*` are untouched; where its hosted MCP goes next
 * is a question for the owner. The origin is derived from the request, so a preview describes itself.
 */
export function GET(request: Request) {
  return Response.json(connectorAuthorizationServerMetadata(connectorOrigin(request)), {
    headers: { ...publicCacheHeaders(300, 3_600), "Access-Control-Allow-Origin": "*" },
  });
}

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "content-type, mcp-protocol-version",
    },
  });
}
