import { createHash } from "node:crypto";

import { privateNoStoreHeaders } from "../http-control";
import { mutationOriginAllowed } from "../security";
import { isModelId, isQuarterId, parseChange, parseCreate, parseOff, type Parsed } from "./agent.ts";
import { isFormat, type RingErrorCode } from "./contract.ts";
import { errorLine, type Outcome, type RingEngine } from "./engine.ts";
import type { RingStore } from "./store.ts";

/**
 * The routes of `/api/ring` (CITY-50), written against plain `Request` and `Response` so every rule is tested without
 * a server; `server.ts` gives them the real session, store, catalog and keys, and `app/api/ring/**` only hands the
 * request over.
 *
 * Every route is closed (404) until the deployment's switch says `open` (`NEXT_PUBLIC_RYNTRA_CITY_RING`), so no
 * catalog is read and no key is made for a Ring people cannot see. Reading the models and a garage needs no one;
 * making, changing and switching off an agent needs the Ryntra account signed in with a wallet, comes from this site
 * only and carries an `Idempotency-Key` — a retried write gets its first answer back and is done once. A store, world
 * or catalog that cannot be reached is a 503, never a 500.
 */

export type AccountRead = { status: "ok"; accountId: string } | { status: "absent" } | { status: "unavailable" };

export type RingApiDeps = {
  engine: () => RingEngine;
  /** Whether the Ring is open to people on this deployment. */
  open: () => boolean;
  /** The account signed in on this request. */
  account: (req: Request) => Promise<AccountRead>;
  /** Where a request key's answer is kept. */
  store: Pick<RingStore, "answer" | "keepAnswer">;
  now?: () => number;
};

const JSON_TYPE = { "content-type": "application/json; charset=utf-8" };
const MAX_BODY_BYTES = 12_288;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_:.-]{8,128}$/;

type Answer = { status: number; body: unknown; headers?: Record<string, string> };
type Kept = Answer & { hash: string };

const failure = (status: number, code: RingErrorCode, message: string, extra: Record<string, unknown> = {}): Answer => ({ status, body: { error: { code, message, ...extra } } });

const STATUS = {
  closed: failure(404, "CLOSED", "The Ring is not open yet."),
  unavailable: failure(503, "UNAVAILABLE", "The Ring could not be reached. Nothing was changed."),
  signIn: failure(401, "SIGN_IN", "Sign in with your wallet to keep an agent."),
} as const;

/** The HTTP status of each refusal the engine gives. */
const STATUS_OF: Record<RingErrorCode, number> = {
  CLOSED: 404,
  UNAVAILABLE: 503,
  FORBIDDEN: 403,
  BAD_REQUEST: 400,
  PAYLOAD_TOO_LARGE: 413,
  IDEMPOTENCY_KEY_REQUIRED: 400,
  IDEMPOTENCY_KEY_REUSED: 422,
  SIGN_IN: 401,
  NOT_FOUND: 404,
  NOT_YOURS: 403,
  NOT_GARAGE: 422,
  SLOT_TAKEN: 409,
  VERSION: 409,
  OFF: 409,
  TOO_LONG: 422,
  MODEL_REFUSED: 422,
  MODELS_UNAVAILABLE: 503,
  KEY_FAILED: 503,
  RATE_LIMITED: 429,
};

function respond(answer: Answer): Response {
  return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { ...JSON_TYPE, ...privateNoStoreHeaders(), ...(answer.headers ?? {}) } });
}

function unavailable(error: unknown): Response {
  console.error("[ring] route failed", errorLine(error));
  return respond(STATUS.unavailable);
}

/** The engine's outcome as an answer: an agent, or its refusal with the agent as it is now when there is one. */
function answerOf(outcome: Outcome<unknown>, okStatus = 200): Answer {
  if (outcome.ok) return { status: okStatus, body: { agent: outcome.value } };
  return failure(STATUS_OF[outcome.code], outcome.code, outcome.message, outcome.current ? { current: outcome.current } : {});
}

export function createRingApi(deps: RingApiDeps) {
  const now = deps.now ?? Date.now;

  /** GET /api/ring/models — every brain on offer, priced, with its class. */
  async function models(_req: Request): Promise<Response> {
    if (!deps.open()) return respond(STATUS.closed);
    try {
      return respond({ status: 200, body: await deps.engine().models() });
    } catch (error) {
      console.error("[ring] catalog not read", errorLine(error));
      return respond(failure(503, "MODELS_UNAVAILABLE", "OpenRouter's catalog could not be read. Try again in a minute."));
    }
  }

  /** GET /api/ring/model?id= — one brain as an agent would get it: the provider it is pinned to, its class, its formats. */
  async function model(req: Request): Promise<Response> {
    if (!deps.open()) return respond(STATUS.closed);
    const id = new URL(req.url).searchParams.get("id");
    if (!isModelId(id)) return respond(failure(400, "BAD_REQUEST", "`id` is an OpenRouter model id."));
    try {
      const quoted = await deps.engine().quote(id);
      if (quoted.ok) return respond({ status: 200, body: { quote: quoted.quote } });
      return respond(quoted.reason === "unavailable" ? failure(503, "MODELS_UNAVAILABLE", quoted.message) : failure(422, "MODEL_REFUSED", quoted.message));
    } catch (error) {
      return unavailable(error);
    }
  }

  /** GET /api/ring/garage?quarter=&slot= — the agent in a garage slot; its owner also sees the script and the key. */
  async function garage(req: Request): Promise<Response> {
    if (!deps.open()) return respond(STATUS.closed);
    const params = new URL(req.url).searchParams;
    const quarter = params.get("quarter");
    const slot = Number(params.get("slot"));
    if (!isQuarterId(quarter) || !/^\d{1,2}$/.test(params.get("slot") ?? "") || slot > 63) return respond(failure(400, "BAD_REQUEST", "quarter and slot name a garage."));
    try {
      const account = await deps.account(req).catch((): AccountRead => ({ status: "unavailable" }));
      const accountId = account.status === "ok" ? account.accountId : null;
      return respond({ status: 200, body: await deps.engine().garage(quarter, slot, accountId) });
    } catch (error) {
      return unavailable(error);
    }
  }

  /** The asker's account, or null when nobody is signed in; `undefined` when the session could not be read. */
  async function asker(req: Request): Promise<string | null | undefined> {
    const account = await deps.account(req).catch((): AccountRead => ({ status: "unavailable" }));
    return account.status === "ok" ? account.accountId : account.status === "absent" ? null : undefined;
  }

  /** GET /api/ring/mine — the asker's agents and their garage in the Arena (CITY-217). */
  async function mine(req: Request): Promise<Response> {
    if (!deps.open()) return respond(STATUS.closed);
    try {
      const accountId = await asker(req);
      if (accountId === undefined) return respond(STATUS.unavailable);
      return respond({ status: 200, body: await deps.engine().mine(accountId) });
    } catch (error) {
      return unavailable(error);
    }
  }

  /** GET /api/ring/board?format= — a format's board, best first (CITY-217). */
  async function board(req: Request): Promise<Response> {
    if (!deps.open()) return respond(STATUS.closed);
    const format = new URL(req.url).searchParams.get("format");
    if (!isFormat(format)) return respond(failure(400, "BAD_REQUEST", "`format` is one of the Ring's formats."));
    try {
      const accountId = await asker(req);
      return respond({ status: 200, body: await deps.engine().board(format, accountId ?? null) });
    } catch (error) {
      return unavailable(error);
    }
  }

  /**
   * The parts every write shares, in order: open, same site, the key, the body, the account, the stored answer of the
   * key (the same key with another body is refused); then `run`. A 5xx is never kept, so a retry runs again.
   */
  async function write<T>(req: Request, route: string, parse: (body: Record<string, unknown>) => Parsed<T>, run: (accountId: string, value: T) => Promise<Answer>): Promise<Response> {
    if (!deps.open()) return respond(STATUS.closed);
    if (!mutationOriginAllowed(req.url, req.headers.get("origin"), req.headers.get("sec-fetch-site"))) {
      return respond(failure(403, "FORBIDDEN", "Agents are made from this site only."));
    }
    const key = req.headers.get("idempotency-key");
    if (!key || !IDEMPOTENCY_KEY.test(key)) {
      return respond(failure(400, "IDEMPOTENCY_KEY_REQUIRED", "Every write carries an Idempotency-Key of 8 to 128 letters, digits or _:.-"));
    }
    const text = await req.text();
    if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) return respond(failure(413, "PAYLOAD_TOO_LARGE", "The request is too large."));
    let body: Record<string, unknown>;
    try {
      const raw = JSON.parse(text) as unknown;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("not an object");
      body = raw as Record<string, unknown>;
    } catch {
      return respond(failure(400, "BAD_REQUEST", "The body is a JSON object."));
    }
    const parsed = parse(body);
    if (!parsed.ok) return respond(failure(parsed.code === "TOO_LONG" ? 422 : 400, parsed.code, parsed.message));

    const account = await deps.account(req).catch((): AccountRead => ({ status: "unavailable" }));
    if (account.status === "unavailable") return respond(STATUS.unavailable);
    if (account.status !== "ok") return respond(STATUS.signIn);

    const kept = `a:${account.accountId}:${route}:${key}`;
    const hash = createHash("sha256").update(`${route}\n${text}`).digest("hex");
    try {
      const stored = (await deps.store.answer(kept, now())) as Kept | null;
      if (stored) {
        if (stored.hash !== hash) return respond(failure(422, "IDEMPOTENCY_KEY_REUSED", "This Idempotency-Key was used for another request."));
        return respond({ status: stored.status, body: stored.body, headers: { ...stored.headers, "idempotent-replayed": "true" } });
      }
      const answer = await run(account.accountId, parsed.value);
      if (answer.status < 500) await deps.store.keepAnswer(kept, { ...answer, hash } satisfies Kept, now());
      return respond(answer);
    } catch (error) {
      return unavailable(error);
    }
  }

  /** POST /api/ring/create — a new agent in a garage of your quarter. */
  const create = (req: Request) => write(req, "create", parseCreate, async (accountId, value) => answerOf(await deps.engine().create(accountId, value), 201));

  /** POST /api/ring/change — the agent's body, brain and script, at the version you saw. */
  const change = (req: Request) => write(req, "change", parseChange, async (accountId, value) => answerOf(await deps.engine().change(accountId, value)));

  /** POST /api/ring/off — switch the agent off; its key goes off with it and the garage is free again. */
  const off = (req: Request) => write(req, "off", parseOff, async (accountId, value) => answerOf(await deps.engine().off(accountId, value)));

  return { models, model, garage, mine, board, create, change, off };
}

export type RingApi = ReturnType<typeof createRingApi>;
