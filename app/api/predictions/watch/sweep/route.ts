import { NextResponse, type NextRequest } from "next/server";

import { getGuardRuntime } from "@/lib/guard/runtime";
import { privateNoStoreHeaders } from "@/lib/http-control";
import { getPredictionProvider } from "@/lib/predictions/agg/adapter";
import { predictionTransports } from "@/lib/predictions/notify/transports.server";
import { watchExplainer } from "@/lib/predictions/watch/explain.server";
import { sweepWatch, WATCH_WALLETS_LIMIT } from "@/lib/predictions/watch/run";
import { watchWallets } from "@/lib/predictions/watch/store";
import { decideBearerAuth } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The pass that makes a watch work with the site closed: for every wallet
 * that set a rule, read the markets its rules are about, judge each rule and
 * send what is due.
 *
 * Behind the operator's bearer secret, and it is the same pass a person's own
 * «check now» runs — one signal per happening, so a run that overlaps with a
 * press tells them once. It buys nothing and it holds no money: every read
 * here is a read.
 */
export async function POST(req: NextRequest) {
  const authorized = decideBearerAuth({ authorization: req.headers.get("authorization"), legacyKeyPresent: req.nextUrl.searchParams.has("key") }, process.env.CRON_SECRET);
  if (authorized !== "authorized") return NextResponse.json({ ok: false }, { status: 401, headers: privateNoStoreHeaders() });
  const store = getGuardRuntime().store;
  const provider = getPredictionProvider();
  const now = Date.now();
  const runId = `wwr_${now.toString(16)}`;
  const transports = predictionTransports(store);
  const explain = watchExplainer({ store, runId }) ?? undefined;
  const wallets = await watchWallets(store, WATCH_WALLETS_LIMIT).catch(() => []);
  let swept = 0;
  let fired = 0;
  let confirmed = 0;
  let stale = 0;
  let unavailable = 0;
  let explained = 0;
  for (const wallet of wallets) {
    const pass = await sweepWatch(store, provider, wallet, process.env, now, { transports, explain }).catch(() => null);
    if (!pass?.ok) continue;
    swept += 1;
    fired += pass.value.tally.fired;
    confirmed += pass.value.tally.confirmed;
    stale += pass.value.tally.stale;
    unavailable += pass.value.tally.unavailable;
    explained += pass.value.tally.explained;
  }
  return NextResponse.json({ ok: true, wallets: wallets.length, swept, fired, confirmed, stale, unavailable, explained }, { headers: privateNoStoreHeaders() });
}

/** The scheduler calls it with GET; the work is the same. */
export async function GET(req: NextRequest) {
  return POST(req);
}
