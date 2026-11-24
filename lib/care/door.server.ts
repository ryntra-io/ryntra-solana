/**
 * The one door of the agent's care of a pool (`/api/city/earn/care`) and of the stock pool's keeper
 * (`/api/city/earn/keeper`): every action is the wallet's own, and the wallet is the one it proved.
 *
 * - `review`, `submit`, `stop`, `relay` change what the agent does with a person's position, so each needs the wallet's
 *   own proof for a change (`requireWalletProof(…, "mutation")`, as autopay's routes): the phone's bearer, or
 *   the browser's proof the wallet signed (its sign-in or a `prove`) — never a wallet an account merely linked;
 * - `status` reads one wallet's cares — what the chain already shows of its policies — and is answered for the address the
 *   body names without a proof, as before: a person who turned the care on before the door asked for proofs still sees
 *   the agent and its «Stop», and so does one whose wallet app switched accounts since it signed in.
 * Without a proof a change is answered 401; a proof of another wallet than the one the body names, 403. The action is then
 * asked for the proven address — never one a request names — so neither another browser nor `curl` with this site's
 * `Origin` can stop, re-point or read someone else's care knowing only their public address.
 *
 * A browser's request comes from this site, the read too (as the pool doors always asked); a bearer carries no origin.
 * The rate is the pool actions' own. Whether the switch is open is the route's to ask first (closed — 404).
 */

import { consumeAgentControlRequest, readAgentControlJson } from "../agent-control/http.ts";
import { privateNoStoreHeaders, rateLimitHeaders, type RateLimitDecision } from "../http-control.ts";
import { mutationOriginAllowed } from "../security.ts";

export const DOOR_ACTIONS = ["review", "submit", "stop", "relay", "status"] as const;
export type DoorAction = (typeof DOOR_ACTIONS)[number];

/** The proof each action needs: only `status` reads. */
export const doorIntent = (action: DoorAction): "read" | "mutation" => (action === "status" ? "read" : "mutation");

/** The proven wallet, or the refusal to answer with (`requireWalletProof`'s own shape). */
export type ProvenWallet = Readonly<{ ok: true; address: string }> | Readonly<{ ok: false; response: Response }>;
export type ProveWallet = (request: Request, intent: "read" | "mutation") => Promise<ProvenWallet>;

/** The real proof, read from the session store — loaded only on a request, never by a test that hands its own. */
const proveFromSession: ProveWallet = async (request, intent) => (await import("../api/v1/proof.ts")).requireWalletProof(request, intent);

export type DoorAnswer = Readonly<{ ok: true }> | Readonly<{ ok: false; code: string; reason: string }>;
/** What each action does, for the proven wallet and the request's body. */
export type DoorActions = Readonly<Record<DoorAction, (owner: string, body: Readonly<Record<string, unknown>>) => Promise<DoorAnswer>>>;

const headersOf = (rate: RateLimitDecision): Record<string, string> => ({ ...privateNoStoreHeaders(), ...rateLimitHeaders(rate) });

function refuse(status: number, code: string, message: string, rate: RateLimitDecision): Response {
  return Response.json({ error: { code, message } }, { status, headers: headersOf(rate) });
}

export type CareDoor = Readonly<{ ok: true; action: DoorAction; owner: string; body: Readonly<Record<string, unknown>>; rate: RateLimitDecision }> | Readonly<{ ok: false; response: Response }>;

export async function openCareDoor(request: Request, deps: Readonly<{ prove?: ProveWallet }> = {}): Promise<CareDoor> {
  const rate = consumeAgentControlRequest(request.headers);
  if (!rate.allowed) return { ok: false, response: refuse(429, "RATE_LIMITED", "Too many requests.", rate) };
  /* A browser from elsewhere is refused before anything of it is read; a request with an Authorization header is the
     phone's, and the proof judges its bearer. */
  if (request.headers.get("authorization") === null && !mutationOriginAllowed(request.url, request.headers.get("origin"), request.headers.get("sec-fetch-site"))) {
    return { ok: false, response: refuse(403, "FORBIDDEN_ORIGIN", "Pool actions must be asked for from this site.", rate) };
  }
  const read = await readAgentControlJson(request);
  if (!read.ok) return { ok: false, response: refuse(read.status, read.code, "The request body was not accepted.", rate) };
  const body = read.value && typeof read.value === "object" && !Array.isArray(read.value) ? (read.value as Record<string, unknown>) : {};
  const action = DOOR_ACTIONS.find((name) => name === body.action);
  const owner = typeof body.owner === "string" ? body.owner : "";
  if (!action || !owner) return { ok: false, response: refuse(400, "BAD_REQUEST", "The request was not understood.", rate) };
  /* A read of the cares is answered for the address named, proof or none (see above); every change needs the proof. */
  if (action === "status") return { ok: true, action, owner, body, rate };
  const proof = await (deps.prove ?? proveFromSession)(request, doorIntent(action));
  if (!proof.ok) {
    const said = (await proof.response.clone().json().catch(() => null)) as { error?: { code?: unknown; message?: unknown } } | null;
    const code = typeof said?.error?.code === "string" ? said.error.code : "UNAUTHORIZED";
    const message = typeof said?.error?.message === "string" ? said.error.message : "No proven wallet: sign in with the wallet first.";
    return { ok: false, response: refuse(proof.response.status || 401, code, message, rate) };
  }
  if (proof.address !== owner) return { ok: false, response: refuse(403, "WALLET_MISMATCH", "The session's wallet is not this action's wallet.", rate) };
  return { ok: true, action, owner: proof.address, body, rate };
}

/**
 * The whole door: the proof, then the one action for the proven wallet. A refusal of the action answers 409 — its own
 * «closed» code 404 — with its code and reason.
 */
export async function answerCareDoor(request: Request, actions: DoorActions, options: Readonly<{ closed: string; prove?: ProveWallet }>): Promise<Response> {
  const door = await openCareDoor(request, { prove: options.prove });
  if (!door.ok) return door.response;
  const answer = await actions[door.action](door.owner, door.body);
  if (!answer.ok) return refuse(answer.code === options.closed ? 404 : 409, answer.code, answer.reason, door.rate);
  return Response.json(answer, { headers: headersOf(door.rate) });
}
