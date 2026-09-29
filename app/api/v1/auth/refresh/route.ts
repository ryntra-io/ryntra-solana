import { reissueSession } from "@/lib/api/v1/auth.server";
import { apiFailure, apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { resolveNativeSession } from "@/lib/auth/native-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A fresh session for the same wallet, while the current one is still valid.
 *
 * Refresh never outlives a revocation or an expiry: a bearer that no longer
 * resolves gets the exact refusal, and the client asks for a signature again.
 * The old session is revoked as replaced the moment the new one is issued, so
 * one wallet on one device holds one live session.
 */
export async function POST(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const read = await resolveNativeSession(request.headers, false);
  if (!read.ok) return apiFailure(read.code, read.reason);
  const result = await reissueSession({ sessionId: read.session.sessionId, address: read.session.address });
  if (!result.ok) return apiFailure(result.code, result.reason);
  return apiJson(result.response);
}
