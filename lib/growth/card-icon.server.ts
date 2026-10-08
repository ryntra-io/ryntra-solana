import { lookup } from "node:dns/promises";

import { privateAddress } from "./public-address.ts";

/**
 * A token's picture for a trade card, fetched as carefully as an outsider's
 * address deserves. The address is the catalogue's, written by whoever
 * minted the token, and the routes that draw cards are public: every hop (at
 * most two redirects, followed by hand) must be https to a public host whose
 * addresses are all public; bounded in time and size; PNG or JPEG only. Any
 * failure is no picture — the card draws the symbol's first letter instead.
 */

/* A token's picture rides inside the card's data to the browser: a small one is plenty for a 56-pixel circle. */
const ICON_BYTES = 256 * 1024;
const ICON_TIMEOUT_MS = 3_000;
const ICON_REDIRECTS = 2;

/** https to a public host name, never an IP literal or a private suffix — and every address the name resolves to is public. */
async function publicHttps(url: URL): Promise<boolean> {
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || !host.includes(".") || /^[\d.:[\]]+$/.test(host) || /(^|\.)(localhost|local|internal|arpa)$/.test(host)) return false;
  try {
    const addresses = await lookup(host, { all: true, verbatim: true });
    return addresses.length > 0 && addresses.every((entry) => !privateAddress(entry.address));
  } catch {
    return false;
  }
}

/** The body, read as it arrives and abandoned past `cap` bytes — a film is never read whole to find out it is one. */
async function readCapped(response: Response, cap: number): Promise<Uint8Array | null> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > cap) {
      await reader.cancel().catch(() => {});
      return null;
    }
    parts.push(value);
  }
  return Buffer.concat(parts);
}

/** PNG or JPEG by their first bytes; anything else is not a picture this card draws. */
export function sniffImage(bytes: Uint8Array): "image/png" | "image/jpeg" | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  return null;
}

/* The invitation page asks for the same few pictures over and over: kept ten minutes per instance, failures too (briefly), at most 200. */
const ICON_CACHE_MS = 10 * 60 * 1000;
const ICON_MISS_MS = 60 * 1000;
const ICON_CACHE = new Map<string, { at: number; uri: string | null }>();

/** The token's own picture, as a data address — or nothing. */
export async function cardIconDataUri(address: string | null): Promise<string | null> {
  if (!address) return null;
  const now = Date.now();
  const hit = ICON_CACHE.get(address);
  if (hit && now - hit.at < (hit.uri ? ICON_CACHE_MS : ICON_MISS_MS)) return hit.uri;
  const uri = await fetchIcon(address);
  if (ICON_CACHE.size >= 200) ICON_CACHE.delete(ICON_CACHE.keys().next().value as string);
  ICON_CACHE.set(address, { at: now, uri });
  return uri;
}

async function fetchIcon(address: string): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return null;
  }
  try {
    for (let hop = 0; hop <= ICON_REDIRECTS; hop += 1) {
      if (!(await publicHttps(url))) return null;
      const response = await fetch(url, { signal: AbortSignal.timeout(ICON_TIMEOUT_MS), redirect: "manual" });
      if (response.status >= 300 && response.status < 400) {
        const next = response.headers.get("location");
        if (!next) return null;
        url = new URL(next, url);
        continue;
      }
      if (!response.ok) return null;
      const type = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      if (type !== "image/png" && type !== "image/jpeg") return null;
      const declared = Number(response.headers.get("content-length") ?? "0");
      if (declared > ICON_BYTES) return null;
      const bytes = await readCapped(response, ICON_BYTES);
      if (!bytes || bytes.byteLength === 0) return null;
      /* The bytes say what they are, not the header: a JPEG served as PNG would draw as nothing. */
      const sniffed = sniffImage(bytes);
      if (!sniffed) return null;
      return `data:${sniffed};base64,${Buffer.from(bytes).toString("base64")}`;
    }
    return null;
  } catch {
    return null;
  }
}
