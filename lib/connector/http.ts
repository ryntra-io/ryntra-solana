import { privateNoStoreHeaders } from "../http-control.ts";
import { ConnectorOAuthError } from "./oauth.ts";

/**
 * The connector's HTTP answers, one shape for every OAuth route: `{ error, error_description }` (RFC 6749 §5.2) with a
 * private, never-cached response, and CORS open where a browser-based MCP client (the Inspector, a web chat) has to
 * read the answer.
 */

export const CONNECTOR_CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, mcp-protocol-version, mcp-session-id",
  "Access-Control-Expose-Headers": "www-authenticate, mcp-session-id, mcp-protocol-version",
};

export function oauthError(error: ConnectorOAuthError, extra: Record<string, string> = {}): Response {
  return Response.json(
    { error: error.code, error_description: error.message },
    { status: error.status, headers: { ...privateNoStoreHeaders(), ...CONNECTOR_CORS, ...extra } },
  );
}

export function oauthJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { ...privateNoStoreHeaders(), ...CONNECTOR_CORS } });
}

export function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: { ...CONNECTOR_CORS, "Access-Control-Max-Age": "600" } });
}

/** A form body (`application/x-www-form-urlencoded`) as strings; JSON is accepted too, for clients that send it. */
export async function readForm(request: Request): Promise<Record<string, string> | null> {
  const type = request.headers.get("content-type") ?? "";
  try {
    if (type.includes("application/json")) {
      const body = (await request.json()) as unknown;
      if (!body || typeof body !== "object") return null;
      return Object.fromEntries(Object.entries(body as Record<string, unknown>).filter(([, v]) => typeof v === "string")) as Record<string, string>;
    }
    const text = await request.text();
    if (text.length > 16_384) return null;
    return Object.fromEntries(new URLSearchParams(text));
  } catch {
    return null;
  }
}
