/**
 * The developer console's rules (DEV-2; spec §11.3): what a project is, which credentials reach the API, what a
 * scope and an origin bound, how a webhook delivery is signed, and how much of a quota window is left.
 *
 * Two credentials, because they live in different places and a single kind would have to be safe in the worse of
 * them:
 *
 * - A **secret key** (`rsk_…`) is a server's. Only its hash is kept, it is shown once at the moment it is made, and a
 *   request that carries an `Origin` is refused whatever the key says — a browser never holds one, so there is no
 *   allowlist that could make it safe there.
 * - A **public key** (`rpk_…`) is a browser's. It has no secret at all: the id is the whole credential, so there is
 *   nothing to leak, and what bounds it is the list of origins it answers from plus its scopes.
 *
 * Rights are the team's (TEAM-1, `../team/roles.ts`): reading a project is `view`, making one or drafting an endpoint
 * is `draft`, issuing, rotating and revoking a credential is `submit`, and the delivery log is `receipts`. This file
 * names which right each action needs; the server asks `authorizeTeamAction` and refuses on its answer.
 *
 * Tariffs are not here. The shape a tariff would have is named (`DEV_PLAN_FIELDS`) and nothing fills it: no price,
 * no included call count and no ceiling is stated anywhere in this repository.
 *
 * Pure: no I/O, no clock of its own, no `process.env`.
 */

import type { TeamPermission } from "../team/roles.ts";

/** A project has both from the day it is made: nothing is promoted, and a test key never reaches live data. */
export const DEV_ENVIRONMENTS = ["test", "live"] as const;
export type DevEnvironment = (typeof DEV_ENVIRONMENTS)[number];

export const DEV_CREDENTIAL_KINDS = ["SECRET", "PUBLIC"] as const;
export type DevCredentialKind = (typeof DEV_CREDENTIAL_KINDS)[number];

/**
 * What a credential may read. Only what a route actually checks is listed: a scope naming a surface no route gates is
 * a promise, and the point of this list is that holding one changes an answer. The surface grows by routes adopting
 * the check, not by names being added here.
 */
export const DEV_SCOPES = ["read:key", "read:usage", "read:events"] as const;
export type DevScope = (typeof DEV_SCOPES)[number];

export const DEV_KEY_STATES = ["ACTIVE", "ROTATING", "REVOKED"] as const;
export type DevKeyState = (typeof DEV_KEY_STATES)[number];

/** The only event there is to subscribe to today — the console's own test delivery. Product events join it with the tasks that produce them. */
export const DEV_WEBHOOK_EVENTS = ["ping"] as const;
export type DevWebhookEvent = (typeof DEV_WEBHOOK_EVENTS)[number];

export const DEV_QUOTA_WINDOWS = ["minute", "day", "month"] as const;
export type DevQuotaWindow = (typeof DEV_QUOTA_WINDOWS)[number];

/* ------------------------------------------------------------------ rights */

/** What a console action is in the team's own vocabulary (TEAM-1 spec §9.2); no action here invents a right. */
export const DEV_ACTIONS = ["readProject", "createProject", "draftEndpoint", "issueKey", "rotateKey", "revokeKey", "changeKey", "changeEndpoint", "sendTest", "readDeliveries"] as const;
export type DevAction = (typeof DEV_ACTIONS)[number];

export const DEV_ACTION_PERMISSION: Readonly<Record<DevAction, TeamPermission>> = Object.freeze({
  readProject: "view",
  createProject: "draft",
  draftEndpoint: "draft",
  issueKey: "submit",
  rotateKey: "submit",
  revokeKey: "submit",
  changeKey: "submit",
  changeEndpoint: "submit",
  sendTest: "submit",
  readDeliveries: "receipts",
});

/* ------------------------------------------------------------------ bounds */

/**
 * Operational bounds, not a tariff: they keep one team from filling the store, and they are the same for everyone on
 * every deployment. A number that would differ by what somebody pays is not here.
 */
export const DEV_LIMITS = Object.freeze({
  projectsPerTeam: 10,
  /** Live credentials of one kind in one environment of one project; a revoked one holds no place. */
  keysPerEnvironment: 10,
  endpointsPerProject: 10,
  originsPerKey: 20,
  /** Hours an old secret still answers after a rotation, at most; 0 ends it the moment the new one is made. */
  rotationGraceHoursMax: 72,
  /** Seconds either side of a delivery's own timestamp that a receiver should still accept it. */
  webhookWindowSeconds: 300,
  /** Delivery rows a project keeps, and the most one read returns. */
  deliveriesKept: 200,
  nameMax: 64,
  urlMax: 300,
  /** Attempts one delivery makes before it is left failed. */
  deliveryAttempts: 3,
});

/** The shape a tariff has. Nothing fills it here: every figure in it is set outside this repository. */
export const DEV_PLAN_FIELDS = ["id", "name", "callsPerMinute", "callsPerDay", "callsPerMonth", "keys", "endpoints", "priceUsdPerMonth", "overageUsdPerThousandCalls"] as const;
export type DevPlanField = (typeof DEV_PLAN_FIELDS)[number];

/* ------------------------------------------------------------- identifiers */

export const DEV_PROJECT_ID = /^[0-9a-f]{24}$/;
export const DEV_ENDPOINT_ID = /^[0-9a-f]{24}$/;
export const DEV_DELIVERY_ID = /^[0-9a-f]{32}$/;

/** `rsk_live_<43>` or `rpk_test_<43>`: the prefix says what the thing is and where it belongs before anything is looked up. */
export const DEV_KEY_ID = /^(rsk|rpk)_(test|live)_[A-Za-z0-9_-]{43}$/;

export const isProjectId = (value: string): boolean => DEV_PROJECT_ID.test(value);
export const isEndpointId = (value: string): boolean => DEV_ENDPOINT_ID.test(value);
export const isDeliveryId = (value: string): boolean => DEV_DELIVERY_ID.test(value);
export const isKeyId = (value: string): boolean => DEV_KEY_ID.test(value);

/** What a key id says about itself — read before the store, so a key of the wrong environment never costs a lookup. */
export function readKeyId(id: string): Readonly<{ kind: DevCredentialKind; environment: DevEnvironment }> | null {
  const match = /^(rsk|rpk)_(test|live)_[A-Za-z0-9_-]{43}$/.exec(id);
  if (!match) return null;
  return { kind: match[1] === "rsk" ? "SECRET" : "PUBLIC", environment: match[2] as DevEnvironment };
}

/* ------------------------------------------------------------------ origins */

/**
 * An origin as a browser sends it: scheme, host and, where it is not the scheme's own, a port. No path, no query, no
 * trailing slash, no credentials — anything else is a string somebody hoped would match.
 */
export function cleanOrigin(raw: string): string | null {
  const text = raw.trim();
  if (text.length === 0 || text.length > 200) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  /* `http://` is a localhost thing: anywhere else it is a credential travelling in clear text. */
  if (url.protocol === "http:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") return null;
  if (url.username || url.password) return null;
  if (url.pathname !== "/" || url.search || url.hash) return null;
  /* A host a browser can actually be at. A wildcard is refused rather than kept as a literal nothing matches: an
     allowlist that silently never fires is worse than one that says no. */
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(url.hostname)) return null;
  /* What is kept is the origin the browser will actually send: the host lowercased and a port the scheme already
     implies dropped, so `https://a.example.com:443` and `https://a.example.com` are one entry rather than two. */
  return url.origin;
}

/** Whether a browser at `origin` may use a key whose list is `allowed`. An empty list allows nothing: a key with no origin is no browser's. */
export function originAllowed(allowed: readonly string[], origin: string | null): boolean {
  if (origin === null) return false;
  const clean = cleanOrigin(origin);
  return clean !== null && allowed.includes(clean);
}

/* ------------------------------------------------------------------- quota */

/**
 * The key of the window a moment falls in. A counter is per project, per environment and per window key, so a day
 * rolls over by its name rather than by anything being swept.
 */
export function windowKey(window: DevQuotaWindow, at: Date): string {
  const iso = at.toISOString();
  if (window === "minute") return `minute:${iso.slice(0, 16)}`;
  if (window === "day") return `day:${iso.slice(0, 10)}`;
  return `month:${iso.slice(0, 7)}`;
}

/** When the window a moment falls in starts again. */
export function windowResetsAt(window: DevQuotaWindow, at: Date): string {
  const t = new Date(at);
  if (window === "minute") {
    t.setUTCSeconds(0, 0);
    t.setUTCMinutes(t.getUTCMinutes() + 1);
  } else if (window === "day") {
    t.setUTCHours(0, 0, 0, 0);
    t.setUTCDate(t.getUTCDate() + 1);
  } else {
    t.setUTCHours(0, 0, 0, 0);
    t.setUTCDate(1);
    t.setUTCMonth(t.getUTCMonth() + 1);
  }
  return t.toISOString();
}

export type DevQuotaState = Readonly<{
  window: DevQuotaWindow;
  used: number;
  /** Null where the project's owner has set no number for this window: the calls are still counted, and nothing is refused on a guess. */
  limit: number | null;
  /** Null with no limit — what is left of a number nobody set is not zero and not infinity, it is unstated. */
  left: number | null;
  resetsAt: string;
}>;

export type DevQuotaLimits = Readonly<Record<DevQuotaWindow, number | null>>;

/** Every window's state at one moment, and whether this call may be served at all. */
export function quotaState(limits: DevQuotaLimits, used: Readonly<Record<DevQuotaWindow, number>>, at: Date): readonly DevQuotaState[] {
  return DEV_QUOTA_WINDOWS.map((window) => {
    const limit = limits[window];
    const spent = used[window] ?? 0;
    return { window, used: spent, limit, left: limit === null ? null : Math.max(0, limit - spent), resetsAt: windowResetsAt(window, at) };
  });
}

/**
 * The first window whose number the project's owner set and whose calls are spent, or null. Asked *after* the call
 * has been counted, so a limit of three serves the third call and refuses the fourth.
 */
export function quotaExceeded(state: readonly DevQuotaState[]): DevQuotaState | null {
  return state.find((row) => row.limit !== null && row.used > row.limit) ?? null;
}

/* ------------------------------------------------------------------- names */

export function cleanName(raw: string): string | null {
  const name = raw.normalize("NFC").replace(/\s+/g, " ").trim();
  if (name.length < 1 || name.length > DEV_LIMITS.nameMax) return null;
  if (/[\u0000-\u001f\u007f<>]/.test(name)) return null;
  return name;
}

/**
 * Where a delivery may be sent: `https` and a public host. A loopback or a private address would make the sender a
 * way to reach the inside of the network from the outside, which is what a webhook url is otherwise perfect for.
 *
 * What this does not catch, stated rather than implied: a public name that resolves to a private address. Closing
 * that needs the address checked at the moment of connecting, not at the moment of saving, and the sender does not
 * do it yet. What stands between the two is that a delivery goes nowhere until a member with `submit` turns the
 * endpoint on, and that the sender reads nothing back but a status.
 */
export function cleanWebhookUrl(raw: string): string | null {
  const text = raw.trim();
  if (text.length === 0 || text.length > DEV_LIMITS.urlMax) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password || url.hash) return null;
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":") || host.startsWith("[")) return null;
  if (!host.includes(".")) return null;
  return url.toString();
}

/** The scopes a credential may hold: known, without repeats, in the catalogue's order. */
export function cleanScopes(raw: readonly string[]): readonly DevScope[] | null {
  if (raw.length === 0) return null;
  const known = new Set<string>(DEV_SCOPES);
  for (const scope of raw) if (!known.has(scope)) return null;
  return DEV_SCOPES.filter((scope) => raw.includes(scope));
}
