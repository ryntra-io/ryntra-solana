import { NextRequest, NextResponse } from "next/server";

import { getGuardRuntime } from "@/lib/guard/runtime";
import { reportError } from "@/lib/monitor";
import { decideBearerAuth, LEGACY_KEY_ERROR } from "@/lib/security";
import { runSpotStops } from "@/lib/stops/runtime.server";
import { stopsOpen } from "@/lib/stops/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Stops on spot (CITY-149), every minute: every watched stop asked about with the swap engine's quote, «reached»
 * written once, the person told — the inbox, Telegram, the phone's and the browser's push; stops past their time
 * expire. Internal — the cron's bearer only. Shut until stops are open (`lib/stops/ready.ts`). Signs, sends money and
 * trades nothing: the sale is the person's to sign.
 */
export async function GET(req: NextRequest) {
  const decision = decideBearerAuth(
    { authorization: req.headers.get("authorization"), legacyKeyPresent: new URL(req.url).searchParams.has("key") },
    process.env.CRON_SECRET,
  );
  if (decision === "legacy-rejected") return NextResponse.json({ ok: false, error: LEGACY_KEY_ERROR }, { status: 401 });
  if (decision !== "authorized") return NextResponse.json({ ok: false }, { status: 401 });
  if (!stopsOpen()) return NextResponse.json({ ok: true, skipped: "closed" });
  const guard = getGuardRuntime();
  if (!guard.writes.allowed) return NextResponse.json({ ok: true, skipped: "read-only" });
  try {
    const run = await runSpotStops(guard.store);
    return NextResponse.json({ ok: true, ...run });
  } catch (error) {
    /* A pass that failed whole is taken again a minute on; «reached» and the notes are written once. */
    void reportError("cron:spot-stops", error, {});
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
