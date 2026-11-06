import { NextRequest, NextResponse } from "next/server";

import { readDemandWeek } from "@/lib/growth/demand-week.server";
import { readWeek, recentWeeks } from "@/lib/growth/demand-week";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { privateNoStoreHeaders } from "@/lib/http-control";
import { getAdminSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The owner's week of demand (CITY-197): `GET ?week=YYYY-MM-DD` — a closed week (a Monday, UTC; the last one by
 * default). An operator's session only; reads and nothing else.
 */
const json = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: privateNoStoreHeaders() });

export async function GET(req: NextRequest) {
  const admin = await getAdminSession();
  if (!admin) return json({ error: "unauthorized" }, 401);
  const now = Date.now();
  const week = readWeek(req.nextUrl.searchParams.get("week"), now);
  if (!week) return json({ error: "bad_week" }, 400);
  try {
    return json({ demand: await readDemandWeek(getGuardRuntime().store, week, process.env), weeks: recentWeeks(now) });
  } catch {
    return json({ error: "unavailable" }, 503);
  }
}
