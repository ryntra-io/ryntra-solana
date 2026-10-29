import { NextResponse, type NextRequest } from "next/server";

import { getGuardRuntime } from "@/lib/guard/runtime";
import { privateNoStoreHeaders } from "@/lib/http-control";
import { getPredictionProvider } from "@/lib/predictions/agg/adapter";
import { limitWallets, limitWorking, sweepLimitOrders } from "@/lib/predictions/limit";
import { predictionTransports } from "@/lib/predictions/notify/transports.server";
import { decideBearerAuth } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The pass that notices a limit order filling without anybody keeping the
 * page open: for every wallet with an order recorded here, read the working
 * ones back from the venue and tell the person what moved.
 *
 * Behind the operator's bearer secret, and it is the same pass the page's own
 * read runs. It places nothing and cancels nothing — it only reads the
 * venue's own state and writes notes, each under its own identity, so a pass
 * every few minutes tells nobody twice.
 */
export async function POST(req: NextRequest) {
  const authorized = decideBearerAuth({ authorization: req.headers.get("authorization"), legacyKeyPresent: req.nextUrl.searchParams.has("key") }, process.env.CRON_SECRET);
  if (authorized !== "authorized") return NextResponse.json({ ok: false }, { status: 401, headers: privateNoStoreHeaders() });
  const store = getGuardRuntime().store;
  const provider = getPredictionProvider();
  const transports = predictionTransports(store);
  const now = Date.now();
  const wallets = await limitWallets(store).catch(() => []);
  let swept = 0;
  let working = 0;
  let unread = 0;
  for (const wallet of wallets) {
    const pass = await sweepLimitOrders(store, provider, wallet, process.env, now, { transports }).catch(() => null);
    if (!pass) continue;
    swept += 1;
    working += pass.orders.filter((o) => limitWorking(o.state)).length;
    if (pass.providerFailure) unread += 1;
  }
  return NextResponse.json({ ok: true, wallets: wallets.length, swept, working, unread }, { headers: privateNoStoreHeaders() });
}

/** The scheduler calls it with GET; the work is the same. */
export async function GET(req: NextRequest) {
  return POST(req);
}
