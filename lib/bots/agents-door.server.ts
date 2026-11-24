/**
 * The door of «a wallet's agents» (`/api/bots/agents`): the wallet's mandates, its autopilot and the piers its
 * agent looks after — read for that wallet only, the one the request proves.
 *
 * The proof is the one for a read (`requireWalletProof(…, "read")`): the phone's bearer, the browser's proof the wallet
 * signed (its sign-in or a `prove`), or a wallet the signed-in account linked. Without one the door answers 401; a proof
 * of another wallet than the one the body names, 403. The book is then read for the proven address — never one a request
 * names — so neither another browser nor `curl` with this site's `Origin` reads someone else's agents by their public
 * address. A browser's request comes from this site (as the pool doors always asked); a bearer carries no origin. The
 * rate is the pool actions' own, as before. Read only: nothing here builds, signs or moves anything.
 */

import { consumeAgentControlRequest, readAgentControlJson } from "../agent-control/http.ts";
import { privateNoStoreHeaders, rateLimitHeaders, type RateLimitDecision } from "../http-control.ts";
import { mutationOriginAllowed } from "../security.ts";

const Base58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/u;

/** The proven wallet, or the refusal to answer with (`requireWalletProof`'s own shape). */
export type ProvenWallet = Readonly<{ ok: true; address: string }> | Readonly<{ ok: false; response: Response }>;
export type ProveRead = (request: Request) => Promise<ProvenWallet>;

/** The real proof, read from the session store — loaded only on a request, never by a test that hands its own. */
const proveFromSession: ProveRead = async (request) => (await import("../api/v1/proof.ts")).requireWalletProof(request, "read");

const headersOf = (rate: RateLimitDecision): Record<string, string> => ({ ...privateNoStoreHeaders(), ...rateLimitHeaders(rate) });

function refuse(status: number, code: string, message: string, rate: RateLimitDecision): Response {
  return Response.json({ error: { code, message } }, { status, headers: headersOf(rate) });
}

/** The whole door: the site or the bearer, the wallet's proof, then the one read for the proven address. */
export async function answerAgents(request: Request, read: (owner: string) => Promise<unknown>, deps: Readonly<{ prove?: ProveRead }> = {}): Promise<Response> {
  const rate = consumeAgentControlRequest(request.headers);
  if (!rate.allowed) return refuse(429, "RATE_LIMITED", "Too many requests.", rate);
  /* A browser from elsewhere is refused before anything of it is read; a request with an Authorization header is the
     phone's, and the proof judges its bearer. */
  if (request.headers.get("authorization") === null && !mutationOriginAllowed(request.url, request.headers.get("origin"), request.headers.get("sec-fetch-site"))) {
    return refuse(403, "FORBIDDEN_ORIGIN", "Pool actions must be asked for from this site.", rate);
  }
  const body = await readAgentControlJson(request);
  if (!body.ok) return refuse(body.status, body.code, "The request body was not accepted.", rate);
  const value = body.value && typeof body.value === "object" && !Array.isArray(body.value) ? (body.value as Record<string, unknown>) : {};
  const owner = typeof value.owner === "string" ? value.owner : "";
  if (!Base58.test(owner)) return refuse(400, "VALIDATION_ERROR", "Not an address.", rate);
  const proof = await (deps.prove ?? proveFromSession)(request);
  if (!proof.ok) {
    const said = (await proof.response.clone().json().catch(() => null)) as { error?: { code?: unknown; message?: unknown } } | null;
    const code = typeof said?.error?.code === "string" ? said.error.code : "UNAUTHORIZED";
    const message = typeof said?.error?.message === "string" ? said.error.message : "No proven wallet: sign in with the wallet first.";
    return refuse(proof.response.status || 401, code, message, rate);
  }
  if (proof.address !== owner) return refuse(403, "WALLET_MISMATCH", "The session's wallet is not this wallet.", rate);
  const agents = await read(proof.address).catch(() => null);
  if (!agents) return refuse(503, "UNAVAILABLE", "The agent's book did not answer.", rate);
  return Response.json(agents, { headers: headersOf(rate) });
}
