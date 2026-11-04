import { z } from "zod";

import { getGuardRuntime } from "../../../../lib/guard/runtime.ts";
import { FixedWindowLimiter, clientIp, privateNoStoreHeaders } from "../../../../lib/http-control.ts";
import { mutationOriginAllowed } from "../../../../lib/security.ts";
import { ConnectorOAuthError, createConnectorOAuthServer } from "../../../../lib/connector/oauth.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The signed consent comes back; the way back to the app goes out (CITY-154).
 *
 * The nonce is checked, the signature verified against the address and the exact message issued for it, the nonce
 * spent, and only then one short-lived authorization code is minted, bound to the wallet that signed. The answer is
 * JSON with the redirect, not a 303: the page navigates itself, so the browser's form rules never meet a third-party
 * address. Nothing here touches a transaction.
 */
const LIMITER = new FixedWindowLimiter({ windowMs: 60_000, limit: 20, maxKeys: 5_000 });

const BodySchema = z
  .object({
    nonce: z.string().regex(/^[0-9a-f]{32}$/),
    address: z.string().min(32).max(44),
    signedMessage: z.string().min(16).max(8_192),
    signature: z.string().min(80).max(96),
  })
  .strict();

function fail(status: number, error: string, message: string) {
  return Response.json({ error, error_description: message }, { status, headers: privateNoStoreHeaders() });
}

export async function POST(request: Request) {
  if (!mutationOriginAllowed(request.url, request.headers.get("origin"), request.headers.get("sec-fetch-site"))) {
    return fail(403, "forbidden", "The consent is given from Ryntra's own page.");
  }
  const decision = LIMITER.consume(`connect-approve:${clientIp(request.headers)}`);
  if (!decision.allowed) return fail(429, "temporarily_unavailable", "Too many attempts. Wait a minute.");
  let parsed;
  try {
    parsed = BodySchema.safeParse(await request.json());
  } catch {
    return fail(400, "invalid_request", "The body is not JSON.");
  }
  if (!parsed.success) return fail(400, "invalid_request", "The signed consent did not match its schema.");
  let signedMessage: Uint8Array;
  let signature: Uint8Array;
  try {
    signedMessage = new Uint8Array(Buffer.from(parsed.data.signedMessage, "base64"));
    signature = new Uint8Array(Buffer.from(parsed.data.signature, "base64"));
  } catch {
    return fail(400, "invalid_request", "The signature must be base64.");
  }
  try {
    const approved = await createConnectorOAuthServer(getGuardRuntime().store).approveConsent({
      nonce: parsed.data.nonce,
      address: parsed.data.address,
      signedMessage,
      signature,
      nowMs: Date.now(),
    });
    return Response.json({ redirect: approved.redirectTo }, { headers: privateNoStoreHeaders() });
  } catch (error) {
    if (error instanceof ConnectorOAuthError) return fail(error.status, error.code, error.message);
    throw error;
  }
}
