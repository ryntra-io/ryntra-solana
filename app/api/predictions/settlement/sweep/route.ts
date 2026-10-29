import { NextResponse, type NextRequest } from "next/server";

import { getGuardRuntime } from "@/lib/guard/runtime";
import { privateNoStoreHeaders } from "@/lib/http-control";
import { getPredictionProvider } from "@/lib/predictions/agg/adapter";
import { predictionTransports } from "@/lib/predictions/notify/transports.server";
import { sweepSettlement, sweepWallets } from "@/lib/predictions/settle-run";
import { decideBearerAuth } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The pass that makes a win arrive without anybody opening the page: for
 * every wallet that has traded here, read the positions, ask the venues for
 * the payouts the provider marks payable, follow the open ones to the end,
 * and send what is due.
 *
 * Behind the operator's bearer secret, and it is the same pass the person's
 * own button runs — one request id per market, so a run that overlaps with a
 * person's press asks for nothing twice. With live money switched off (the
 * default) it asks for no payout at all: it keeps the calendar and the notes.
 */
export async function POST(req: NextRequest) {
  const authorized = decideBearerAuth({ authorization: req.headers.get("authorization"), legacyKeyPresent: req.nextUrl.searchParams.has("key") }, process.env.CRON_SECRET);
  if (authorized !== "authorized") return NextResponse.json({ ok: false }, { status: 401, headers: privateNoStoreHeaders() });
  const store = getGuardRuntime().store;
  const provider = getPredictionProvider();
  const transports = predictionTransports(store);
  const now = Date.now();
  const wallets = await sweepWallets(store).catch(() => []);
  let swept = 0;
  let collecting = 0;
  let unknown = 0;
  let notes = 0;
  for (const wallet of wallets) {
    const pass = await sweepSettlement(store, provider, wallet, process.env, now, { transports }).catch(() => null);
    if (!pass?.ok) continue;
    swept += 1;
    collecting += pass.value.collects.filter((c) => c.phase === "asking" || c.phase === "collecting").length;
    unknown += pass.value.collects.filter((c) => c.phase === "unknown").length;
    notes += pass.value.notes.filter((n) => n.readAt === null).length;
  }
  return NextResponse.json({ ok: true, wallets: wallets.length, swept, collecting, unknown, notes }, { headers: privateNoStoreHeaders() });
}

/** The scheduler calls it with GET; the work is the same. */
export async function GET(req: NextRequest) {
  return POST(req);
}
