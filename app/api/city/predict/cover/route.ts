import { serveCover } from '@/city/lib/districts/predict/cover-serve';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

/** A Predictions cover through the city's own origin: AGG's covers only (`city/lib/districts/predict/cover-serve.ts`). */
export async function GET(request: Request) {
  return serveCover(request);
}
