import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { publicCacheHeaders, rateLimitHeaders, type RateLimitDecision } from "@/lib/http-control";
import { retryAfterHeader } from "@/lib/spot/shared-reads";
import { readCreator } from "@/lib/spot/creator.server";
import { readHolderLinks } from "@/lib/spot/holder-links.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * The coin page's creator and its largest holders' links, one part at a time so a tab reads only what it
 * draws, behind the deployment's closed switch (`RYNTRA_SPOT_CREATOR=on`):
 *
 * - `creator` — the wallet that launched the coin, its other coins and how each went, what it did with this one;
 * - `links` — which of the largest holders the chain ties: the coin or SOL from one wallet, transfers between them.
 *
 * Closed, a coin without a creator, or SOL: an answer about the coin (`none` with its code), never a failure. A part
 * that could not be read says why with its code, never as an empty list. The edge keeps each answer for minutes, so
 * one coin's reads of Helius are made once for everyone who opens it.
 */

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const PARTS = ["creator", "links"] as const;
type Part = (typeof PARTS)[number];

const CACHE: Readonly<Record<Part, readonly [number, number]>> = {
  creator: [300, 900],
  links: [600, 1800],
};

function failure(status: number, code: string, message: string, rate: RateLimitDecision, retryAfterMs?: number | null) {
  return Response.json({ error: { code, message } }, { status, headers: { ...rateLimitHeaders(rate), ...retryAfterHeader(retryAfterMs), "cache-control": "private, no-store" } });
}

export async function GET(request: Request) {
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return failure(429, "RATE_LIMITED", "Too many requests.", rate);
  const params = new URL(request.url).searchParams;
  const mint = params.get("mint") ?? "";
  const part = params.get("part") ?? "";
  if (!BASE58.test(mint)) return failure(400, "VALIDATION_ERROR", "A coin is addressed by its mint.", rate);
  if (!(PARTS as readonly string[]).includes(part)) return failure(400, "VALIDATION_ERROR", `part is one of ${PARTS.join(", ")}.`, rate);
  const read = part === "creator" ? await readCreator(mint) : await readHolderLinks(mint);
  if (!read.ok) {
    /* «Closed», «no creator» and «not read for this coin» are answers about the coin, not failures of the page. */
    if (read.code === "CLOSED" || read.code === "NO_CREATOR" || read.code === "NOT_READ") {
      return Response.json({ none: { code: read.code, reason: read.reason }, observedAt: new Date().toISOString() }, { headers: { ...publicCacheHeaders(60, 300), ...rateLimitHeaders(rate) } });
    }
    return failure(read.code === "RATE_LIMITED" ? 429 : 503, `CREATOR_${read.code}`, read.reason, rate, read.retryAfterMs);
  }
  const { ok: _ok, ...body } = read;
  void _ok;
  const [maxAge, stale] = CACHE[part as Part];
  /* A held copy is kept at the edge briefly, so the fresh read reaches people as soon as there is one. */
  return Response.json(body, { headers: { ...(body.stale ? publicCacheHeaders(30, 120) : publicCacheHeaders(maxAge, stale)), ...rateLimitHeaders(rate) } });
}
