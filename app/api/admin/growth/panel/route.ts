import { NextRequest, NextResponse } from "next/server";

import { getGuardRuntime } from "@/lib/guard/runtime";
import { exportWeek, weeklyCsv } from "@/lib/growth/panel-csv";
import { isPanelRange, projectPanel } from "@/lib/growth/panel";
import { readPanelInputs } from "@/lib/growth/panel.server";
import { privateNoStoreHeaders } from "@/lib/http-control";
import { getAdminSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The growth panel (Ріст 7): `GET ?range=7d|30d|all` — the model the page draws; `GET ?format=csv[&week=YYYY-MM-DD]`
 * — a week (a Monday, UTC; the last full week by default) as CSV for «Медіа · Тиждень». An operator's session only;
 * reads and nothing else.
 */
const json = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: privateNoStoreHeaders() });

export async function GET(req: NextRequest) {
  const admin = await getAdminSession();
  if (!admin) return json({ error: "unauthorized" }, 401);
  const params = req.nextUrl.searchParams;
  const now = new Date().toISOString();
  const store = getGuardRuntime().store;
  if (params.get("format") === "csv") {
    const week = exportWeek(params.get("week"), now);
    if (!week) return json({ error: "bad_week" }, 400);
    try {
      const csv = weeklyCsv(await readPanelInputs(store, { now, range: "all", env: process.env }), week);
      return new NextResponse(csv, {
        status: 200,
        headers: {
          ...privateNoStoreHeaders(),
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="ryntra-growth-${week.start.slice(0, 10)}.csv"`,
        },
      });
    } catch {
      return json({ error: "unavailable" }, 503);
    }
  }
  const range = params.get("range") ?? "30d";
  if (!isPanelRange(range)) return json({ error: "bad_range" }, 400);
  try {
    return json({ panel: projectPanel(await readPanelInputs(store, { now, range, env: process.env })) });
  } catch {
    return json({ error: "unavailable" }, 503);
  }
}
