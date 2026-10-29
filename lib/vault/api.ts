import { clientIp, privateNoStoreHeaders } from "../http-control";
import { mutationOriginAllowed } from "../security";
import type { VaultErrorCode } from "./contract";
import { errorLine, type VaultEngine } from "./engine";
import type { VaultStore } from "./store";
import { guestCookieHeader, guestOf, newGuest, readCookie, whoKey, VAULT_GUEST_COOKIE, type Who } from "./identity";
import { isVaultId } from "./levels";
import type { WorldSink } from "./world";

/**
 * The routes of `/api/vault`, written against plain `Request` and `Response` so every rule is tested without a server;
 * `server.ts` gives them the real session, secret and model, and `app/api/vault/**` only hands the request over.
 *
 * All three are closed (404) until the deployment's switch says `open` (`NEXT_PUBLIC_RYNTRA_CITY_VAULT`), so no model
 * is ever called for a vault people cannot see. An attempt comes from this site only, carries an `Idempotency-Key`
 * (a retried attempt gets the same answer and is counted once, with or without the guest cookie the first answer
 * made), and makes a guest for a person who has none. A store that cannot be reached is a 503, never a 500.
 */

export type WalletRead = { status: "ok"; accountId: string } | { status: "absent" } | { status: "unavailable" };

export type VaultApiDeps = {
  /** The engine, or null when the server has no signing secret (then every route says unavailable). */
  engine: () => VaultEngine | null;
  secret: () => string | null;
  /** Whether the vault is open to people on this deployment. */
  open: () => boolean;
  /** The account signed in on this request: a person who signed in with a wallet. */
  wallet: (req: Request) => Promise<WalletRead>;
  /** Where a request key's answer is kept, so a retried attempt is never counted twice. */
  store: Pick<VaultStore, "answer" | "keepAnswer">;
  world: WorldSink;
  now?: () => number;
};

const JSON_TYPE = { "content-type": "application/json; charset=utf-8" };
const MAX_BODY_BYTES = 2_048;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_:.-]{8,128}$/;

type Answer = { status: number; body: unknown; headers?: Record<string, string> };
/** What is kept for a request key: the answer and, for a first visit, the guest cookie that answer made. */
type Kept = Answer & { cookie?: string };

const failure = (status: number, code: VaultErrorCode, message: string, extra: Record<string, unknown> = {}): Answer => ({ status, body: { error: { code, message, ...extra } } });

const STATUS: Record<string, Answer> = {
  closed: failure(404, "CLOSED", "The vault is not open yet."),
  unavailable: failure(503, "UNAVAILABLE", "The vault could not be reached; nothing was counted."),
  LOCKED: failure(422, "LOCKED", "Crack the level before this one first."),
  EMPTY: failure(400, "EMPTY", "Say something to the guard."),
  TOO_LONG: failure(422, "TOO_LONG", "An attempt is 280 characters at most."),
  GUARD_SILENT: failure(503, "GUARD_SILENT", "The guard didn't answer. This try didn't count."),
};

function respond(answer: Answer, requestUrl: string, cookie?: string | null): Response {
  const headers = new Headers({ ...JSON_TYPE, ...privateNoStoreHeaders(), ...(answer.headers ?? {}) });
  if (cookie) headers.append("set-cookie", guestCookieHeader(cookie, requestUrl));
  return new Response(JSON.stringify(answer.body), { status: answer.status, headers });
}

/** A replayed answer: the same status and body, marked as a replay, with the guest cookie it made if any. */
function replay(stored: Kept, requestUrl: string, cookie: string | null): Response {
  const answer: Answer = { status: stored.status, body: stored.body, headers: { ...stored.headers, "idempotent-replayed": "true" } };
  return respond(answer, requestUrl, cookie);
}

/** The store or the engine failed: a 503 that names nothing inside, and one log line without the phrase. */
function unavailable(error: unknown, requestUrl: string): Response {
  console.error("[vault] route failed", errorLine(error));
  return respond(STATUS.unavailable!, requestUrl);
}

export function createVaultApi(deps: VaultApiDeps) {
  const now = deps.now ?? Date.now;

  /** Who is asking: the signed-in account, else the guest the cookie names; null for a first visit. */
  async function identify(req: Request, secret: string): Promise<Who | null> {
    const account = await deps.wallet(req).catch((): WalletRead => ({ status: "unavailable" }));
    if (account.status === "ok") return { kind: "wallet", id: account.accountId };
    const guest = guestOf(readCookie(req.headers.get("cookie"), VAULT_GUEST_COOKIE), secret);
    return guest ? { kind: "guest", id: guest } : null;
  }

  /** POST /api/vault/attempt — one message to a guard, or the phrase. */
  async function attempt(req: Request): Promise<Response> {
    if (!deps.open()) return respond(STATUS.closed!, req.url);
    if (!mutationOriginAllowed(req.url, req.headers.get("origin"), req.headers.get("sec-fetch-site"))) {
      return respond(failure(403, "FORBIDDEN", "Attempts come from this site only."), req.url);
    }
    const engine = deps.engine();
    const secret = deps.secret();
    if (!engine || !secret) return respond(STATUS.unavailable!, req.url);
    const key = req.headers.get("idempotency-key");
    if (!key || !IDEMPOTENCY_KEY.test(key)) {
      return respond(failure(400, "IDEMPOTENCY_KEY_REQUIRED", "Every attempt carries an Idempotency-Key of 8 to 128 letters, digits or _:.-"), req.url);
    }
    const text = await req.text();
    if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) return respond(failure(413, "PAYLOAD_TOO_LARGE", "The request is too large."), req.url);
    let body: Record<string, unknown>;
    try {
      const parsed = JSON.parse(text) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
      body = parsed as Record<string, unknown>;
    } catch {
      return respond(failure(400, "BAD_REQUEST", "The body is a JSON object: { vault, text }."), req.url);
    }
    if (!isVaultId(body.vault)) return respond(failure(404, "NOT_FOUND", "There is no such vault."), req.url);
    if (typeof body.text !== "string") return respond(failure(400, "BAD_REQUEST", "The attempt is text."), req.url);

    try {
      let who = await identify(req, secret);
      let cookie: string | null = null;
      // A first visit's attempt is also kept under its key alone, with the guest it made: a retry that lost the
      // cookie gets the same answer and the same guest, and is counted once.
      const first = who ? null : `new:${key}`;
      if (!who) {
        const stored = (await deps.store.answer(`new:${key}`, now())) as Kept | null;
        if (stored?.cookie && guestOf(stored.cookie, secret)) return replay(stored, req.url, stored.cookie);
        const made = newGuest(secret);
        who = { kind: "guest", id: made.id };
        cookie = made.cookie;
      }

      // A retried attempt gets its first answer back and is counted once; the key is this person's own.
      const kept = `${whoKey(who)}:${key}`;
      const stored = (await deps.store.answer(kept, now())) as Kept | null;
      if (stored) return replay(stored, req.url, cookie);

      const result = await engine.attempt({ who, address: clientIp(req.headers), vault: body.vault, text: body.text });
      let answer: Answer;
      if (result.ok) {
        if (result.event) await deps.world.award(req, result.event).catch(() => "pending");
        answer = { status: 200, body: result.response };
      } else if (result.code === "RATE_LIMITED") {
        const message = result.window === "minute" ? "Three tries a minute. Catch your breath." : "That's today's 25 tries. The vaults reset at midnight UTC.";
        answer = { ...failure(429, "RATE_LIMITED", message, { window: result.window, retryAfterS: result.retryAfterS }), headers: { "Retry-After": String(result.retryAfterS) } };
      } else {
        answer = STATUS[result.code]!;
      }
      // A guard that did not answer is not kept: the same key may try again.
      if (answer.status < 500) {
        await deps.store.keepAnswer(kept, answer, now());
        if (first && cookie) await deps.store.keepAnswer(first, { ...answer, cookie } satisfies Kept, now());
      }
      return respond(answer, req.url, cookie);
    } catch (error) {
      return unavailable(error, req.url);
    }
  }

  /** GET /api/vault/state — the vaults as this person sees them today. */
  async function state(req: Request): Promise<Response> {
    if (!deps.open()) return respond(STATUS.closed!, req.url);
    const engine = deps.engine();
    const secret = deps.secret();
    if (!engine || !secret) return respond(STATUS.unavailable!, req.url);
    try {
      return respond({ status: 200, body: await engine.state(await identify(req, secret)) }, req.url);
    } catch (error) {
      return unavailable(error, req.url);
    }
  }

  /** GET /api/vault/feed?vault=&before= — what the guards said, masked, newest first. */
  async function feed(req: Request): Promise<Response> {
    if (!deps.open()) return respond(STATUS.closed!, req.url);
    const engine = deps.engine();
    if (!engine) return respond(STATUS.unavailable!, req.url);
    const params = new URL(req.url).searchParams;
    const vault = params.get("vault");
    if (!isVaultId(vault)) return respond(failure(404, "NOT_FOUND", "There is no such vault."), req.url);
    const before = params.get("before");
    if (before !== null && !/^[A-Za-z0-9_-]{1,32}$/.test(before)) return respond(failure(400, "BAD_REQUEST", "`before` is an entry id."), req.url);
    try {
      return respond({ status: 200, body: await engine.feed(vault, before) }, req.url);
    } catch (error) {
      return unavailable(error, req.url);
    }
  }

  return { attempt, state, feed };
}
