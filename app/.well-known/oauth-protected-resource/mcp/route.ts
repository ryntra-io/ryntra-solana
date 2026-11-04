import { connectorOrigin, connectorProtectedResourceMetadata } from "../../../../lib/connector/metadata.ts";
import { publicCacheHeaders } from "../../../../lib/http-control.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * RFC 9728 protected-resource metadata for the connector's MCP endpoint `/mcp` (CITY-154). The path mirrors the
 * resource path, as the RFC asks and as the `WWW-Authenticate` challenge points. Public: a client cannot authenticate
 * until it has read this.
 */
export function GET(request: Request) {
  return Response.json(connectorProtectedResourceMetadata(connectorOrigin(request)), {
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
