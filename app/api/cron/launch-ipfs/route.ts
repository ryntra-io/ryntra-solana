import { NextRequest, NextResponse } from "next/server";

import { privateNoStoreHeaders } from "@/lib/http-control";
import { runIpfsPass } from "@/lib/launch/ipfs.server";
import { launchMarketDeps } from "@/lib/launch/runtime.server";
import { decideBearerAuth } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The pass stops starting a file after this long: each add is seen through inside the route's 60 s. */
const BUDGET_MS = 35_000;

/**
 * The launches' pictures and metadata pinned on IPFS, every hour (vercel.json, SOL-L3): each file Ryntra keeps under
 * its sha256 is added to the operator's provider and recorded only when the provider's address is the same bytes'.
 * Without the provider's settings it does nothing. Signs nothing. Called by Vercel's cron with `CRON_SECRET`; anything
 * else is refused.
 */
export async function GET(req: NextRequest) {
  const authorized = decideBearerAuth({ authorization: req.headers.get("authorization"), legacyKeyPresent: req.nextUrl.searchParams.has("key") }, process.env.CRON_SECRET);
  if (authorized !== "authorized") return NextResponse.json({ ok: false }, { status: 401, headers: privateNoStoreHeaders() });
  const deps = launchMarketDeps();
  if (!deps) return NextResponse.json({ ok: true, state: "NOT_SERVED" }, { headers: privateNoStoreHeaders() });
  try {
    const pass = await runIpfsPass({ store: deps.store, cluster: deps.network.cluster, origin: deps.network.origin, env: process.env, now: deps.now }, { budgetMs: BUDGET_MS });
    return NextResponse.json({ ok: true, state: pass.configured ? "RAN" : "NOT_CONFIGURED", pass }, { headers: privateNoStoreHeaders() });
  } catch {
    return NextResponse.json({ ok: false, error: "IPFS_UNAVAILABLE" }, { status: 503, headers: privateNoStoreHeaders() });
  }
}
