/**
 * Each agent's and each guard's own OpenRouter key with a dollar limit
 * (CITY-45, decision 72) — OpenRouter's management API (`/api/v1/keys`),
 * called with `OPENROUTER_MANAGEMENT_KEY`. A spent limit stops that one
 * subject (403 «Key limit exceeded» → `budget_exhausted`), never the others.
 *
 * - `create` makes a key named `ryntra:<kind>:<id>` with its limit. OpenRouter
 *   shows the key's secret once: the caller puts it in the server's secret
 *   store at once and hands it to `ModelCall.apiKey`; the gateway never keeps,
 *   logs or returns it again.
 * - `disable` switches a key off (`disabled: true`) — when a match, a Vault or
 *   an agent ends. The key stays in OpenRouter's list with its spend.
 * - `read` gives a key's limit, what is left of it and its spend.
 *
 * A limit is at most `KEY_LIMIT_MAX_USD`: a typo of a few zeros never becomes
 * a key that can spend the account.
 */

import { MODELS_ENV, missingKey, readKey, type ModelsEnv } from "./env.ts";
import { ModelGatewayError, classifyHttpFailure, classifyThrown } from "./errors.ts";
import { badSubject, readSubject } from "./subject.ts";
import type { ModelSubject } from "./types.ts";

export const KEYS_URL = "https://openrouter.ai/api/v1/keys";
export const KEY_LIMIT_MAX_USD = 100;
export const KEYS_TIMEOUT_MS = 15_000;

export const KEY_LIMIT_RESETS = ["daily", "weekly", "monthly"] as const;
export type KeyLimitReset = (typeof KEY_LIMIT_RESETS)[number];

export type ModelKeyInfo = Readonly<{
  /** OpenRouter's id of the key — what `disable` and `read` take; not a secret. */
  hash: string;
  name: string;
  disabled: boolean;
  /** The dollar limit; `null` when OpenRouter says the key has none. */
  limitUsd: number | null;
  limitRemainingUsd: number | null;
  /** `null` — the limit is for the key's whole life. */
  limitReset: KeyLimitReset | null;
  usageUsd: number | null;
  createdAt: string | null;
  updatedAt: string | null;
}>;

export type CreatedModelKey = Readonly<{
  info: ModelKeyInfo;
  /** The key itself, shown by OpenRouter this once — straight into the server's secret store, never a log or a response. */
  secret: string;
}>;

export type CreateKeyInput = Readonly<{
  subject: ModelSubject;
  /** Dollars this key may ever spend (or per `limitReset` period): above 0, at most `KEY_LIMIT_MAX_USD`. */
  limitUsd: number;
  limitReset?: KeyLimitReset | null;
}>;

export type ModelKeyManager = Readonly<{
  create(input: CreateKeyInput): Promise<CreatedModelKey>;
  disable(hash: string): Promise<ModelKeyInfo>;
  read(hash: string): Promise<ModelKeyInfo>;
}>;

export type KeyManagerDeps = Readonly<{
  env?: ModelsEnv;
  fetch?: typeof fetch;
  timeoutMs?: number;
  url?: string;
}>;

const KEY_HASH = /^[A-Za-z0-9_-]{8,128}$/;

/** The key's name in OpenRouter's list: who it is for, nothing more. */
export function keyName(subject: ModelSubject): string {
  return `ryntra:${subject.kind}:${subject.id}`;
}

const money = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null);
const text = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value.slice(0, 64) : null);

/** A key's record from OpenRouter (`data`); without a hash it is not a key. */
export function parseKeyInfo(raw: unknown): ModelKeyInfo {
  const data = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (typeof data.hash !== "string" || !KEY_HASH.test(data.hash)) throw new ModelGatewayError("invalid_response", "OpenRouter's key record has no hash.");
  const reset = data.limit_reset;
  return {
    hash: data.hash,
    name: typeof data.name === "string" ? data.name.slice(0, 128) : typeof data.label === "string" ? data.label.slice(0, 128) : "",
    disabled: data.disabled === true,
    limitUsd: money(data.limit),
    limitRemainingUsd: money(data.limit_remaining),
    limitReset: typeof reset === "string" && (KEY_LIMIT_RESETS as readonly string[]).includes(reset) ? (reset as KeyLimitReset) : null,
    usageUsd: money(data.usage),
    createdAt: text(data.created_at),
    updatedAt: text(data.updated_at),
  };
}

function checkHash(hash: unknown): string {
  if (typeof hash !== "string" || !KEY_HASH.test(hash)) throw new ModelGatewayError("invalid_request", "A key hash is 8–128 safe characters.");
  return hash;
}

export function createKeyManager(deps: KeyManagerDeps = {}): ModelKeyManager {
  const env = deps.env ?? {};
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const timeoutMs = deps.timeoutMs ?? KEYS_TIMEOUT_MS;
  const base = deps.url ?? KEYS_URL;

  async function request(method: "GET" | "POST" | "PATCH", path: string, payload?: Record<string, unknown>): Promise<unknown> {
    const management = readKey(env, MODELS_ENV.managementKey);
    if (!management) throw missingKey(MODELS_ENV.managementKey);
    const timer = AbortSignal.timeout(timeoutMs);
    let response: Response | null = null;
    let body: unknown;
    try {
      response = await fetchImpl(`${base}${path}`, {
        method,
        headers: { authorization: `Bearer ${management}`, accept: "application/json", ...(payload ? { "content-type": "application/json" } : {}) },
        ...(payload ? { body: JSON.stringify(payload) } : {}),
        signal: timer,
      });
      body = await response.json();
    } catch (error: unknown) {
      if (!response || timer.aborted) throw classifyThrown(error, timer.aborted, false);
      body = undefined;
    }
    if (response.status === 404) throw new ModelGatewayError("not_found", "OpenRouter has no such key.", 404);
    if (!response.ok) throw classifyHttpFailure(response.status, body, response.headers.get("retry-after"));
    if (!body || typeof body !== "object") throw new ModelGatewayError("invalid_response", "OpenRouter's answer was not JSON.", response.status);
    return body;
  }

  return {
    async create(input) {
      const subject = readSubject(input?.subject);
      if (!subject) throw badSubject();
      const limit = input.limitUsd;
      if (typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0 || limit > KEY_LIMIT_MAX_USD) {
        throw new ModelGatewayError("invalid_request", `limitUsd is above 0 and at most ${KEY_LIMIT_MAX_USD}.`);
      }
      const reset = input.limitReset ?? null;
      if (reset !== null && !(KEY_LIMIT_RESETS as readonly string[]).includes(reset)) throw new ModelGatewayError("invalid_request", "limitReset is daily, weekly, monthly or null.");
      const body = (await request("POST", "", {
        name: keyName({ kind: subject.kind, id: subject.id }),
        limit,
        limit_reset: reset,
        /* Our own provider keys, if ever added, count against the same limit: one budget per subject. */
        include_byok_in_limit: true,
      })) as { data?: unknown; key?: unknown };
      if (typeof body.key !== "string" || body.key.length < 8) throw new ModelGatewayError("invalid_response", "OpenRouter made the key but did not return it.");
      return { info: parseKeyInfo(body.data), secret: body.key };
    },
    async disable(hash) {
      const body = (await request("PATCH", `/${encodeURIComponent(checkHash(hash))}`, { disabled: true })) as { data?: unknown };
      const info = parseKeyInfo(body.data);
      if (!info.disabled) throw new ModelGatewayError("invalid_response", "OpenRouter did not confirm the key is disabled.");
      return info;
    },
    async read(hash) {
      const body = (await request("GET", `/${encodeURIComponent(checkHash(hash))}`)) as { data?: unknown };
      return parseKeyInfo(body.data);
    },
  };
}
