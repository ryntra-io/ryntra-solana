import { consumeSpotIconRequest } from "@/lib/agent-control/http";
import { lookupSpotIcon } from "@/lib/spot/markets.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

/**
 * A token's icon, served from here.
 *
 * The site's CSP allows images from itself and two named hosts, and token
 * icons live on four hundred — GitHub raw, Backed's and Ondo's CDNs, IPFS and
 * Arweave gateways, issuers' own sites, a long tail of image hosts behind
 * memes. Widening `img-src` to the whole web is the wrong trade for a picture,
 * so the page asks this route and the route fetches the icon.
 *
 * The address is the catalogue's own — the list and the market carry it and
 * the page passes it back as `u` — and it is fetched only over https to a
 * public host name: never an IP literal, localhost or a private suffix, so a
 * mint whose metadata points inward reaches nothing. Without `u` the mint is
 * looked up in this instance's own catalogue reads; a serverless instance does
 * not share memory with the one that answered the list, which is why the page
 * sends the address rather than relying on that.
 *
 * Bounded on every axis — a few megabytes, five seconds, image types only, a
 * per-address budget of its own so a long list of pictures never spends the
 * budget the price and the quote run on — and cached at the edge for a day
 * under the icon's own address.
 */

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
/* Issuers upload the picture they have: a 1.5 MB JPEG behind a 28 px avatar
   is common. The page asks for it through next/image, which resizes it once
   and caches the small file, so the ceiling is about not reading a film. */
const CEILING_BYTES = 3 * 1024 * 1024;
const CACHE_TTL_MS = 60 * 60_000;
/* A miss is remembered briefly: the public IPFS gateway answers 429 in
   bursts, and an icon that was busy at noon is not an icon that does not exist. */
const MISS_TTL_MS = 10 * 60_000;
const CACHE_ENTRIES = 600;
const FETCH_TIMEOUT_MS = 5_000;

type CachedIcon = Readonly<{ bytes: Uint8Array; type: string; at: number }> | Readonly<{ missing: true; at: number }>;
const cache = new Map<string, CachedIcon>();

function remember(mint: string, entry: CachedIcon): void {
  if (cache.size >= CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(mint, entry);
}

/**
 * A token's metadata is written by whoever minted it, so the icon address is
 * the one string on this route an outsider chooses. It is fetched only over
 * https to a public host name — never an IP literal, localhost or a private
 * suffix — so a mint cannot point the server at anything but the open web.
 */
function publicHttpsUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".arpa")) return false;
  if (/^\[?[0-9a-f:.]+\]?$/i.test(host) && /[0-9]/.test(host) && !/[g-z]/i.test(host)) return false;
  return host.includes(".");
}

/* No logo is an answer, not an error (CITY-200): a 404 put «Failed to load resource» in the console for every coin of a
   search without a picture. 204, as the city's own `/api/icon` answers; the page keeps the coin's badge either way. */
function notFound(): Response {
  return new Response(null, { status: 204, headers: { "cache-control": "public, max-age=300, s-maxage=600" } });
}

/**
 * The addresses to try, in order. A quarter of the catalogue's icons sit on
 * `ipfs.io`, which rate-limits by the minute; the same content id is served
 * by the other public gateways, so a busy answer there is asked of the next
 * before it is called missing. Content-addressed, so every gateway answers
 * the same bytes or nothing.
 */
function candidates(icon: string): string[] {
  const match = /^https:\/\/(?:ipfs\.io|gateway\.ipfs\.io|dweb\.link|w3s\.link|gateway\.pinata\.cloud|cf-ipfs\.com|cloudflare-ipfs\.com|nftstorage\.link)\/ipfs\/([A-Za-z0-9]+)(\/.*)?$/.exec(icon);
  if (!match) return [icon];
  const cid = match[1];
  const rest = match[2] ?? "";
  /* Measured on 2026-09-11: ipfs.io, dweb.link and w3s.link share one limiter
     and refused together; filebase and rarible answered the same bytes. */
  return [icon, `https://ipfs.filebase.io/ipfs/${cid}${rest}`, `https://ipfs.raribleuserdata.com/ipfs/${cid}${rest}`];
}

/**
 * What the bytes are, from the bytes. Arweave and the IPFS gateways serve a
 * picture with no content type at all, or as `application/octet-stream`; the
 * magic numbers say PNG, JPEG, GIF, WebP or SVG, and anything else is not an
 * image this route will hand to a browser whatever the header claims.
 */
function sniffImageType(bytes: Uint8Array, declared: string): string | null {
  const head = bytes.subarray(0, 16);
  const ascii = new TextDecoder("latin1").decode(bytes.subarray(0, 256)).trimStart();
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return "image/png";
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x38) return "image/gif";
  if (head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 && head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50) return "image/webp";
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(ascii)) return "image/svg+xml";
  /* AVIF and other ISO-BMFF images name themselves in the ftyp box. */
  if (head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70 && declared.startsWith("image/")) return declared;
  return null;
}

async function fetchImage(icon: string): Promise<Readonly<{ bytes: Uint8Array; type: string }> | null> {
  for (const candidate of candidates(icon)) {
    let upstream: Response;
    try {
      upstream = await fetch(candidate, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { accept: "image/*" } });
    } catch {
      continue;
    }
    const declaredType = (upstream.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const declaredLength = Number(upstream.headers.get("content-length") ?? "0");
    const claimsImage = declaredType === "" || declaredType.startsWith("image/") || declaredType.endsWith("/octet-stream");
    if (!upstream.ok || !claimsImage || (Number.isFinite(declaredLength) && declaredLength > CEILING_BYTES)) {
      await upstream.body?.cancel();
      /* A refusal that is not about load — a 404, a page where a picture
         should be — is final for this address; a busy gateway is worth the
         next one. */
      if (upstream.status === 429 || upstream.status >= 500) continue;
      return null;
    }
    const buffer = new Uint8Array(await upstream.arrayBuffer());
    if (buffer.byteLength === 0 || buffer.byteLength > CEILING_BYTES) return null;
    const type = sniffImageType(buffer, declaredType);
    if (!type) return null;
    return { bytes: buffer, type };
  }
  return null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mint = url.searchParams.get("mint") ?? "";
  const given = url.searchParams.get("u");
  if (!BASE58.test(mint)) return new Response(null, { status: 400, headers: { "cache-control": "private, no-store" } });
  if (given !== null && (given.length > 512 || !publicHttpsUrl(given))) return notFound();
  const rate = consumeSpotIconRequest(request.headers);
  if (!rate.allowed) return new Response(null, { status: 429, headers: { "cache-control": "private, no-store" } });

  const key = given ?? mint;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ("missing" in hit ? MISS_TTL_MS : CACHE_TTL_MS)) {
    if ("missing" in hit) return notFound();
    return new Response(new Uint8Array(hit.bytes), { headers: { "content-type": hit.type, "cache-control": "public, max-age=86400, s-maxage=604800, immutable" } });
  }

  const icon = given ?? (await lookupSpotIcon(mint));
  if (!icon || !publicHttpsUrl(icon)) {
    remember(key, { missing: true, at: Date.now() });
    return notFound();
  }
  const image = await fetchImage(icon);
  if (!image) {
    remember(key, { missing: true, at: Date.now() });
    return notFound();
  }
  remember(key, { bytes: image.bytes, type: image.type, at: Date.now() });
  return new Response(new Uint8Array(image.bytes), { headers: { "content-type": image.type, "cache-control": "public, max-age=86400, s-maxage=604800, immutable" } });
}
