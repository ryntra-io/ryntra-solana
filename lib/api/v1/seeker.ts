/**
 * `GET /api/v1/auth/seeker` (contract 1.66.0, SKR-3) — the answer, apart from
 * the carrier.
 *
 * The route proves the wallet first (`requireWalletProof`, a read: the web's
 * cookie or the phone's bearer, both from this server's Sign In With Solana —
 * single-use nonce, domain, expiry) and hands over only the address it proved.
 * Here that address is limited, read and shaped; a chain that could not be
 * read is `UNAVAILABLE`, never `verified: false`.
 *
 * Server only; kept free of Next so the answer is tested on fixtures.
 */

import { FixedWindowLimiter, rateLimitHeaders } from "../../http-control.ts";
import { checkSeekerGenesis, type SeekerCheck } from "../../solana/seeker-genesis.server.ts";
import { NETWORK, type ApiErrorCode, type SeekerCheckResponse } from "./contract.ts";

/* The cache answers repeats; this bounds a client that loops past it. */
/** The contract's ceiling on `tokens` (one SGT per phone; a wallet holds a handful at most). */
export const SEEKER_TOKENS_MAX = 100;

const LIMITER = new FixedWindowLimiter({ windowMs: 60_000, limit: 20, maxKeys: 5_000 });

export type SeekerAnswer =
  | Readonly<{ ok: true; body: SeekerCheckResponse }>
  | Readonly<{ ok: false; code: Extract<ApiErrorCode, "UNAVAILABLE" | "RATE_LIMITED" | "VALIDATION_ERROR">; message: string; headers?: Record<string, string> }>;

export async function answerSeekerCheck(
  address: string,
  deps: Readonly<{ check?: (address: string) => Promise<SeekerCheck>; limiter?: FixedWindowLimiter }> = {},
): Promise<SeekerAnswer> {
  const decision = (deps.limiter ?? LIMITER).consume(`seeker:${address}`);
  if (!decision.allowed) {
    return { ok: false, code: "RATE_LIMITED", message: "Too many checks; try again in a minute.", headers: rateLimitHeaders(decision) };
  }
  const result = await (deps.check ?? checkSeekerGenesis)(address);
  if (result.status === "invalid") return { ok: false, code: "VALIDATION_ERROR", message: "address: not a Solana address." };
  if (result.status === "unavailable") {
    return { ok: false, code: "UNAVAILABLE", message: "The chain could not be read now. This is not «no Seeker» — try again in a moment.", headers: { "Retry-After": "30" } };
  }
  return {
    ok: true,
    body: { address: result.address, verified: result.verified, tokens: result.tokens.slice(0, SEEKER_TOKENS_MAX).map((token) => ({ mint: token.mint, memberNumber: token.memberNumber })), network: NETWORK, checkedAt: result.checkedAt },
  };
}
