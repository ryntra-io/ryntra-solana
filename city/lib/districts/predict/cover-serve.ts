import { isCover } from './cover.ts';

/**
 * A Predictions cover, served from the city's own origin (CITY-77; the route is `app/api/city/predict/cover`). The
 * covers live on `assets.agg.market`; the city's page carries the site's policy, which does not name that host, so
 * the browser refused every cover and each card showed its emblem.
 * Widening the site's `img-src` for one district is the wrong trade (`lib/security-headers.test.mjs` pins it), so the
 * page asks this route and the route fetches the cover.
 *
 * Only AGG's own covers: one host, one shape of path, WebP (`city/lib/districts/predict/cover.ts`) — never a redirect,
 * never another host, so the address the page passes reaches nothing else. Bounded — two megabytes, five seconds, the
 * bytes must be an image — and cached at the edge for a week under the cover's own address.
 */

const CEILING_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 5_000;
const CACHE_ENTRIES = 400;
/** What the kept covers may hold together in one instance's memory: the oldest give way first. */
const CACHE_BYTES = 48 * 1024 * 1024;
const CACHE_TTL_MS = 60 * 60_000;
const KEEP = 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400';

type Cached = Readonly<{ bytes: Uint8Array; type: string; at: number }>;
const cache = new Map<string, Cached>();
let kept = 0;

/** For tests: forget the covers kept. */
export function forgetCovers(): void {
  cache.clear();
  kept = 0;
}

/** For tests: how many covers and bytes are kept. */
export function keptCovers(): Readonly<{ entries: number; bytes: number }> {
  return { entries: cache.size, bytes: kept };
}

/** Keep a cover, the oldest giving way while the count or the bytes would pass their ceiling. */
function keep(url: string, entry: Cached): void {
  const was = cache.get(url);
  if (was) {
    cache.delete(url);
    kept -= was.bytes.byteLength;
  }
  while (cache.size > 0 && (cache.size >= CACHE_ENTRIES || kept + entry.bytes.byteLength > CACHE_BYTES)) {
    const oldest = cache.keys().next().value as string;
    kept -= cache.get(oldest)!.bytes.byteLength;
    cache.delete(oldest);
  }
  cache.set(url, entry);
  kept += entry.bytes.byteLength;
}

/** The body, read no further than the ceiling: null when it passes it, whatever the head declared. */
async function readBounded(res: Response): Promise<Uint8Array | null> {
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > CEILING_BYTES) {
      await reader.cancel().catch(() => {});
      return null;
    }
    parts.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    bytes.set(p, at);
    at += p.byteLength;
  }
  return bytes;
}

function none(status = 404): Response {
  return new Response(null, { status, headers: { 'cache-control': status === 400 ? 'private, no-store' : 'public, max-age=300, s-maxage=600' } });
}

/** What the bytes are, from the bytes: WebP, PNG or JPEG, and nothing else is handed to a browser. */
function sniff(bytes: Uint8Array): string | null {
  const b = bytes;
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  return null;
}

function image(entry: Cached): Response {
  return new Response(new Uint8Array(entry.bytes), {
    headers: { 'content-type': entry.type, 'cache-control': KEEP, 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'" },
  });
}

/** Answer a cover: `?u=` an AGG cover address; anything else is refused before any fetch. */
export async function serveCover(request: Request, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const given = new URL(request.url).searchParams.get('u');
  if (!isCover(given)) return none(400);
  const hit = cache.get(given);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return image(hit);

  let upstream: Response;
  try {
    upstream = await fetchImpl(given, { redirect: 'error', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { accept: 'image/webp,image/*' } });
  } catch {
    return none(502);
  }
  const declared = Number(upstream.headers.get('content-length') ?? '0');
  if (!upstream.ok || (Number.isFinite(declared) && declared > CEILING_BYTES)) {
    await upstream.body?.cancel();
    return none(upstream.status === 404 ? 404 : 502);
  }
  // Read no further than the ceiling, whatever the head declared; a body cut off on the way is no cover.
  const bytes = await readBounded(upstream).catch(() => undefined);
  if (bytes === undefined) return none(502);
  if (bytes === null) return none(502);
  const type = bytes.byteLength > 0 ? sniff(bytes) : null;
  if (!type) return none();
  const entry = { bytes, type, at: Date.now() };
  keep(given, entry);
  return image(entry);
}
