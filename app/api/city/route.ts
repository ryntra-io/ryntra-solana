import { NextResponse } from 'next/server';
import { readCity } from '@/city/lib/market/jupiter';
import { BUNDLED_CITY } from '@/city/lib/market/bundled';
import { cityAnswer } from '@/city/lib/market/serve';
import type { CitySnapshot } from '@/city/lib/market/types';

// One shared read a minute for every visitor; Jupiter's keyless limit is 0.5 requests a second.
export const revalidate = 60;

/** The last live city this instance read: a failed read answers with it (CITY-200, `city/lib/market/serve.ts`). */
let kept: CitySnapshot | null = null;

export async function GET() {
  const { snapshot: live, failures } = await readCity();
  const answer = cityAnswer(live, kept, BUNDLED_CITY, Date.now(), process.env.NEXT_PHASE === 'phase-production-build');
  kept = answer.keep;
  // A failed regeneration is not stored: the edge keeps the last live city, and the page keeps the city it drew.
  if (!answer.body) throw new Error(`city read failed: ${failures.join('; ')}`);
  return NextResponse.json(answer.body, {
    headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
  });
}
