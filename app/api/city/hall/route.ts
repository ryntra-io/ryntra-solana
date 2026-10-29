import { after } from 'next/server';
import { hallOpen } from '@/city/lib/launch/hall';
import { readHall } from '@/city/lib/launch/hall.server';
import { FixedWindowLimiter, clientIp, rateLimitHeaders } from '@/lib/http-control';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Asks from one address a minute on one instance; the page reads the Hall once every few minutes. */
const HALL_ASKS_PER_MINUTE = 30;
const limiter = new FixedWindowLimiter({ limit: HALL_ASKS_PER_MINUTE, windowMs: 60_000, maxKeys: 10_000 });

const NO_STORE = { 'cache-control': 'no-store' } as const;

/**
 * The Hall of Fame's billboards of the week: the Launch engine's own reads, the honest count's judgement of
 * every trade, kept a few minutes for every visitor and worked out again behind the answer. Read-only, public — and
 * closed while the Hall is.
 *
 * The answer never depends on the query: an ask with one is sent to the bare address, so the CDN keeps one copy and a
 * made-up `?x=` cannot walk past it. Asks are limited per address, and one Hall is worked out at a time per instance.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.search) {
    return new Response(null, { status: 308, headers: { location: url.pathname, 'cache-control': 'public, max-age=3600, s-maxage=3600' } });
  }
  const decision = limiter.consume(clientIp(req.headers));
  if (!decision.allowed) {
    return Response.json({ error: { code: 'RATE_LIMITED', message: 'Too many asks; try again in a minute.' } }, { status: 429, headers: { ...NO_STORE, ...rateLimitHeaders(decision) } });
  }
  if (!hallOpen(process.env.NEXT_PUBLIC_RYNTRA_CITY_HALL)) {
    return Response.json({ error: { code: 'HALL_CLOSED', message: 'The Hall of Fame opens soon.' } }, { status: 404, headers: NO_STORE });
  }
  const answer = await readHall(Date.now(), (work) => after(work));
  if (!answer.ok) {
    const message = answer.code === 'LAUNCH_UNAVAILABLE' ? 'Launch is not served here.' : 'The engine could not be read now; try again.';
    return Response.json({ error: { code: answer.code, message } }, { status: 503, headers: { ...NO_STORE, 'retry-after': '60' } });
  }
  /* A Hall cut short by its time budget, or an older one standing in, is kept by the CDN for less. */
  const cache = answer.mark === 'fresh' ? 'public, s-maxage=120, stale-while-revalidate=300' : 'public, s-maxage=30, stale-while-revalidate=60';
  return Response.json(answer.view, { headers: { 'cache-control': cache, 'x-ryntra-hall': answer.mark } });
}
