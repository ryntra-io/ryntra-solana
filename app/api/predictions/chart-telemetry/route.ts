import { NextResponse } from "next/server";

import { telemetryLine } from "@/lib/predictions/chart-telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The market chart's health from the browser (`ryntra.chart.telemetry/1`): the market, counts and durations, never a
 * person. Each event is written as one line to the server's log, which the deployment's monitoring reads; anything
 * the schema does not name is dropped before it is written.
 */
export async function POST(request: Request) {
  // A body larger than any event is not read at all.
  if (Number(request.headers.get("content-length") ?? 0) > 8_192) return new NextResponse(null, { status: 413 });
  const text = await request.text().catch(() => "");
  const line = telemetryLine(text);
  if (line) console.info("[predictions.chart]", line);
  return new NextResponse(null, { status: 204, headers: { "cache-control": "no-store" } });
}
