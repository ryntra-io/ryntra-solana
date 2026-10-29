/**
 * The collateral routes' own decisions (B6), apart from their wiring so a test can hold them: the door lets the request
 * in, the wallet a phone's bearer carries must be the action's wallet, and only then does the action answer. The routes
 * (`app/api/solana/futures/collateral/{review,submit}/route.ts`) give the real door and the real actions.
 */

import { privateNoStoreHeaders, rateLimitHeaders, type RateLimitDecision } from "../http-control.ts";

import { readTicket, type Env } from "./collateral.ts";
import type { ActionFailure, CollateralRelay, CollateralReview } from "./collateral-actions.ts";

export type CollateralDoor = Readonly<{ ok: true; body: unknown; rate: RateLimitDecision; mismatch: (owner: string) => boolean }> | Readonly<{ ok: false; response: Response }>;

export function collateralHeaders(rate: RateLimitDecision): Record<string, string> {
  return { ...privateNoStoreHeaders(), ...rateLimitHeaders(rate) };
}

export function collateralFailure(status: number, code: string, message: string, rate: RateLimitDecision): Response {
  return Response.json({ error: { code, message } }, { status, headers: collateralHeaders(rate) });
}

type Answer<T> = Readonly<{ ok: true; value: T }> | ActionFailure;
const mismatched = (rate: RateLimitDecision) => collateralFailure(403, "WALLET_MISMATCH", "The session's wallet is not this action's wallet.", rate);

/** The Review: the body's wallet is the session's, or nothing is built. */
export function collateralReviewHandler(deps: Readonly<{ openDoor: (request: Request) => Promise<CollateralDoor>; review: (body: unknown) => Promise<Answer<CollateralReview>> }>) {
  return async (request: Request): Promise<Response> => {
    const door = await deps.openDoor(request);
    if (!door.ok) return door.response;
    const owner = (door.body as { owner?: unknown } | null)?.owner;
    if (typeof owner === "string" && door.mismatch(owner)) return mismatched(door.rate);
    const reviewed = await deps.review(door.body);
    if (!reviewed.ok) return collateralFailure(reviewed.status, reviewed.code, reviewed.reason, door.rate);
    return Response.json(reviewed.value, { headers: collateralHeaders(door.rate) });
  };
}

/** The relay: the ticket's wallet is the session's, or nothing is sent. */
export function collateralSubmitHandler(deps: Readonly<{ openDoor: (request: Request) => Promise<CollateralDoor>; submit: (body: unknown) => Promise<Answer<CollateralRelay>>; env: () => Env }>) {
  return async (request: Request): Promise<Response> => {
    const door = await deps.openDoor(request);
    if (!door.ok) return door.response;
    const read = readTicket((door.body as { ticket?: unknown } | null)?.ticket, deps.env());
    if (read.ok && door.mismatch(read.ticket.owner)) return mismatched(door.rate);
    const relayed = await deps.submit(door.body);
    if (!relayed.ok) return collateralFailure(relayed.status, relayed.code, relayed.reason, door.rate);
    return Response.json(relayed.value, { headers: collateralHeaders(door.rate) });
  };
}
