import { NextResponse } from "next/server";

import { getGuardRuntime } from "@/lib/guard/runtime";
import { readLaunchMetadata } from "@/lib/launch/metadata.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/launch/metadata/<sha256>` — a launched token's metadata, the URI
 * its mint names for ever. The address is the sha256 of the bytes served, so
 * it never serves anything else: cached for a year, immutable. Public and
 * open to any origin, like every token's metadata wallets and explorers read.
 * Served whether or not this deployment builds launches — a mint's URI must
 * keep answering.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const stored = await readLaunchMetadata(getGuardRuntime().store, id).catch(() => null);
  if (!stored) return NextResponse.json({ error: "not found" }, { status: 404, headers: { "cache-control": "no-store" } });
  return new NextResponse(stored.json, {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=31536000, immutable", "access-control-allow-origin": "*" },
  });
}
