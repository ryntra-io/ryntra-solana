import { z } from "zod";

import { getGuardRuntime } from "../../../../lib/guard/runtime.ts";
import { FixedWindowLimiter, clientIp, privateNoStoreHeaders } from "../../../../lib/http-control.ts";
import { mutationOriginAllowed } from "../../../../lib/security.ts";
import { connectorOrigin } from "../../../../lib/connector/metadata.ts";
import { ConnectorOAuthError, createConnectorOAuthServer } from "../../../../lib/connector/oauth.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The consent page asks for the message the wallet will sign (CITY-154).
 *
 * The server checks the authorization request again — client, redirect, PKCE, resource, scope — and builds the Sign
 * In With Solana message itself, its statement naming the client and saying nothing can move. The client never writes
 * the message: one that did would choose its own domain, expiry and words. The nonce is held in the store with the
 * request it was issued for, so the signature can only ever approve this one request.
 */
const LIMITER = new FixedWindowLimiter({ windowMs: 60_000, limit: 20, maxKeys: 5_000 });

const BodySchema = z
  .object({
    address: z.string().min(32).max(44),
    request: z
      .object({
        response_type: z.string().max(32).nullish(),
        client_id: z.string().max(512).nullish(),
        redirect_uri: z.string().max(512).nullish(),
        scope: z.string().max(256).nullish(),
        state: z.string().max(1_024).nullish(),
        code_challenge: z.string().max(128).nullish(),
        code_challenge_method: z.string().max(16).nullish(),
        resource: z.string().max(512).nullish(),
      })
      .strip(),
  })
  .strict();

function fail(status: number, error: string, message: string) {
  return Response.json({ error, error_description: message }, { status, headers: privateNoStoreHeaders() });
}

export async function POST(request: Request) {
  if (!mutationOriginAllowed(request.url, request.headers.get("origin"), request.headers.get("sec-fetch-site"))) {
    return fail(403, "forbidden", "The consent is asked for from Ryntra's own page.");
  }
  const decision = LIMITER.consume(`connect-challenge:${clientIp(request.headers)}`);
  if (!decision.allowed) return fail(429, "temporarily_unavailable", "Too many attempts. Wait a minute.");
  let parsed;
  try {
    parsed = BodySchema.safeParse(await request.json());
  } catch {
    return fail(400, "invalid_request", "The body is not JSON.");
  }
  if (!parsed.success) return fail(400, "invalid_request", "The consent request did not match its schema.");
  const origin = connectorOrigin(request);
  try {
    const issued = await createConnectorOAuthServer(getGuardRuntime().store).issueConsent({
      params: parsed.data.request,
      address: parsed.data.address,
      origin,
      domain: new URL(origin).host,
      nowMs: Date.now(),
    });
    return Response.json(issued, { headers: privateNoStoreHeaders() });
  } catch (error) {
    if (error instanceof ConnectorOAuthError) return fail(error.status, error.code, error.message);
    throw error;
  }
}
