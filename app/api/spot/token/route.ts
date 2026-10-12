import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { publicCacheHeaders, rateLimitHeaders, type RateLimitDecision } from "@/lib/http-control";
import { readTokenHolders, readTokenOverview, readTokenPools, readTokenRisk, readTokenTrades } from "@/lib/spot/token-page.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * The token page's reads, one part at a time so a
 * tab reads only what it draws:
 *
 * - `overview` — the header's windows and the chart's marks (on arrival);
 * - `trades` — who bought and who sold, how much, and the capitalisation at the trade;
 * - `holders` — the largest holders, their share and how their holding moved;
 * - `risk` — the facts behind «Ризик», each with its source;
 * - `pools` — where the token trades, deepest first.
 *
 * Each answer names its time and whether it is a held copy; a part that could
 * not be read says why with its code, never as an empty list.
 */

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const PARTS = ["overview", "trades", "holders", "risk", "pools"] as const;
type Part = (typeof PARTS)[number];

const CACHE: Readonly<Record<Part, readonly [number, number]>> = {
  overview: [20, 60],
  trades: [15, 45],
  holders: [60, 180],
  risk: [60, 180],
  pools: [120, 300],
};

function failure(status: number, code: string, message: string, rate: RateLimitDecision) {
  return Response.json({ error: { code, message } }, { status, headers: { ...rateLimitHeaders(rate), "cache-control": "private, no-store" } });
}

export async function GET(request: Request) {
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return failure(429, "RATE_LIMITED", "Too many requests.", rate);
  const params = new URL(request.url).searchParams;
  const mint = params.get("mint") ?? "";
  const part = params.get("part") ?? "";
  if (!BASE58.test(mint)) return failure(400, "VALIDATION_ERROR", "A token is addressed by its mint.", rate);
  if (!(PARTS as readonly string[]).includes(part)) return failure(400, "VALIDATION_ERROR", `part is one of ${PARTS.join(", ")}.`, rate);
  const read =
    part === "overview" ? await readTokenOverview(mint)
    : part === "trades" ? await readTokenTrades(mint)
    : part === "holders" ? await readTokenHolders(mint)
    : part === "risk" ? await readTokenRisk(mint)
    : await readTokenPools(mint);
  if (!read.ok) {
    /* «Not listed», «no pool» and «not read for this token» are answers about the token, not failures of the page. */
    if (read.code === "NOT_LISTED" || read.code === "NO_POOL" || read.code === "NOT_READ") {
      return Response.json({ none: { code: read.code, reason: read.reason }, observedAt: new Date().toISOString() }, { headers: { ...publicCacheHeaders(60, 180), ...rateLimitHeaders(rate) } });
    }
    return failure(read.code === "RATE_LIMITED" ? 429 : 503, `TOKEN_${read.code}`, read.reason, rate);
  }
  const { ok: _ok, ...body } = read;
  void _ok;
  const [maxAge, stale] = CACHE[part as Part];
  return Response.json(body, { headers: { ...publicCacheHeaders(maxAge, stale), ...rateLimitHeaders(rate) } });
}
