import { createHash } from "node:crypto";

import { judgeStep, type NotPaid, type RequestStep } from "../city-economy/points";
import { FixedWindowLimiter, clientIp, privateNoStoreHeaders, rateLimitHeaders, type RateLimitDecision } from "../http-control";
import { mutationOriginAllowed } from "../security";
import { DISTRICTS, type Building, type ChainLink, type District, type PointsReason, type PublicBuilding, type Resident, type WorldErrorCode } from "./contract";
import { awayReport, mineOf, NO_CONSENT } from "./away";
import { POINTS } from "./catalog";
import { guestCookieHeader, guestKey, guestKeyMatches, guestResidentId, hashedAddress, newGuestSalt, readCookie, GUEST_COOKIE } from "./guest";
import { checkLinkShape, dayOf, goalOf, isId, ownerBuilding, parseLink, planBuild, storedLink, tasksOfDay, type Refusal } from "./rules";
import { WorldStoreUnavailable, type Progress, type WorldStore } from "./store";
import { cleanResidentName } from "./text-safety/clean";

type PublicBuildingList = readonly PublicBuilding[];

/**
 * The routes of `/api/world`, written against plain `Request` and `Response`
 * so that every rule can be tested without a server. `server.ts` gives them
 * the real store, the account session and the engine's reads; the files in
 * `app/api/world/**` only hand the request over.
 *
 * Who is asking, in order: the account session (after a wallet sign-in), then
 * the guest key in the `rwg` cookie. When both are there, the guest joins the
 * account and the cookie is cleared; the quarter and the points go along.
 *
 * Every write: same site only, limited per address and per resident, carries
 * an `Idempotency-Key` (the same key gives back the same answer), and writes
 * only at the version of the quarter the person saw (409 with the quarter as
 * it is now otherwise). A closed slot, building, module or level is a 422
 * that says what opens it.
 */

export type AccountRead = { status: "ok"; accountId: string } | { status: "absent" } | { status: "unavailable" };
export type WalletRead = { status: "ok"; address: string } | { status: "absent" } | { status: "unavailable" };
export type LinkVerdict = "owned" | "not_owned" | "unverifiable" | "unavailable";
export type LinkVerifyInput = { link: ChainLink; accountId: string | null; wallet: string };

export type WorldDeps = {
  store: WorldStore;
  /** The server's signing secret, for guest keys and hashed addresses. */
  secret: () => string | null;
  /** The account signed in on this request, if any. */
  account: (req: Request) => Promise<AccountRead>;
  /** A wallet this request proved by its own signature (a linked wallet alone does not count). */
  wallet: (req: Request) => Promise<WalletRead>;
  /** Whether the engine object is the caller's. */
  verifyLink: (input: LinkVerifyInput) => Promise<LinkVerdict>;
  now?: () => Date;
  limiter?: WorldLimiter;
};

/** What `award` did with a step: paid it, had paid it before, refused it by the economy's rules, or could not ask. */
export type StepAward =
  | { status: "awarded"; reason: PointsReason; points: number; total: number }
  | { status: "already"; reason: PointsReason; total: number }
  | { status: "refused"; why: NotPaid }
  | { status: "no_resident" }
  | { status: "unavailable" };

/* ---------------------------------------------------------------- limits -- */

export type RouteName = "claim" | "me" | "quarter" | "district" | "build" | "link" | "away" | "consent" | "visit" | "version";

/** Requests a minute, per address and per resident, in each server instance. */
export const LIMITS: Readonly<Record<RouteName, Readonly<{ ip: number; device: number | null }>>> = {
  claim: { ip: 10, device: 5 },
  me: { ip: 120, device: 60 },
  quarter: { ip: 240, device: null },
  district: { ip: 120, device: null },
  build: { ip: 120, device: 60 },
  link: { ip: 60, device: 20 },
  away: { ip: 60, device: 30 },
  consent: { ip: 60, device: 20 },
  visit: { ip: 240, device: 120 },
  version: { ip: 240, device: null },
};

/** New guests from one address in an hour, counted in the database across every instance. */
export const NEW_GUESTS_PER_HOUR = 20;

export class WorldLimiter {
  private readonly limiters = new Map<string, FixedWindowLimiter>();

  consume(route: RouteName, kind: "ip" | "device", key: string, now?: () => number): RateLimitDecision | null {
    const limit = LIMITS[route][kind];
    if (limit === null) return null;
    const name = `${route}:${kind}`;
    let limiter = this.limiters.get(name);
    if (!limiter) {
      limiter = new FixedWindowLimiter({ limit, windowMs: 60_000, maxKeys: 10_000, ...(now ? { now } : {}) });
      this.limiters.set(name, limiter);
    }
    return limiter.consume(key);
  }
}

/* --------------------------------------------------------------- answers -- */

const JSON_TYPE = { "content-type": "application/json; charset=utf-8" };
const MAX_BODY_BYTES = 4_096;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_:.-]{8,128}$/;
/** Besides the home quarter, how many more of my quarters the away report reads to know what is mine. */
const MAX_OTHER_QUARTERS = 8;

type Answer = { status: number; body: unknown; headers?: Record<string, string>; cookie?: string | null };

function respond(answer: Answer, base: Record<string, string>, requestUrl: string, clearGuest = false): Response {
  const headers = new Headers({ ...JSON_TYPE, ...base, ...(answer.headers ?? {}) });
  if (answer.cookie !== undefined) headers.append("set-cookie", guestCookieHeader(answer.cookie, requestUrl));
  else if (clearGuest) headers.append("set-cookie", guestCookieHeader(null, requestUrl));
  return new Response(JSON.stringify(answer.body), { status: answer.status, headers });
}

function failure(status: number, code: WorldErrorCode, message: string, extra: Record<string, unknown> = {}, more: Record<string, unknown> = {}): Answer {
  return { status, body: { error: { code, message, ...extra }, ...more } };
}

function refusalAnswer(refusal: Refusal): Answer {
  const { status, code, message, ...rest } = refusal;
  return failure(status, code, message, rest);
}

function limited(decision: RateLimitDecision | null): Answer | null {
  if (!decision || decision.allowed) return null;
  return { ...failure(429, "RATE_LIMITED", "Too many requests; try again shortly."), headers: rateLimitHeaders(decision) };
}

const unavailable = (): Answer => failure(503, "UNAVAILABLE", "The world could not be reached; nothing was changed.");

/** Object keys in one order, so the same request always hashes the same. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

async function readJson(req: Request): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; answer: Answer }> {
  const text = await req.text();
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) return { ok: false, answer: failure(413, "PAYLOAD_TOO_LARGE", "The request is too large.") };
  if (text.trim() === "") return { ok: true, body: {} };
  try {
    const body = JSON.parse(text) as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, answer: failure(400, "BAD_REQUEST", "The body is a JSON object.") };
    return { ok: true, body: body as Record<string, unknown> };
  } catch {
    return { ok: false, answer: failure(400, "BAD_REQUEST", "The body is not JSON.") };
  }
}

const isInt = (value: unknown, min: number, max: number): value is number => typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;

/* -------------------------------------------------------------- identity -- */

type Who = {
  accountId: string | null;
  resident: Resident | null;
  /** The guest cookie should be cleared: it joined the account, or it names nobody. */
  clearGuest: boolean;
};

export function createWorldApi(deps: WorldDeps) {
  const now = deps.now ?? (() => new Date());
  const limiter = deps.limiter ?? new WorldLimiter();
  const clock = () => now().getTime();

  /**
   * Who is asking. A signed-in account with a guest key in the same browser
   * is the moment the guest joins the account; it happens once, and the key
   * stops working the same instant.
   */
  async function identify(req: Request): Promise<Who> {
    const account = await deps.account(req);
    if (account.status === "unavailable") throw new WorldStoreUnavailable("session store unavailable");
    const cookie = readCookie(req.headers.get("cookie"), GUEST_COOKIE);
    const guestId = guestResidentId(cookie);
    let guest: Resident | null = null;
    if (cookie && guestId) {
      const stored = await deps.store.resident({ id: guestId });
      if (stored && guestKeyMatches(cookie, stored, deps.secret())) {
        const { guestSalt: _salt, ...resident } = stored;
        guest = resident;
      }
    }
    if (account.status === "ok") {
      if (guest) {
        const merged = await deps.store.mergeGuest({ guestId: guest.id, accountId: account.accountId, now: now() });
        if (!merged.ok) throw new WorldStoreUnavailable("the account behind the session is missing");
        return { accountId: account.accountId, resident: merged.resident, clearGuest: true };
      }
      const stored = await deps.store.resident({ accountId: account.accountId });
      const resident = stored ? (({ guestSalt: _salt, ...rest }) => rest)(stored) : null;
      return { accountId: account.accountId, resident, clearGuest: cookie !== null };
    }
    return { accountId: null, resident: guest, clearGuest: cookie !== null && guest === null };
  }

  const noResident = () => failure(401, "NO_RESIDENT", "Claim your place first.");

  /** The parts of a read every route shares: the address limit and a store that may blink. */
  async function read(req: Request, route: RouteName, base: Record<string, string>, run: () => Promise<Answer & { clearGuest?: boolean }>): Promise<Response> {
    const capped = limited(limiter.consume(route, "ip", clientIp(req.headers), clock));
    if (capped) return respond(capped, privateNoStoreHeaders(), req.url);
    try {
      const answer = await run();
      return respond(answer, answer.status === 200 ? base : privateNoStoreHeaders(), req.url, answer.clearGuest);
    } catch (error) {
      if (error instanceof WorldStoreUnavailable) return respond(unavailable(), privateNoStoreHeaders(), req.url);
      throw error;
    }
  }

  /**
   * The parts of a write every route shares, in this order: same site, the
   * address limit, the key, the body, who is asking, the resident limit, and
   * the stored answer of the key. `run` returns the answer; a 5xx is never
   * kept, so a retry runs again.
   */
  async function write(
    req: Request,
    route: RouteName,
    run: (ctx: { body: Record<string, unknown>; who: Who }) => Promise<Answer>,
    options: { scope?: (who: Who) => string | null; replay?: (body: unknown) => Promise<Answer["cookie"]> } = {},
  ): Promise<Response> {
    const base = privateNoStoreHeaders();
    if (!mutationOriginAllowed(req.url, req.headers.get("origin"), req.headers.get("sec-fetch-site"))) {
      return respond(failure(403, "FORBIDDEN", "Writes come from this site only."), base, req.url);
    }
    const ip = clientIp(req.headers);
    const capped = limited(limiter.consume(route, "ip", ip, clock));
    if (capped) return respond(capped, base, req.url);
    const key = req.headers.get("idempotency-key");
    if (!key || !IDEMPOTENCY_KEY.test(key)) {
      return respond(failure(400, "IDEMPOTENCY_KEY_REQUIRED", "Every write carries an Idempotency-Key of 8 to 128 letters, digits or _:.-"), base, req.url);
    }
    const parsed = await readJson(req);
    if (!parsed.ok) return respond(parsed.answer, base, req.url);

    let who: Who;
    try {
      who = await identify(req);
    } catch (error) {
      if (error instanceof WorldStoreUnavailable) return respond(unavailable(), base, req.url);
      throw error;
    }
    const device = who.resident?.id ?? who.accountId;
    if (device) {
      const deviceCap = limited(limiter.consume(route, "device", device, clock));
      if (deviceCap) return respond(deviceCap, base, req.url, who.clearGuest);
    }
    const scope = options.scope ? options.scope(who) : who.resident ? `r:${who.resident.id}` : null;
    if (!scope) return respond(who.accountId || route !== "claim" ? noResident() : unavailable(), base, req.url, who.clearGuest);

    const ref = { scope, route, key };
    const hash = createHash("sha256").update(`${route}\n${canonical(parsed.body)}`).digest("hex");
    try {
      const gate = await deps.store.requestBegin({ ...ref, hash, now: now() });
      if (gate.state === "mismatch") return respond(failure(422, "IDEMPOTENCY_KEY_REUSED", "This Idempotency-Key was used for another request."), base, req.url, who.clearGuest);
      if (gate.state === "pending") return respond(failure(409, "REQUEST_IN_PROGRESS", "The same request is still running."), base, req.url, who.clearGuest);
      if (gate.state === "replay") {
        const cookie = options.replay ? await options.replay(gate.body) : undefined;
        return respond({ status: gate.status, body: gate.body, headers: { "idempotent-replayed": "true" }, cookie }, base, req.url, who.clearGuest);
      }
    } catch (error) {
      if (error instanceof WorldStoreUnavailable) return respond(unavailable(), base, req.url, who.clearGuest);
      throw error;
    }

    let answer: Answer;
    try {
      answer = await run({ body: parsed.body, who });
    } catch (error) {
      await deps.store.requestAbandon(ref).catch(() => undefined);
      if (error instanceof WorldStoreUnavailable) return respond(unavailable(), base, req.url, who.clearGuest);
      throw error;
    }
    try {
      if (answer.status >= 500) await deps.store.requestAbandon(ref);
      else await deps.store.requestFinish({ ...ref, status: answer.status, body: answer.body, now: now() });
    } catch {
      /* The change is made; only its stored answer is missing, and a retry of
         the key then runs again against the new version. */
    }
    return respond(answer, base, req.url, who.clearGuest);
  }

  /** The owner's view of a quarter's buildings: the prediction book gets its account back. */
  const mine = (buildings: PublicBuildingList, who: Who): Building[] => buildings.map((b) => ownerBuilding(b, who.resident?.accountId ?? null));

  const conflict = (state: { quarter: unknown; buildings: PublicBuildingList }, who: Who): Answer =>
    failure(409, "VERSION_CONFLICT", "The quarter changed since you saw it.", {}, { quarter: state.quarter, buildings: mine(state.buildings, who) });

  /* --------------------------------------------------------------- routes -- */

  /** POST /api/world/claim — a place on the newcomers' street; the guest key if there is no account. */
  async function claim(req: Request): Promise<Response> {
    const secret = deps.secret();
    const ip = clientIp(req.headers);
    return write(req, "claim", async ({ body, who }) => {
      const name = body.displayName;
      if (name !== undefined && (typeof name !== "string" || !/^[\p{L}\p{N} ._-]{1,32}$/u.test(name.trim()))) {
        return failure(400, "BAD_REQUEST", "A display name is 1 to 32 letters, digits, spaces or ._-");
      }
      /* A name every visitor reads: no disguised word, no order to a model (CITY-73). */
      if (typeof name === "string" && !cleanResidentName(name).ok) return failure(400, "BAD_REQUEST", "Pick another display name.");
      const displayName = typeof name === "string" ? name.trim() : null;
      if (who.resident) {
        const state = await deps.store.quarter(who.resident.homeQuarterId);
        if (!state) throw new WorldStoreUnavailable("home quarter missing");
        return { status: 200, body: { resident: who.resident, quarter: state.quarter, created: false } };
      }
      if (who.accountId) {
        const made = await deps.store.claim({ accountId: who.accountId, guestSalt: null, displayName, now: now() });
        if (!made.ok) throw new WorldStoreUnavailable("the account behind the session is missing");
        return { status: made.created ? 201 : 200, body: { resident: made.resident, quarter: made.quarter, created: made.created } };
      }
      const address = hashedAddress(ip, secret);
      if (!secret || !address) return unavailable();
      const hourly = await deps.store.limitHit({ bucket: `claim:${address}`, windowSeconds: 3600, max: NEW_GUESTS_PER_HOUR, now: now() });
      if (!hourly.allowed) return { ...failure(429, "RATE_LIMITED", "Too many new places from this address; try again later."), headers: { "retry-after": String(hourly.retryAfterSeconds) } };
      const salt = newGuestSalt();
      const made = await deps.store.claim({ accountId: null, guestSalt: salt, displayName, now: now() });
      if (!made.ok) return unavailable();
      return { status: 201, body: { resident: made.resident, quarter: made.quarter, created: true }, cookie: guestKey(made.resident.id, salt, secret) };
    }, {
      scope: (who) => who.resident ? `r:${who.resident.id}` : who.accountId ? `a:${who.accountId}` : (() => {
        const address = hashedAddress(ip, secret);
        return address ? `ip:${address}` : null;
      })(),
      /* A claim retried after its answer was lost gets the same guest key
         back, so the browser ends up holding the place it was given. */
      replay: async (stored) => {
        const residentId = (stored as { resident?: { id?: unknown; accountId?: unknown } } | null)?.resident;
        if (!residentId || typeof residentId.id !== "string" || residentId.accountId !== null) return undefined;
        const resident = await deps.store.resident({ id: residentId.id });
        return resident && resident.accountId === null ? guestKey(resident.id, resident.guestSalt, secret) ?? undefined : undefined;
      },
    });
  }

  /** GET /api/world/me — my resident, home quarter, buildings, points and today's tasks. */
  async function me(req: Request): Promise<Response> {
    return read(req, "me", privateNoStoreHeaders(), async () => {
      const who = await identify(req);
      if (!who.resident) return { ...noResident(), clearGuest: who.clearGuest };
      const capped = limited(limiter.consume("me", "device", who.resident.id, clock));
      if (capped) return { ...capped, clearGuest: who.clearGuest };
      const day = dayOf(now());
      const data = await deps.store.me({ residentId: who.resident.id, day });
      if (!data) return { ...noResident(), clearGuest: true };
      return {
        status: 200,
        clearGuest: who.clearGuest,
        body: { ...data, buildings: mine(data.buildings, who), tasks: tasksOfDay(data.tasks, data.resident.id, day) },
      };
    });
  }

  /** GET /api/world/quarter/:id — a quarter and its buildings, for anyone. */
  async function quarter(req: Request, id: string): Promise<Response> {
    return read(req, "quarter", { "cache-control": "public, max-age=0, s-maxage=10, stale-while-revalidate=30" }, async () => {
      if (!isId(id)) return failure(404, "NOT_FOUND", "No such quarter.");
      const state = await deps.store.quarter(id.toLowerCase());
      if (!state) return failure(404, "NOT_FOUND", "No such quarter.");
      return { status: 200, body: state };
    });
  }

  /** GET /api/world/district/:id?cursor= — the district's quarters, sketched, a page at a time. */
  async function district(req: Request, id: string): Promise<Response> {
    return read(req, "district", { "cache-control": "public, max-age=0, s-maxage=30, stale-while-revalidate=120" }, async () => {
      if (!(DISTRICTS as readonly string[]).includes(id)) return failure(404, "NOT_FOUND", "No such district.");
      const cursor = new URL(req.url).searchParams.get("cursor");
      if (cursor !== null && !isId(cursor)) return failure(400, "BAD_REQUEST", "A cursor is the nextCursor of the page before.");
      const page = await deps.store.district({ district: id as District, after: cursor ? cursor.toLowerCase() : null, limit: 200 });
      return { status: 200, body: { district: id, ...page } };
    });
  }

  /** POST /api/world/build — place or improve a building: { quarterId, slot, kind, modules, version }. */
  async function build(req: Request): Promise<Response> {
    return write(req, "build", async ({ body, who }) => {
      const resident = who.resident!;
      if (!isId(body.quarterId) || !isInt(body.version, 1, 2 ** 31 - 1)) return failure(400, "BAD_REQUEST", "A build names quarterId, slot, kind, modules and version.");
      const state = await deps.store.quarter(body.quarterId.toLowerCase());
      if (!state) return failure(404, "NOT_FOUND", "No such quarter.");
      if (state.quarter.ownerId !== resident.id) return failure(403, "NOT_OWNER", "Only the owner builds here.");
      if (state.quarter.version !== body.version) return conflict(state, who);
      const planned = planBuild({ quarter: state.quarter, buildings: state.buildings, slot: body.slot, kind: body.kind, modules: body.modules });
      if (!planned.ok) return refusalAnswer(planned.refusal);
      const plan = planned.plan;
      const day = dayOf(now());
      const progress: Progress[] = plan.progress.flatMap((p) => {
        const goal = goalOf(p.kind);
        return goal === null ? [] : [{ kind: p.kind, delta: p.delta, goal }];
      });
      const done = await deps.store.commitBuild({
        residentId: resident.id, quarterId: state.quarter.id, version: body.version, slot: plan.slot, kind: plan.kind,
        level: plan.level, modules: plan.modules, day, progress, taskPoints: POINTS.task_done, now: now(),
      });
      if (!done.ok) {
        if (done.error === "version") return conflict(done, who);
        if (done.error === "not_found") return failure(404, "NOT_FOUND", "No such quarter.");
        if (done.error === "not_owner") return failure(403, "NOT_OWNER", "Only the owner builds here.");
        return failure(422, "LOCKED", "A building that shows an engine object keeps its kind.", { reason: "linked" });
      }
      return {
        status: 200,
        body: { quarter: done.quarter, building: ownerBuilding(done.building, resident.accountId), tasks: tasksOfDay(done.tasks, resident.id, day), points: { total: done.pointsTotal } },
      };
    });
  }

  /** POST /api/world/link — show an engine object on a building: { quarterId, slot, link, version }; link null takes it off. */
  async function link(req: Request): Promise<Response> {
    return write(req, "link", async ({ body, who }) => {
      const resident = who.resident!;
      const wanted = body.link === null ? null : parseLink(body.link);
      if (!isId(body.quarterId) || !isInt(body.slot, 0, 63) || !isInt(body.version, 1, 2 ** 31 - 1) || (body.link !== null && !wanted)) {
        return failure(400, "BAD_REQUEST", "A link names quarterId, slot, version and link (an engine object, or null).");
      }
      const wallet = await deps.wallet(req);
      if (wallet.status === "unavailable") return unavailable();
      if (wallet.status !== "ok") return failure(401, "WALLET_REQUIRED", "Sign in with your wallet to link what is yours.");
      const state = await deps.store.quarter(body.quarterId.toLowerCase());
      if (!state) return failure(404, "NOT_FOUND", "No such quarter.");
      if (state.quarter.ownerId !== resident.id) return failure(403, "NOT_OWNER", "Only the owner links here.");
      if (state.quarter.version !== body.version) return conflict(state, who);
      const building = state.buildings.find((b) => b.slot === body.slot);
      if (!building) return failure(404, "NOT_FOUND", "There is no building in this slot.");
      if (wanted) {
        const shape = checkLinkShape({ kind: building.kind, link: wanted, accountId: resident.accountId });
        if (!shape.ok) return failure(422, "LINK_REFUSED", "This object cannot be shown on this building.", { reason: shape.reason });
        const verdict = await deps.verifyLink({ link: wanted, accountId: resident.accountId, wallet: wallet.address });
        if (verdict === "unavailable") return unavailable();
        if (verdict === "not_owned") return failure(422, "LINK_REFUSED", "This object is not yours.", { reason: "not_yours" });
        if (verdict === "unverifiable") return failure(422, "LINK_REFUSED", "This object cannot be checked yet.", { reason: "unverifiable" });
      }
      const done = await deps.store.commitLink({ residentId: resident.id, quarterId: state.quarter.id, version: body.version, slot: body.slot, link: storedLink(wanted), now: now() });
      if (!done.ok) {
        if (done.error === "version") return conflict(done, who);
        if (done.error === "link_taken") return failure(409, "LINK_TAKEN", "Another building already shows this object.");
        if (done.error === "not_owner") return failure(403, "NOT_OWNER", "Only the owner links here.");
        return failure(404, "NOT_FOUND", done.error === "no_building" ? "There is no building in this slot." : "No such quarter.");
      }
      return { status: 200, body: { quarter: done.quarter, building: ownerBuilding(done.building, resident.accountId) } };
    });
  }

  /** GET /api/world/away?since= — what happened while I was away, newest first. */
  async function away(req: Request): Promise<Response> {
    return read(req, "away", privateNoStoreHeaders(), async () => {
      const who = await identify(req);
      if (!who.resident) return { ...noResident(), clearGuest: who.clearGuest };
      const capped = limited(limiter.consume("away", "device", who.resident.id, clock));
      if (capped) return { ...capped, clearGuest: who.clearGuest };
      const until = now();
      const raw = new URL(req.url).searchParams.get("since");
      const asked = raw === null ? until.getTime() - 86_400_000 : Date.parse(raw);
      if (!Number.isFinite(asked)) return failure(400, "BAD_REQUEST", "since is an ISO time.");
      const since = new Date(Math.min(until.getTime(), Math.max(asked, until.getTime() - 7 * 86_400_000)));
      const events = await deps.store.away({ residentId: who.resident.id, since, until, limit: 100 });
      if (events === null) return { ...noResident(), clearGuest: true };
      // What is mine: every quarter I own and what its buildings show, so the report can say which lines are about me.
      const data = await deps.store.me({ residentId: who.resident.id, day: dayOf(until) });
      if (!data) return { ...noResident(), clearGuest: true };
      const others = await Promise.all(data.quarters.filter((q) => q.id !== data.quarter.id).slice(0, MAX_OTHER_QUARTERS).map((q) => deps.store.quarter(q.id)));
      const mine = mineOf([{ quarter: data.quarter, buildings: data.buildings }, ...others.filter((q) => q !== null)]);
      return { status: 200, clearGuest: who.clearGuest, body: { since: since.toISOString(), until: until.toISOString(), events, report: awayReport(events, mine) } };
    });
  }

  /** GET /api/world/consent — the channels «While you were away» may also reach; all off until the person chooses. */
  async function consent(req: Request): Promise<Response> {
    return read(req, "consent", privateNoStoreHeaders(), async () => {
      const who = await identify(req);
      if (!who.resident) return { ...noResident(), clearGuest: who.clearGuest };
      const capped = limited(limiter.consume("consent", "device", who.resident.id, clock));
      if (capped) return { ...capped, clearGuest: who.clearGuest };
      const found = await deps.store.consent(who.resident.id);
      if (!found) return { ...noResident(), clearGuest: true };
      return { status: 200, clearGuest: who.clearGuest, body: { consent: who.resident.accountId ? found : NO_CONSENT, canConsent: who.resident.accountId !== null } };
    });
  }

  /**
   * POST /api/world/consent — { telegram?, push? }: the person turns a channel on or off. Consent is kept under a
   * Ryntra account; a guest is asked to sign in with a wallet. Nothing is sent from here.
   */
  async function setConsent(req: Request): Promise<Response> {
    return write(req, "consent", async ({ body, who }) => {
      const resident = who.resident!;
      const keys = Object.keys(body);
      const flag = (value: unknown) => value === undefined || typeof value === "boolean";
      if (keys.length === 0 || keys.some((k) => k !== "telegram" && k !== "push") || !flag(body.telegram) || !flag(body.push)) {
        return failure(400, "BAD_REQUEST", "Consent names telegram or push, each true or false.");
      }
      if (resident.accountId === null) return failure(401, "WALLET_REQUIRED", "Sign in with your wallet to choose where the report reaches you.");
      const done = await deps.store.setConsent({
        residentId: resident.id,
        telegram: typeof body.telegram === "boolean" ? body.telegram : null,
        push: typeof body.push === "boolean" ? body.push : null,
        now: now(),
      });
      if (!done.ok) return done.error === "account_required" ? failure(401, "WALLET_REQUIRED", "Sign in with your wallet to choose where the report reaches you.") : noResident();
      return { status: 200, body: { consent: done.consent, canConsent: true } };
    });
  }

  /** POST /api/world/visit — a visit to a quarter: { quarterId }; counted once a day. */
  async function visit(req: Request): Promise<Response> {
    return write(req, "visit", async ({ body, who }) => {
      const resident = who.resident!;
      if (!isId(body.quarterId)) return failure(400, "BAD_REQUEST", "A visit names quarterId.");
      const goal = goalOf("visit_quarters");
      const done = await deps.store.visit({
        visitorId: resident.id, quarterId: body.quarterId.toLowerCase(), day: dayOf(now()),
        /* A visitor counts as a checked person when they signed in with a wallet; a guest does not. */
        verifiedHuman: resident.accountId !== null,
        progress: goal === null ? null : { kind: "visit_quarters", delta: 1, goal },
        taskPoints: POINTS.task_done, now: now(),
      });
      if (!done.ok) return failure(404, "NOT_FOUND", "No such quarter.");
      return { status: 200, body: { visit: done.visit, counted: done.counted, reason: done.reason } };
    });
  }

  /** GET /api/world/version/:id — a frozen city, for a challenge on the exact world. */
  async function version(req: Request, id: string): Promise<Response> {
    return read(req, "version", { "cache-control": "public, max-age=3600, s-maxage=86400, immutable" }, async () => {
      if (!isId(id)) return failure(404, "NOT_FOUND", "No such world.");
      const found = await deps.store.version(id.toLowerCase());
      return found ? { status: 200, body: found } : failure(404, "NOT_FOUND", "No such world.");
    });
  }

  /**
   * Points for a step that happened in this request somewhere else on the server — a free vault cracked — for the
   * person behind it, found the way the routes find them: the account session, then the guest key. Not a route. The
   * economy's rules (`lib/city-economy/points.ts`) name the reason, the points and the key from the step itself and
   * the world's own day; nothing the report says about points, keys or days is read. A paid entry pays nothing.
   */
  async function award(req: Request, step: RequestStep): Promise<StepAward> {
    const verdict = judgeStep(step, dayOf(now()));
    if (!verdict.paid) return { status: "refused", why: verdict.why };
    const { reason, points, sourceRef, key } = verdict.award;
    try {
      const who = await identify(req);
      if (!who.resident) return { status: "no_resident" };
      const done = await deps.store.award({ residentId: who.resident.id, reason, delta: points, sourceRef, key, now: now() });
      if (!done.ok) return { status: "no_resident" };
      return done.awarded ? { status: "awarded", reason, points, total: done.total } : { status: "already", reason, total: done.total };
    } catch (error) {
      if (error instanceof WorldStoreUnavailable) return { status: "unavailable" };
      throw error;
    }
  }

  return { claim, me, quarter, district, build, link, away, consent, setConsent, visit, version, award };
}

export type WorldApi = ReturnType<typeof createWorldApi>;
