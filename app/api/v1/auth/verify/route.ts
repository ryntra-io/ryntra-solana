import { verifyAndOpenSession } from "@/lib/api/v1/auth.server";
import { VerifyRequestSchema } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { FixedWindowLimiter, clientIp, rateLimitHeaders } from "@/lib/http-control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The signed challenge comes back; a bearer session goes out.
 *
 * Order matters and is the web route's: the nonce's issuance tag is checked,
 * the nonce is spent in the store, and only then is the Ed25519 signature
 * verified against the address — so a captured signature finds its nonce
 * gone and two concurrent requests with one nonce cannot both proceed. The
 * token in the answer is the same signed session reference the web's cookie
 * carries; the session is the same recorded row, revocable from anywhere.
 */
const LIMITER = new FixedWindowLimiter({ windowMs: 60_000, limit: 20, maxKeys: 5_000 });

export async function POST(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const decision = LIMITER.consume(`native-siws:${clientIp(request.headers)}`);
  if (!decision.allowed) return apiFailure("RATE_LIMITED", "Too many sign-in attempts.", { headers: rateLimitHeaders(decision) });
  const read = await readApiBody(request, VerifyRequestSchema, 16_384);
  if (!read.ok) return read.response;
  let signedMessage: Uint8Array;
  let signature: Uint8Array;
  try {
    signedMessage = new Uint8Array(Buffer.from(read.body.signedMessage, "base64"));
    signature = new Uint8Array(Buffer.from(read.body.signature, "base64"));
  } catch {
    return apiFailure("VALIDATION_ERROR", "signedMessage and signature must be base64.");
  }
  const url = new URL(request.url);
  const result = await verifyAndOpenSession({ address: read.body.address, signedMessage, signature, client: read.body.client, domain: url.host, uri: url.origin });
  if (!result.ok) return apiFailure(result.code, result.reason, { minimumAppVersion: result.minimumAppVersion });
  return apiJson(result.response);
}
