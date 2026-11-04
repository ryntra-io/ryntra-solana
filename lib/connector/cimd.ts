import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

import { z } from "zod";

/**
 * Client ID Metadata Documents (CIMD, `draft-ietf-oauth-client-id-metadata-document`, adopted by MCP 2025-11-25).
 *
 * A client that has a website identifies itself by an https URL as its `client_id`. The URL serves a JSON document
 * naming the client and its redirect URIs, and that document is the registration: the authorization server reads it
 * when the consent opens, so nothing is stored per connection and a chat with a million users is one client, not a
 * million registrations.
 *
 * Reading a URL a stranger chose is the one outbound call this connector makes for a caller, so it is bounded hard:
 *
 * - https only, on the default port, with a path, no credentials, no fragment, no IP literal of a private network;
 * - every address the name resolves to must be public — loopback, private, link-local, CGNAT, multicast and reserved
 *   ranges are refused before the request is made;
 * - no redirects, five seconds, five kilobytes;
 * - the document must name itself: its `client_id` equals the URL it was read from, character for character;
 * - the client is public: a document asking for a client secret is refused, not downgraded.
 *
 * What is cached is the validated document, for five minutes, in this process only. A store row per client would be
 * a second copy of a document its owner can change at any time.
 */

export const CIMD_MAX_BYTES = 5 * 1_024;
export const CIMD_TIMEOUT_MS = 5_000;
export const CIMD_CACHE_MS = 5 * 60_000;
const CACHE_MAX = 500;

export type CimdLookup = (hostname: string) => Promise<readonly Readonly<{ address: string; family: number }>[]>;
export type CimdFetch = (url: string, init: RequestInit) => Promise<Response>;

export type CimdDeps = Readonly<{ fetch?: CimdFetch; lookup?: CimdLookup; nowMs?: () => number }>;

export type CimdClient = Readonly<{
  clientId: string;
  clientName: string;
  redirectUris: readonly string[];
  clientUri: string | null;
}>;

export type CimdResult =
  | Readonly<{ ok: true; client: CimdClient }>
  | Readonly<{ ok: false; code: "CIMD_URL" | "CIMD_ADDRESS" | "CIMD_UNREACHABLE" | "CIMD_INVALID"; message: string }>;

const HTTPS_REDIRECT = /^https:\/\/[^\s#]+$/;
const LOOPBACK_REDIRECT = /^http:\/\/(?:127\.0\.0\.1|\[::1\]|localhost)(?::\d{1,5})?(?:\/[^\s#]*)?$/;

export function redirectUriShapeOk(value: string): boolean {
  return (HTTPS_REDIRECT.test(value) || LOOPBACK_REDIRECT.test(value)) && !value.includes("#") && value.length <= 512;
}

/** True when a `client_id` is a CIMD URL rather than an id this server issued. */
export function isCimdClientId(value: string): boolean {
  if (!value.startsWith("https://") || value.length > 512) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === "https:" && url.pathname !== "/" && url.pathname !== "" && !url.username && !url.password && !url.hash && url.port === "";
}

/* ── which addresses are public ─────────────────────────────────────────── */

function v4Parts(address: string): number[] | null {
  const parts = address.split(".").map(Number);
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) ? parts : null;
}

function publicV4(address: string): boolean {
  const p = v4Parts(address);
  if (!p) return false;
  const [a, b] = p;
  if (a === 0 || a === 10 || a === 127) return false; // this network, private, loopback
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
  if (a === 169 && b === 254) return false; // link-local, cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false; // private
  if (a === 192 && b === 168) return false; // private
  if (a === 192 && b === 0 && (p[2] === 0 || p[2] === 2)) return false; // IETF protocol, TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a === 198 && b === 51 && p[2] === 100) return false; // TEST-NET-2
  if (a === 203 && b === 0 && p[2] === 113) return false; // TEST-NET-3
  if (a >= 224) return false; // multicast, reserved, broadcast
  return true;
}

function expandV6(address: string): number[] | null {
  let text = address.toLowerCase();
  if (text.includes("%")) return null; // a zoned address is local by definition
  let tail: number[] = [];
  const lastColon = text.lastIndexOf(":");
  const last = text.slice(lastColon + 1);
  if (last.includes(".")) {
    const p = v4Parts(last);
    if (!p) return null;
    tail = [(p[0] << 8) | p[1], (p[2] << 8) | p[3]];
    text = text.slice(0, lastColon);
    if (text.endsWith(":")) text += ":";
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string) => (part === "" ? [] : part.split(":").map((group) => (/^[0-9a-f]{1,4}$/.test(group) ? parseInt(group, 16) : Number.NaN)));
  const head = parse(halves[0]);
  const rest = halves.length === 2 ? parse(halves[1]) : [];
  if ([...head, ...rest].some((group) => Number.isNaN(group))) return null;
  const used = head.length + rest.length + tail.length;
  if (halves.length === 1) return used === 8 ? [...head, ...tail] : null;
  if (used > 7) return null;
  return [...head, ...new Array<number>(8 - used).fill(0), ...rest, ...tail];
}

function publicV6(address: string): boolean {
  const g = expandV6(address);
  if (!g || g.length !== 8) return false;
  if (g.every((x) => x === 0)) return false; // unspecified
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return false; // loopback
  /* IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible: judged as the IPv4 address they carry. */
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) {
    return publicV4(`${g[6] >> 8}.${g[6] & 0xff}.${g[7] >> 8}.${g[7] & 0xff}`);
  }
  if (g[0] === 0x64 && g[1] === 0xff9b) return publicV4(`${g[6] >> 8}.${g[6] & 0xff}.${g[7] >> 8}.${g[7] & 0xff}`); // NAT64
  if ((g[0] & 0xfe00) === 0xfc00) return false; // unique local
  if ((g[0] & 0xffc0) === 0xfe80) return false; // link-local
  if ((g[0] & 0xff00) === 0xff00) return false; // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false; // documentation
  if (g[0] === 0x2002) return false; // 6to4 can carry any IPv4 address
  if (g[0] === 0x2001 && g[1] === 0) return false; // Teredo
  if (g[0] === 0x0100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return false; // discard-only
  return true;
}

/** True only for a unicast address reachable on the public internet. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return publicV4(address);
  if (family === 6) return publicV6(address);
  return false;
}

/* ── the document ───────────────────────────────────────────────────────── */

const DocumentSchema = z
  .object({
    client_id: z.string().min(1).max(512),
    client_name: z.string().min(1).max(200).optional(),
    client_uri: z.string().max(512).optional(),
    redirect_uris: z.array(z.string().min(1).max(512)).min(1).max(10),
    grant_types: z.array(z.string().max(64)).max(6).optional(),
    response_types: z.array(z.string().max(32)).max(4).optional(),
    token_endpoint_auth_method: z.string().max(64).optional(),
    client_secret: z.unknown().optional(),
    client_secret_expires_at: z.unknown().optional(),
  })
  .passthrough();

/** Validate a document read from `clientId`. Exported for tests; the fetch path calls it. */
export function validateClientMetadataDocument(clientId: string, raw: unknown): CimdResult {
  const parsed = DocumentSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, code: "CIMD_INVALID", message: "The client metadata document does not match its schema." };
  const doc = parsed.data;
  if (doc.client_id !== clientId) {
    return { ok: false, code: "CIMD_INVALID", message: "The client metadata document names a different client_id than the URL it was read from." };
  }
  if (doc.client_secret !== undefined || doc.client_secret_expires_at !== undefined) {
    return { ok: false, code: "CIMD_INVALID", message: "A client metadata document may not carry a client secret." };
  }
  if (doc.token_endpoint_auth_method !== undefined && doc.token_endpoint_auth_method !== "none") {
    return { ok: false, code: "CIMD_INVALID", message: "This server serves public clients only (token_endpoint_auth_method none)." };
  }
  for (const type of doc.grant_types ?? ["authorization_code"]) {
    if (type !== "authorization_code" && type !== "refresh_token") {
      return { ok: false, code: "CIMD_INVALID", message: `Grant type ${type} is not supported.` };
    }
  }
  if (doc.response_types && doc.response_types.some((type) => type !== "code")) {
    return { ok: false, code: "CIMD_INVALID", message: "Only the code response type is supported." };
  }
  for (const uri of doc.redirect_uris) {
    if (!redirectUriShapeOk(uri)) {
      return { ok: false, code: "CIMD_INVALID", message: "A redirect URI must be https, or http on a loopback address." };
    }
  }
  const host = new URL(clientId).hostname;
  return {
    ok: true,
    client: {
      clientId,
      clientName: doc.client_name ?? host,
      redirectUris: Object.freeze([...doc.redirect_uris]),
      clientUri: typeof doc.client_uri === "string" && doc.client_uri.startsWith("https://") ? doc.client_uri : null,
    },
  };
}

const cache = new Map<string, { client: CimdClient; expiresAt: number }>();

/** Forget every cached document. Tests use it; nothing in production needs to. */
export function clearCimdCache(): void {
  cache.clear();
}

async function readCapped(response: Response): Promise<string | null> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > CIMD_MAX_BYTES) return null;
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > CIMD_MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
}

/** Read and validate the client metadata document a `client_id` URL serves. */
export async function fetchClientMetadataDocument(clientId: string, deps: CimdDeps = {}): Promise<CimdResult> {
  const now = deps.nowMs ?? Date.now;
  if (!isCimdClientId(clientId)) return { ok: false, code: "CIMD_URL", message: "The client_id is not an https URL with a path on the default port." };
  const cached = cache.get(clientId);
  if (cached && cached.expiresAt > now()) return { ok: true, client: cached.client };

  const url = new URL(clientId);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".internal") || hostname.endsWith(".local")) {
    return { ok: false, code: "CIMD_ADDRESS", message: "The client metadata document must be served from a public address." };
  }
  if (isIP(hostname)) {
    if (!isPublicAddress(hostname)) return { ok: false, code: "CIMD_ADDRESS", message: "The client metadata document must be served from a public address." };
  } else {
    const lookup: CimdLookup = deps.lookup ?? ((name) => dnsLookup(name, { all: true, verbatim: true }));
    let addresses: readonly { address: string }[];
    try {
      addresses = await lookup(hostname);
    } catch {
      return { ok: false, code: "CIMD_UNREACHABLE", message: "The client metadata document's host does not resolve." };
    }
    if (addresses.length === 0 || addresses.some((entry) => !isPublicAddress(entry.address))) {
      return { ok: false, code: "CIMD_ADDRESS", message: "The client metadata document must be served from a public address." };
    }
  }

  const fetcher: CimdFetch = deps.fetch ?? ((target, init) => fetch(target, init));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CIMD_TIMEOUT_MS);
  let text: string | null;
  try {
    const response = await fetcher(clientId, {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (response.status !== 200) {
      return { ok: false, code: "CIMD_UNREACHABLE", message: `The client metadata document answered ${response.status}.` };
    }
    text = await readCapped(response);
  } catch {
    return { ok: false, code: "CIMD_UNREACHABLE", message: "The client metadata document could not be read in time." };
  } finally {
    clearTimeout(timer);
  }
  if (text === null) return { ok: false, code: "CIMD_INVALID", message: "The client metadata document is larger than five kilobytes." };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, code: "CIMD_INVALID", message: "The client metadata document is not JSON." };
  }
  const result = validateClientMetadataDocument(clientId, raw);
  if (result.ok) {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
    cache.set(clientId, { client: result.client, expiresAt: now() + CIMD_CACHE_MS });
  }
  return result;
}
