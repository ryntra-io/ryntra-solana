import { NextResponse } from "next/server";

import { getGuardRuntime } from "@/lib/guard/runtime";
import { isTakenDown, readLaunchMetadata } from "@/lib/launch/metadata.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A day in a browser, ten minutes on the CDN: long enough to spare the store, short enough for a takedown to land. */
const TAKEDOWN_REACHABLE = "public, max-age=86400, s-maxage=600";

/**
 * `GET /api/launch/metadata/<sha256>` — a launched token's metadata, the URI
 * its mint names for ever. The address is the sha256 of the bytes served, so
 * it never serves anything else. Public and
 * open to any origin, like every token's metadata wallets and explorers read.
 * Served whether or not this deployment builds launches — a mint's URI must
 * keep answering. MC-1: details Ryntra took down are served without their
 * description and links, and the cache is a day (a CDN copy ten minutes), so a
 * takedown reaches wallets and explorers — no longer a year, immutable.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const stored = await readLaunchMetadata(getGuardRuntime().store, id).catch(() => null);
  if (!stored) return NextResponse.json({ error: "not found" }, { status: 404, headers: { "cache-control": "no-store" } });
  let json = stored.json;
  /* A takedown not read is not «not taken down»: nothing is served, and nothing is cached. */
  const down = await isTakenDown(getGuardRuntime().store, "metadata", id).catch(() => null);
  if (down === null) return NextResponse.json({ error: "unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  if (down) {
    const { name, symbol, image, createdOn } = JSON.parse(stored.json) as Record<string, unknown>;
    json = JSON.stringify({ name, symbol, description: "", image, createdOn });
  }
  return new NextResponse(json, {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": TAKEDOWN_REACHABLE, "access-control-allow-origin": "*" },
  });
}
