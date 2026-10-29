import { FixedWindowLimiter, TRACK_MAX_BODY_BYTES, clientIp, rateLimitHeaders } from "@/lib/http-control";

/**
 * Ryntra City's run log (Skyline Run). One JSON line per event in the server log, tagged [track]. Anonymous id
 * and game facts only; anything else is dropped, the address is never kept, and a flood from one caller is cut
 * off by the shared limiter.
 */
const LIMITER = new FixedWindowLimiter({ limit: 120, windowMs: 60_000, maxKeys: 5_000 });

const EVENTS = new Set(['home', 'play', 'explore', 'run_start', 'run_end', 'challenge']);
const FIELDS: Record<string, 'string' | 'number' | 'boolean'> = {
  ev: 'string',
  id: 'string',
  at: 'number',
  from: 'string',
  form: 'string',
  course: 'string',
  attempt: 'number',
  again: 'boolean',
  result: 'string',
  time: 'number',
  progress: 'number',
  reason: 'string',
  routes: 'string',
  node: 'string',
  best: 'boolean',
  hits: 'number',
  challenge: 'boolean',
  touch: 'boolean',
};

export async function POST(req: Request) {
  const decision = LIMITER.consume(clientIp(req.headers));
  if (!decision.allowed) return new Response(null, { status: 429, headers: rateLimitHeaders(decision) });
  const now = Date.now();
  const text = await req.text();
  if (text.length > TRACK_MAX_BODY_BYTES) return new Response(null, { status: 413 });
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return new Response(null, { status: 400 });
  }
  if (typeof body.ev !== 'string' || !EVENTS.has(body.ev)) return new Response(null, { status: 400 });
  const clean: Record<string, unknown> = {};
  for (const [key, type] of Object.entries(FIELDS)) {
    const value = body[key];
    if (typeof value !== type) continue;
    clean[key] = typeof value === 'string' ? value.slice(0, 80) : value;
  }
  console.log('[track]', JSON.stringify({ ...clean, t: new Date(now).toISOString() }));
  return new Response(null, { status: 204 });
}
