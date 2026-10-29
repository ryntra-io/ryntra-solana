/**
 * The developer console on the server (DEV-2; spec §11.3, §11.6, §11.8): projects and their two environments, the
 * credentials that reach the API, the endpoints Ryntra signs deliveries to, and what a project has spent of its
 * quota. The rules are `../core/developer/console.ts`; the records are `./store.ts`.
 *
 * Three things this file is written around.
 *
 * 1. **A secret is shown once.** `issueKey` and `rotateKey` return the token in their own answer and nothing else
 *    ever does: the store holds a SHA-256 of it, and `keyView` has no field for one. A person who loses it rotates.
 * 2. **Rights are the team's.** Every action asks `authorize` — in production `authorizeTeamAction` (TEAM-1) against
 *    the stored member list, on every request — for the right `DEV_ACTION_PERMISSION` names. A hidden button is not
 *    a refusal, and this file invents no right of its own.
 * 3. **A credential is checked whole.** `authenticateKey` reads the state, the environment, the scope, the origin
 *    and the quota in that order, and a failure of any of them is a refusal with its own code rather than a
 *    pretended success.
 *
 * Nothing here signs a transaction, holds a wallet key or moves money.
 *
 * Server only.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import {
  DEV_ACTION_PERMISSION,
  DEV_ENVIRONMENTS,
  DEV_LIMITS,
  DEV_SCOPES,
  DEV_WEBHOOK_EVENTS,
  cleanName,
  cleanOrigin,
  cleanScopes,
  cleanWebhookUrl,
  isEndpointId,
  isKeyId,
  isProjectId,
  originAllowed,
  quotaExceeded,
  quotaState,
  readKeyId,
  windowKey,
  type DevAction,
  type DevCredentialKind,
  type DevEnvironment,
  type DevQuotaLimits,
  type DevQuotaWindow,
  type DevScope,
  type DevWebhookEvent,
} from "../core/developer/console.ts";
import type { DevKeyIssuedResponse, DevProjectResponse, DevProjectsResponse } from "../api/v1/contract.ts";
import type { TeamRefusal, TeamRole } from "../core/team/roles.ts";
import { newDeliveryId, newWebhookSecret, signWebhook, verifyWebhook, type WebhookRefusal } from "./webhooks.ts";
import {
  DevStoreUnavailable,
  type DevDeliveryRecord,
  type DevEndpointRecord,
  type DevKeyRecord,
  type DevNetwork,
  type DevProjectRecord,
  type DevProjectState,
  type DevStore,
  type DevWrite,
} from "./store.ts";

/* -------------------------------------------------------------------- deps */

/** What the team said about one wallet and one right, or that it could not be asked. */
export type DevAuthority = Readonly<{ allowed: boolean; role: TeamRole | null; refusal: TeamRefusal | null }> | Readonly<{ unavailable: true; message: string }>;

export type DevAuthorize = (input: Readonly<{ teamId: string; wallet: string; permission: string }>) => Promise<DevAuthority>;

/** How a delivery actually leaves. Injected so the tests send nothing and the sender has one place to be bounded. */
export type DevSend = (input: Readonly<{ url: string; body: string; headers: Readonly<Record<string, string>> }>) => Promise<Readonly<{ status: number }>>;

export type DevDeps = Readonly<{
  store: DevStore;
  network: DevNetwork;
  now: () => Date;
  authorize: DevAuthorize;
  send: DevSend;
  /** The numbers the project's owner set for this deployment; every one may be null, and then nothing is refused on a guess. */
  quota: DevQuotaLimits;
  newProjectId?: () => string;
  newEndpointId?: () => string;
}>;

/* ----------------------------------------------------------------- failures */

export const DEV_FAILURE_CODES = ["INVALID", "NOT_FOUND", "FORBIDDEN", "LIMIT", "CHANGED", "KEY_INVALID", "ORIGIN_REFUSED", "SCOPE_REFUSED", "QUOTA_EXCEEDED", "UNAVAILABLE"] as const;
export type DevFailureCode = (typeof DEV_FAILURE_CODES)[number];
export type DevFailure = Readonly<{ ok: false; code: DevFailureCode; message: string; refusal?: TeamRefusal | null; quota?: readonly DevQuotaView[] }>;
const fail = (code: DevFailureCode, message: string, extra: Omit<DevFailure, "ok" | "code" | "message"> = {}): DevFailure => ({ ok: false, code, message, ...extra });

/** The store's own refusal to answer becomes UNAVAILABLE; nothing reads it as «no project». */
async function guarded<T>(work: () => Promise<T | DevFailure>): Promise<T | DevFailure> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof DevStoreUnavailable)
      return fail("UNAVAILABLE", error.reason === "NOT_PROVISIONED" ? "The developer console is not provisioned on this deployment yet." : "The console store did not answer; try again.");
    throw error;
  }
}

/* -------------------------------------------------------------------- views */

/**
 * The shapes the console answers in are the contract's own (1.83.0), not a second set beside it: a field this file
 * could carry but the contract does not is a field that cannot be served, and a key's secret is not among them —
 * `DevKeyView` has no place to put one.
 */
export type DevProjectView = DevProjectResponse["project"];
export type DevKeyView = DevProjectView["keys"][number];
export type DevEndpointView = DevProjectView["endpoints"][number];
export type DevQuotaView = DevProjectView["usage"][number]["windows"][number];

const keyView = (row: DevKeyRecord): DevKeyView => ({
  id: row.id,
  environment: row.environment,
  kind: row.kind,
  name: row.name,
  scopes: [...row.scopes],
  origins: [...row.origins],
  state: row.state,
  createdAt: row.createdAt,
  createdBy: row.createdBy,
  lastUsedAt: row.lastUsedAt,
  expiresAt: row.expiresAt,
  revokedAt: row.revokedAt,
  rotatedTo: row.rotatedTo,
});

const endpointView = (row: DevEndpointRecord): DevEndpointView => ({
  id: row.id,
  environment: row.environment,
  url: row.url,
  events: [...row.events],
  enabled: row.enabled,
  createdAt: row.createdAt,
  createdBy: row.createdBy,
  previousUntil: row.previousUntil,
});

/* ------------------------------------------------------------------ helpers */

const newId = () => randomBytes(12).toString("hex");
const hash = (value: string): string => createHash("sha256").update(value).digest("hex");
const secretPart = () => randomBytes(32).toString("base64url");

const sameHash = (a: string, b: string): boolean => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

/** `rsk_live_…` / `rpk_test_…`: the prefix carries the kind and the environment, so neither is a lookup. */
const newKeyId = (kind: DevCredentialKind, environment: DevEnvironment) => `${kind === "SECRET" ? "rsk" : "rpk"}_${environment}_${secretPart()}`;

const isEnvironment = (value: string): value is DevEnvironment => (DEV_ENVIRONMENTS as readonly string[]).includes(value);

/** A key that answers now: active, or rotating and still inside its grace. */
function live(key: DevKeyRecord, now: number): boolean {
  if (key.state === "REVOKED") return false;
  if (key.state === "ROTATING") return key.expiresAt !== null && Date.parse(key.expiresAt) > now;
  return true;
}

const windowKeys = (at: Date): Readonly<Record<DevQuotaWindow, string>> => ({ minute: windowKey("minute", at), day: windowKey("day", at), month: windowKey("month", at) });

/**
 * May this wallet do this here? The team decides; this only names the right and turns a refusal into the console's
 * own vocabulary. Anything but a plain yes is a no: an unreadable team is never an allowance.
 */
async function may(deps: DevDeps, project: DevProjectRecord, wallet: string, action: DevAction): Promise<Readonly<{ ok: true; role: TeamRole | null }> | DevFailure> {
  const answer = await deps.authorize({ teamId: project.teamId, wallet, permission: DEV_ACTION_PERMISSION[action] });
  if ("unavailable" in answer) return fail("UNAVAILABLE", answer.message);
  /* A wallet outside the team learns nothing: the same answer as a project that is not there. */
  if (answer.refusal === "NOT_A_MEMBER") return fail("NOT_FOUND", "No such project.");
  if (!answer.allowed) return fail("FORBIDDEN", `Your role does not hold the right this needs (${DEV_ACTION_PERMISSION[action]}).`, { refusal: answer.refusal });
  return { ok: true, role: answer.role };
}

/** A change decided on the project as read and committed only while it is still that version. Three rounds, then CHANGED. */
async function change(deps: DevDeps, id: string, decide: (state: DevProjectState, at: string) => Readonly<{ writes: readonly DevWrite[] }> | DevFailure): Promise<Readonly<{ ok: true; state: DevProjectState }> | DevFailure> {
  for (let round = 0; round < 3; round += 1) {
    const state = await deps.store.read(id);
    if (!state || state.project.network !== deps.network) return fail("NOT_FOUND", "No such project.");
    const decided = decide(state, deps.now().toISOString());
    if ("ok" in decided) return decided;
    if (await deps.store.commit(id, state.project.version, decided.writes)) {
      const after = await deps.store.read(id);
      if (after) return { ok: true, state: after };
    }
  }
  return fail("CHANGED", "The project changed while this was decided; read it again.");
}

/* ------------------------------------------------------------------ reading */

async function projectView(deps: DevDeps, state: DevProjectState, wallet: string, role: TeamRole | null): Promise<DevProjectView> {
  const at = deps.now();
  const windows = windowKeys(at);
  const usage: DevProjectView["usage"] = [];
  for (const environment of DEV_ENVIRONMENTS) {
    const used = await deps.store.usage(state.project.id, environment, windows);
    usage.push({ environment, windows: [...quotaState(deps.quota, used, at)] });
  }
  /* The rights are asked of the team rather than guessed from the role, because the server's answer is the only one
     that decides anything and the page should offer exactly what it would allow. Ten actions name four rights, and
     the question is per right — so it is asked four times, not ten. */
  const asked = new Map<string, boolean>();
  for (const permission of new Set(Object.values(DEV_ACTION_PERMISSION))) {
    const answer = await deps.authorize({ teamId: state.project.teamId, wallet, permission });
    asked.set(permission, "unavailable" in answer ? false : answer.allowed);
  }
  const may = Object.fromEntries((Object.keys(DEV_ACTION_PERMISSION) as DevAction[]).map((action) => [action, asked.get(DEV_ACTION_PERMISSION[action]) ?? false])) as Record<DevAction, boolean>;
  return {
    id: state.project.id,
    teamId: state.project.teamId,
    network: state.project.network,
    name: state.project.name,
    createdAt: state.project.createdAt,
    createdBy: state.project.createdBy,
    version: state.project.version,
    keys: state.keys.map(keyView),
    endpoints: state.endpoints.map(endpointView),
    usage,
    you: { role, may },
  };
}

export async function listProjects(deps: DevDeps, input: Readonly<{ teamId: string; wallet: string }>): Promise<Readonly<{ ok: true; projects: DevProjectsResponse["projects"] }> | DevFailure> {
  return guarded(async () => {
    const answer = await deps.authorize({ teamId: input.teamId, wallet: input.wallet, permission: DEV_ACTION_PERMISSION.readProject });
    if ("unavailable" in answer) return fail("UNAVAILABLE", answer.message);
    if (!answer.allowed) return fail("NOT_FOUND", "No such team.");
    const rows = await deps.store.byTeam(deps.network, input.teamId);
    const projects: DevProjectsResponse["projects"] = [];
    for (const row of rows) {
      const state = await deps.store.read(row.id);
      projects.push({ id: row.id, name: row.name, createdAt: row.createdAt, keys: state?.keys.filter((key) => key.state !== "REVOKED").length ?? 0, endpoints: state?.endpoints.length ?? 0 });
    }
    return { ok: true as const, projects };
  });
}

export async function readProject(deps: DevDeps, input: Readonly<{ id: string; wallet: string }>): Promise<Readonly<{ ok: true; project: DevProjectView }> | DevFailure> {
  return guarded(async () => {
    if (!isProjectId(input.id)) return fail("NOT_FOUND", "No such project.");
    const state = await deps.store.read(input.id);
    if (!state || state.project.network !== deps.network) return fail("NOT_FOUND", "No such project.");
    const allowed = await may(deps, state.project, input.wallet, "readProject");
    if (!allowed.ok) return allowed;
    return { ok: true as const, project: await projectView(deps, state, input.wallet, allowed.role) };
  });
}

/* ------------------------------------------------------------------ projects */

export async function createProject(deps: DevDeps, input: Readonly<{ teamId: string; wallet: string; name: string }>): Promise<Readonly<{ ok: true; project: DevProjectView }> | DevFailure> {
  return guarded(async () => {
    const name = cleanName(input.name);
    if (!name) return fail("INVALID", `name: one to ${DEV_LIMITS.nameMax} characters, no markup.`);
    const answer = await deps.authorize({ teamId: input.teamId, wallet: input.wallet, permission: DEV_ACTION_PERMISSION.createProject });
    if ("unavailable" in answer) return fail("UNAVAILABLE", answer.message);
    if (answer.refusal === "NOT_A_MEMBER") return fail("NOT_FOUND", "No such team.");
    if (!answer.allowed) return fail("FORBIDDEN", "Your role does not make a project here.", { refusal: answer.refusal });
    const mine = await deps.store.byTeam(deps.network, input.teamId);
    if (mine.length >= DEV_LIMITS.projectsPerTeam) return fail("LIMIT", `A team holds at most ${DEV_LIMITS.projectsPerTeam} projects.`);
    const at = deps.now().toISOString();
    const project: DevProjectRecord = { id: (deps.newProjectId ?? newId)(), teamId: input.teamId, network: deps.network, name, createdBy: input.wallet, createdAt: at, version: 0 };
    if (!(await deps.store.create(project))) return fail("CHANGED", "The project could not be made; try again.");
    const state = await deps.store.read(project.id);
    if (!state) return fail("UNAVAILABLE", "The project was made but could not be read back; open your projects.");
    return { ok: true as const, project: await projectView(deps, state, input.wallet, answer.role) };
  });
}

/* ---------------------------------------------------------------------- keys */

export type IssueKeyInput = Readonly<{ projectId: string; wallet: string; environment: string; kind: string; name: string; scopes: readonly string[]; origins?: readonly string[] }>;

/** What a caller is handed once and never again. */
export type DevSecretOnce = DevKeyIssuedResponse["issued"];

type Minted = Readonly<{ key: DevKeyRecord; secret: string | null }>;

function buildKey(input: Readonly<{ projectId: string; wallet: string; environment: DevEnvironment; kind: DevCredentialKind; name: string; scopes: readonly DevScope[]; origins: readonly string[]; at: string }>): Minted {
  const id = newKeyId(input.kind, input.environment);
  /* A public key is the id and nothing else: there is no secret, so there is none to leak from a browser. A secret
     key's token is the id and a part only its holder ever sees — the store keeps the hash of that part. */
  const part = input.kind === "SECRET" ? secretPart() : null;
  return {
    key: {
      id,
      projectId: input.projectId,
      environment: input.environment,
      kind: input.kind,
      name: input.name,
      secretHash: part === null ? null : hash(part),
      scopes: input.scopes,
      origins: input.origins,
      state: "ACTIVE",
      createdBy: input.wallet,
      createdAt: input.at,
      lastUsedAt: null,
      expiresAt: null,
      revokedAt: null,
      rotatedTo: null,
    },
    secret: part === null ? null : `${id}.${part}`,
  };
}

export async function issueKey(deps: DevDeps, input: IssueKeyInput): Promise<Readonly<{ ok: true; project: DevProjectView; issued: DevSecretOnce }> | DevFailure> {
  return guarded(async () => {
    if (!isProjectId(input.projectId)) return fail("NOT_FOUND", "No such project.");
    if (!isEnvironment(input.environment)) return fail("INVALID", "environment: test or live.");
    if (input.kind !== "SECRET" && input.kind !== "PUBLIC") return fail("INVALID", "kind: SECRET or PUBLIC.");
    const name = cleanName(input.name);
    if (!name) return fail("INVALID", `name: one to ${DEV_LIMITS.nameMax} characters, no markup.`);
    const scopes = cleanScopes(input.scopes);
    if (!scopes) return fail("INVALID", `scopes: at least one of ${DEV_SCOPES.join(", ")}, each known.`);
    const originsRaw = input.origins ?? [];
    if (input.kind === "SECRET" && originsRaw.length > 0) return fail("INVALID", "origins: a secret key is a server's and answers no browser; it holds no origins.");
    if (input.kind === "PUBLIC" && originsRaw.length === 0) return fail("INVALID", "origins: a public key answers only the origins it names; name at least one.");
    if (originsRaw.length > DEV_LIMITS.originsPerKey) return fail("INVALID", `origins: at most ${DEV_LIMITS.originsPerKey}.`);
    const origins: string[] = [];
    for (const raw of originsRaw) {
      const origin = cleanOrigin(raw);
      if (!origin) return fail("INVALID", `origins: «${raw.slice(0, 60)}» is not an origin a browser sends.`);
      if (!origins.includes(origin)) origins.push(origin);
    }

    const state = await deps.store.read(input.projectId);
    if (!state || state.project.network !== deps.network) return fail("NOT_FOUND", "No such project.");
    const allowed = await may(deps, state.project, input.wallet, "issueKey");
    if (!allowed.ok) return allowed;

    let issued: Minted | null = null;
    const changed = await change(deps, input.projectId, (current, at) => {
      const alive = current.keys.filter((key) => key.environment === input.environment && key.kind === input.kind && key.state !== "REVOKED");
      if (alive.length >= DEV_LIMITS.keysPerEnvironment) return fail("LIMIT", `A project holds at most ${DEV_LIMITS.keysPerEnvironment} live keys of one kind in one environment.`);
      const minted = buildKey({ projectId: input.projectId, wallet: input.wallet, environment: input.environment as DevEnvironment, kind: input.kind as DevCredentialKind, name, scopes, origins, at });
      issued = minted;
      return { writes: [{ kind: "key", key: minted.key }] };
    });
    if (!changed.ok) return changed;
    if (!issued) return fail("CHANGED", "The key was not made; read the project again.");
    const made: Minted = issued;
    return { ok: true as const, project: await projectView(deps, changed.state, input.wallet, allowed.role), issued: { key: keyView(made.key), secret: made.secret, shownOnce: true } };
  });
}

/**
 * A rotation makes the successor and puts the predecessor on a clock: for `graceHours` both answer, then only the new
 * one does. A grace of 0 ends the old key the moment the new one exists. The old key's secret is not re-shown — it
 * never was readable — and the new one is shown once, here.
 */
export async function rotateKey(deps: DevDeps, input: Readonly<{ projectId: string; wallet: string; keyId: string; graceHours: number }>): Promise<Readonly<{ ok: true; project: DevProjectView; issued: DevSecretOnce }> | DevFailure> {
  return guarded(async () => {
    if (!isProjectId(input.projectId)) return fail("NOT_FOUND", "No such project.");
    if (!isKeyId(input.keyId)) return fail("NOT_FOUND", "No such key.");
    if (!Number.isInteger(input.graceHours) || input.graceHours < 0 || input.graceHours > DEV_LIMITS.rotationGraceHoursMax) return fail("INVALID", `graceHours: a whole number of hours, 0 to ${DEV_LIMITS.rotationGraceHoursMax}.`);
    const state = await deps.store.read(input.projectId);
    if (!state || state.project.network !== deps.network) return fail("NOT_FOUND", "No such project.");
    const allowed = await may(deps, state.project, input.wallet, "rotateKey");
    if (!allowed.ok) return allowed;

    let issued: Minted | null = null;
    const changed = await change(deps, input.projectId, (current, at) => {
      const old = current.keys.find((key) => key.id === input.keyId) ?? null;
      if (!old) return fail("NOT_FOUND", "No such key.");
      if (old.state === "REVOKED") return fail("INVALID", "A revoked key is not rotated; issue a new one.");
      const minted = buildKey({ projectId: input.projectId, wallet: input.wallet, environment: old.environment, kind: old.kind, name: old.name, scopes: old.scopes, origins: old.origins, at });
      issued = minted;
      const expiresAt = new Date(Date.parse(at) + input.graceHours * 3_600_000).toISOString();
      const retired: DevKeyRecord =
        input.graceHours === 0
          ? { ...old, state: "REVOKED", revokedAt: at, expiresAt: null, rotatedTo: minted.key.id }
          : { ...old, state: "ROTATING", expiresAt, rotatedTo: minted.key.id };
      return { writes: [{ kind: "key", key: minted.key }, { kind: "key", key: retired }] };
    });
    if (!changed.ok) return changed;
    if (!issued) return fail("CHANGED", "The key was not rotated; read the project again.");
    const made: Minted = issued;
    return { ok: true as const, project: await projectView(deps, changed.state, input.wallet, allowed.role), issued: { key: keyView(made.key), secret: made.secret, shownOnce: true } };
  });
}

export async function revokeKey(deps: DevDeps, input: Readonly<{ projectId: string; wallet: string; keyId: string }>): Promise<Readonly<{ ok: true; project: DevProjectView }> | DevFailure> {
  return guarded(async () => {
    if (!isProjectId(input.projectId)) return fail("NOT_FOUND", "No such project.");
    if (!isKeyId(input.keyId)) return fail("NOT_FOUND", "No such key.");
    const state = await deps.store.read(input.projectId);
    if (!state || state.project.network !== deps.network) return fail("NOT_FOUND", "No such project.");
    const allowed = await may(deps, state.project, input.wallet, "revokeKey");
    if (!allowed.ok) return allowed;
    const changed = await change(deps, input.projectId, (current, at) => {
      const key = current.keys.find((row) => row.id === input.keyId) ?? null;
      if (!key) return fail("NOT_FOUND", "No such key.");
      if (key.state === "REVOKED") return fail("INVALID", "This key is revoked already.");
      return { writes: [{ kind: "key", key: { ...key, state: "REVOKED", revokedAt: at, expiresAt: null } }] };
    });
    if (!changed.ok) return changed;
    return { ok: true as const, project: await projectView(deps, changed.state, input.wallet, allowed.role) };
  });
}

/** The bounds of a key that already exists: its scopes and, for a public key, the origins it answers from. */
export async function changeKey(deps: DevDeps, input: Readonly<{ projectId: string; wallet: string; keyId: string; scopes?: readonly string[]; origins?: readonly string[] }>): Promise<Readonly<{ ok: true; project: DevProjectView }> | DevFailure> {
  return guarded(async () => {
    if (!isProjectId(input.projectId)) return fail("NOT_FOUND", "No such project.");
    if (!isKeyId(input.keyId)) return fail("NOT_FOUND", "No such key.");
    if (input.scopes === undefined && input.origins === undefined) return fail("INVALID", "Nothing to change.");
    const scopes = input.scopes === undefined ? null : cleanScopes(input.scopes);
    if (input.scopes !== undefined && !scopes) return fail("INVALID", `scopes: at least one of ${DEV_SCOPES.join(", ")}, each known.`);
    let origins: string[] | null = null;
    if (input.origins !== undefined) {
      if (input.origins.length > DEV_LIMITS.originsPerKey) return fail("INVALID", `origins: at most ${DEV_LIMITS.originsPerKey}.`);
      origins = [];
      for (const raw of input.origins) {
        const origin = cleanOrigin(raw);
        if (!origin) return fail("INVALID", `origins: «${raw.slice(0, 60)}» is not an origin a browser sends.`);
        if (!origins.includes(origin)) origins.push(origin);
      }
    }
    const state = await deps.store.read(input.projectId);
    if (!state || state.project.network !== deps.network) return fail("NOT_FOUND", "No such project.");
    const allowed = await may(deps, state.project, input.wallet, "changeKey");
    if (!allowed.ok) return allowed;
    const changed = await change(deps, input.projectId, (current) => {
      const key = current.keys.find((row) => row.id === input.keyId) ?? null;
      if (!key) return fail("NOT_FOUND", "No such key.");
      if (key.state === "REVOKED") return fail("INVALID", "A revoked key is not changed.");
      if (origins !== null && key.kind === "SECRET" && origins.length > 0) return fail("INVALID", "origins: a secret key answers no browser; it holds no origins.");
      if (origins !== null && key.kind === "PUBLIC" && origins.length === 0) return fail("INVALID", "origins: a public key answers only the origins it names; name at least one.");
      return { writes: [{ kind: "key", key: { ...key, scopes: scopes ?? key.scopes, origins: origins ?? key.origins } }] };
    });
    if (!changed.ok) return changed;
    return { ok: true as const, project: await projectView(deps, changed.state, input.wallet, allowed.role) };
  });
}

/* ----------------------------------------------------------------- endpoints */

const cleanEvents = (raw: readonly string[]): readonly DevWebhookEvent[] | null => {
  if (raw.length === 0) return null;
  const known = new Set<string>(DEV_WEBHOOK_EVENTS);
  for (const event of raw) if (!known.has(event)) return null;
  return DEV_WEBHOOK_EVENTS.filter((event) => raw.includes(event));
};

export async function createEndpoint(
  deps: DevDeps,
  input: Readonly<{ projectId: string; wallet: string; environment: string; url: string; events: readonly string[] }>,
): Promise<Readonly<{ ok: true; project: DevProjectView; endpoint: DevEndpointView; secret: string; shownOnce: true }> | DevFailure> {
  return guarded(async () => {
    if (!isProjectId(input.projectId)) return fail("NOT_FOUND", "No such project.");
    if (!isEnvironment(input.environment)) return fail("INVALID", "environment: test or live.");
    const url = cleanWebhookUrl(input.url);
    if (!url) return fail("INVALID", "url: an https address on a public host.");
    const events = cleanEvents(input.events);
    if (!events) return fail("INVALID", `events: at least one of ${DEV_WEBHOOK_EVENTS.join(", ")}.`);
    const state = await deps.store.read(input.projectId);
    if (!state || state.project.network !== deps.network) return fail("NOT_FOUND", "No such project.");
    const allowed = await may(deps, state.project, input.wallet, "draftEndpoint");
    if (!allowed.ok) return allowed;

    let made: DevEndpointRecord | null = null;
    const changed = await change(deps, input.projectId, (current, at) => {
      if (current.endpoints.length >= DEV_LIMITS.endpointsPerProject) return fail("LIMIT", `A project holds at most ${DEV_LIMITS.endpointsPerProject} endpoints.`);
      const drafted: DevEndpointRecord = {
        id: (deps.newEndpointId ?? newId)(),
        projectId: input.projectId,
        environment: input.environment as DevEnvironment,
        url,
        events,
        /* An endpoint is made off: nothing is delivered to an address until somebody with `submit` turns it on. */
        enabled: false,
        secret: newWebhookSecret(),
        previousSecret: null,
        previousUntil: null,
        createdBy: input.wallet,
        createdAt: at,
      };
      made = drafted;
      return { writes: [{ kind: "endpoint", endpoint: drafted }] };
    });
    if (!changed.ok) return changed;
    if (!made) return fail("CHANGED", "The endpoint was not made; read the project again.");
    const endpoint: DevEndpointRecord = made;
    return { ok: true as const, project: await projectView(deps, changed.state, input.wallet, allowed.role), endpoint: endpointView(endpoint), secret: endpoint.secret, shownOnce: true };
  });
}

export async function changeEndpoint(
  deps: DevDeps,
  input: Readonly<{ projectId: string; wallet: string; endpointId: string; enabled?: boolean; events?: readonly string[]; rotateSecret?: boolean; remove?: boolean }>,
): Promise<Readonly<{ ok: true; project: DevProjectView; secret: string | null }> | DevFailure> {
  return guarded(async () => {
    if (!isProjectId(input.projectId)) return fail("NOT_FOUND", "No such project.");
    if (!isEndpointId(input.endpointId)) return fail("NOT_FOUND", "No such endpoint.");
    const events = input.events === undefined ? null : cleanEvents(input.events);
    if (input.events !== undefined && !events) return fail("INVALID", `events: at least one of ${DEV_WEBHOOK_EVENTS.join(", ")}.`);
    const state = await deps.store.read(input.projectId);
    if (!state || state.project.network !== deps.network) return fail("NOT_FOUND", "No such project.");
    const allowed = await may(deps, state.project, input.wallet, "changeEndpoint");
    if (!allowed.ok) return allowed;

    let secret: string | null = null;
    const changed = await change(deps, input.projectId, (current, at) => {
      const endpoint = current.endpoints.find((row) => row.id === input.endpointId) ?? null;
      if (!endpoint) return fail("NOT_FOUND", "No such endpoint.");
      if (input.remove) return { writes: [{ kind: "endpointRemove", endpointId: endpoint.id }] };
      let next: DevEndpointRecord = { ...endpoint, ...(input.enabled === undefined ? {} : { enabled: input.enabled }), ...(events ? { events } : {}) };
      if (input.rotateSecret) {
        /* Both secrets sign for one window, so a receiver that has not deployed the new one yet keeps verifying. */
        secret = newWebhookSecret();
        next = { ...next, secret, previousSecret: endpoint.secret, previousUntil: new Date(Date.parse(at) + DEV_LIMITS.webhookWindowSeconds * 1000).toISOString() };
      }
      return { writes: [{ kind: "endpoint", endpoint: next }] };
    });
    if (!changed.ok) return changed;
    return { ok: true as const, project: await projectView(deps, changed.state, input.wallet, allowed.role), secret };
  });
}

/* ---------------------------------------------------------------- deliveries */

/** The secrets an endpoint signs with now: the current one, and the previous while its window has not closed. */
function signingSecrets(endpoint: DevEndpointRecord, now: number): readonly string[] {
  const previous = endpoint.previousSecret !== null && endpoint.previousUntil !== null && Date.parse(endpoint.previousUntil) > now ? [endpoint.previousSecret] : [];
  return [endpoint.secret, ...previous];
}

/**
 * A test delivery: the one event there is. It is signed exactly as a product event would be and recorded in the
 * project's log, so a developer debugging their receiver sees what Ryntra actually sent and what came back.
 */
export async function sendTestDelivery(deps: DevDeps, input: Readonly<{ projectId: string; wallet: string; endpointId: string }>): Promise<Readonly<{ ok: true; delivery: DevDeliveryRecord }> | DevFailure> {
  return guarded(async () => {
    if (!isProjectId(input.projectId)) return fail("NOT_FOUND", "No such project.");
    if (!isEndpointId(input.endpointId)) return fail("NOT_FOUND", "No such endpoint.");
    const state = await deps.store.read(input.projectId);
    if (!state || state.project.network !== deps.network) return fail("NOT_FOUND", "No such project.");
    const allowed = await may(deps, state.project, input.wallet, "sendTest");
    if (!allowed.ok) return allowed;
    const endpoint = state.endpoints.find((row) => row.id === input.endpointId) ?? null;
    if (!endpoint) return fail("NOT_FOUND", "No such endpoint.");
    if (!endpoint.enabled) return fail("INVALID", "This endpoint is off; turn it on before sending to it.");

    const at = deps.now();
    const id = newDeliveryId();
    const timestamp = Math.floor(at.getTime() / 1000);
    const body = JSON.stringify({ id, event: "ping", at: at.toISOString(), project: state.project.id, environment: endpoint.environment, data: {} });
    const headers = { "content-type": "application/json", ...signWebhook({ id, timestamp, body, secrets: signingSecrets(endpoint, at.getTime()) }) };

    let status: number | null = null;
    let error: string | null = null;
    let attempts = 0;
    for (; attempts < DEV_LIMITS.deliveryAttempts; attempts += 1) {
      try {
        const answer = await deps.send({ url: endpoint.url, body, headers });
        status = answer.status;
        if (status >= 200 && status < 300) {
          error = null;
          break;
        }
        error = `The receiver answered ${status}.`;
        /* A refusal the receiver meant is not retried: only a server error or nothing at all is worth a second try. */
        if (status < 500) {
          attempts += 1;
          break;
        }
      } catch (cause) {
        status = null;
        error = cause instanceof Error ? cause.message.slice(0, 200) : "The address did not answer.";
      }
    }
    const delivery: DevDeliveryRecord = {
      id,
      projectId: state.project.id,
      endpointId: endpoint.id,
      event: "ping",
      at: at.toISOString(),
      state: error === null ? "DELIVERED" : "FAILED",
      attempts: Math.max(1, attempts),
      status,
      error,
    };
    await deps.store.recordDelivery(delivery, DEV_LIMITS.deliveriesKept);
    return { ok: true as const, delivery };
  });
}

export async function readDeliveries(deps: DevDeps, input: Readonly<{ projectId: string; wallet: string }>): Promise<Readonly<{ ok: true; deliveries: readonly DevDeliveryRecord[] }> | DevFailure> {
  return guarded(async () => {
    if (!isProjectId(input.projectId)) return fail("NOT_FOUND", "No such project.");
    const state = await deps.store.read(input.projectId);
    if (!state || state.project.network !== deps.network) return fail("NOT_FOUND", "No such project.");
    const allowed = await may(deps, state.project, input.wallet, "readDeliveries");
    if (!allowed.ok) return allowed;
    return { ok: true as const, deliveries: await deps.store.deliveries(input.projectId, DEV_LIMITS.deliveriesKept) };
  });
}

/**
 * Ryntra's own check of a delivery a receiver got: the signature against the endpoint's secrets, the timestamp
 * against the window, and the delivery's id against what this endpoint has already had verified. The third is the
 * one that makes a replay fail — the same bytes with the same signature verify for ever otherwise — and it is kept
 * on the server, where a caller cannot forget it.
 */
export async function verifyDelivery(
  deps: DevDeps,
  input: Readonly<{ projectId: string; wallet: string; endpointId: string; body: string; headers: Readonly<Record<string, string>> }>,
): Promise<Readonly<{ ok: true; verified: boolean; refusal: WebhookRefusal | null; deliveryId: string | null }> | DevFailure> {
  return guarded(async () => {
    if (!isProjectId(input.projectId)) return fail("NOT_FOUND", "No such project.");
    if (!isEndpointId(input.endpointId)) return fail("NOT_FOUND", "No such endpoint.");
    const state = await deps.store.read(input.projectId);
    if (!state || state.project.network !== deps.network) return fail("NOT_FOUND", "No such project.");
    const allowed = await may(deps, state.project, input.wallet, "readDeliveries");
    if (!allowed.ok) return allowed;
    const endpoint = state.endpoints.find((row) => row.id === input.endpointId) ?? null;
    if (!endpoint) return fail("NOT_FOUND", "No such endpoint.");
    const at = deps.now();
    const answer = await verifyWebhook({
      body: input.body,
      headers: input.headers,
      secrets: signingSecrets(endpoint, at.getTime()),
      now: at,
      windowSeconds: DEV_LIMITS.webhookWindowSeconds,
      seen: (id) => deps.store.markSeen(endpoint.id, id, at.toISOString(), DEV_LIMITS.webhookWindowSeconds * 4),
    });
    return answer.ok ? { ok: true as const, verified: true, refusal: null, deliveryId: answer.id } : { ok: true as const, verified: false, refusal: answer.refusal, deliveryId: null };
  });
}

/** The same log, read by a credential that holds `read:events` rather than by a wallet. */
export async function deliveriesForKey(deps: DevDeps, projectId: string): Promise<Readonly<{ ok: true; deliveries: readonly DevDeliveryRecord[] }> | DevFailure> {
  return guarded(async () => ({ ok: true as const, deliveries: await deps.store.deliveries(projectId, DEV_LIMITS.deliveriesKept) }));
}

/* ------------------------------------------------------- the key on a request */

export type DevPrincipal = Readonly<{
  key: DevKeyView;
  project: Readonly<{ id: string; teamId: string; name: string }>;
  environment: DevEnvironment;
  quota: DevQuotaView[];
}>;

/**
 * The credential on a request, checked whole. In order: the shape of the token, the key, its state, the environment
 * it names, the secret (constant-time), the scope the route asks for, the origin, and finally the quota — which is
 * the only step that writes, so nothing is counted against a project whose key was never going to be served.
 *
 * `origin` is the request's own `Origin` header, or null when it carries none. A secret key is refused outright when
 * one is present: a browser is sending it, which is the thing a secret key must never be in, and no allowlist makes
 * that safe.
 */
export async function authenticateKey(
  deps: DevDeps,
  input: Readonly<{ token: string | null; scope: DevScope; origin: string | null }>,
): Promise<Readonly<{ ok: true; principal: DevPrincipal }> | DevFailure> {
  return guarded(async () => {
    const token = (input.token ?? "").trim();
    if (token.length === 0) return fail("KEY_INVALID", "No key on the request.");
    const [id, part = null] = token.split(".", 2);
    const read = readKeyId(id);
    if (!read) return fail("KEY_INVALID", "That is not a Ryntra key.");
    if (read.kind === "SECRET" && part === null) return fail("KEY_INVALID", "A secret key is sent whole, as id.secret.");
    if (read.kind === "PUBLIC" && part !== null) return fail("KEY_INVALID", "A public key is the id alone.");

    const key = await deps.store.key(id);
    const now = deps.now();
    /* An unknown key and a revoked one answer the same way: a probe learns nothing from the difference. */
    if (!key || !live(key, now.getTime())) return fail("KEY_INVALID", "That key does not answer: it is unknown, revoked, or past its rotation.");
    if (key.kind === "SECRET") {
      if (key.secretHash === null || part === null || !sameHash(hash(part), key.secretHash)) return fail("KEY_INVALID", "That key does not answer: it is unknown, revoked, or past its rotation.");
      /* The one rule that makes «never in a browser» true rather than advised. */
      if (input.origin !== null) return fail("ORIGIN_REFUSED", "A secret key is a server's: a request carrying an Origin is refused. Use a public key in a browser.");
    } else if (!originAllowed(key.origins, input.origin)) {
      return fail("ORIGIN_REFUSED", "This key answers only the origins it names.");
    }
    if (!key.scopes.includes(input.scope)) return fail("SCOPE_REFUSED", `This key does not hold ${input.scope}.`);

    const state = await deps.store.read(key.projectId);
    if (!state || state.project.network !== deps.network) return fail("KEY_INVALID", "That key does not answer: it is unknown, revoked, or past its rotation.");

    const windows = windowKeys(now);
    const used = await deps.store.consume(key.projectId, key.environment, windows, now.toISOString());
    const quota: DevQuotaView[] = [...quotaState(deps.quota, used, now)];
    /* Counted first, then judged: the call that passes the limit is the one refused, and a refused call counts too —
       a client hammering a spent window does not get a free retry loop out of it. */
    const spent = quotaExceeded(quota);
    if (spent) return fail("QUOTA_EXCEEDED", `The ${spent.window}'s calls are spent (${spent.limit} of ${spent.limit}); it starts again at ${spent.resetsAt}.`, { quota });

    await deps.store.touchKey(key.id, now.toISOString());
    return {
      ok: true as const,
      principal: { key: keyView({ ...key, lastUsedAt: now.toISOString() }), project: { id: state.project.id, teamId: state.project.teamId, name: state.project.name }, environment: key.environment, quota },
    };
  });
}
