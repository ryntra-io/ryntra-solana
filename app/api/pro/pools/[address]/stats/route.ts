import { tapeRoute } from "@/lib/pro-pools/tape-route.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `GET /api/pro/pools/<address>/stats` — one Meteora DLMM Pro pool's day from the program's own events:
 * volume, fees in their five parts, trades and wallets, limit orders placed, filled and collected, the bonus their
 * makers earned and took. `depth` says from how deep it was counted; a node that does not answer is `UNAVAILABLE`, never
 * zeros. Public and read-only; kept fifteen seconds.
 */
export const GET = tapeRoute("stats");
