import { answerCareDoor } from '@/lib/care/door.server';
import { keeperActions, keeperGate } from '@/lib/care/stock-keeper.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * «Your agent keeps the stock pool»: one door for the terminal's position screen, beside the care's own
 * (`../care/route.ts`) and through the same door (`lib/care/door.server.ts`). Every action is the proven wallet's —
 * `review` builds the one approval for the bounds the person chose, `submit` relays it signed, `stop` builds everything
 * taken back, `relay` sends that signed, `status` reads the wallet's keepers. A change needs the wallet's own proof, a
 * read the proof of that wallet; the switch closed answers 404. All of it is `lib/care/stock-keeper.server.ts`.
 */
export async function POST(request: Request) {
  if (!keeperGate(process.env).open) return Response.json({ error: { code: 'KEEPER_CLOSED', message: 'Closed here.' } }, { status: 404, headers: { 'cache-control': 'no-store' } });
  return answerCareDoor(request, keeperActions(), { closed: 'KEEPER_CLOSED' });
}
