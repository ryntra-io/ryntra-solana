import { NextRequest, NextResponse } from "next/server";

import { reportError } from "@/lib/monitor";
import { decideBearerAuth, LEGACY_KEY_ERROR } from "@/lib/security";
import { runServerBeacons } from "@/lib/world/beacons/server";
import { beaconsMode } from "@/lib/world/beacons/switch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The city's beacons (CITY-72), every two minutes: one market read of the city for all, every account's beacons
 * checked by the engine, and a Telegram message for each one that lit where the person connected a chat. Internal —
 * the cron's bearer only. Signs, sends money and trades nothing.
 */
export async function GET(req: NextRequest) {
  const decision = decideBearerAuth(
    { authorization: req.headers.get("authorization"), legacyKeyPresent: new URL(req.url).searchParams.has("key") },
    process.env.CRON_SECRET,
  );
  if (decision === "legacy-rejected") return NextResponse.json({ ok: false, error: LEGACY_KEY_ERROR }, { status: 401 });
  if (decision !== "authorized") return NextResponse.json({ ok: false }, { status: 401 });
  /* Closed until the owner applies the migration and opens the account's beacons: nothing is read, nobody is told. */
  if (beaconsMode(process.env.NEXT_PUBLIC_RYNTRA_CITY_BEACONS) !== "open") return NextResponse.json({ ok: true, closed: true });
  try {
    const run = await runServerBeacons();
    return NextResponse.json({ ok: true, ...run });
  } catch (error) {
    /* Until the beacons' migration is applied the store does not answer: the pass waits for the next one. */
    void reportError("cron:city-beacons", error, {});
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
