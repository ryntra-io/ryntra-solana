import { NextRequest, NextResponse } from "next/server";

import { runNewsCollection } from "@/lib/assistant/news/runtime.server";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { decideBearerAuth, LEGACY_KEY_ERROR } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The news collector's cron (AI-09), every ten minutes: read the allow-listed
 * feeds, keep the new items, label them, rebuild the digests they touch.
 * Internal — the cron's bearer only, not part of the public contract. Signs,
 * sends and trades nothing.
 */
export async function GET(req: NextRequest) {
  const decision = decideBearerAuth(
    { authorization: req.headers.get("authorization"), legacyKeyPresent: new URL(req.url).searchParams.has("key") },
    process.env.CRON_SECRET,
  );
  if (decision === "legacy-rejected") return NextResponse.json({ ok: false, error: LEGACY_KEY_ERROR }, { status: 401 });
  if (decision !== "authorized") return NextResponse.json({ ok: false }, { status: 401 });
  const report = await runNewsCollection(getGuardRuntime().store, Date.now());
  if (report === null) return NextResponse.json({ ok: true, skipped: "another run holds this slot" });
  return NextResponse.json({ ok: true, fresh: report.fresh, feeds: report.feeds.map((feed) => ({ id: feed.id, ok: feed.ok, fresh: feed.fresh })), modelCalls: report.modelCalls, costUsd: report.costMicroUsd === null ? null : report.costMicroUsd / 1_000_000 });
}
