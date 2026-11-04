import { createHash, randomBytes } from "node:crypto";

import { FixedWindowLimiter, clientIp, privateNoStoreHeaders, rateLimitHeaders, type RateLimitDecision } from "../http-control";
import { mutationOriginAllowed } from "../security";
import type { AccountRead } from "./api";
import type { CrewMember, CrewRefusal, CrewStreet, MyCrew, Resident, WorldErrorCode } from "./contract";
import { CREW_LIMIT, crewName, crewScore, hqOf, inviteCode, isCrewColour, normalInvite, planGift, shownCrewName, weekOf } from "./crew";
import type { CrewStore, CrewStreetRead, MyCrewRead } from "./crew-store";
import { guestCookieHeader, guestKeyMatches, guestResidentId, readCookie, GUEST_COOKIE } from "./guest";
import { dayOf } from "./rules";
import { WorldStoreUnavailable, type WorldStore } from "./store";
import { shownText } from "./text-safety/clean";

/**
 * The routes of crews (CITY-20), written against plain `Request` and `Response` like the world's own (`api.ts`), with
 * the same guarantees: same site only, limited per address and per resident, an `Idempotency-Key` on every write.
 *
 *   GET  /api/world/crew                my crew: its street, people, invite, headquarters, score; null when none
 *   GET  /api/world/crews               every crew street, for the terrace
 *   GET  /api/world/crew/invite/:code   the street behind an invite, before joining
 *   POST /api/world/crew                { name, colour } — a new crew, my quarter on its street
 *   POST /api/world/crew/join           { code } — my quarter into the crew's row
 *   POST /api/world/crew/leave          {} — my quarter back on a newcomers' street, one tap
 *   POST /api/world/crew/gift           { kind: "module", module } | { kind: "points", points }
 *
 * An invite is a code and a link; it carries no wallet and asks for none. Nothing here pays points or touches money.
 */

export type CrewDeps = {
  world: WorldStore;
  crews: CrewStore;
  secret: () => string | null;
  account: (req: Request) => Promise<AccountRead>;
  now?: () => Date;
  /** Random bytes for invite codes. */
  random?: (n: number) => Uint8Array;
};

/** Requests a minute in each server instance, per address and per resident. */
export const CREW_LIMITS = {
  mine: { ip: 120, device: 60 },
  streets: { ip: 240, device: null },
  // An invite is looked up by its code: few a minute, so codes cannot be walked.
  invite: { ip: 20, device: null },
  write: { ip: 60, device: 20 },
} as const;
/** Crew writes a resident may make in a day, counted in the database across every instance. */
export const CREW_WRITES_PER_DAY = 200;

const MAX_BODY_BYTES = 1_024;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_:.-]{8,128}$/;
const JSON_TYPE = { "content-type": "application/json; charset=utf-8" };

type Answer = { status: number; body: unknown; headers?: Record<string, string> };
type Who = { resident: Resident | null; clearGuest: boolean };
type Route = "create" | "join" | "leave" | "gift";

const failure = (status: number, code: WorldErrorCode, message: string, extra: Record<string, unknown> = {}): Answer => ({
  status,
  body: { error: { code, message, ...extra } },
});
const unavailable = () => failure(503, "UNAVAILABLE", "The world could not be reached; nothing was changed.");
const noResident = () => failure(401, "NO_RESIDENT", "Claim your place first.");

const REFUSAL_LINES: Record<CrewRefusal, string> = {
  name: "This name cannot be shown.",
  full: "This crew is full.",
  in_crew: "You are in a crew already.",
  not_in_crew: "You are in no crew.",
  today: "Given today already; come back tomorrow.",
  points: "Not that many points left to give.",
  module: "Your quarter's level does not open this module yet.",
};
const refused = (reason: CrewRefusal): Answer => failure(422, "CREW_REFUSED", REFUSAL_LINES[reason], { reason });

/** Object keys in one order, so the same write always hashes the same. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** A crew street as anyone reads it; the name is cleaned again on its way out. */
export function streetView(read: CrewStreetRead): CrewStreet {
  return {
    id: read.crew.id,
    name: shownCrewName(read.crew.name),
    colour: read.crew.colour,
    street: read.crew.street,
    row: read.crew.row,
    members: read.members,
    limit: CREW_LIMIT,
    hq: hqOf(read.units, read.given),
  };
}

/** My crew as a member reads it, with the week's score counted from what its people did. */
export function myCrewView(read: MyCrewRead, now: Date): MyCrew {
  const people: CrewMember[] = read.people.map((p) => ({
    quarterId: p.quarterId,
    name: p.displayName === null ? null : shownText(p.displayName, "resident"),
    lot: p.lot,
    level: p.level,
    verified: p.verified,
    joinedAt: p.joinedAt,
  }));
  return {
    ...streetView({ crew: read.crew, members: read.people.length, units: read.units, given: read.given }),
    invite: read.crew.invite,
    people,
    score: crewScore({ week: weekOf(now), members: read.people.map((p) => ({ residentId: p.residentId, verified: p.verified })), actions: read.actions }),
    me: { quarterId: read.me.quarterId, gave: read.me.gave, points: Math.max(0, read.me.pointsTotal - read.me.pointsGiven) },
  };
}

/** The Monday the war's week starts on, as a moment. */
const weekStart = (now: Date) => new Date(`${weekOf(now)}T00:00:00.000Z`);

export function createCrewApi(deps: CrewDeps) {
  const now = deps.now ?? (() => new Date());
  const clock = () => now().getTime();
  const random = deps.random ?? ((n: number) => new Uint8Array(randomBytes(n)));
  const limiters = new Map<string, FixedWindowLimiter>();

  function limit(route: keyof typeof CREW_LIMITS, kind: "ip" | "device", key: string): Answer | null {
    const max = CREW_LIMITS[route][kind];
    if (max === null) return null;
    const name = `${route}:${kind}`;
    let limiter = limiters.get(name);
    if (!limiter) {
      limiter = new FixedWindowLimiter({ limit: max, windowMs: 60_000, maxKeys: 10_000, now: clock });
      limiters.set(name, limiter);
    }
    const decision: RateLimitDecision = limiter.consume(key);
    if (decision.allowed) return null;
    return { ...failure(429, "RATE_LIMITED", "Too many requests; try again shortly."), headers: rateLimitHeaders(decision) };
  }

  function respond(answer: Answer, base: Record<string, string>, req: Request, clearGuest = false): Response {
    const headers = new Headers({ ...JSON_TYPE, ...base, ...(answer.headers ?? {}) });
    if (clearGuest) headers.append("set-cookie", guestCookieHeader(null, req.url));
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers });
  }

  /** Who is asking, as the world's own routes decide it: the account first, then the guest key; a guest joins the account. */
  async function identify(req: Request): Promise<Who> {
    const account = await deps.account(req);
    if (account.status === "unavailable") throw new WorldStoreUnavailable("session store unavailable");
    const cookie = readCookie(req.headers.get("cookie"), GUEST_COOKIE);
    const guestId = guestResidentId(cookie);
    let guest: Resident | null = null;
    if (cookie && guestId) {
      const stored = await deps.world.resident({ id: guestId });
      if (stored && guestKeyMatches(cookie, stored, deps.secret())) {
        const { guestSalt: _salt, ...resident } = stored;
        guest = resident;
      }
    }
    if (account.status === "ok") {
      if (guest) {
        const merged = await deps.world.mergeGuest({ guestId: guest.id, accountId: account.accountId, now: now() });
        if (!merged.ok) throw new WorldStoreUnavailable("the account behind the session is missing");
        return { resident: merged.resident, clearGuest: true };
      }
      const stored = await deps.world.resident({ accountId: account.accountId });
      return { resident: stored ? (({ guestSalt: _salt, ...rest }) => rest)(stored) : null, clearGuest: cookie !== null };
    }
    return { resident: guest, clearGuest: cookie !== null && guest === null };
  }

  async function myCrew(resident: Resident): Promise<MyCrew | null> {
    const at = now();
    const read = await deps.crews.mine({ residentId: resident.id, day: dayOf(at), since: weekStart(at) });
    return read ? myCrewView(read, at) : null;
  }

  /** GET /api/world/crew — my crew, or null. */
  async function mine(req: Request): Promise<Response> {
    const base = privateNoStoreHeaders();
    const capped = limit("mine", "ip", clientIp(req.headers));
    if (capped) return respond(capped, base, req);
    let who: Who = { resident: null, clearGuest: false };
    try {
      who = await identify(req);
      if (!who.resident) return respond(noResident(), base, req, who.clearGuest);
      const deviceCap = limit("mine", "device", who.resident.id);
      if (deviceCap) return respond(deviceCap, base, req, who.clearGuest);
      return respond({ status: 200, body: { crew: await myCrew(who.resident) } }, base, req, who.clearGuest);
    } catch (error) {
      if (error instanceof WorldStoreUnavailable) return respond(unavailable(), base, req, who.clearGuest);
      throw error;
    }
  }

  /** GET /api/world/crews — every crew street. */
  async function streets(req: Request): Promise<Response> {
    const capped = limit("streets", "ip", clientIp(req.headers));
    if (capped) return respond(capped, privateNoStoreHeaders(), req);
    try {
      const list = await deps.crews.streets();
      return respond({ status: 200, body: { crews: list.map(streetView) } }, { "cache-control": "public, max-age=0, s-maxage=15, stale-while-revalidate=60" }, req);
    } catch (error) {
      if (error instanceof WorldStoreUnavailable) return respond(unavailable(), privateNoStoreHeaders(), req);
      throw error;
    }
  }

  /** GET /api/world/crew/invite/:code — the street behind an invite. */
  async function invite(req: Request, raw: string): Promise<Response> {
    const base = privateNoStoreHeaders();
    const capped = limit("invite", "ip", clientIp(req.headers));
    if (capped) return respond(capped, base, req);
    const code = normalInvite(raw);
    if (!code) return respond(failure(404, "NOT_FOUND", "No such invite."), base, req);
    try {
      const found = await deps.crews.byInvite(code);
      if (!found) return respond(failure(404, "NOT_FOUND", "No such invite."), base, req);
      return respond({ status: 200, body: { crew: streetView(found) } }, base, req);
    } catch (error) {
      if (error instanceof WorldStoreUnavailable) return respond(unavailable(), base, req);
      throw error;
    }
  }

  /** Every write: same site, limited, keyed, the body read once, the answer kept under its key. */
  async function write(req: Request, route: Route, commit: (resident: Resident, body: Record<string, unknown>) => Promise<Answer>): Promise<Response> {
    const base = privateNoStoreHeaders();
    if (!mutationOriginAllowed(req.url, req.headers.get("origin"), req.headers.get("sec-fetch-site"))) {
      return respond(failure(403, "FORBIDDEN", "Writes come from this site only."), base, req);
    }
    const capped = limit("write", "ip", clientIp(req.headers));
    if (capped) return respond(capped, base, req);
    const key = req.headers.get("idempotency-key");
    if (!key || !IDEMPOTENCY_KEY.test(key)) {
      return respond(failure(400, "IDEMPOTENCY_KEY_REQUIRED", "Every write carries an Idempotency-Key of 8 to 128 letters, digits or _:.-"), base, req);
    }
    const text = await req.text();
    if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) return respond(failure(413, "PAYLOAD_TOO_LARGE", "The request is too large."), base, req);
    let body: Record<string, unknown>;
    try {
      const parsed = JSON.parse(text || "{}") as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return respond(failure(400, "BAD_REQUEST", "The body is a JSON object."), base, req);
      body = parsed as Record<string, unknown>;
    } catch {
      return respond(failure(400, "BAD_REQUEST", "The body is not JSON."), base, req);
    }

    let who: Who = { resident: null, clearGuest: false };
    try {
      who = await identify(req);
    } catch (error) {
      if (error instanceof WorldStoreUnavailable) return respond(unavailable(), base, req);
      throw error;
    }
    const resident = who.resident;
    if (!resident) return respond(noResident(), base, req, who.clearGuest);
    const deviceCap = limit("write", "device", resident.id);
    if (deviceCap) return respond(deviceCap, base, req, who.clearGuest);

    const ref = { scope: `r:${resident.id}`, route: `crew.${route}`, key };
    const hash = createHash("sha256").update(`crew.${route}\n${canonical(body)}`).digest("hex");
    try {
      const gate = await deps.world.requestBegin({ ...ref, hash, now: now() });
      if (gate.state === "mismatch") return respond(failure(422, "IDEMPOTENCY_KEY_REUSED", "This Idempotency-Key was used for another request."), base, req, who.clearGuest);
      if (gate.state === "pending") return respond(failure(409, "REQUEST_IN_PROGRESS", "The same request is still running."), base, req, who.clearGuest);
      if (gate.state === "replay") return respond({ status: gate.status, body: gate.body, headers: { "idempotent-replayed": "true" } }, base, req, who.clearGuest);
    } catch (error) {
      if (error instanceof WorldStoreUnavailable) return respond(unavailable(), base, req, who.clearGuest);
      throw error;
    }

    let answer: Answer;
    try {
      const daily = await deps.world.limitHit({ bucket: `crew:${resident.id}`, windowSeconds: 86_400, max: CREW_WRITES_PER_DAY, now: now() });
      answer = daily.allowed
        ? await commit(resident, body)
        : { ...failure(429, "RATE_LIMITED", "Enough for today; your crew keeps what you did."), headers: { "retry-after": String(daily.retryAfterSeconds) } };
    } catch (error) {
      await deps.world.requestAbandon(ref).catch(() => undefined);
      if (error instanceof WorldStoreUnavailable) return respond(unavailable(), base, req, who.clearGuest);
      throw error;
    }
    try {
      if (answer.status >= 500) await deps.world.requestAbandon(ref);
      else await deps.world.requestFinish({ ...ref, status: answer.status, body: answer.body, now: now() });
    } catch {
      /* The step is kept; only the stored answer of the key is missing. */
    }
    return respond(answer, base, req, who.clearGuest);
  }

  /** The answer of a step that moved my quarter: my crew as it is now, and my quarter where it stands. */
  async function after(resident: Resident, status: number): Promise<Answer> {
    const crew = await myCrew(resident);
    const home = await deps.world.quarter(resident.homeQuarterId);
    if (!crew || !home) throw new WorldStoreUnavailable("the crew could not be read back");
    return { status, body: { crew, quarter: home.quarter } };
  }

  /** POST /api/world/crew — { name, colour }. */
  const create = (req: Request) =>
    write(req, "create", async (resident, body) => {
      if (!isCrewColour(body.colour) || typeof body.name !== "string") return failure(400, "BAD_REQUEST", "A crew names its name and colour.");
      const named = crewName(body.name);
      if (!named.ok) return refused("name");
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const done = await deps.crews.create({ residentId: resident.id, name: named.name, colour: body.colour, invite: inviteCode(random), now: now() });
        if (done.ok) return after(resident, 201);
        if (done.error === "invite_taken") continue;
        if (done.error === "in_crew") return refused("in_crew");
        return failure(404, "NOT_FOUND", "No such quarter.");
      }
      throw new WorldStoreUnavailable("no free invite code");
    });

  /** POST /api/world/crew/join — { code }. */
  const join = (req: Request) =>
    write(req, "join", async (resident, body) => {
      const code = normalInvite(body.code);
      if (!code) return failure(404, "NOT_FOUND", "No such invite.");
      const done = await deps.crews.join({ residentId: resident.id, invite: code, limit: CREW_LIMIT, now: now() });
      if (done.ok) return after(resident, 200);
      if (done.error === "in_crew" || done.error === "full") return refused(done.error);
      return failure(404, "NOT_FOUND", "No such invite.");
    });

  /** POST /api/world/crew/leave — {}. */
  const leave = (req: Request) =>
    write(req, "leave", async (resident) => {
      const done = await deps.crews.leave({ residentId: resident.id, now: now() });
      if (done.ok) return { status: 200, body: { quarter: done.quarter } };
      if (done.error === "not_in_crew") return refused("not_in_crew");
      return failure(404, "NOT_FOUND", "No such quarter.");
    });

  /** POST /api/world/crew/gift — a module or points towards the headquarters. */
  const gift = (req: Request) =>
    write(req, "gift", async (resident, body) => {
      const at = now();
      const read = await deps.crews.mine({ residentId: resident.id, day: dayOf(at), since: weekStart(at) });
      if (!read) return refused("not_in_crew");
      const planned = planGift({ body, quarterLevel: read.me.quarterLevel, points: Math.max(0, read.me.pointsTotal - read.me.pointsGiven), gave: read.me.gave });
      if (!planned.ok) return planned.reason === "shape" ? failure(400, "BAD_REQUEST", "A gift is a module or 5 to 100 points.") : refused(planned.reason);
      const g = planned.gift;
      const done = await deps.crews.gift({ residentId: resident.id, kind: g.kind, module: g.module, points: g.points, units: g.units, day: dayOf(at), now: at });
      if (!done.ok) return refused(done.error);
      return after(resident, 200);
    });

  return { mine, streets, invite, create, join, leave, gift };
}

export type CrewApi = ReturnType<typeof createCrewApi>;
