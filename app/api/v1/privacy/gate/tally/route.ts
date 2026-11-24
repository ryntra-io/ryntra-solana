import { NextResponse } from "next/server";

import { FixedWindowLimiter, clientIp, rateLimitHeaders } from "@/lib/http-control";
import { dayOf, memoryTally, readReport, tallyJson } from "@/lib/privacy/gate/tally";
import { sameSite } from "@/lib/privacy/relay";
import { openNetwork } from "@/lib/privacy/relay-key.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `/api/v1/privacy/gate/tally` — «in — out» on Ryntra's side (`lib/privacy/gate/tally.ts`).
 *
 * - `POST { move: "in" | "out", lamports: "<decimal>" }` — a step that landed through Ryntra's screens. It adds one to
 *   the day's count and its amount to the day's sum; no address, signature or time of day is taken or kept.
 * - `GET` — the totals per UTC day and all days together.
 *
 * Kept in memory, per server instance since it started, until the owner names a durable store (a table is a database
 * change of its own). Shut (404) unless `NEXT_PUBLIC_RYNTRA_PRIVATE` opens a network (`devnet`, or `mainnet` with its key).
 */

const store = memoryTally();
const limiter = new FixedWindowLimiter({ limit: 30, windowMs: 60_000, maxKeys: 10_000 });

const MAX_BODY_BYTES = 256;
const NO_STORE = { "cache-control": "no-store" };

export async function GET(request: Request): Promise<Response> {
  if (!openNetwork()) return new NextResponse(null, { status: 404 });
  const rate = limiter.consume(clientIp(request.headers));
  if (!rate.allowed) return new NextResponse(null, { status: 429, headers: rateLimitHeaders(rate) });
  return NextResponse.json({ kept: "memory", ...tallyJson(await store.read()) }, { headers: NO_STORE });
}

export async function POST(request: Request): Promise<Response> {
  if (!openNetwork()) return new NextResponse(null, { status: 404 });
  if (!sameSite(request.headers)) return new NextResponse(null, { status: 403 });
  const rate = limiter.consume(clientIp(request.headers));
  if (!rate.allowed) return new NextResponse(null, { status: 429, headers: rateLimitHeaders(rate) });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return new NextResponse(null, { status: 413 });
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return new NextResponse(null, { status: 413 });
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  const report = readReport(body);
  if (!report) return new NextResponse(null, { status: 400, headers: NO_STORE });
  await store.add(dayOf(Date.now()), report.move, report.lamports);
  return new NextResponse(null, { status: 204, headers: NO_STORE });
}
