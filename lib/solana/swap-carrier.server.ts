/**
 * The carrier of a swap request, read from the real session store.
 *
 * A bearer present is resolved through `resolveNativeSession` (the same read
 * every v1 route makes, touching idleness as a page view does); an
 * `Authorization` header without a bearer's grammar is refused as a native
 * request that failed (1.22.0), never judged by the origin check; a request
 * without one is the web's. The decision itself is `swap-carrier.ts`.
 *
 * Server only.
 */

import { bearerToken, resolveNativeSession } from "../auth/native-session.ts";
import { decideSwapCarrier, MALFORMED_BEARER, type SwapCarrier } from "./swap-carrier.ts";

export { walletMismatch, type SwapCarrier } from "./swap-carrier.ts";

export async function readSwapCarrier(request: Request, originRefusal: string): Promise<SwapCarrier> {
  const session = bearerToken(request.headers)
    ? await resolveNativeSession(request.headers)
    : request.headers.get("authorization") !== null
      ? MALFORMED_BEARER
      : null;
  return decideSwapCarrier(
    { url: request.url, origin: request.headers.get("origin"), secFetchSite: request.headers.get("sec-fetch-site"), session },
    originRefusal,
  );
}
