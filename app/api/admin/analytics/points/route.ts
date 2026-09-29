import { NextResponse } from "next/server";

import { isBusinessScope } from "@/lib/admin/business";
import { isBase58Wallet } from "@/lib/admin/internal-wallets";
import { isPointsSort } from "@/lib/admin/points";
import { readPointsLedger, readPointsTable } from "@/lib/admin/points.server";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { getAdminSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * The owner's Points table, and one wallet's ledger behind it.
 *
 * Admin session only. `?scope=external|all` and `?sort=points|volume|active|newest`
 * shape the table; `?wallet=<base58>` returns that wallet's rows instead, for
 * the audit disclosure. Nothing here is cached: a figure is the store at the
 * moment of the request, and the same `rankPoints` the customer's page reads.
 */
export async function GET(request: Request) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const headers = { "Cache-Control": "private, no-store" };
  const store = getGuardRuntime().store;

  const wallet = url.searchParams.get("wallet");
  if (wallet !== null) {
    if (!isBase58Wallet(wallet)) return NextResponse.json({ error: "bad_wallet" }, { status: 400 });
    const ledger = await readPointsLedger(store, wallet);
    return NextResponse.json({ ledger }, { headers });
  }

  const scope = url.searchParams.get("scope") ?? "external";
  const sort = url.searchParams.get("sort") ?? "points";
  if (!isBusinessScope(scope) || !isPointsSort(sort)) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const read = await readPointsTable(store, { now: new Date().toISOString(), scope, sort, env: process.env });
  return NextResponse.json({ points: read.model, sources: read.sources }, { headers });
}
