/**
 * The Earn routes' own decisions, apart from their wiring so a test can hold them.
 *
 * Three decisions, and none of them is about lending: the door lets the request in, the wallet a phone's
 * bearer carries must be the wallet the action is for, and only then does the action answer. The same shape
 * the collateral lane uses (`lib/phoenix/collateral-routes.ts`), because a second shape for the same decision
 * is how one of them comes to be the laxer one.
 *
 * The routes themselves are `app/api/solana/earn/**`; what they call is `service.server.ts`.
 */

import { privateNoStoreHeaders, rateLimitHeaders, type RateLimitDecision } from "../http-control.ts";

export type EarnDoor =
  | Readonly<{ ok: true; body: unknown; rate: RateLimitDecision; mismatch: (owner: string) => boolean }>
  | Readonly<{ ok: false; response: Response }>;

export function earnHeaders(rate: RateLimitDecision): Record<string, string> {
  return { ...privateNoStoreHeaders(), ...rateLimitHeaders(rate) };
}

export function earnFailure(status: number, code: string, message: string, rate: RateLimitDecision): Response {
  return Response.json({ error: { code, message } }, { status, headers: earnHeaders(rate) });
}

type Answer<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; status: number; code: string; reason: string }>;

const mismatched = (rate: RateLimitDecision) => earnFailure(403, "WALLET_MISMATCH", "The session's wallet is not this action's wallet.", rate);

/** The Review: the body's wallet is the session's, or nothing is built. */
export function earnReviewHandler<T>(deps: Readonly<{ openDoor: (request: Request) => Promise<EarnDoor>; review: (body: unknown) => Promise<Answer<T>> }>) {
  return async (request: Request): Promise<Response> => {
    const door = await deps.openDoor(request);
    if (!door.ok) return door.response;
    const owner = (door.body as { owner?: unknown } | null)?.owner;
    if (typeof owner === "string" && door.mismatch(owner)) return mismatched(door.rate);
    const reviewed = await deps.review(door.body);
    if (!reviewed.ok) return earnFailure(reviewed.status, reviewed.code, reviewed.reason, door.rate);
    return Response.json(reviewed.value, { headers: earnHeaders(door.rate) });
  };
}

/**
 * The relay: the ticket's own wallet is checked inside the action, where the seal is read.
 *
 * The door's bearer check still runs — a phone acts for its own wallet and nothing else — and the ticket is
 * not read here, because reading a sealed ticket in two places is how the two readings come to disagree.
 */
export function earnSubmitHandler<T>(deps: Readonly<{ openDoor: (request: Request) => Promise<EarnDoor>; submit: (body: unknown) => Promise<Answer<T>> }>) {
  return async (request: Request): Promise<Response> => {
    const door = await deps.openDoor(request);
    if (!door.ok) return door.response;
    const relayed = await deps.submit(door.body);
    if (!relayed.ok) return earnFailure(relayed.status, relayed.code, relayed.reason, door.rate);
    return Response.json(relayed.value, { headers: earnHeaders(door.rate) });
  };
}

/** `?signatures=a,b` as the status route reads it: at most five, each a plausible signature. */
export function signaturesParam(value: string | null): readonly string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => /^[1-9A-HJ-NP-Za-km-z]{64,96}$/.test(entry))
    .slice(0, 5);
}
