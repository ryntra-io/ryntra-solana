import { connectorOrigin } from "@/lib/connector/metadata";
import { serveConnectorMcp } from "@/lib/connector/endpoint";
import { getGuardRuntime } from "@/lib/guard/runtime";

import { engineReaderFor } from "./engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/* The slowest honest engine read behind a tool (the full market list) takes most of a minute. */
export const maxDuration = 60;

/**
 * `https://ryntra.io/mcp` — Ryntra's Solana connector for AI chats (CITY-154, phase 1). Streamable HTTP, OAuth 2.1
 * with the person's wallet as the consent (`/connect`), read-only tools over the engine's public routes. The whole
 * argument lives in `lib/connector/endpoint.ts`; this file only wires the store and the engine.
 */
async function serve(request: Request): Promise<Response> {
  const origin = connectorOrigin(request);
  return serveConnectorMcp(request, { store: getGuardRuntime().store, readFor: (wallet) => engineReaderFor(origin, wallet) });
}

export const GET = serve;
export const POST = serve;
export const DELETE = serve;
export const OPTIONS = serve;
