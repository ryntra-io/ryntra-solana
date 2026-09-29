import {
  protectedResourceMetadata,
} from "../../../../../../lib/agent-control/oauth/metadata.ts";
import { publicCacheHeaders } from "../../../../../../lib/http-control.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * RFC 9728 protected-resource metadata for the hosted MCP endpoint.
 *
 * The path mirrors the resource path, which is what the RFC requires and what
 * the `WWW-Authenticate` challenge points at. It is public and unauthenticated
 * on purpose: a client cannot authenticate until it has read this.
 */
export function GET(request: Request) {
  return Response.json(protectedResourceMetadata(request), {
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
      "Access-Control-Allow-Headers": "content-type, mcp-protocol-version",
    },
  });
}
