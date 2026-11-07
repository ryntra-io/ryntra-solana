import { createHash } from "node:crypto";

import { privateNoStoreHeaders } from "../../http-control";
import { mutationOriginAllowed } from "../../security";
import type { AccountRead } from "../api.ts";
import type { RingStore } from "../store.ts";
import { isDuelFormat } from "./harness.ts";
import type { DuelErrorCode, DuelService, StartRequest } from "./service.ts";

/**
 * The duels' routes (CITY-51), on plain `Request` and `Response` like the rest of `/api/ring`:
 *
 *   GET  /api/ring/duel?id=                         → { duel: DuelView }
 *   GET  /api/ring/duels                            → { duels: DuelView[] }   the latest, newest first
 *   POST /api/ring/fight  { format, agent, opponent } + Idempotency-Key → 202 { duel: DuelView }
 *
 * Closed (404) until both switches say `open`: the Ring's (`NEXT_PUBLIC_RYNTRA_CITY_RING`) and the duels' own
 * (`NEXT_PUBLIC_RYNTRA_CITY_RING_DUELS`). A start needs the account signed in with a wallet, comes from this site only
 * and carries an `Idempotency-Key`: a retried start gets the same duel back and plays once.
 */

export type DuelApiDeps = {
  service: () => DuelService;
  open: () => boolean;
  account: (req: Request) => Promise<AccountRead>;
  store: Pick<RingStore, "answer" | "keepAnswer">;
  now?: () => number;
};

const JSON_TYPE = { "content-type": "application/json; charset=utf-8" };
const MAX_BODY_BYTES = 2_048;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_:.-]{8,128}$/;
const ID = /^[A-Za-z0-9._:-]{1,64}$/;

type Answer = { status: number; body: unknown };

const STATUS_OF: Record<DuelErrorCode, number> = {
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  NOT_YOURS: 403,
  SAME_AGENT: 422,
  SAME_OWNER: 422,
  WEIGHT: 422,
  FORMAT: 422,
  OFF: 409,
  NO_KEY: 409,
  MARKET_UNAVAILABLE: 503,
  RATE_LIMITED: 429,
};

const failure = (status: number, code: string, message: string): Answer => ({ status, body: { error: { code, message } } });
const closed = failure(404, "CLOSED", "Duels are not open yet.");
const unavailable = failure(503, "UNAVAILABLE", "Duels could not be reached. Nothing was started.");

const respond = (answer: Answer): Response =>
  new Response(JSON.stringify(answer.body), { status: answer.status, headers: { ...JSON_TYPE, ...privateNoStoreHeaders() } });

export function createDuelApi(deps: DuelApiDeps) {
  const now = deps.now ?? Date.now;

  /** GET /api/ring/duel?id= — one duel as anyone may watch it. */
  async function duel(req: Request): Promise<Response> {
    if (!deps.open()) return respond(closed);
    const id = new URL(req.url).searchParams.get("id");
    if (!id || !ID.test(id)) return respond(failure(400, "BAD_REQUEST", "`id` names a duel."));
    try {
      const found = await deps.service().get(id);
      return respond(found.ok ? { status: 200, body: { duel: found.value } } : failure(404, found.code, found.message));
    } catch {
      return respond(unavailable);
    }
  }

  /** GET /api/ring/duels — the latest duels, newest first. */
  async function duels(_req: Request): Promise<Response> {
    if (!deps.open()) return respond(closed);
    try {
      return respond({ status: 200, body: { duels: await deps.service().recent(12) } });
    } catch {
      return respond(unavailable);
    }
  }

  /** POST /api/ring/fight — start a duel: your agent (or the house) against another owner's agent or the house. */
  async function fight(req: Request): Promise<Response> {
    if (!deps.open()) return respond(closed);
    if (!mutationOriginAllowed(req.url, req.headers.get("origin"), req.headers.get("sec-fetch-site"))) return respond(failure(403, "FORBIDDEN", "Duels start from this site only."));
    const key = req.headers.get("idempotency-key");
    if (!key || !IDEMPOTENCY_KEY.test(key)) return respond(failure(400, "IDEMPOTENCY_KEY_REQUIRED", "Every start carries an Idempotency-Key of 8 to 128 letters, digits or _:.-"));
    const text = await req.text();
    if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) return respond(failure(413, "PAYLOAD_TOO_LARGE", "The request is too large."));
    let request: StartRequest;
    try {
      const raw = JSON.parse(text) as Record<string, unknown>;
      if (!raw || typeof raw !== "object" || !isDuelFormat(raw.format) || typeof raw.agent !== "string" || typeof raw.opponent !== "string" || !ID.test(raw.agent) || !ID.test(raw.opponent)) throw new Error("shape");
      request = { format: raw.format, agent: raw.agent, opponent: raw.opponent };
    } catch {
      return respond(failure(400, "BAD_REQUEST", "The body is { format, agent, opponent }."));
    }
    const account = await deps.account(req).catch((): AccountRead => ({ status: "unavailable" }));
    if (account.status === "unavailable") return respond(unavailable);
    if (account.status !== "ok") return respond(failure(401, "SIGN_IN", "Sign in with your wallet to start a duel."));

    const kept = `a:${account.accountId}:fight:${key}`;
    const hash = createHash("sha256").update(`fight\n${text}`).digest("hex");
    try {
      const stored = (await deps.store.answer(kept, now())) as (Answer & { hash: string }) | null;
      if (stored) return respond(stored.hash === hash ? { status: stored.status, body: stored.body } : failure(422, "IDEMPOTENCY_KEY_REUSED", "This Idempotency-Key was used for another request."));
      const started = await deps.service().start(account.accountId, request);
      const answer = started.ok ? { status: 202, body: { duel: started.value } } : failure(STATUS_OF[started.code], started.code, started.message);
      if (answer.status < 500) await deps.store.keepAnswer(kept, { ...answer, hash }, now());
      return respond(answer);
    } catch {
      return respond(unavailable);
    }
  }

  return { duel, duels, fight };
}

export type DuelApi = ReturnType<typeof createDuelApi>;
