import { NextResponse } from 'next/server';
import { readCity } from '@/city/lib/market/jupiter';
import { BUNDLED_CITY } from '@/city/lib/market/bundled';
import type { CitySnapshot } from '@/city/lib/market/types';

// One shared read a minute for every visitor; Jupiter's keyless limit is 0.5 requests a second.
export const revalidate = 60;

export async function GET() {
  const { snapshot: live } = await readCity();
  const body: CitySnapshot = live ?? BUNDLED_CITY;
  return NextResponse.json(body, {
    headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
  });
}
