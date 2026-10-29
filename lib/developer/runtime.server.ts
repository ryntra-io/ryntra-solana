/**
 * What the developer console needs on this deployment (DEV-2), or why it is not served.
 *
 * A project belongs to a team, and every right it has is that team's (TEAM-1), so the console is served only where
 * teams are. On top of that the deployment says `RYNTRA_DEV_CONSOLE=open`, which the project's owner sets after
 * applying the DEV-2 migration (`db/migrations/README.md`). The store is the Postgres one wherever the team store
 * is; per-process memory serves a local stand on one instance and nothing behind several.
 *
 * The quota numbers are read from the environment and are null until something puts them there. Null is not
 * «unlimited by design»: calls are counted all the same, and the page says the number is unset. No figure in this
 * repository decides what a developer may spend.
 *
 * Server only.
 */

import type { DevQuotaLimits, DevQuotaWindow } from "../core/developer/console.ts";
import { resolveGuardDeployment, resolveGuardStoreConfig } from "../guard/runtime-config.ts";
import { authorizeTeamAction } from "../team/service.server.ts";
import { teamsServed } from "../team/runtime.server.ts";
import type { DevAuthority, DevAuthorize, DevDeps, DevSend } from "./service.server.ts";
import { createMemoryDevStore, type DevStore } from "./store.ts";
import { createPostgresDevStore } from "./store-postgres.server.ts";

export type DevServed = Readonly<{ served: true; deps: DevDeps }> | Readonly<{ served: false; reason: "NO_TEAMS" | "CLOSED" | "NO_STORE" }>;

export function devConsoleOpen(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env.RYNTRA_DEV_CONSOLE?.trim().toLowerCase() === "open";
}

const QUOTA_ENV: Readonly<Record<DevQuotaWindow, string>> = { minute: "RYNTRA_DEV_QUOTA_MINUTE", day: "RYNTRA_DEV_QUOTA_DAY", month: "RYNTRA_DEV_QUOTA_MONTH" };

/** A window's ceiling as the deployment states it: a whole positive number, or null where nothing is stated. */
export function devQuotaLimits(env: Readonly<Record<string, string | undefined>> = process.env): DevQuotaLimits {
  const read = (window: DevQuotaWindow): number | null => {
    const raw = env[QUOTA_ENV[window]]?.trim();
    if (!raw) return null;
    const value = Number(raw);
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  };
  return { minute: read("minute"), day: read("day"), month: read("month") };
}

let cachedStore: { key: string; store: DevStore } | null = null;

function storeFor(env: Readonly<Record<string, string | undefined>>): DevStore | null {
  let config;
  try {
    config = resolveGuardStoreConfig(env);
  } catch {
    return null;
  }
  const key = config.kind === "postgres" ? `postgres:${config.connectionString}` : "memory";
  if (cachedStore?.key === key) return cachedStore.store;
  if (config.kind === "postgres") cachedStore = { key, store: createPostgresDevStore({ connectionString: config.connectionString }) };
  /* Memory only where one instance serves: a key issued on one instance would be unknown to the next. */
  else if (resolveGuardDeployment(env) === "SINGLE_INSTANCE") cachedStore = { key, store: createMemoryDevStore() };
  else return null;
  return cachedStore.store;
}

/**
 * A delivery leaves with a deadline, no redirect followed and nothing read back but the status. A redirect would
 * move a signed body to an address nobody put on the endpoint, and a body is never needed: what a receiver says is
 * its status.
 */
export const sendWebhook: DevSend = async ({ url, body, headers }) => {
  const response = await fetch(url, {
    method: "POST",
    body,
    headers: { ...headers, "user-agent": "Ryntra-Webhooks/1" },
    redirect: "manual",
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  return { status: response.status };
};

export function devConsoleServed(env: Readonly<Record<string, string | undefined>> = process.env): DevServed {
  const teams = teamsServed(env);
  if (!teams.served) return { served: false, reason: "NO_TEAMS" };
  if (!devConsoleOpen(env)) return { served: false, reason: "CLOSED" };
  const store = storeFor(env);
  if (!store) return { served: false, reason: "NO_STORE" };

  /* One right, asked of the team on every call: the console caches no answer and keeps no list of its own. */
  const authorize: DevAuthorize = async ({ teamId, wallet, permission }): Promise<DevAuthority> => {
    const answer = await authorizeTeamAction(teams.deps, { teamId, wallet, permission: permission as Parameters<typeof authorizeTeamAction>[1]["permission"] });
    if (!answer.ok) return answer.code === "NOT_FOUND" ? { allowed: false, role: null, refusal: "NOT_A_MEMBER" } : { unavailable: true, message: answer.message };
    return { allowed: answer.decision.allowed, role: answer.decision.role, refusal: answer.decision.refusal };
  };

  return { served: true, deps: { store, network: teams.deps.network, now: () => new Date(), authorize, send: sendWebhook, quota: devQuotaLimits(env) } };
}
