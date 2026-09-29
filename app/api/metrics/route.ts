import { NextRequest, NextResponse } from "next/server";
import { metrics } from "@/lib/beta/rpc";
import { decideBearerAuth, LEGACY_KEY_ERROR } from "@/lib/security";

import { toDescriptiveMetrics } from "@/lib/metrics-response.mjs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Descriptive funnel metrics. Always protected:
 * GET /api/metrics with `Authorization: Bearer <METRICS_SECRET>` → data; anything else → 401;
 * legacy `?key=` → 401 with a migration error (never accepted, even alongside a valid Bearer).
 */
export async function GET(req: NextRequest) {
  const decision = decideBearerAuth(
    { authorization: req.headers.get("authorization"), legacyKeyPresent: new URL(req.url).searchParams.has("key") },
    process.env.METRICS_SECRET
  );
  if (decision === "legacy-rejected") {
    return NextResponse.json({ ok: false, error: LEGACY_KEY_ERROR }, { status: 401 });
  }
  if (decision !== "authorized") {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const descriptiveMetrics = toDescriptiveMetrics(await metrics());
  if (!descriptiveMetrics) return NextResponse.json({ ok: false, error: "metrics unavailable" }, { status: 503 });
  return NextResponse.json({ ...descriptiveMetrics, ok: true });
}
