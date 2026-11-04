import { connectorOrigin } from "@/lib/connector/metadata";
import { serveConnectorMcp } from "@/lib/connector/endpoint";
import { CONNECTOR_PROFILES } from "@/lib/connector/profiles";
import { getGuardRuntime } from "@/lib/guard/runtime";

import { engineReaderFor } from "../engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/* The slowest honest engine read behind a tool (the full market list) takes most of a minute. */
export const maxDuration = 60;

/**
 * `https://ryntra.io/mcp/read` — the connector a directory lists (CITY-170): the same server as `/mcp` with the
 * catalog's profile — the Solana market and the check before signing, reads only, no tool that prepares anything to
 * sign and no link to sign (`lib/connector/profiles.ts`). The same consent (`/connect`) and the same wallet's quota;
 * its own resource, so its tokens open this address only.
 */
async function serve(request: Request): Promise<Response> {
  const origin = connectorOrigin(request);
  return serveConnectorMcp(request, {
    profile: CONNECTOR_PROFILES.catalog,
    store: getGuardRuntime().store,
    readFor: (wallet) => engineReaderFor(origin, wallet),
  });
}

export const GET = serve;
export const POST = serve;
export const DELETE = serve;
export const OPTIONS = serve;
