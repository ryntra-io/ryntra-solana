import { NextRequest, NextResponse } from "next/server";

import { runNewsRefresh } from "@/lib/assistant/news/runtime.server";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { decideBearerAuth, LEGACY_KEY_ERROR } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The news digests' hourly cron (AI-09): the followed tokens refreshed from
 * the watchlists, every digest rebuilt, items older than three days removed.
 * Internal — the cron's bearer only. No model call.
 */
export async function GET(req: NextRequest) {
  const decision = decideBearerAuth(
    { authorization: req.headers.get("authorization"), legacyKeyPresent: new URL(req.url).searchParams.has("key") },
    process.env.CRON_SECRET,
  );
  if (decision === "legacy-rejected") return NextResponse.json({ ok: false, error: LEGACY_KEY_ERROR }, { status: 401 });
  if (decision !== "authorized") return NextResponse.json({ ok: false }, { status: 401 });
  const done = await runNewsRefresh(getGuardRuntime().store, Date.now());
  return NextResponse.json({ ok: true, ...done });
}
