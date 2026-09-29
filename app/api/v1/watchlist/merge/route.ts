import { WatchlistMergeRequestSchema, type WatchlistMergeResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { resolveNativeSession } from "@/lib/auth/native-session";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { mergeSpotWatchlistRow } from "@/lib/spot/watchlist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The one merge a device does after sign-in: its own list, its removals and
 * when it last took the server's answer go in; the union in the server's
 * order comes out, with everything that did not make it named — the overflow
 * past the limit, and the mints the server had removed after the device last
 * synced. The device keeps the answer as its list and `syncedAt` as its mark.
 * Keyed by the session's wallet; another address is refused.
 */
export async function POST(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const session = await resolveNativeSession(request.headers);
  if (!session.ok) return apiFailure(session.code, session.reason);
  const read = await readApiBody(request, WatchlistMergeRequestSchema, 65_536);
  if (!read.ok) return read.response;
  if (read.body.address !== session.session.address) return apiFailure("WALLET_MISMATCH", "The session proves a different wallet.");
  const now = new Date().toISOString();
  const merged = await mergeSpotWatchlistRow(getGuardRuntime().store, read.body.address, { mints: read.body.mints, removed: read.body.removed, syncedAt: read.body.syncedAt }, now);
  if (!merged.ok) return apiFailure(merged.reason === "WATCHLIST_INVALID" ? "VALIDATION_ERROR" : "UNAVAILABLE", merged.reason === "WATCHLIST_INVALID" ? "mints: not all Solana addresses." : "The store did not answer.");
  const response: WatchlistMergeResponse = {
    address: read.body.address,
    mints: [...merged.result.mints],
    notKept: [...merged.result.notKept],
    droppedByServer: [...merged.result.droppedByServer],
    version: merged.version,
    syncedAt: now,
  };
  return apiJson(response);
}
