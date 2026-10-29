import { LaunchWindowsResponseSchema, type LaunchWindowsResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { EVENING_WINDOW_HOUR_UTC, EVENING_WINDOW_MINUTES, HOURLY_WINDOW_MINUTES, nextWindow, windowOpenAt, type LaunchWindow } from "@/lib/core/launch/windows";
import { rateLimitHeaders } from "@/lib/http-control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const view = (window: LaunchWindow) => ({ id: window.id, kind: window.kind, opensAt: new Date(window.opensAt).toISOString(), closesAt: new Date(window.closesAt).toISOString() });

/**
 * `GET /api/v1/launch/windows` (contract 1.74.0, MC-2) — the launch windows' published schedule: a small window at the
 * top of every hour UTC, a big one every evening; the one open now, the next and the next evening. A window is a time
 * only — Ryntra holds and signs nothing for it. Public; no read of the chain.
 */
export async function GET(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const now = Date.now();
  const open = windowOpenAt(now);
  const body: LaunchWindowsResponse = {
    open: open ? view(open) : null,
    next: view(nextWindow(now)),
    nextEvening: view(nextWindow(now, "evening")),
    schedule: { hourlyMinutes: HOURLY_WINDOW_MINUTES, eveningHourUtc: EVENING_WINDOW_HOUR_UTC, eveningMinutes: EVENING_WINDOW_MINUTES },
    observedAt: new Date(now).toISOString(),
  };
  return apiJson(LaunchWindowsResponseSchema.parse(body), 200, rateLimitHeaders(rate));
}
