import { randomBytes } from "node:crypto";

import { createMcpHandler } from "@modelcontextprotocol/server";

import type { GuardStore } from "../guard/store.ts";
import { FixedWindowLimiter, privateNoStoreHeaders } from "../http-control.ts";
import { CONNECTOR_CORS } from "./http.ts";
import { consumeConnectorQuota, recordConnectorReceipt } from "./ledger.ts";
import { connectorOrigin, connectorResource, connectorResourceMetadataUrl, type ConnectorMcpPath } from "./metadata.ts";
import { ConnectorOAuthError, createConnectorOAuthServer, type ConnectorOAuthOptions } from "./oauth.ts";
import { CONNECTOR_PROFILES, type ConnectorProfile } from "./profiles.ts";
import { createConnectorServer, type ConnectorCallOutcome } from "./server.ts";
import type { EngineRead } from "./tools.ts";

/**
 * `/mcp` — Ryntra's Solana connector, the address a person pastes into a chat (CITY-154) — and `/mcp/read`, the same
 * connector with the catalog's read-only profile, the address a directory lists (CITY-170). Each address is its own
 * resource: a token minted for one is `invalid_token` at the other.
 *
 * The order is the argument: authenticate, serve, and inside each tool call meter and record.
 *
 * - **No token, no service.** An unauthenticated call answers `401` with `WWW-Authenticate: Bearer` naming the RFC 9728
 *   metadata, which is how a client discovers `/connect` with nothing configured by hand.
 * - **The token names this resource.** Audience is checked on every call, so a token minted for a preview or a fork is
 *   `invalid_token` here.
 * - **The wallet is the principal.** Each wallet's durable window, sixty tool calls a minute, counted inside
 *   `tools/call`; a per-instance floor per token in front of everything keeps one hot loop from reaching the store.
 * - **Every call leaves a receipt**, admitted or refused, with a digest of its arguments.
 */

/* Protocol messages (initialize, tools/list, pings) are cheap and uncounted by the wallet's window; this floor per token
   and per instance keeps a hot loop from reaching the store at all. */
const TOKEN_FLOOR = new FixedWindowLimiter({ windowMs: 60_000, limit: 300, maxKeys: 10_000 });

export type ConnectorEndpointDeps = Readonly<{
  /** The profile this address serves; the full connector unless named. */
  profile?: ConnectorProfile;
  store: GuardStore;
  /** The engine reader for one wallet's calls. */
  readFor: (wallet: string) => EngineRead;
  oauth?: ConnectorOAuthOptions;
  nowMs?: () => number;
}>;

function bearer(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

/* RFC 6750 §3: a request with no credential hears no error code, only where to begin; a refused one hears why. */
function challenge(origin: string, path: ConnectorMcpPath, code: string | null, description: string): Response {
  const parts = [`realm="ryntra"`];
  if (code) parts.push(`error="${code}"`, `error_description="${description.replace(/"/g, "'")}"`);
  parts.push(`resource_metadata="${connectorResourceMetadataUrl(origin, path)}"`, `scope="market:read"`);
  return Response.json(
    { error: code ?? "unauthorized", error_description: description },
    {
      status: 401,
      headers: {
        ...privateNoStoreHeaders(),
        ...CONNECTOR_CORS,
        "WWW-Authenticate": `Bearer ${parts.join(", ")}`,
      },
    },
  );
}

function limited(retryAfterSeconds: number, message: string): Response {
  return Response.json(
    { error: "rate_limited", error_description: message },
    { status: 429, headers: { ...privateNoStoreHeaders(), ...CONNECTOR_CORS, "Retry-After": String(retryAfterSeconds) } },
  );
}

export async function serveConnectorMcp(request: Request, deps: ConnectorEndpointDeps): Promise<Response> {
  const now = deps.nowMs ?? Date.now;
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...CONNECTOR_CORS, "Access-Control-Max-Age": "600" } });
  const origin = connectorOrigin(request);
  const profile = deps.profile ?? CONNECTOR_PROFILES.full;

  const presented = bearer(request);
  if (presented === null) return challenge(origin, profile.path, null, "Connect Ryntra first: this endpoint needs an OAuth access token.");

  const floor = TOKEN_FLOOR.consume(`connector:${presented.slice(0, 32)}`);
  if (!floor.allowed) return limited(floor.retryAfterSeconds, "Too many calls on this connection.");

  let verified;
  try {
    verified = await createConnectorOAuthServer(deps.store, deps.oauth).verifyAccessToken({ token: presented, resource: connectorResource(origin, profile.path), nowMs: now() });
  } catch (error) {
    return challenge(origin, profile.path, "invalid_token", error instanceof ConnectorOAuthError ? error.message : "The access token was refused.");
  }

  /* The wallet's durable window and the receipt both live inside `tools/call` (`./server.ts`): the quota counts tool
     calls rather than protocol messages, and the receipt is written before the call's answer exists, so no way of
     streaming the response can outrun it. */
  const handler = createMcpHandler(() =>
    createConnectorServer({
      profile,
      scopes: verified.scopes,
      read: deps.readFor(verified.wallet),
      origin,
      nowMs: now,
      meter: () => consumeConnectorQuota(deps.store, { wallet: verified.wallet, nowMs: now() }),
      onCall: async (call: ConnectorCallOutcome) => {
        await recordConnectorReceipt(deps.store, {
          receiptId: `rcp_${now().toString(36)}_${randomBytes(6).toString("hex")}`,
          wallet: verified.wallet,
          clientId: verified.clientId,
          grantId: verified.grantId,
          toolName: call.toolName,
          admitted: call.admitted,
          reasonCode: call.reasonCode,
          args: call.args,
          atMs: now(),
        }).catch(() => null);
      },
    }),
  );
  const response = await handler.fetch(request);

  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, no-store, max-age=0");
  for (const [name, value] of Object.entries(CONNECTOR_CORS)) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
