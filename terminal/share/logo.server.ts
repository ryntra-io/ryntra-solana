import { SITE_ORIGIN } from '@/lib/product/app-address';
import { spotIcon } from '@/city/lib/search/rank';
import { logoChain } from '@/terminal/market/depth-view';

/**
 * A coin's logo for a share card: the same addresses the terminal's `CoinLogo` tries, in the same order (`logoChain`:
 * the catalogue's picture through `/api/spot/icon`, the same IPFS picture on another gateway, Ryntra's `/api/icon/<mint>`),
 * fetched from the site itself — the routes keep their own guards and their edge copies — and drawn as PNG or JPEG, the
 * only pictures the card's engine reads (a WebP, AVIF or SVG logo is redrawn by sharp). The letter stays only when no
 * address brings a picture. Logos are the engine's: nothing is drawn for a coin.
 */

const LOGO_MS = 4_000;
const MAX_BYTES = 1_000_000;
/** The size a logo is redrawn at: twice the card's largest disc. */
const DRAWN_PX = 256;

/** PNG or JPEG by their bytes: what the card draws as it is. */
function drawable(bytes: Uint8Array): 'image/png' | 'image/jpeg' | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  return null;
}

/** Any picture as a PNG data address: as it is when the card can draw it, else redrawn; null when it is not a picture. */
export async function pictureUri(bytes: Uint8Array): Promise<string | null> {
  const type = drawable(bytes);
  if (type) return `data:${type};base64,${Buffer.from(bytes).toString('base64')}`;
  try {
    const { default: sharp } = await import('sharp');
    const png = await sharp(bytes, { animated: false }).resize(DRAWN_PX, DRAWN_PX, { fit: 'cover' }).png().toBuffer();
    return `data:image/png;base64,${png.toString('base64')}`;
  } catch {
    return null;
  }
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** One address of the site, as a picture, or null: a «no logo» (204), a page that is not a picture or one too big. */
async function fromSite(address: string, get: FetchLike): Promise<string | null> {
  const res = await get(`${SITE_ORIGIN}${address}`, { signal: AbortSignal.timeout(LOGO_MS), headers: { accept: 'image/png,image/jpeg,image/webp,image/avif,image/svg+xml,image/*' } }).catch(() => null);
  if (!res || res.status !== 200 || !(res.headers.get('content-type') ?? '').startsWith('image/') || Number(res.headers.get('content-length') ?? 0) > MAX_BYTES) {
    await res?.body?.cancel().catch(() => {});
    return null;
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  return bytes.byteLength <= MAX_BYTES ? pictureUri(bytes) : null;
}

/**
 * The logo of a mint, by the terminal's chain of addresses. `icon` is the catalogue's own picture address (the market's
 * `icon`), raw; without it only Ryntra's `/api/icon/<mint>` is asked.
 */
export async function coinLogoUri(mint: string, icon: string | null, get: FetchLike = fetch): Promise<string | null> {
  const first = icon ? spotIcon(mint, icon) : null;
  const chain = logoChain(mint, icon, first);
  for (const address of [chain.src, ...chain.also]) {
    if (!address) continue;
    const got = await fromSite(address, get);
    if (got) return got;
  }
  return null;
}
