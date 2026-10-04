/**
 * The native bearer session — server only.
 *
 * A native client has no cookie jar it can be trusted with and no `Origin` a
 * server can check, so it carries the session itself: `Authorization: Bearer
 * <token>`, where the token is the same signed session reference the web's
 * `rw` cookie carries (`issueSessionRefToken`) and the session is the same
 * recorded `wallet` row (`session_open`) the web mints after a verified SIWS
 * message. One session model, two carriers; revocation, expiry and idleness
 * are the row's and apply to both.
 *
 * A bearer is not ambient — a browser never attaches it on its own — so a
 * request that carries one needs no origin check; a request without one is
 * the web's and keeps every check the web has. The two are never mixed in one
 * request: a bearer that fails is a refusal, not a fall-through to the cookie.
 */

import { sessionResolve, sessionRevoke, type ResolvedSession } from "../account/rpc.ts";
import { verifySession } from "../beta/token.ts";
import type { ApiErrorCode } from "../api/v1/contract.ts";

export type NativeSession = Readonly<{
  sessionId: string;
  address: string;
  issuedAt: string;
  expiresAt: string;
}>;

export type NativeSessionRead =
  | Readonly<{ ok: true; session: NativeSession; resolved: ResolvedSession }>
  | Readonly<{ ok: false; code: Extract<ApiErrorCode, "UNAUTHORIZED" | "SESSION_EXPIRED" | "SESSION_REVOKED" | "UNAVAILABLE">; reason: string }>;

/** The store states instants with an offset; the contract states them in UTC. */
function utc(value: string): string {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : value;
}

/** The token from `Authorization: Bearer …`, or null when the header is absent or not a bearer. */
export function bearerToken(headers: Headers): string | null {
  const value = headers.get("authorization");
  if (!value) return null;
  const match = /^Bearer\s+([A-Za-z0-9._~+/=-]{16,1024})$/.exec(value.trim());
  return match ? match[1] : null;
}

/**
 * The session a bearer names, or the exact reason it does not.
 *
 * `touch` extends idleness the way a page view does; a read that must not
 * count as activity (revocation) passes `false`.
 */
export async function resolveNativeSession(headers: Headers, touch = true): Promise<NativeSessionRead> {
  const token = bearerToken(headers);
  if (!token) return { ok: false, code: "UNAUTHORIZED", reason: "No bearer session." };
  const parsed = verifySession(token);
  if (!parsed || parsed.admin || parsed.subject.kind !== "session") return { ok: false, code: "UNAUTHORIZED", reason: "The bearer is not a session reference." };
  const outcome = await sessionResolve(parsed.subject.sessionId, touch);
  if (outcome.status === "unavailable") return { ok: false, code: "UNAVAILABLE", reason: "The session store did not answer." };
  if (outcome.status === "refused") {
    if (outcome.reason === "expired" || outcome.reason === "idle") return { ok: false, code: "SESSION_EXPIRED", reason: `The session is ${outcome.reason}.` };
    return { ok: false, code: "SESSION_REVOKED", reason: outcome.reason === "revoked" ? "The session was revoked." : "The session does not exist." };
  }
  const s = outcome.session;
  if (s.kind !== "wallet" || s.walletChain !== "solana" || !s.walletAddress) return { ok: false, code: "UNAUTHORIZED", reason: "The session is not a Solana wallet session." };
  return { ok: true, resolved: s, session: { sessionId: s.id, address: s.walletAddress, issuedAt: utc(s.issuedAt), expiresAt: utc(s.expiresAt) } };
}

/** Revoke the session a bearer names; true when it was revoked or already gone. */
export async function revokeNativeSession(headers: Headers): Promise<Readonly<{ ok: true }> | Readonly<{ ok: false; code: "UNAUTHORIZED" | "UNAVAILABLE" }>> {
  const token = bearerToken(headers);
  if (!token) return { ok: false, code: "UNAUTHORIZED" };
  const parsed = verifySession(token);
  if (!parsed || parsed.admin || parsed.subject.kind !== "session") return { ok: false, code: "UNAUTHORIZED" };
  const outcome = await sessionResolve(parsed.subject.sessionId, false);
  if (outcome.status === "unavailable") return { ok: false, code: "UNAVAILABLE" };
  if (outcome.status === "refused") return { ok: true };
  const revoked = await sessionRevoke(outcome.session.id, "logout");
  return revoked ? { ok: true } : { ok: false, code: "UNAVAILABLE" };
}
