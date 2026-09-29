import { NETWORK } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { resolveNativeSession, revokeNativeSession } from "@/lib/auth/native-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET` — the session the bearer names, or the exact reason it does not
 * (`SESSION_EXPIRED`, `SESSION_REVOKED`, `UNAUTHORIZED`); a client checks this
 * on launch and knows whether to ask for a signature again.
 * `DELETE` — revoke it (sign out). Idempotent: a session already gone is a
 * success, because the state the client wants is the state it is in.
 */
export async function GET(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const read = await resolveNativeSession(request.headers);
  if (!read.ok) return apiFailure(read.code, read.reason);
  const s = read.session;
  return apiJson({ session: { id: s.sessionId, address: s.address, network: NETWORK, issuedAt: s.issuedAt, expiresAt: s.expiresAt } });
}

export async function DELETE(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const result = await revokeNativeSession(request.headers);
  if (!result.ok) return apiFailure(result.code, result.code === "UNAUTHORIZED" ? "No bearer session." : "The session store did not answer.");
  return apiJson({ revoked: true as const });
}
