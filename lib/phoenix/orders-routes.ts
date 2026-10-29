/**
 * The order routes' own decisions (B6b), apart from their wiring so a test can hold them — the collateral's
 * (`collateral-routes.ts`) with the order's ticket: the door lets the request in, the wallet a phone's bearer carries
 * must be the order's wallet, and only then does the action answer.
 */

import { collateralFailure, collateralHeaders, type CollateralDoor } from "./collateral-routes.ts";
import type { ActionFailure } from "./orders-actions.ts";
import { readOrderTicket, type Env, type OrderRelay, type OrderReview } from "./orders.ts";

type Answer<T> = Readonly<{ ok: true; value: T }> | ActionFailure;

/** The Review: the body's wallet is the session's, or nothing is built. */
export function orderReviewHandler(deps: Readonly<{ openDoor: (request: Request) => Promise<CollateralDoor>; review: (body: unknown) => Promise<Answer<OrderReview>> }>) {
  return async (request: Request): Promise<Response> => {
    const door = await deps.openDoor(request);
    if (!door.ok) return door.response;
    const owner = (door.body as { owner?: unknown } | null)?.owner;
    if (typeof owner === "string" && door.mismatch(owner)) return collateralFailure(403, "WALLET_MISMATCH", "The session's wallet is not this order's wallet.", door.rate);
    const reviewed = await deps.review(door.body);
    if (!reviewed.ok) return collateralFailure(reviewed.status, reviewed.code, reviewed.reason, door.rate);
    return Response.json(reviewed.value, { headers: collateralHeaders(door.rate) });
  };
}

/** The relay: the ticket's wallet is the session's, or nothing is sent. */
export function orderSubmitHandler(deps: Readonly<{ openDoor: (request: Request) => Promise<CollateralDoor>; submit: (body: unknown) => Promise<Answer<OrderRelay>>; env: () => Env }>) {
  return async (request: Request): Promise<Response> => {
    const door = await deps.openDoor(request);
    if (!door.ok) return door.response;
    const read = readOrderTicket((door.body as { ticket?: unknown } | null)?.ticket, deps.env());
    if (read.ok && door.mismatch(read.ticket.owner)) return collateralFailure(403, "WALLET_MISMATCH", "The session's wallet is not this order's wallet.", door.rate);
    const relayed = await deps.submit(door.body);
    if (!relayed.ok) return collateralFailure(relayed.status, relayed.code, relayed.reason, door.rate);
    return Response.json(relayed.value, { headers: collateralHeaders(door.rate) });
  };
}
