import { tapeRoute } from "@/lib/pro-pools/tape-route.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `GET /api/pro/pools/<address>/trades?limit=50` — one Meteora DLMM Pro pool's latest trades from the
 * program's own swap events, newest first (at most 100): side, what moved on each side, the price, the fee and its
 * parts, and whether it filled limit orders. Only trades read without a gap; `depth` says how deep. Public and
 * read-only; kept fifteen seconds.
 */
export const GET = tapeRoute("trades");
