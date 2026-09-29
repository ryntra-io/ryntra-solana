import { WatchlistPutRequestSchema, type WatchlistResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { resolveNativeSession } from "@/lib/auth/native-session";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { BASE58 } from "@/lib/api/v1/contract";
import { readSpotWatchlistRow, writeSpotWatchlist } from "@/lib/spot/watchlist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The watchlist of the wallet the bearer proves — the same row the web reads
 * and writes through `/api/spot/watchlist` with its proof cookie, so a star
 * on the phone is a star on the laptop. The session's address is the only
 * address this route answers for; asking for another is `WALLET_MISMATCH`,
 * which is also how a device that switched wallets without clearing its
 * copy learns it must not carry one wallet's list into another's.
 */
function toResponse(address: string, row: Readonly<{ mints: readonly string[]; version: number | null; updatedAt: string | null }>): WatchlistResponse {
  return { address, mints: [...row.mints], version: row.version ?? 0, updatedAt: row.updatedAt };
}

export async function GET(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const session = await resolveNativeSession(request.headers);
  if (!session.ok) return apiFailure(session.code, session.reason);
  const address = new URL(request.url).searchParams.get("address") ?? session.session.address;
  if (!BASE58.test(address)) return apiFailure("VALIDATION_ERROR", "address: not a Solana address.");
  if (address !== session.session.address) return apiFailure("WALLET_MISMATCH", "The session proves a different wallet.");
  const row = await readSpotWatchlistRow(getGuardRuntime().store, address);
  return apiJson(toResponse(address, row));
}

export async function PUT(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const session = await resolveNativeSession(request.headers);
  if (!session.ok) return apiFailure(session.code, session.reason);
  const read = await readApiBody(request, WatchlistPutRequestSchema, 32_768);
  if (!read.ok) return read.response;
  if (read.body.address !== session.session.address) return apiFailure("WALLET_MISMATCH", "The session proves a different wallet.");
  const wrote = await writeSpotWatchlist(getGuardRuntime().store, read.body.address, read.body.mints, new Date().toISOString(), { ifVersion: read.body.ifVersion });
  if (!wrote.ok) {
    if (wrote.reason === "WATCHLIST_CONFLICT") return apiFailure("VALIDATION_ERROR", "ifVersion: the list changed since it was read; read it again and merge.");
    return apiFailure(wrote.reason === "WATCHLIST_INVALID" ? "VALIDATION_ERROR" : "UNAVAILABLE", wrote.reason === "WATCHLIST_INVALID" ? "mints: not all Solana addresses." : "The store did not answer.");
  }
  return apiJson({ address: read.body.address, mints: [...wrote.mints], version: wrote.version, updatedAt: new Date().toISOString() } satisfies WatchlistResponse);
}
