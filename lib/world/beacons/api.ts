import { FixedWindowLimiter, clientIp, privateNoStoreHeaders, rateLimitHeaders, type RateLimitDecision } from "../../http-control";
import { mutationOriginAllowed } from "../../security";
import type { AccountRead } from "../api";
import { WorldStoreUnavailable } from "../store";
import { sanitizeBeacons, sanitizeStates, stateOf, type BeaconRule, type BeaconStates } from "./rules";
import type { BeaconRow, BeaconStore } from "./store";

/**
 * `/api/world/beacons`: the person's beacons, kept under their Ryntra account
 * (a wallet sign-in), so the server can tell their Telegram when one lights.
 *
 * - `GET` — the rules, what the engine remembers of them, the revision, and
 *   whether Telegram is connected (`linked`, `unlinked`, or null when that
 *   could not be read).
 * - `POST { revision, rules }` — the whole list, at the revision the person
 *   saw; 409 with the list as it is now otherwise. Every rule must read: one
 *   that does not is a 400, nothing is changed. An edited rule starts over;
 *   the others keep what the engine remembers.
 *
 * Writes come from this site only and are limited per address and per
 * account. Nothing here moves money, signs or sends: a beacon only tells.
 */

export type TelegramState = "linked" | "unlinked" | null;

export type BeaconDeps = {
  store: BeaconStore;
  account: (req: Request) => Promise<AccountRead>;
  /** Whether the account has a Telegram chat connected; null when that could not be read. */
  telegram: (accountId: string) => Promise<TelegramState>;
  now?: () => Date;
};

const JSON_TYPE = { "content-type": "application/json; charset=utf-8" };
/** Thirty rules of a few conditions fit with room to spare. */
const MAX_BODY_BYTES = 32_768;
const LIMITS = { ip: 60, account: 30 } as const;

type Answer = { status: number; body: unknown; headers?: Record<string, string> };

function respond(answer: Answer): Response {
  return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { ...JSON_TYPE, ...privateNoStoreHeaders(), ...(answer.headers ?? {}) } });
}

const failure = (status: number, code: string, message: string, more: Record<string, unknown> = {}): Answer => ({ status, body: { error: { code, message }, ...more } });
const unavailable = () => failure(503, "UNAVAILABLE", "Beacons could not be reached; nothing was changed.");
const walletRequired = () => failure(401, "WALLET_REQUIRED", "Sign in with your wallet to keep beacons.");

function limited(decision: RateLimitDecision | null): Answer | null {
  if (!decision || decision.allowed) return null;
  return { ...failure(429, "RATE_LIMITED", "Too many requests; try again shortly."), headers: rateLimitHeaders(decision) };
}

/** What the person sees of a row: only rules that read, and states only for them. */
function viewOf(row: BeaconRow): { revision: number; rules: readonly BeaconRule[]; states: BeaconStates } {
  const rules = sanitizeBeacons(row.rules);
  return { revision: row.revision, rules, states: sanitizeStates(row.states, rules) };
}

export function createBeaconApi(deps: BeaconDeps) {
  const now = deps.now ?? (() => new Date());
  const byIp = new FixedWindowLimiter({ limit: LIMITS.ip, windowMs: 60_000, maxKeys: 10_000, now: () => now().getTime() });
  const byAccount = new FixedWindowLimiter({ limit: LIMITS.account, windowMs: 60_000, maxKeys: 10_000, now: () => now().getTime() });

  async function guarded(req: Request, run: (accountId: string) => Promise<Answer>): Promise<Response> {
    const capped = limited(byIp.consume(clientIp(req.headers)));
    if (capped) return respond(capped);
    try {
      const account = await deps.account(req);
      if (account.status === "unavailable") return respond(unavailable());
      if (account.status !== "ok") return respond(walletRequired());
      const accountCap = limited(byAccount.consume(account.accountId));
      if (accountCap) return respond(accountCap);
      return respond(await run(account.accountId));
    } catch (error) {
      if (error instanceof WorldStoreUnavailable) return respond(unavailable());
      throw error;
    }
  }

  async function telegramOf(accountId: string): Promise<TelegramState> {
    try {
      return await deps.telegram(accountId);
    } catch {
      return null;
    }
  }

  /** GET /api/world/beacons */
  async function list(req: Request): Promise<Response> {
    return guarded(req, async (accountId) => {
      const [row, telegram] = await Promise.all([deps.store.read(accountId), telegramOf(accountId)]);
      return { status: 200, body: { ...viewOf(row), telegram } };
    });
  }

  /** POST /api/world/beacons — { revision, rules } */
  async function save(req: Request): Promise<Response> {
    if (!mutationOriginAllowed(req.url, req.headers.get("origin"), req.headers.get("sec-fetch-site"))) {
      return respond(failure(403, "FORBIDDEN", "Writes come from this site only."));
    }
    const text = await req.text();
    if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) return respond(failure(413, "PAYLOAD_TOO_LARGE", "The request is too large."));
    let body: Record<string, unknown>;
    try {
      const parsed = JSON.parse(text) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
      body = parsed as Record<string, unknown>;
    } catch {
      return respond(failure(400, "BAD_REQUEST", "The body is a JSON object."));
    }
    const revision = body.revision;
    if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 0 || !Array.isArray(body.rules)) {
      return respond(failure(400, "BAD_REQUEST", "Beacons name revision and rules."));
    }
    const rules = sanitizeBeacons(body.rules);
    if (rules.length !== body.rules.length) return respond(failure(400, "BAD_REQUEST", "A beacon does not read."));
    return guarded(req, async (accountId) => {
      const current = await deps.store.read(accountId);
      const kept = sanitizeStates(current.states, sanitizeBeacons(current.rules));
      const states: Record<string, unknown> = {};
      for (const rule of rules) {
        const state = stateOf(rule, kept);
        if (kept[rule.id]?.version === rule.version) states[rule.id] = state;
      }
      const done = await deps.store.write({ accountId, revision, rules, states, now: now() });
      if (!done.ok) {
        if (done.error === "no_account") return walletRequired();
        return failure(409, "VERSION_CONFLICT", "Your beacons changed elsewhere.", viewOf(done.row));
      }
      return { status: 200, body: viewOf(done.row) };
    });
  }

  return { list, save };
}

export type BeaconApi = ReturnType<typeof createBeaconApi>;
