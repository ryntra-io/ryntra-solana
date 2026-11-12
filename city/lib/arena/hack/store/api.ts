import { createHash } from "node:crypto";

import { privateNoStoreHeaders } from "../../../../../lib/http-control.ts";
import { mutationOriginAllowed } from "../../../../../lib/security.ts";
import { isOrderId } from "../order.ts";
import type { RunService } from "../runs/service.ts";
import { isName } from "../scope.ts";
import { HACK_LIMITS, isHackRole, type HackDb } from "./contract.ts";
import type { HackCaller, HackErrorCode, HackService, Outcome } from "./service.ts";

/**
 * Hack's routes (CITY-226), on plain `Request` and `Response` so every rule is tested without a server; `server.ts`
 * hands in the real session, store and signature check, and `app/api/arena/hack/[action]` only passes the request on.
 *
 *   GET  /api/arena/hack/orders?status=&protocol=   → { orders }
 *   GET  /api/arena/hack/order?id=                  → { order, takes, findings }
 *   GET  /api/arena/hack/finding?id=                → { finding }
 *   GET  /api/arena/hack/run?order=&hunter=         → { run }   the agent's run on the order, live (CITY-238)
 *   POST /api/arena/hack/open     { order, grant }                         → 201 { order }
 *   POST /api/arena/hack/take     { order, hunter, role }                  → 200 { take, again, run }
 *   POST /api/arena/hack/submit   { id?, order, hunter, target, vulnClass, severity, title, logHash? } → 201 { finding, outcome }
 *   POST /api/arena/hack/move     { order, move: pause | resume | close | settle }                → 200 { order }
 *   POST /api/arena/hack/confirm  { finding, verdict: confirm | reject }   → 200 { finding }
 *
 * Closed (404) until `NEXT_PUBLIC_RYNTRA_CITY_HACK` says `open`, and in production only on the shared database
 * (`ready.ts`). A write comes from this site only, carries an `Idempotency-Key` (a retried write gets the same answer
 * and is done once), needs a wallet that signed in, and is counted for its network an hour and for its wallet an hour
 * (the day's limits per wallet and per agent are the store's, under its lock). A store that cannot be reached is a 503
 * that did nothing, never a 500.
 *
 * A take starts the agent's run (CITY-238, `../runs/service.ts`): once the take is written, the server launches the
 * agent on the machine with no network and answers at once — `run.started`, or why not. The run's own route serves its
 * journal as the viewer may see it: the agent's owner and the protocol's owner all of it, anyone else only how each
 * step came out.
 */

/** The wallet behind a request. A write reads only a wallet that signed in itself; a read may also see a linked one. */
export type CallerRead = { status: "ok"; caller: HackCaller } | { status: "absent" } | { status: "unavailable" };

export type HackApiDeps = {
  service: () => HackService;
  open: () => boolean;
  caller: (req: Request, mode: "read" | "write") => Promise<CallerRead>;
  /** The network a write is counted for, as a keyed hash the store may keep (`ip:<hash>`): never an address. */
  network: (req: Request) => string;
  store: Pick<HackDb, "answer" | "keepAnswer" | "hit">;
  /**
   * The agents' runs (`../runs/service.ts`). Absent — no run is launched and the run's route answers «none»: the
   * window then follows the agent through the order's own record.
   */
  runs?: () => Pick<RunService, "launch" | "feed">;
  limits?: typeof HACK_LIMITS;
  now?: () => number;
};

const JSON_TYPE = { "content-type": "application/json; charset=utf-8" };
const MAX_BODY_BYTES = 16_384;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_:.-]{8,128}$/;

type Answer = { status: number; body: unknown; headers?: Record<string, string> };
type Kept = Answer & { hash: string };

export const STATUS_OF: Record<HackErrorCode, number> = {
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  NOT_YOURS: 403,
  NOT_YOUR_AGENT: 403,
  SELF_AUDIT: 403,
  NOT_TAKEN: 403,
  SIGN_IN: 401,
  BAD_ORDER: 422,
  BAD_FINDING: 422,
  NO_PERMISSION: 422,
  NO_RUN: 422,
  AGENT_OFF: 409,
  WINDOW: 409,
  EXISTS: 409,
  CLOSED: 409,
  BOTH_SIDES: 409,
  HUNTER_TAKEN: 409,
  BAD_MOVE: 409,
  UNRESOLVED: 409,
  SETTLED: 409,
  NOT_PENDING: 409,
  RATE_LIMITED: 429,
};

const failure = (status: number, code: string, message: string, headers?: Record<string, string>): Answer => ({ status, body: { error: { code, message } }, headers });
const closed = failure(404, "CLOSED", "Hack is not open yet.");
const unavailable = failure(503, "UNAVAILABLE", "Hack could not be reached. Nothing was done.");

const respond = (answer: Answer): Response =>
  new Response(JSON.stringify(answer.body), { status: answer.status, headers: { ...JSON_TYPE, ...privateNoStoreHeaders(), ...(answer.headers ?? {}) } });

/** The store failed: a 503 that names nothing inside, and one log line. */
function down(error: unknown): Response {
  console.error("[hack] route failed", error instanceof Error ? `${error.name}: ${error.message.slice(0, 200)}` : "unknown");
  return respond(unavailable);
}

function answerOf<T>(outcome: Outcome<T>, success: number): Answer {
  return outcome.ok ? { status: success, body: outcome.value } : failure(STATUS_OF[outcome.code], outcome.code, outcome.message);
}

type WriteAction = "open" | "take" | "submit" | "move" | "confirm";

export function createHackApi(deps: HackApiDeps) {
  const now = deps.now ?? Date.now;
  const limits = deps.limits ?? HACK_LIMITS;

  async function viewer(req: Request): Promise<string | null> {
    const read = await deps.caller(req, "read").catch((): CallerRead => ({ status: "absent" }));
    return read.status === "ok" ? read.caller.wallet : null;
  }

  async function read(req: Request, run: (url: URL) => Promise<Response>): Promise<Response> {
    if (!deps.open()) return respond(closed);
    try {
      return await run(new URL(req.url));
    } catch (error) {
      return down(error);
    }
  }

  /**
   * Every write the same way: the switch, the site, the key, the size, the wallet, the network's and the wallet's
   * hour, then the kept answer to the key — or the action, whose answer is kept for the key unless it failed inside.
   */
  async function write(req: Request, action: WriteAction, run: (caller: HackCaller, body: Record<string, unknown>) => Promise<Answer>): Promise<Response> {
    if (!deps.open()) return respond(closed);
    if (!mutationOriginAllowed(req.url, req.headers.get("origin"), req.headers.get("sec-fetch-site"))) return respond(failure(403, "FORBIDDEN", "Hack takes writes from this site only."));
    const key = req.headers.get("idempotency-key");
    if (!key || !IDEMPOTENCY_KEY.test(key)) return respond(failure(400, "IDEMPOTENCY_KEY_REQUIRED", "Every write carries an Idempotency-Key of 8 to 128 letters, digits or _:.-"));
    const text = await req.text();
    if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) return respond(failure(413, "PAYLOAD_TOO_LARGE", "The request is too large."));
    let body: Record<string, unknown>;
    try {
      const raw = JSON.parse(text) as unknown;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("shape");
      body = raw as Record<string, unknown>;
    } catch {
      return respond(failure(400, "BAD_REQUEST", "The body is a JSON object."));
    }

    try {
      const at = now();
      const network = await deps.store.hit(deps.network(req), limits.writesPerHour, at);
      if (!network.allowed) return respond(failure(429, "RATE_LIMITED", "Too many writes from this network. Try again later.", { "retry-after": String(network.retryAfterS) }));

      const read = await deps.caller(req, "write");
      if (read.status === "unavailable") return respond(unavailable);
      if (read.status !== "ok") return respond(failure(401, "SIGN_IN", "Sign in with your wallet first."));
      const { caller } = read;

      const kept = `w:${caller.wallet}:${action}:${key}`;
      const hash = createHash("sha256").update(`${action}\n${text}`).digest("hex");
      const stored = (await deps.store.answer(kept, at)) as Kept | null;
      if (stored) {
        if (stored.hash !== hash) return respond(failure(422, "IDEMPOTENCY_KEY_REUSED", "This Idempotency-Key was used for another request."));
        return respond({ status: stored.status, body: stored.body, headers: { "idempotent-replayed": "true" } });
      }

      const wallet = await deps.store.hit(`w:${caller.wallet}`, limits.walletWritesPerHour, at);
      if (!wallet.allowed) return respond(failure(429, "RATE_LIMITED", "Too many writes from this wallet. Try again later.", { "retry-after": String(wallet.retryAfterS) }));

      /* A finding with no id of its own takes one from the wallet and the key: two copies of one request sent at once
         name the same finding, and the store files it once (review 9.11). */
      if (action === "submit" && body.id === undefined) body = { ...body, id: `f-${createHash("sha256").update(kept).digest("hex").slice(0, 40)}` };
      const answer = await run(caller, body);
      // A limit's answer is not kept: the same request may pass once the limit has room.
      if (answer.status < 500 && answer.status !== 429) await deps.store.keepAnswer(kept, { status: answer.status, body: answer.body, hash } satisfies Kept, now());
      return respond(answer);
    } catch (error) {
      return down(error);
    }
  }

  return {
    orders: (req: Request) =>
      read(req, async (url) => {
        const status = url.searchParams.get("status") ?? undefined;
        const protocol = url.searchParams.get("protocol") ?? undefined;
        const listed = await deps.service().orders({ status, protocol });
        return respond(listed.ok ? { status: 200, body: { orders: listed.value } } : answerOf(listed, 200));
      }),

    order: (req: Request) =>
      read(req, async (url) => respond(answerOf(await deps.service().order(url.searchParams.get("id"), await viewer(req)), 200))),

    finding: (req: Request) =>
      read(req, async (url) => respond(answerOf(await deps.service().finding(url.searchParams.get("id"), await viewer(req)), 200))),

    open: (req: Request) =>
      write(req, "open", async (caller, body) => answerOf(await deps.service().open(caller, { order: body.order, grant: body.grant }), 201)),

    /** The agent's run on the order, as the viewer may see it; `null` when it has none. */
    run: (req: Request) =>
      read(req, async (url) => {
        const order = url.searchParams.get("order");
        const hunter = url.searchParams.get("hunter");
        if (!isOrderId(order) || !isName(hunter)) return respond(failure(400, "BAD_REQUEST", "`order` names an order and `hunter` an agent."));
        if (!deps.runs) return respond({ status: 200, body: { run: null } });
        const who = await viewer(req);
        const detail = await deps.service().order(order, who);
        if (!detail.ok) return respond(answerOf(detail, 200));
        return respond({ status: 200, body: { run: await deps.runs().feed(order, hunter, who, detail.value.order.protocol) } });
      }),

    take: (req: Request) =>
      write(req, "take", async (caller, body) => {
        const taken = await deps.service().take(caller, { order: body.order, hunter: body.hunter, role: body.role });
        if (!taken.ok || !deps.runs) return answerOf(taken, 200);
        // The take is written: the agent goes to work. Whatever keeps it from starting, the take stands.
        const take = { ...taken.value.take, order: body.order as string };
        const launched = isHackRole(take.role)
          ? await deps
              .runs()
              .launch(take)
              .catch((error: unknown) => {
                console.error("[hack] run not launched", error instanceof Error ? `${error.name}: ${error.message.slice(0, 200)}` : "unknown");
                return { ok: false as const, reason: "UNAVAILABLE" as const };
              })
          : { ok: false as const, reason: "NO_RUN_FOR_ROLE" as const };
        return { status: 200, body: { ...taken.value, run: launched.ok ? { started: true } : { started: false, reason: launched.reason } } };
      }),

    submit: (req: Request) =>
      write(req, "submit", async (caller, body) =>
        answerOf(
          await deps.service().submit(caller, {
            id: body.id,
            order: body.order,
            hunter: body.hunter,
            target: body.target,
            vulnClass: body.vulnClass,
            severity: body.severity,
            title: body.title,
            logHash: body.logHash,
          }),
          201,
        ),
      ),

    move: (req: Request) => write(req, "move", async (caller, body) => answerOf(await deps.service().move(caller, { order: body.order, move: body.move }), 200)),

    confirm: (req: Request) =>
      write(req, "confirm", async (caller, body) => answerOf(await deps.service().resolve(caller, { finding: body.finding, verdict: body.verdict }), 200)),
  };
}

export type HackApi = ReturnType<typeof createHackApi>;
