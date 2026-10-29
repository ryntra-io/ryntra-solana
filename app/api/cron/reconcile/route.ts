import { NextRequest, NextResponse } from "next/server";

import { readAttribution } from "@/lib/attribution/chain.server";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { privateNoStoreHeaders } from "@/lib/http-control";
import { decideBearerAuth } from "@/lib/security";
import { reconcileLaunchTrades } from "@/lib/launch/record.server";
import { launchMarketDeps } from "@/lib/launch/runtime.server";
import { reconcileSolanaWalletActions } from "@/lib/solana/action-reconcile.server";
import { reconcileLimitOrders } from "@/lib/solana/limits/sync.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The asynchronous reconciliation layer, every ten minutes.
 *
 * Two things, neither of which counts an operation: the ledger rows left in
 * flight are settled from the lane's own durable evidence (the owner lock with
 * its receipt, the send attempt; a launch's trade from its own transaction on
 * chain), and the shared chain read behind the public
 * statistics is refreshed so a confirmed operation's *verified* mark appears
 * without waiting for a visitor. The ledger is the count; the chain read is
 * the second witness. No payout path, no provider call that spends anything.
 */
export async function GET(req: NextRequest) {
  const authorized = decideBearerAuth({ authorization: req.headers.get("authorization"), legacyKeyPresent: req.nextUrl.searchParams.has("key") }, process.env.CRON_SECRET);
  if (authorized !== "authorized") return NextResponse.json({ ok: false }, { status: 401, headers: privateNoStoreHeaders() });
  try {
    const report = await reconcileSolanaWalletActions(getGuardRuntime().store, { apply: true, limit: 25 });
    const launchDeps = launchMarketDeps();
    const launches = launchDeps ? await reconcileLaunchTrades(launchDeps, { limit: 10 }).catch(() => []) : [];
    /* Spot limits (B3): a placement or cancellation whose relay did not answer is read by its signature; open orders are refreshed from their venue. */
    const limits = await reconcileLimitOrders(getGuardRuntime().store, { limit: 25 }).catch(() => []);
    const chain = await readAttribution();
    return NextResponse.json(
      {
        ok: true,
        examined: report.examined,
        settled: report.decisions.filter((decision) => decision.applied).map((decision) => ({ key: decision.key, before: decision.before, after: decision.after })),
        left: report.decisions.filter((decision) => !decision.applied).map((decision) => ({ key: decision.key, evidence: decision.evidence })),
        enriched: report.enriched.filter((row) => row.applied).length,
        launchTrades: launches.filter((entry) => entry.after !== entry.before),
        limits: limits.filter((decision) => decision.applied),
        chain: chain.ok ? { readAt: chain.readAt, operations: chain.totals.operations, complete: chain.coverage.complete } : { code: chain.code },
      },
      { headers: privateNoStoreHeaders() },
    );
  } catch {
    return NextResponse.json({ ok: false, error: "RECONCILE_UNAVAILABLE" }, { status: 503, headers: privateNoStoreHeaders() });
  }
}
