import { NextResponse } from "next/server";

import { readActivitySummary } from "@/lib/admin/activity";
import { projectInsights } from "@/lib/admin/insights";
import { metrics } from "@/lib/beta/rpc";
import { toDescriptiveMetrics } from "@/lib/metrics-response.mjs";
import { getAdminSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const [m, activity] = await Promise.all([metrics(), readActivitySummary()]);
  const descriptive = toDescriptiveMetrics(m);
  if (!descriptive) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  const ctaBlock = descriptive.cta_events_14d;
  const cta = ctaBlock && typeof ctaBlock === "object" && !Array.isArray(ctaBlock) ? (ctaBlock as Record<string, unknown>) : {};
  return NextResponse.json({
    insights: projectInsights({
      cta14d: cta,
      activity,
      env: {
        GA4_PROPERTY_ID: process.env.GA4_PROPERTY_ID,
        GSC_SITE_URL: process.env.GSC_SITE_URL,
      },
    }),
  });
}
