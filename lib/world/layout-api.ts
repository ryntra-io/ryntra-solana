import { createHash } from "node:crypto";

import { FixedWindowLimiter, clientIp, privateNoStoreHeaders, rateLimitHeaders, type RateLimitDecision } from "../http-control";
import { mutationOriginAllowed } from "../security";
import type { Resident, WorldErrorCode } from "./contract";
import { guestCookieHeader, guestKeyMatches, guestResidentId, readCookie, GUEST_COOKIE } from "./guest";
import { planLayout, publicLayout, type Layout, type LayoutRefusal } from "./layout";
import type { LayoutStore } from "./layout-store";
import { isId } from "./rules";
import { WorldStoreUnavailable, type WorldStore } from "./store";
import type { AccountRead } from "./api";

/**
 * The routes of a quarter's free layout (CITY-55), written against plain `Request` and `Response` like the world's
 * own (`api.ts`), with the same guarantees: same site only, limited per address and per resident, an
 * `Idempotency-Key` on every save, and a save written only at the layout version the person saw.
 *
 *   GET  /api/world/layout?quarterId=   my layout (my home quarter when none is named), my signs' words included
 *   GET  /api/world/layout/:quarterId   anyone's layout, without the words of its signs
 *   POST /api/world/layout              { quarterId, pieces, version } — the whole layout at once
 *
 * Nothing here pays points, moves a task of the day or touches money: a layout is how a quarter looks, nothing more.
 */

export type LayoutDeps = {
  world: WorldStore;
  layouts: LayoutStore;
  secret: () => string | null;
  account: (req: Request) => Promise<AccountRead>;
  now?: () => Date;
};

/** Requests a minute in each server instance, per address and per resident. */
export const LAYOUT_LIMITS = {
  mine: { ip: 120, device: 60 },
  public: { ip: 240, device: null },
  save: { ip: 120, device: 40 },
} as const;
/** Saves a resident may make in a day, counted in the database across every instance. */
export const SAVES_PER_DAY = 1_500;

/** The largest layout (120 pieces with a sign's words) is about 8 KB. */
const MAX_BODY_BYTES = 16_384;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_:.-]{8,128}$/;
const JSON_TYPE = { "content-type": "application/json; charset=utf-8" };

type Answer = { status: number; body: unknown; headers?: Record<string, string> };
type Who = { resident: Resident | null; clearGuest: boolean };

const failure = (status: number, code: WorldErrorCode, message: string, extra: Record<string, unknown> = {}, more: Record<string, unknown> = {}): Answer => ({
  status,
  body: { error: { code, message, ...extra }, ...more },
});
const unavailable = () => failure(503, "UNAVAILABLE", "The world could not be reached; nothing was changed.");
const noResident = () => failure(401, "NO_RESIDENT", "Claim your place first.");

const REFUSAL_LINES: Record<LayoutRefusal["reason"], string> = {
  shape: "A layout is a list of pieces.",
  cap: "This quarter holds no more pieces at its level.",
  cell: "This piece does not fit there.",
  closed: "This plot opens at a higher quarter level.",
  built: "A building stands on this plot.",
  overlap: "Two pieces cannot share a place.",
  support: "This piece needs something under it that carries.",
  kind: "This piece opens at a higher quarter level.",
  limit: "A quarter holds no more of this piece.",
  sign: "A sign takes up to 12 plain letters and digits.",
};

function refusalAnswer(refusal: LayoutRefusal): Answer {
  const status = refusal.reason === "shape" ? 400 : 422;
  const extra: Record<string, unknown> = { reason: refusal.reason, index: refusal.index };
  if (refusal.need) extra.need = refusal.need;
  return failure(status, status === 400 ? "BAD_REQUEST" : "LOCKED", REFUSAL_LINES[refusal.reason], extra);
}

/** Object keys in one order, so the same save always hashes the same. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

const isVersion = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 2 ** 31 - 1;

export function createLayoutApi(deps: LayoutDeps) {
  const now = deps.now ?? (() => new Date());
  const clock = () => now().getTime();
  const limiters = new Map<string, FixedWindowLimiter>();

  function limit(route: keyof typeof LAYOUT_LIMITS, kind: "ip" | "device", key: string): Answer | null {
    const max = LAYOUT_LIMITS[route][kind];
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

  /** GET /api/world/layout?quarterId= — my layout, with my signs' words. */
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
      const asked = new URL(req.url).searchParams.get("quarterId");
      if (asked !== null && !isId(asked)) return respond(failure(400, "BAD_REQUEST", "quarterId is a quarter's id."), base, req, who.clearGuest);
      const quarterId = (asked ?? who.resident.homeQuarterId).toLowerCase();
      const state = await deps.world.quarter(quarterId);
      if (!state) return respond(failure(404, "NOT_FOUND", "No such quarter."), base, req, who.clearGuest);
      if (state.quarter.ownerId !== who.resident.id) return respond(failure(403, "NOT_OWNER", "This is not your quarter."), base, req, who.clearGuest);
      const layout = await deps.layouts.layout(quarterId);
      if (!layout) return respond(failure(404, "NOT_FOUND", "No such quarter."), base, req, who.clearGuest);
      return respond({ status: 200, body: { layout } }, base, req, who.clearGuest);
    } catch (error) {
      if (error instanceof WorldStoreUnavailable) return respond(unavailable(), base, req, who.clearGuest);
      throw error;
    }
  }

  /** GET /api/world/layout/:quarterId — anyone's layout; signs come without their words. */
  async function ofQuarter(req: Request, id: string): Promise<Response> {
    const capped = limit("public", "ip", clientIp(req.headers));
    if (capped) return respond(capped, privateNoStoreHeaders(), req);
    try {
      if (!isId(id)) return respond(failure(404, "NOT_FOUND", "No such quarter."), privateNoStoreHeaders(), req);
      const layout = await deps.layouts.layout(id.toLowerCase());
      if (!layout) return respond(failure(404, "NOT_FOUND", "No such quarter."), privateNoStoreHeaders(), req);
      return respond({ status: 200, body: { layout: publicLayout(layout) } }, { "cache-control": "public, max-age=0, s-maxage=10, stale-while-revalidate=30" }, req);
    } catch (error) {
      if (error instanceof WorldStoreUnavailable) return respond(unavailable(), privateNoStoreHeaders(), req);
      throw error;
    }
  }

  /** POST /api/world/layout — { quarterId, pieces, version }: the whole layout of my quarter. */
  async function save(req: Request): Promise<Response> {
    const base = privateNoStoreHeaders();
    if (!mutationOriginAllowed(req.url, req.headers.get("origin"), req.headers.get("sec-fetch-site"))) {
      return respond(failure(403, "FORBIDDEN", "Writes come from this site only."), base, req);
    }
    const capped = limit("save", "ip", clientIp(req.headers));
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
    const deviceCap = limit("save", "device", resident.id);
    if (deviceCap) return respond(deviceCap, base, req, who.clearGuest);

    const ref = { scope: `r:${resident.id}`, route: "layout", key };
    const hash = createHash("sha256").update(`layout\n${canonical(body)}`).digest("hex");
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
      answer = await commit(resident, body);
    } catch (error) {
      await deps.world.requestAbandon(ref).catch(() => undefined);
      if (error instanceof WorldStoreUnavailable) return respond(unavailable(), base, req, who.clearGuest);
      throw error;
    }
    try {
      if (answer.status >= 500) await deps.world.requestAbandon(ref);
      else await deps.world.requestFinish({ ...ref, status: answer.status, body: answer.body, now: now() });
    } catch {
      /* The layout is saved; only the stored answer of the key is missing, and a retry then meets the new version. */
    }
    return respond(answer, base, req, who.clearGuest);
  }

  async function commit(resident: Resident, body: Record<string, unknown>): Promise<Answer> {
    if (!isId(body.quarterId) || !isVersion(body.version) || !Array.isArray(body.pieces)) {
      return failure(400, "BAD_REQUEST", "A layout names quarterId, pieces and version.");
    }
    const quarterId = body.quarterId.toLowerCase();
    const state = await deps.world.quarter(quarterId);
    if (!state) return failure(404, "NOT_FOUND", "No such quarter.");
    if (state.quarter.ownerId !== resident.id) return failure(403, "NOT_OWNER", "Only the owner builds here.");
    const planned = planLayout({ quarter: state.quarter, buildings: state.buildings, pieces: body.pieces });
    if (!planned.ok) return refusalAnswer(planned.refusal);
    const daily = await deps.world.limitHit({ bucket: `layout:${resident.id}`, windowSeconds: 86_400, max: SAVES_PER_DAY, now: now() });
    if (!daily.allowed) return { ...failure(429, "RATE_LIMITED", "Enough building for today; the quarter keeps what you made."), headers: { "retry-after": String(daily.retryAfterSeconds) } };
    const done = await deps.layouts.commitLayout({ residentId: resident.id, quarterId, version: body.version, pieces: planned.pieces, now: now() });
    if (!done.ok) {
      if (done.error === "version") return failure(409, "VERSION_CONFLICT", "The layout changed since you saw it.", {}, { layout: done.layout });
      if (done.error === "not_owner") return failure(403, "NOT_OWNER", "Only the owner builds here.");
      return failure(404, "NOT_FOUND", "No such quarter.");
    }
    return { status: 200, body: { layout: done.layout satisfies Layout } };
  }

  return { mine, ofQuarter, save };
}

export type LayoutApi = ReturnType<typeof createLayoutApi>;
