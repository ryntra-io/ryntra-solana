import { NextRequest, NextResponse } from "next/server";

import { getGuardRuntime } from "@/lib/guard/runtime";
import { tickMonitoring } from "@/lib/monitoring/service.server";
import { decideBearerAuth, LEGACY_KEY_ERROR } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Evaluate every monitor, write inbox rows, deliver the outbox. Never executes a trade. */
export async function GET(req: NextRequest) {
  const decision = decideBearerAuth(
    { authorization: req.headers.get("authorization"), legacyKeyPresent: new URL(req.url).searchParams.has("key") },
    process.env.CRON_SECRET,
  );
  if (decision === "legacy-rejected") {
    return NextResponse.json({ ok: false, error: LEGACY_KEY_ERROR }, { status: 401 });
  }
  if (decision !== "authorized") return NextResponse.json({ ok: false }, { status: 401 });
  await tickMonitoring(getGuardRuntime().store, Date.now(), "en");
  return NextResponse.json({ ok: true });
}
