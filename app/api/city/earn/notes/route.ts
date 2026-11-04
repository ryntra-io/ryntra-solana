import { earnOpen } from '@/city/lib/earn/flag';
import { registerEarnWatch } from '@/city/lib/earn/notes-watch';
import { requireWalletProof } from '@/lib/api/v1/proof';
import { getGuardRuntime } from '@/lib/guard/runtime';
import { clientIp, FixedWindowLimiter } from '@/lib/http-control';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LIMITER = new FixedWindowLimiter({ limit: 10, windowMs: 60_000, maxKeys: 5_000 });
const WALLET = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Earn's notes with Ryntra closed (CITY-100): the city asks Ryntra's server to watch the wallet it proved, so the phone
 * and a connected Telegram hear of a position out of range, the exchange's weekend and a dividend date
 * (`city/lib/earn/notes-watch.ts`). Only the proven wallet itself, never another address; the request names the wallet
 * the page holds, and a proof of another wallet changes nothing. Writes one row of the watch; signs, sends and trades
 * nothing. Closed where Earn is closed.
 */
export async function POST(request: Request) {
  const headers = { 'cache-control': 'private, no-store' };
  const fail = (status: number, code: string, message: string) => Response.json({ error: { code, message } }, { status, headers });
  if (!earnOpen(process.env.NEXT_PUBLIC_RYNTRA_CITY_EARN)) return fail(404, 'EARN_CLOSED', 'Earn is closed here.');
  if (!LIMITER.consume(`city-earn-notes:${clientIp(request.headers)}`).allowed) return fail(429, 'RATE_LIMITED', 'Too many requests.');
  const proof = await requireWalletProof(request, 'mutation');
  if (!proof.ok) return proof.response;
  const body = (await request.json().catch(() => null)) as { owner?: unknown; locale?: unknown } | null;
  const owner = typeof body?.owner === 'string' && WALLET.test(body.owner) ? body.owner : null;
  const locale = body?.locale === 'uk' ? 'uk' : body?.locale === 'en' ? 'en' : null;
  if (!owner || !locale) return fail(400, 'BAD_REQUEST', 'A wallet and a language are needed.');
  if (owner !== proof.address) return fail(403, 'FORBIDDEN', 'Only the proven wallet can be watched.');
  const guard = getGuardRuntime();
  if (!guard.writes.allowed) return fail(503, 'UNAVAILABLE', 'Notes cannot be kept here now.');
  try {
    await registerEarnWatch(guard.store, owner, locale, Date.now());
    return Response.json({ ok: true }, { headers });
  } catch {
    return fail(503, 'UNAVAILABLE', 'Notes cannot be kept here now. Try again in a moment.');
  }
}
