/**
 * «Що це за монета» — the pure half.
 *
 * A token says what it is in one place only: the metadata its creator wrote.
 * The mint names a metadata URI — in the Metaplex Token Metadata account, or
 * in a Token-2022 mint's own metadata extension — and the JSON at that URI
 * carries a `description`. Jupiter's Tokens V2 carries the links (website, X,
 * Telegram) and no description, so the description is read here, from the
 * chain and the URI, and nothing about it is guessed: a token whose creator
 * wrote none says so (B.11), and a read that failed says that instead.
 *
 * Every string here is the creator's own and unverified — the page says so
 * beside it. This module decides what of it may be shown: plain text, no
 * control characters, one paragraph, a bounded length; and which addresses
 * may be fetched: https to a public host name only, never an IP literal,
 * localhost or a private suffix, so a mint cannot point the server inward.
 *
 * No network, no clock: `token-about.server.ts` reads, this shapes.
 */

/** The Metaplex Token Metadata program. */
export const METAPLEX_METADATA_PROGRAM = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";

/** The longest description the header draws — a few lines on a phone, never a wall of prose. */
export const ABOUT_MAX_CHARS = 420;

/**
 * What the page can say about the token:
 * - `described` — the creator wrote a description, and here it is;
 * - `silent` — the metadata was read and holds no description;
 * - `no-metadata` — the mint names no metadata at all;
 * - `unread` — the chain or the metadata's address did not answer now.
 */
export type TokenAboutState = "described" | "silent" | "no-metadata" | "unread";

export type TokenAbout = Readonly<{ state: TokenAboutState; description: string | null }>;

/**
 * An address the server may fetch: https, no credentials, a public host name.
 * A token's metadata is written by whoever minted it, so this is the one
 * string an outsider chooses.
 */
export function publicHttpsUrl(value: string): boolean {
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

/**
 * The same content on the public gateways, in order. A quarter of the
 * catalogue sits on `ipfs.io`, which rate-limits by the minute; the content id
 * is served the same by the others, so a busy answer is asked of the next.
 */
export function gatewayCandidates(address: string): string[] {
  const path = /^https:\/\/(?:ipfs\.io|gateway\.ipfs\.io|dweb\.link|w3s\.link|gateway\.pinata\.cloud|cf-ipfs\.com|cloudflare-ipfs\.com|nftstorage\.link)\/ipfs\/([A-Za-z0-9]+)(\/.*)?$/.exec(address);
  /* A gateway that names the content in its host — `<cid>.ipfs.nftstorage.link` — redirects to another that rate-limits; the path-style gateways serve the same bytes. */
  const subdomain = path ? null : /^https:\/\/([a-z0-9]{46,})\.ipfs\.[a-z0-9.-]+(\/[^?#]*)?$/.exec(address);
  const match = path ?? subdomain;
  if (!match) return [address];
  const cid = match[1];
  const rest = match[2] && match[2] !== "/" ? match[2] : "";
  return [...(path ? [address] : []), `https://ipfs.filebase.io/ipfs/${cid}${rest}`, `https://ipfs.raribleuserdata.com/ipfs/${cid}${rest}`, ...(subdomain ? [address] : [])];
}

/**
 * The metadata URI as the mint states it, as an address the server may fetch:
 * the padding stripped, `ipfs://` and `ar://` read through their public
 * gateways; null for an empty or an address this module refuses.
 */
export function metadataAddress(uri: string | null | undefined): string | null {
  if (typeof uri !== "string") return null;
  const trimmed = uri.replace(/\0+$/g, "").trim();
  if (trimmed.length === 0 || trimmed.length > 512) return null;
  const ipfs = /^ipfs:\/\/(?:ipfs\/)?([A-Za-z0-9]+)(\/.*)?$/.exec(trimmed);
  const arweave = /^ar:\/\/([A-Za-z0-9_-]+)(\/.*)?$/.exec(trimmed);
  const address = ipfs ? `https://ipfs.io/ipfs/${ipfs[1]}${ipfs[2] ?? ""}` : arweave ? `https://arweave.net/${arweave[1]}${arweave[2] ?? ""}` : trimmed;
  return publicHttpsUrl(address) ? address : null;
}

/** A Borsh string at `offset`: a little-endian u32 length and that many UTF-8 bytes. */
function borshString(bytes: Uint8Array, offset: number): Readonly<{ value: string; next: number }> | null {
  if (offset + 4 > bytes.length) return null;
  const length = bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24);
  if (length < 0 || length > 1024 || offset + 4 + length > bytes.length) return null;
  const value = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(offset + 4, offset + 4 + length));
  return { value, next: offset + 4 + length };
}

/**
 * The URI a Metaplex Token Metadata account names: the account's key byte, the
 * update authority and the mint (32 bytes each), then the name, the symbol and
 * the URI as Borsh strings. Null for an account that is not a metadata
 * account (key 4, `MetadataV1`) or does not decode.
 */
export function metaplexUri(bytes: Uint8Array): string | null {
  if (bytes.length < 1 + 32 + 32 + 12 || bytes[0] !== 4) return null;
  const name = borshString(bytes, 65);
  const symbol = name ? borshString(bytes, name.next) : null;
  const uri = symbol ? borshString(bytes, symbol.next) : null;
  return uri ? uri.value.replace(/\0+$/g, "") : null;
}

/**
 * The URI a Token-2022 mint's own metadata extension names, from the mint as
 * the official decoder states it; null where the mint carries none.
 */
export function token2022Uri(extensions: unknown): string | null {
  const option = extensions && typeof extensions === "object" ? (extensions as { __option?: unknown; value?: unknown }) : null;
  const list = option && option.__option === "Some" ? option.value : null;
  if (!Array.isArray(list)) return null;
  for (const extension of list) {
    if (extension && typeof extension === "object" && (extension as { __kind?: unknown }).__kind === "TokenMetadata") {
      const uri = (extension as { uri?: unknown }).uri;
      return typeof uri === "string" ? uri : null;
    }
  }
  return null;
}

/**
 * The description in the metadata's JSON, as the page may draw it: plain text,
 * no control or invisible characters, whitespace as single spaces, at most
 * `ABOUT_MAX_CHARS` (cut at a word with «…»). Null when the JSON holds none,
 * or only the token's own name again.
 */
export function descriptionOf(json: unknown, names: readonly string[] = []): string | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const raw = (json as Record<string, unknown>).description;
  if (typeof raw !== "string") return null;
  const clean = raw
    .normalize("NFC")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F​-‏‪-‮⁠-⁤﻿]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (clean.length < 2) return null;
  if (names.some((name) => name.trim().toLowerCase() === clean.toLowerCase())) return null;
  if (clean.length <= ABOUT_MAX_CHARS) return clean;
  const cut = clean.slice(0, ABOUT_MAX_CHARS);
  const space = cut.lastIndexOf(" ");
  return `${(space > ABOUT_MAX_CHARS * 0.6 ? cut.slice(0, space) : cut).replace(/[\s.,;:!?-]+$/, "")}…`;
}

/**
 * The answer as one caller is shown it: a description that only repeats the
 * token's own name or symbol is no description. Applied after the kept answer,
 * never stored, so no caller's names change what another reads.
 */
export function withoutNames(about: TokenAbout, names: readonly string[]): TokenAbout {
  if (about.state !== "described" || about.description === null) return about;
  const said = about.description.trim().toLowerCase();
  return names.some((name) => name.trim().toLowerCase() === said) ? { state: "silent", description: null } : about;
}

/**
 * An address no public fetch may reach: IPv4 private, loopback, link-local,
 * shared, multicast and reserved ranges; IPv6 loopback, unique-local,
 * link-local and an IPv4-mapped address in any of those.
 */
export function isPrivateAddress(ip: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  /* The same mapped address in hex — `::ffff:7f00:1` is 127.0.0.1. */
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(ip);
  const fromHex = hex ? [parseInt(hex[1], 16) >> 8, parseInt(hex[1], 16) & 255, parseInt(hex[2], 16) >> 8, parseInt(hex[2], 16) & 255].join(".") : null;
  const v4 = mapped ? mapped[1] : fromHex ?? (/^\d+\.\d+\.\d+\.\d+$/.test(ip) ? ip : null);
  if (v4) {
    const [a, b] = v4.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19));
  }
  const v6 = ip.toLowerCase();
  return v6 === "::" || v6 === "::1" || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6);
}

const X_HOSTS = new Set(["x.com", "twitter.com", "mobile.twitter.com", "mobile.x.com"]);
const TELEGRAM_HOSTS = new Set(["t.me", "telegram.me", "telegram.org"]);

/**
 * What a creator's link opens, said before it is pressed: «jup.ag» for a site, «@JupiterExchange» for an X profile,
 * «@channel» for a Telegram one. The X and Telegram faces are given only to their own hosts — a field the creator
 * filled with any other address is shown as that address, never under X's or Telegram's name.
 */
export function linkFace(kind: "website" | "twitter" | "telegram", href: string): Readonly<{ label: string; mark: "site" | "x" | "telegram" }> {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return { label: href.slice(0, 40), mark: "site" };
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const segment = /^\/([A-Za-z0-9_]{1,32})\/?$/.exec(url.pathname)?.[1] ?? null;
  if (kind === "twitter" && X_HOSTS.has(host)) {
    const handle = segment && segment.length <= 15 && !["i", "home", "search", "intent", "share"].includes(segment.toLowerCase()) ? `@${segment}` : "X";
    return { label: handle, mark: "x" };
  }
  if (kind === "telegram" && TELEGRAM_HOSTS.has(host)) {
    return { label: segment && segment !== "joinchat" && !segment.startsWith("+") ? `@${segment}` : "Telegram", mark: "telegram" };
  }
  return { label: host, mark: "site" };
}
