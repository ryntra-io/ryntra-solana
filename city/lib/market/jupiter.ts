import { CURATED, districtOf } from './curated.ts';
import { buildTowers, type JupiterToken } from './normalize.ts';
import type { CitySnapshot } from './types.ts';

const BASE = 'https://api.jup.ag/tokens/v2';
const TIMEOUT_MS = 8_000;
/** A Tokens v2 page is tens of kilobytes; anything past this is not an answer we draw. */
const MAX_BYTES = 3_000_000;
/** The engine's own Jupiter key (`lib/solana/quotes.ts`): the city reads with the key Ryntra already holds. */
const KEY_ENV = 'RYNTRA_JUPITER_API_KEY';

export type JupiterRead = { ok: true; tokens: JupiterToken[] } | { ok: false; reason: string };

/**
 * One bounded read. Keyless calls are limited to 0.5 requests a second, so a 429 is not retried:
 * the caller falls back to the cached city. With the engine's key the reads go at once.
 */
export async function readTokens(path: string, fetchImpl: typeof fetch = fetch, revalidate = 60): Promise<JupiterRead> {
  const headers: Record<string, string> = { accept: 'application/json' };
  const key = process.env[KEY_ENV];
  if (key) headers['x-api-key'] = key;
  try {
    const res = await fetchImpl(`${BASE}/${path}`, {
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      next: { revalidate },
    } as RequestInit);
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status} on ${path}` };
    const text = await res.text();
    if (text.length > MAX_BYTES) return { ok: false, reason: `too large: ${path}` };
    const body: unknown = JSON.parse(text);
    if (!Array.isArray(body)) return { ok: false, reason: `not a list: ${path}` };
    return { ok: true, tokens: body as JupiterToken[] };
  } catch (error) {
    return { ok: false, reason: `${path}: ${error instanceof Error ? error.name : 'error'}` };
  }
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The three reads that make the skyline: the curated city in one search (≤100 mints), the trending hour,
 * the newest pools. Without a key they go one after another, 2.1 s apart, to stay under 0.5 requests a second.
 */
export async function readCity(fetchImpl: typeof fetch = fetch): Promise<{ snapshot: CitySnapshot | null; failures: string[] }> {
  const mints = CURATED.map(([mint]) => mint).join(',');
  const gap = process.env[KEY_ENV] ? 0 : 2_100;
  const curated = await readTokens(`search?query=${mints}`, fetchImpl, 60);
  if (gap) await pause(gap);
  const trending = await readTokens('toptrending/1h?limit=40', fetchImpl, 120);
  if (gap) await pause(gap);
  const recent = await readTokens('recent', fetchImpl, 90);
  const failures = [curated, trending, recent].flatMap((read) => (read.ok ? [] : [read.reason]));
  // Without the curated read there is no city worth calling live; the route serves the snapshot instead.
  if (!curated.ok) return { snapshot: null, failures };
  const towers = buildTowers(curated.tokens, districtOf, trending.ok ? trending.tokens : [], recent.ok ? recent.tokens : []);
  return { snapshot: { towers, fetchedAt: new Date().toISOString(), source: 'live' }, failures };
}
