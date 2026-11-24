import { answerCareDoor } from '@/lib/care/door.server';
import { careActions, careGate } from '@/lib/care/service.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * «Your agent looks after it»: one door for the window. Every action is the proven wallet's own — `review`
 * builds the care's transactions, `submit` relays the ones the wallet signed, `stop` builds everything back, `relay`
 * sends that signed, `status` reads the wallet's cares. A change needs the wallet's own proof, a read the proof of that
 * wallet (`lib/care/door.server.ts`); the switch closed answers 404.
 */
export async function POST(request: Request) {
  if (!careGate(process.env).open) return Response.json({ error: { code: 'CARE_CLOSED', message: 'Closed here.' } }, { status: 404, headers: { 'cache-control': 'no-store' } });
  return answerCareDoor(request, careActions(), { closed: 'CARE_CLOSED' });
}
