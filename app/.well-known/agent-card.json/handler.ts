/**
 * The Agent Card, served at the protocol's own well-known path.
 *
 * Public and unauthenticated, as a discovery document has to be: a client
 * cannot authenticate until it has read which scheme to authenticate with. The
 * card names its security scheme and the interface behind it; the interface is
 * where a credential starts mattering.
 *
 * One handler, two routes. The 1.0 path is `/.well-known/agent-card.json`; the
 * earlier generation served `/.well-known/agent.json`, which is still the
 * address most clients try first. Both answer this same document, because two
 * documents at two addresses is worse than either.
 */

import {
  A2A_CONTENT_TYPE,
  A2A_VERSION_HEADER,
  A2A_WIRE_VERSION,
  CARD_LIMITATIONS,
  buildRyntraAgentCard,
} from "../../../lib/agent-control/a2a/card.ts";
import { requestOrigin } from "../../../lib/agent-control/oauth/metadata.ts";
import { publicCacheHeaders } from "../../../lib/http-control.ts";

export function cardResponse(request: Request): Response {
  const origin = requestOrigin(request);
  if (!/^https:\/\/[^/]+$/.test(origin)) {
    /* A card with a relative or plain-http interface URL would point a reader
       wherever their own base happens to be, so none is published. */
    return Response.json(
      {
        error: {
          code: "CARD_ORIGIN_NOT_ABSOLUTE_HTTPS",
          message: "This deployment's own https origin is not known, so no card is published here.",
        },
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  return new Response(JSON.stringify(buildRyntraAgentCard({ origin })), {
    headers: {
      ...publicCacheHeaders(300, 3_600),
      "content-type": A2A_CONTENT_TYPE,
      [A2A_VERSION_HEADER]: A2A_WIRE_VERSION,
      "Access-Control-Allow-Origin": "*",
      /* What the card does not say, where a reader of the HTTP response will
         see it. It is not a field inside the card: a field of our own in a
         protocol document is a field nobody else reads. */
      "X-Ryntra-Card-Limitations": CARD_LIMITATIONS.length.toString(),
    },
  });
}

export function cardOptions(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": `content-type, ${A2A_VERSION_HEADER}`,
    },
  });
}
