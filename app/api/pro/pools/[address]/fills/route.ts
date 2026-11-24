import { tapeRoute } from "@/lib/pro-pools/tape-route.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `GET /api/pro/pools/<address>/fills?limit=50` — one Meteora DLMM Pro pool's limit orders collected with a
 * part filled, newest first (at most 100): the program emits nothing when a swap fills an order, so a fill shows when
 * its owner collects — what filled, what came back unfilled, the bonus and the referral's part. Public and read-only;
 * kept fifteen seconds.
 */
export const GET = tapeRoute("fills");
