import { getGuardRuntime } from "../../../../lib/guard/runtime.ts";
import { privateNoStoreHeaders } from "../../../../lib/http-control.ts";
import { CONNECTOR_CORS, corsPreflight, readForm } from "../../../../lib/connector/http.ts";
import { createConnectorOAuthServer } from "../../../../lib/connector/oauth.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * RFC 7009 revocation. Revoking either token of a connection ends the whole connection — the grant the person signed.
 * An unknown token answers 200, as the RFC asks: an endpoint that said "unknown" would let anyone test guesses.
 */
export async function POST(request: Request) {
  const form = await readForm(request);
  await createConnectorOAuthServer(getGuardRuntime().store).revoke({ token: form?.token ?? "", nowMs: Date.now() });
  return new Response(null, { status: 200, headers: { ...privateNoStoreHeaders(), ...CONNECTOR_CORS } });
}

export const OPTIONS = corsPreflight;
