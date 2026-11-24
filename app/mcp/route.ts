import { connectorOrigin } from "@/lib/connector/metadata";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { serveRyntraMcp } from "@/lib/mcp/endpoint";
import { engineGates } from "@/terminal/shell/engine";
import { shelfOn } from "@/terminal/shell/shelves";

import { engineReaderAt, ownReaderAt } from "./engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/* The slowest honest engine read behind a tool (the full market list) takes most of a minute. */
export const maxDuration = 60;

/**
 * `https://ryntra.io/mcp` — Ryntra for another AI. Streamable HTTP. Without signing in: the public
 * reads and the tools that prepare a link for the person to open and sign; signed in through the connector's OAuth
 * (`/connect`): the same tools with the wallet's own window and receipts. The argument lives in `lib/mcp/endpoint.ts`;
 * this file only wires the store, the engine and the agent's line as this deployment has it.
 */
async function serve(request: Request): Promise<Response> {
  const origin = connectorOrigin(request);
  return serveRyntraMcp(request, {
    store: getGuardRuntime().store,
    readFor: (readKey) => engineReaderAt(origin, readKey),
    ownFor: (readKey) => ownReaderAt(origin, readKey),
    plan: { on: (shelf) => shelfOn(shelf), gates: engineGates() },
  });
}

export const GET = serve;
export const POST = serve;
export const DELETE = serve;
export const OPTIONS = serve;
