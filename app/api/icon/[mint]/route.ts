import { NextResponse } from 'next/server';
import { BUNDLED_CITY } from '@/city/lib/market/bundled';
import { readCity } from '@/city/lib/market/jupiter';
import { publicHttps } from '@/city/lib/net';
import { launchViewDeps } from '@/lib/launch/runtime.server';
import { readLaunchView } from '@/lib/launch/view.server';

/**
 * Same-origin token logos for the city's sign atlas (WebGL can only read same-origin or CORS images).
 * Only the icon URL that Jupiter lists for a tower, or the picture a Ryntra launch was made with (a coin bought from a
 * quarter or the Launch Docks before it is a tower), is ever fetched — never a URL from the request — over https,
 * to a public hostname, following at most three redirects that pass the same check, as a raster image or SVG
 * under 1 MB. SVG is served with a CSP that forbids scripts. IPFS logos are spread over several public gateways,
 * because one gateway alone rate-limits a city's worth of logos. A logo that cannot be served is "no logo" — 204, never
 * an error status, because the city simply keeps the coin's badge. The edge keeps every answer for a day — a logo
 * and a "no logo" alike — so a city's worth of visitors never asks the gateways twice; a busy gateway, a minute.
 */
const TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml', 'image/avif']);
const MAX_BYTES = 1_000_000;
const MAX_REDIRECTS = 3;
const DAY = 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800';
const noLogo = (cache = DAY) => new NextResponse(null, { status: 204, headers: { 'Cache-Control': cache } });
const BUSY = 'public, s-maxage=60';
/** A coin that is not a tower may be a launch minutes old: its "no logo" is asked again sooner. */
const SOON = 'public, max-age=600, s-maxage=600';

/** The picture a Ryntra launch was made with, read from the launch's own record; null for anything else. */
async function launchPicture(mint: string): Promise<string | null> {
  const deps = launchViewDeps();
  if (!deps) return null;
  try {
    const view = await readLaunchView(deps, mint);
    return typeof view?.image === 'string' ? view.image : null;
  } catch {
    return null;
  }
}
const IPFS_GATEWAYS = ['https://ipfs.io/ipfs/', 'https://dweb.link/ipfs/', 'https://gateway.pinata.cloud/ipfs/', 'https://nftstorage.link/ipfs/'];

function ipfsCid(icon: URL): { cid: string; path: string } | null {
  const sub = icon.hostname.match(/^(b[a-z2-7]{58,})\.ipfs\./);
  if (sub) return { cid: sub[1]!, path: icon.pathname === '/' ? '' : icon.pathname };
  const p = icon.pathname.match(/^\/ipfs\/(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{58,})(\/.*)?$/);
  return p ? { cid: p[1]!, path: p[2] ?? '' } : null;
}

/** The URLs to try for one logo: the original, or the same IPFS object on two gateways picked by its CID. */
function candidates(icon: URL): URL[] {
  const ipfs = ipfsCid(icon);
  if (!ipfs) return [icon];
  const start = ipfs.cid.charCodeAt(ipfs.cid.length - 1) % IPFS_GATEWAYS.length;
  return [0, 1].map((i) => new URL(`${IPFS_GATEWAYS[(start + i) % IPFS_GATEWAYS.length]}${ipfs.cid}${ipfs.path}`));
}

async function fetchImage(start: URL): Promise<Response | 'retry' | null> {
  let url: URL | null = start;
  for (let hop = 0; hop <= MAX_REDIRECTS && url; hop += 1) {
    // The edge caches the route's answer; the image itself skips the data cache, which refuses anything over 2 MB.
    const res: Response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(6_000), cache: 'no-store' });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      url = location ? publicHttps(new URL(location, url).toString()) : null;
      continue;
    }
    if (res.ok) return res;
    return res.status === 429 || res.status >= 500 ? 'retry' : null;
  }
  return null;
}

export async function GET(_req: Request, { params }: { params: Promise<{ mint: string }> }) {
  const { mint } = await params;
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) return new NextResponse(null, { status: 400 });

  // Logos are served only for Jupiter-verified towers; unverified pools stay anonymous in the city.
  let tower = BUNDLED_CITY.towers.find((t) => t.id === mint);
  if (!tower) {
    const { snapshot: live } = await readCity();
    tower = live?.towers.find((t) => t.id === mint);
  }
  let url = tower?.verified && tower.icon ? publicHttps(tower.icon) : null;
  if (!url && !tower) {
    const picture = await launchPicture(mint);
    url = picture ? publicHttps(picture) : null;
    if (!url) return noLogo(SOON);
  }
  if (!url) return noLogo();

  try {
    let res: Response | null = null;
    let busy = false;
    for (const candidate of candidates(url)) {
      const got = await fetchImage(candidate);
      if (got === 'retry') {
        busy = true;
        continue;
      }
      res = got;
      break;
    }
    if (!res) return noLogo(busy ? BUSY : DAY);
    const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    // A logo that says it is too big is refused before a byte of it is read.
    if (!TYPES.has(type) || Number(res.headers.get('content-length') ?? 0) > MAX_BYTES) {
      await res.body?.cancel();
      return noLogo();
    }
    const body = await res.arrayBuffer();
    if (body.byteLength > MAX_BYTES) return noLogo();
    return new NextResponse(body, {
      headers: {
        'Content-Type': type,
        'Cache-Control': DAY,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
      },
    });
  } catch {
    return noLogo(BUSY);
  }
}
