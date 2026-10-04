import { NextResponse } from "next/server";

import { readAttribution } from "@/lib/attribution/chain.server";
import { registryDocumentOf } from "@/lib/attribution/stats.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The attribution registry as JSON — the same rows `/stats` draws under its
 * public identities: every address on which an outside counter can tell that
 * money moved through Ryntra, with its network, products and role, and — from
 * the shared chain read, ten minutes old at most — the block it started at and
 * the transaction that shows it at work. A dashboard or a listing reads this
 * and nothing else, so the addresses it counts are the ones the product
 * publishes.
 *
 * Public and unauthenticated: public addresses and public transactions only.
 */
export async function GET() {
  return NextResponse.json(await registryDocumentOf(await readAttribution()), {
    headers: { "Cache-Control": "public, max-age=60, s-maxage=600, stale-while-revalidate=3600" },
  });
}
