import { randomBytes } from "node:crypto";

import { createMcpHandler } from "@modelcontextprotocol/server";

import { CONNECTOR_CORS } from "../connector/http.ts";
import { consumeConnectorQuota, recordConnectorReceipt, walletReadKey } from "../connector/ledger.ts";
import { CONNECTOR_MCP_PATH, connectorOrigin, connectorResource, connectorResourceMetadataUrl } from "../connector/metadata.ts";
import { ConnectorOAuthError, createConnectorOAuthServer, type ConnectorOAuthOptions } from "../connector/oauth.ts";
import type { EngineRead } from "../connector/tools.ts";
import type { GuardStore } from "../guard/store.ts";
import { clientIp, FixedWindowLimiter, privateNoStoreHeaders } from "../http-control.ts";
import type { PlanDeps } from "./plan.ts";
import { createRyntraServer, type McpCallOutcome, type McpMeter } from "./server.ts";
import type { OwnRead } from "./tools.ts";

/**
 * `https://ryntra.io/mcp` — the address a person pastes into their AI chat or any MCP client. Streamable
 * HTTP; two ways in, one set of tools:
 *
 * - **Without signing in** — no `Authorization` header — every tool answers: the public reads (the market, a coin, the
 *   pools, a portfolio by its public address) and the prepare tools, whose answers are links the person opens and signs
 *   on ryntra.io. Only public data is read; nothing is kept about the caller. The window is the caller's address:
 *   sixty tool calls a minute on each instance, and every engine route behind a tool keeps its own window for that
 *   address, as if the caller had called it directly.
 * - **Signed in** — the connector's OAuth (`/connect`: one Sign In With Solana message, no transaction) — the
 *   same tools, with the wallet as the principal: its own durable window and a receipt for every call
 *   (`lib/connector/ledger.ts`). A token that is wrong, expired or minted for another address is `401` with where to
 *   sign in again, never a silent fall to the open door.
 *
 * Neither way holds a key, builds a transaction or signs: the most a tool returns is a link.
 */

/* Protocol messages (initialize, tools/list, pings) are cheap and outside the tool window; this floor per caller and per
   instance keeps one hot loop from costing more than that. */
const MESSAGE_FLOOR = new FixedWindowLimiter({ windowMs: 60_000, limit: 300, maxKeys: 10_000 });
/** Tool calls of callers who did not sign in, per address and per instance. */
export const OPEN_CALLS_PER_MINUTE = 60;
const OPEN_CALLS = new FixedWindowLimiter({ windowMs: 60_000, limit: OPEN_CALLS_PER_MINUTE, maxKeys: 10_000 });

export type RyntraMcpDeps = Readonly<{
  store: GuardStore;
  /** The connector's engine reader, keyed by the address the engine's read windows count. */
  readFor: (readKey: string) => EngineRead;
  /** Ryntra's own tools' reader, keyed the same way. */
  ownFor: (readKey: string) => OwnRead;
  /** The shelves and gates the agent's line reads with. */
  plan: Omit<PlanDeps, "towers">;
  oauth?: ConnectorOAuthOptions;
  nowMs?: () => number;
  /** For tests: a fresh open window instead of the instance's. */
  openLimiter?: FixedWindowLimiter;
}>;

function bearerOf(header: string): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match ? match[1]! : null;
}

function challenge(origin: string, code: string, description: string): Response {
  const parts = [`realm="ryntra"`, `error="${code}"`, `error_description="${description.replace(/"/g, "'")}"`];
  parts.push(`resource_metadata="${connectorResourceMetadataUrl(origin, CONNECTOR_MCP_PATH)}"`, `scope="market:read"`);
  return Response.json(
    { error: code, error_description: description },
    { status: 401, headers: { ...privateNoStoreHeaders(), ...CONNECTOR_CORS, "WWW-Authenticate": `Bearer ${parts.join(", ")}` } },
  );
}

function limited(retryAfterSeconds: number): Response {
  return Response.json(
    { error: "rate_limited", error_description: "Too many calls from this address." },
    { status: 429, headers: { ...privateNoStoreHeaders(), ...CONNECTOR_CORS, "Retry-After": String(retryAfterSeconds) } },
  );
}

type Principal = Readonly<{ readKey: string; meter: McpMeter; onCall: (outcome: McpCallOutcome) => Promise<void> }>;

export async function serveRyntraMcp(request: Request, deps: RyntraMcpDeps): Promise<Response> {
  const now = deps.nowMs ?? Date.now;
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...CONNECTOR_CORS, "Access-Control-Max-Age": "600" } });
  const origin = connectorOrigin(request);
  const header = request.headers.get("authorization");

  let principal: Principal;
  if (header === null) {
    const address = clientIp(request.headers);
    const floor = MESSAGE_FLOOR.consume(`mcp-open:${address}`);
    if (!floor.allowed) return limited(floor.retryAfterSeconds);
    const window = deps.openLimiter ?? OPEN_CALLS;
    principal = {
      readKey: address,
      meter: async () => {
        const decision = window.consume(`mcp-open:${address}`);
        return { allowed: decision.allowed, retryAfterSeconds: decision.retryAfterSeconds };
      },
      onCall: async () => {},
    };
  } else {
    const token = bearerOf(header);
    if (token === null) return challenge(origin, "invalid_token", "Send the access token as «Authorization: Bearer <token>», or no Authorization header to use Ryntra without signing in.");
    const floor = MESSAGE_FLOOR.consume(`mcp-token:${token.slice(0, 32)}`);
    if (!floor.allowed) return limited(floor.retryAfterSeconds);
    let verified;
    try {
      verified = await createConnectorOAuthServer(deps.store, deps.oauth).verifyAccessToken({ token, resource: connectorResource(origin, CONNECTOR_MCP_PATH), nowMs: now() });
    } catch (error) {
      return challenge(origin, "invalid_token", error instanceof ConnectorOAuthError ? error.message : "The access token was refused.");
    }
    principal = {
      readKey: walletReadKey(verified.wallet),
      meter: () => consumeConnectorQuota(deps.store, { wallet: verified.wallet, nowMs: now() }),
      onCall: async (call) => {
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
    };
  }

  const handler = createMcpHandler(() =>
    createRyntraServer({
      read: deps.readFor(principal.readKey),
      own: { read: deps.ownFor(principal.readKey), origin, plan: deps.plan },
      origin,
      nowMs: now,
      meter: principal.meter,
      onCall: principal.onCall,
    }),
  );
  const response = await handler.fetch(request);
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, no-store, max-age=0");
  for (const [name, value] of Object.entries(CONNECTOR_CORS)) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
