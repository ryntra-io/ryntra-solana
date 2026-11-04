import { earnOpen } from '@/city/lib/earn/flag';
import { readStockPierList } from '@/city/lib/earn/stock-pier.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * The Stock Pier's verified pairs (CITY-98): stocks of the city's avenue that the issuer's catalogue and Jupiter name,
 * that the venue takes as they are (or whose badge stands), that are not paused or halted, and whose market traded in
 * the last seven days — each with its price, multiplier, the exchange's hours, a corporate step in sight, and its pier
 * on SOL and on USDC, standing or not. Read-only, so Earn can show it while the product's own switch is closed.
 */
export async function GET() {
  if (!earnOpen(process.env.NEXT_PUBLIC_RYNTRA_CITY_EARN)) {
    return Response.json({ error: { code: 'EARN_CLOSED', message: 'Earn is closed here.' } }, { status: 404, headers: { 'cache-control': 'no-store' } });
  }
  try {
    const list = await readStockPierList();
    return Response.json(list, {
      headers: {
        'cache-control': 'public, s-maxage=120, stale-while-revalidate=300',
      },
    });
  } catch {
    return Response.json(
      {
        error: {
          code: 'UNAVAILABLE',
          message: 'The stocks could not be read now.',
        },
      },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  }
}
