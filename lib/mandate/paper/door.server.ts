/**
 * The door of a paper week's start (`POST /api/bots/mandate/paper`): a start is the proven wallet's own, and
 * every limit on it is the wallet's.
 *
 * - The browser asks from this site (`paperOriginAllowed`, 403 otherwise); a request with an Authorization header is the
 *   phone's, and the proof judges its bearer.
 * - The proof is the one every change of Ryntra asks (`requireWalletProof(…, "mutation")`, as the care's door,
 *   `lib/care/door.server.ts`, and autopay's routes): the phone's bearer, or the browser's proof the wallet signed — one
 *   message the server wrote, its nonce spent once (`/api/auth/solana`), no transaction. Never a wallet an account merely
 *   linked, never anything the body carries: a signed message pasted into the body proves nothing. Without a proof — 401;
 *   a proof of another wallet than the one the body names — 403.
 * - The proven wallet is the identity, never the place it asks from:
 *   - one paper week at a time per wallet: the week's key is the wallet's own, derived under the server's key
 *     (`paperKeyOf`), so a second start while one is at work answers that week (`already`) and spends nothing;
 *   - starts: the store's durable ledger counts the wallet (an HMAC of its address, `whoOf("wallet:…")`) — three an hour,
 *     eight a day, everyone 240 an hour (`PAPER_STARTS`), before a single quote is asked; past it — 429 `PAPER_LIMITED`,
 *     reason `wallet`.
 * - The address it asks from stays a guard against a flood only: `PAPER_START_IP` starts an hour at one instance, past it
 *   — 429 `RATE_LIMITED`, reason `ip`, before the proof is even read. It is wide on purpose: people behind one shared
 *   address (a carrier, an office) are not held by each other — the wallet is what is counted.
 * - Without the server's key the door cannot name the wallet's week safely: it refuses (503), it never derives a key from
 *   nothing.
 *
 * This file reads no environment and holds no key: the route hands in the server's key, the store and the reads
 * (`./wire.server.ts`); a test hands its own, and its own proof.
 */

import { clientIp, FixedWindowLimiter, type RateLimitDecision } from "../../http-control.ts";
import { mutationOriginAllowed } from "../../security.ts";
import { closePaper, paperKeyOf, startPaper, whoOf, type PaperDeps, type PaperRefusal } from "./service.server.ts";

const Base58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/u;

/** The flood guard on the address a start comes from: starts an hour, at one instance. The wallet's ledger is the limit. */
export const PAPER_START_IP = Object.freeze({ limit: 20, windowMs: 3_600_000 });

const START_WINDOW = new FixedWindowLimiter({ ...PAPER_START_IP, maxKeys: 5_000 });

/** The proven wallet, or the refusal to answer with (`requireWalletProof`'s own shape). */
export type ProvenWallet = Readonly<{ ok: true; address: string }> | Readonly<{ ok: false; response: Response }>;
export type ProveWallet = (request: Request) => Promise<ProvenWallet>;

/** The real proof, read from the session store — loaded only on a request, never by a test that hands its own. */
const proveFromSession: ProveWallet = async (request) => (await import("../../api/v1/proof.ts")).requireWalletProof(request, "mutation");

/** A change from a browser comes from this site; a request with an Authorization header is the phone's, judged by its proof. */
export const paperOriginAllowed = (request: Request): boolean =>
  request.headers.get("authorization") !== null || mutationOriginAllowed(request.url, request.headers.get("origin"), request.headers.get("sec-fetch-site"));

export type PaperStartDeps = Readonly<{
  paper: PaperDeps;
  /** The server's key: names the wallet in the ledger and derives its week's key. Null or short — the door refuses. */
  secret: string | null;
  prove?: ProveWallet;
  /** The flood guard on the address; the instance's own when not handed in. */
  window?: Readonly<{ consume(key: string): RateLimitDecision }>;
}>;

export type PaperStartAnswer = Readonly<{ status: number; body: unknown; retryAfterSeconds?: number }>;

const refused = (status: number, code: string, message: string, extra: Readonly<Record<string, unknown>> = {}, retryAfterSeconds?: number): PaperStartAnswer => ({
  status,
  body: { error: { code, message, ...extra } },
  ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
});

/** A refusal of the paper service, as the door answers it. */
function refusalOf(code: PaperRefusal): PaperStartAnswer {
  switch (code) {
    case "KEY":
    case "INPUT":
      return refused(400, "VALIDATION_ERROR", "The request was not understood.");
    case "LIMITED":
      return refused(429, "PAPER_LIMITED", "This wallet started paper too often lately: three an hour, eight a day. Try again later.", { reason: "wallet" });
    case "FULL":
      return refused(503, "PAPER_FULL", "Paper is full right now. Try again later.");
    case "BUSY":
      return refused(503, "PAPER_BUSY", "Paper's share of prices is spent for now. Try again in a minute.");
    case "PAIR":
      return refused(422, "PAPER_PAIR", "The agent does not trade this coin.");
    case "NO_PRICE":
      return refused(422, "PAPER_NO_PRICE", "No price for this coin right now.");
  }
}

/**
 * A start, for the wallet the request proves: the flood guard, the proof, then the paper week on the wallet's own key and
 * ledger. `body` is the route's parsed body: `{ owner, coin, symbol, plan, perDay, perTrade, days, bornAt }`; a `key` it
 * carries is not read — the wallet's week has the wallet's key, answered back for the browser to read and end it with.
 */
export async function answerPaperStart(request: Request, body: Readonly<Record<string, unknown>>, deps: PaperStartDeps): Promise<PaperStartAnswer> {
  if (!paperOriginAllowed(request)) return refused(403, "FORBIDDEN_ORIGIN", "Paper starts must be asked for from this site.");
  const flood = (deps.window ?? START_WINDOW).consume(`agent-paper:start:${clientIp(request.headers)}`);
  if (!flood.allowed) return refused(429, "RATE_LIMITED", "Too many paper starts from this network lately. Try again later.", { reason: "ip" }, flood.retryAfterSeconds);
  const owner = typeof body.owner === "string" ? body.owner : "";
  if (!Base58.test(owner)) return refused(400, "VALIDATION_ERROR", "Not a wallet address.");
  const proof = await (deps.prove ?? proveFromSession)(request);
  if (!proof.ok) {
    const said = (await proof.response.clone().json().catch(() => null)) as { error?: { code?: unknown } } | null;
    const status = proof.response.status || 401;
    const code = typeof said?.error?.code === "string" ? said.error.code : "UNAUTHORIZED";
    return refused(status, code, status === 401 ? "Sign one message with the wallet to start paper." : "The proof of the wallet was not accepted.", { proof: false });
  }
  if (proof.address !== owner) return refused(403, "WALLET_MISMATCH", "The proven wallet is not this start's wallet.", { proof: false });
  const key = deps.secret ? paperKeyOf(proof.address, deps.secret) : null;
  if (!key || !deps.secret) return refused(503, "PAPER_UNAVAILABLE", "Paper is not open now.");
  const started = await startPaper(
    { key, coin: body.coin, symbol: body.symbol, plan: body.plan, perDay: body.perDay, perTrade: body.perTrade, days: body.days, bornAt: body.bornAt, who: whoOf(`wallet:${proof.address}`, deps.secret) },
    deps.paper,
  );
  if (!started.ok) return refusalOf(started.code);
  return { status: started.already ? 200 : 201, body: { paper: started.view, already: started.already, key } };
}

/**
 * «End paper» and «Start with money» close the proven wallet's own week, by the same proof as its start (the lead's review
 * of #1971): the week's key is derived from the proven address (`paperKeyOf`), never taken from the body — a key that once
 * leaked from a browser reads that week, but ends no week of the wallet, now or later. Without a proof — 401; another
 * wallet's proof — 403; a wallet with no week — `{ paper: null }`.
 */
export async function answerPaperClose(request: Request, body: Readonly<Record<string, unknown>>, to: "ended" | "live", deps: Omit<PaperStartDeps, "window">): Promise<PaperStartAnswer> {
  if (!paperOriginAllowed(request)) return refused(403, "FORBIDDEN_ORIGIN", "Paper changes must be asked for from this site.");
  const owner = typeof body.owner === "string" ? body.owner : "";
  if (!Base58.test(owner)) return refused(400, "VALIDATION_ERROR", "Not a wallet address.");
  const proof = await (deps.prove ?? proveFromSession)(request);
  if (!proof.ok) {
    const said = (await proof.response.clone().json().catch(() => null)) as { error?: { code?: unknown } } | null;
    const status = proof.response.status || 401;
    const code = typeof said?.error?.code === "string" ? said.error.code : "UNAUTHORIZED";
    return refused(status, code, status === 401 ? "Sign one message with the wallet to change paper." : "The proof of the wallet was not accepted.", { proof: false });
  }
  if (proof.address !== owner) return refused(403, "WALLET_MISMATCH", "The proven wallet is not this paper week's wallet.", { proof: false });
  const key = deps.secret ? paperKeyOf(proof.address, deps.secret) : null;
  if (!key) return refused(503, "PAPER_UNAVAILABLE", "Paper is not open now.");
  const closed = await closePaper(key, to, deps.paper);
  if (!closed.ok) return refused(400, "VALIDATION_ERROR", "The request was not understood.");
  return { status: 200, body: { paper: closed.view } };
}
