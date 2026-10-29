import { NextResponse, type NextRequest } from "next/server";

import { getGuardRuntime } from "@/lib/guard/runtime";
import { privateNoStoreHeaders } from "@/lib/http-control";
import { aggOrdersFetcher, syncFeeLedger } from "@/lib/predictions/agg-orders";
import { readPredictionsEnv } from "@/lib/predictions/env";
import { ledgerTotals, readLedgerView } from "@/lib/predictions/fee-ledger";
import { decideBearerAuth } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The fee ledger, for the operator: one bounded pass over the aggregator's
 * order list from where the last one stopped, then the newest trades' lines —
 * what was filled, Ryntra's fee, the aggregator's share, the inviter, the
 * «0 %» window, what Ryntra keeps, and whether the webhooks and the list agree
 * — with the totals over every trade. Behind the operator's bearer secret; it
 * spends nothing. `?limit=` caps the lines (default 200, at most 1000).
 */
export async function GET(req: NextRequest) {
  const authorized = decideBearerAuth({ authorization: req.headers.get("authorization"), legacyKeyPresent: req.nextUrl.searchParams.has("key") }, process.env.CRON_SECRET);
  if (authorized !== "authorized") return NextResponse.json({ ok: false }, { status: 401, headers: privateNoStoreHeaders() });
  const asked = Number(req.nextUrl.searchParams.get("limit") ?? "200");
  const limit = Number.isInteger(asked) && asked > 0 ? Math.min(asked, 1000) : 200;
  const store = getGuardRuntime().store;
  const fetchPage = aggOrdersFetcher(readPredictionsEnv());
  try {
    const sync = fetchPage ? await syncFeeLedger(store, fetchPage).catch(() => ({ error: "ORDERS_UNAVAILABLE" as const })) : { error: "NOT_CONFIGURED" as const };
    const view = await readLedgerView(store);
    return NextResponse.json({ ok: true, sync, totals: ledgerTotals(view), lines: view.lines.slice(0, limit), unlinked: view.unlinked.slice(0, limit) }, { headers: privateNoStoreHeaders() });
  } catch {
    return NextResponse.json({ ok: false, error: "LEDGER_UNAVAILABLE" }, { status: 503, headers: privateNoStoreHeaders() });
  }
}
