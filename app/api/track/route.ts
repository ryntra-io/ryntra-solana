import { NextRequest } from "next/server";
import { insertEvent } from "@/lib/db";
import { FixedWindowLimiter, TRACK_MAX_BODY_BYTES, clientIp, privateNoStoreHeaders, rateLimitHeaders } from "@/lib/http-control";
import { reportError } from "@/lib/monitor";
import { mutationOriginAllowed } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* Anonymous site clicks only. `workspace_cta_click` is fired by the site chrome
   and was refused here until RYN-ADMIN-006, so the admin never saw it. */
const ALLOWED_EVENTS = new Set(["telegram_cta_click", "workspace_cta_click", "arcus_link_click"]);
const limiter = new FixedWindowLimiter({ limit: 60, windowMs: 60_000, maxKeys: 5_000 });
const TRACK_ERROR_REPORT_WINDOW_MS = 60_000;
let lastInsertErrorAt = 0;


const str = (value: unknown, max: number): string | null =>
  typeof value === "string" && value.length > 0 ? value.slice(0, max) : null;

function empty(status: number, extraHeaders?: Record<string, string>): Response {
  return new Response(null, {
    status,
    headers: { ...privateNoStoreHeaders(), ...extraHeaders },
  });
}

export async function POST(req: NextRequest) {
  if (!mutationOriginAllowed(req.url, req.headers.get("origin"), req.headers.get("sec-fetch-site"))) {
    return empty(403);
  }

  const decision = limiter.consume(clientIp(req.headers));
  if (!decision.allowed) return empty(429, rateLimitHeaders(decision));

  const contentType = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") return empty(415);

  const declaredLength = Number(req.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > TRACK_MAX_BODY_BYTES) return empty(413);

  let text: string;
  try {
    text = await req.text();
  } catch {
    return empty(400);
  }
  if (new TextEncoder().encode(text).byteLength > TRACK_MAX_BODY_BYTES) return empty(413);

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return empty(400);
  }

  const { name, placement, locale, path, ref } = (body ?? {}) as Record<string, unknown>;
  if (typeof name !== "string" || !ALLOWED_EVENTS.has(name)) return empty(400);

  const stored = await insertEvent({
    name,
    placement: str(placement, 32),
    locale: str(locale, 12),
    path: str(path, 128),
    ref: str(ref, 256),
  });
  const now = Date.now();
  if (!stored && now - lastInsertErrorAt >= TRACK_ERROR_REPORT_WINDOW_MS) {
    lastInsertErrorAt = now;
    void reportError("track.insert", new Error("analytics event insert failed"), { name });
  }
  return empty(204);
}
