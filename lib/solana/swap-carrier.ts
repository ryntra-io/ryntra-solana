/**
 * Who may ask a swap route to act: the site for a browser, the bearer for the phone.
 *
 * The four swap routes that act or rescue (`/order`, `/execute`,
 * `/cancel-review`, `/recover`) carry no owner session — the authorization
 * for a swap is the wallet's own signature over the reviewed bytes, and what
 * stood between a request and a route was the site's origin, because a
 * browser's cookie jar is ambient and a state-changing request from a browser
 * must come from this site. A native client has no origin a server can check
 * and no cookie jar; it carries the session itself (`Authorization: Bearer`,
 * `lib/auth/native-session.ts`), and a bearer is not ambient — a browser never
 * attaches one on its own — so a request carrying one needs no origin check.
 * This is the rule the watchlist and the private reads already follow; the
 * phone app's request brings it to the swap routes.
 *
 * The bearer's wallet is then the only wallet the route acts for: the taker
 * of an order, the taker of a signed bundle, the owner of a Review or of a
 * recovery — `WALLET_MISMATCH` for any other, so a session can never move,
 * cancel or read another wallet's swap. A request without a bearer is the
 * web's and keeps every check the web has. The two are never mixed in one
 * request: a bearer that is present and fails is a refusal with its own code
 * (`UNAUTHORIZED`, `SESSION_EXPIRED`, `SESSION_REVOKED`, `UNAVAILABLE`), never
 * a fall-through to the origin check.
 *
 * This file is the decision, with no store behind it, so it is tested with
 * every outcome the session resolver can meet; `swap-carrier.server.ts` reads
 * the real session for the routes.
 */

import { ERROR_STATUS } from "../api/v1/contract.ts";
import type { NativeSessionRead } from "../auth/native-session.ts";
import { mutationOriginAllowed } from "../security.ts";

export type SwapCarrier =
  /** A browser on this site: the signature is the authorization, no wallet is bound here. */
  | Readonly<{ ok: true; carrier: "site" }>
  /** A native session: every wallet the route acts for must be this one. */
  | Readonly<{ ok: true; carrier: "bearer"; address: string }>
  | Readonly<{
      ok: false;
      status: number;
      code: "FORBIDDEN_ORIGIN" | "UNAUTHORIZED" | "SESSION_EXPIRED" | "SESSION_REVOKED" | "UNAVAILABLE";
      message: string;
    }>;

/**
 * An `Authorization` header that does not carry a bearer's grammar. Such a
 * request asked to be a native one and is refused as one (401), never judged
 * by the origin check a browser's request gets (contract 1.22.0).
 */
export const MALFORMED_BEARER: NativeSessionRead = { ok: false, code: "UNAUTHORIZED", reason: "The Authorization header does not carry a bearer session." };

export type SwapCarrierRequest = Readonly<{
  url: string;
  origin: string | null;
  secFetchSite: string | null;
  /** The session the bearer named, or null when the request carries no bearer. */
  session: NativeSessionRead | null;
}>;

/**
 * Decide the carrier.
 *
 * `originRefusal` is the sentence the route has always answered a browser
 * from elsewhere with; it is kept word for word so the web sees no change.
 */
export function decideSwapCarrier(request: SwapCarrierRequest, originRefusal: string): SwapCarrier {
  if (request.session) {
    const session = request.session;
    if (!session.ok) return { ok: false, status: ERROR_STATUS[session.code], code: session.code, message: session.reason };
    return { ok: true, carrier: "bearer", address: session.session.address };
  }
  if (!mutationOriginAllowed(request.url, request.origin, request.secFetchSite)) {
    return { ok: false, status: 403, code: "FORBIDDEN_ORIGIN", message: originRefusal };
  }
  return { ok: true, carrier: "site" };
}

/**
 * True when a bearer carries the request and names a wallet other than the
 * one the request acts for. The site carries no wallet: the signature over
 * the bytes, the issuer-bound bundle or the exact `requestId` is what binds a
 * browser's request, exactly as before.
 */
export function walletMismatch(carrier: Extract<SwapCarrier, { ok: true }>, wallet: string): boolean {
  return carrier.carrier === "bearer" && carrier.address !== wallet;
}
