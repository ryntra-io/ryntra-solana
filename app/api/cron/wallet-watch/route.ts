import { NextRequest, NextResponse } from "next/server";

import { getGuardRuntime } from "@/lib/guard/runtime";
import { reportError } from "@/lib/monitor";
import { decideBearerAuth, LEGACY_KEY_ERROR } from "@/lib/security";
import { runWalletWatches } from "@/lib/wallet-watch/runtime.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * «Стеження за гаманцями»'s cron (SOL-R4), every two minutes: every followed wallet read once for all who follow it,
 * its new trades told to each of them as a note through the monitoring engine; a wallet copied on paper (SOL-R3) has
 * its new trades filled on paper at the price of the moment. Internal — the cron's bearer only. Signs, sends money and
 * trades nothing.
 */
export async function GET(req: NextRequest) {
  const decision = decideBearerAuth(
    { authorization: req.headers.get("authorization"), legacyKeyPresent: new URL(req.url).searchParams.has("key") },
    process.env.CRON_SECRET,
  );
  if (decision === "legacy-rejected") return NextResponse.json({ ok: false, error: LEGACY_KEY_ERROR }, { status: 401 });
  if (decision !== "authorized") return NextResponse.json({ ok: false }, { status: 401 });
  const guard = getGuardRuntime();
  if (!guard.writes.allowed) return NextResponse.json({ ok: true, skipped: "read-only" });
  try {
    const run = await runWalletWatches(guard.store);
    return NextResponse.json({ ok: true, ...run });
  } catch (error) {
    /* A pass that failed whole is taken again two minutes on; nothing it wrote is written twice. */
    void reportError("cron:wallet-watch", error, {});
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
