import { NextRequest, NextResponse } from "next/server";

import { reportError } from "@/lib/monitor";
import { weeklyPass } from "@/lib/partner-payouts/payouts.server";
import { decideBearerAuth, LEGACY_KEY_ERROR } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The partners' weekly payout (CITY-128): every closed week counted once into its statement, every bound proposal
 * settled against the chain, and the running week's share so far for «Мій район». Internal — the cron's bearer only.
 * Off unless `RYNTRA_PARTNER_PAYOUTS=on`. Signs, sends and pays nothing: the operator's wallet signs the week's proposal.
 */
export async function GET(req: NextRequest) {
  const decision = decideBearerAuth(
    { authorization: req.headers.get("authorization"), legacyKeyPresent: new URL(req.url).searchParams.has("key") },
    process.env.CRON_SECRET,
  );
  if (decision === "legacy-rejected") return NextResponse.json({ ok: false, error: LEGACY_KEY_ERROR }, { status: 401 });
  if (decision !== "authorized") return NextResponse.json({ ok: false }, { status: 401 });
  try {
    const pass = await weeklyPass();
    if (!pass.on) return NextResponse.json({ ok: true, closed: true });
    return NextResponse.json({ ok: true, prepared: pass.prepared, settled: pass.settled });
  } catch (error) {
    void reportError("cron:partner-payouts", error, {});
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
