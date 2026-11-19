import { consumeSpotIconRequest } from "@/lib/agent-control/http";
import { publicHttps } from "@/city/lib/net";
import { resolveRelayApiKey } from "@/lib/relay/api-key.server";
import { chainById, fetchBridgeChains } from "@/lib/relay/bridge-chains";
import { findBridgeToken } from "@/lib/relay/bridge-tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

/**
 * Same-origin logos for the Bridge: a network's mark and a coin's logo, as Relay's own index names them. The
 * site's policy lets a page load images only from itself, and a logo host is anybody's — so the server fetches the one
 * address Relay lists for this chain or this coin (never an address from the request), over https to a public host,
 * following at most three redirects that pass the same check, as a raster image or SVG under 1 MB, SVG served with a
 * policy that forbids scripts. No logo is «no logo» — 204, and the page keeps the coin's letter.
 *
 * `GET ?chain=<id>` — the network; `GET ?chain=<id>&token=<address>` — a coin on it.
 */
const TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml", "image/avif"]);
const MAX_BYTES = 1_000_000;
const DAY = "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800";
const BUSY = "public, s-maxage=60";
const none = (cache = DAY) => new Response(null, { status: 204, headers: { "Cache-Control": cache } });

async function logoOf(chainId: number, token: string | null): Promise<string | null> {
  const apiKey = resolveRelayApiKey();
  const index = await fetchBridgeChains({ apiKey });
  const chain = index.ok ? chainById(index.chains, chainId) : null;
  if (!token) return chain?.icon ?? null;
  if (chain) {
    const known = [chain.native, ...chain.featured].find((entry) => (token.startsWith("0x") ? entry.address.toLowerCase() === token.toLowerCase() : entry.address === token));
    if (known?.logo) return known.logo;
  }
  return (await findBridgeToken({ chainId, address: token, external: false }, { apiKey }))?.logo ?? null;
}

async function fetchImage(start: URL): Promise<Response | "busy" | null> {
  let url: URL | null = start;
  for (let hop = 0; hop <= 3 && url; hop += 1) {
    const res: Response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(6_000), cache: "no-store" });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      url = location ? publicHttps(new URL(location, url).toString()) : null;
      continue;
    }
    if (res.ok) return res;
    return res.status === 429 || res.status >= 500 ? "busy" : null;
  }
  return null;
}

export async function GET(request: Request) {
  const rate = consumeSpotIconRequest(request.headers);
  if (!rate.allowed) return new Response(null, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  const params = new URL(request.url).searchParams;
  const chainId = Number(params.get("chain"));
  const token = params.get("token");
  if (!Number.isSafeInteger(chainId) || chainId <= 0 || (token !== null && !/^[0-9A-Za-z:_-]{8,90}$/.test(token))) return new Response(null, { status: 400 });

  try {
    const raw = await logoOf(chainId, token);
    const url = raw ? publicHttps(raw) : null;
    if (!url) return none();
    const res = await fetchImage(url);
    if (res === "busy") return none(BUSY);
    if (!res) return none();
    const type = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    if (!TYPES.has(type) || Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) {
      await res.body?.cancel();
      return none();
    }
    // Read with a count: a body that never says its length is still cut at the limit.
    const reader = res.body?.getReader();
    if (!reader) return none();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        return none();
      }
      chunks.push(value);
    }
    const body = Buffer.concat(chunks);
    return new Response(body, {
      headers: {
        "Content-Type": type,
        "Cache-Control": DAY,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
      },
    });
  } catch {
    return none(BUSY);
  }
}
