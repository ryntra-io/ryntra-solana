/**
 * When Hack answers people (CITY-226), on which store, and as whom on a developer's stand. Pure, so the rules are tested
 * without a server; `server.ts` applies them to the deployment's own settings.
 *
 * Closed by default: every `/api/arena/hack/**` route is a 404 until `NEXT_PUBLIC_RYNTRA_CITY_HACK` says `open`, as the
 * Ring's duels wait for theirs. In production the store must also be the database every instance shares
 * (`supabase/migrations/20261108180000_hack_v1.sql`): on one instance's memory production stays closed, whatever the
 * switch says. And since CITY-238 production opens only with the machine that plays the runs: a sandbox with no
 * network to start from, and the harness's stamp key (`machineSetup`). Without them the door stays shut — Hack is
 * never opened on a sandbox that is only a thread of the routes' own process.
 */

type Env = Record<string, string | undefined>;

/** The switch: the same name the city reads for the Arena's third door. */
export const HACK_FLAG = "NEXT_PUBLIC_RYNTRA_CITY_HACK";

/**
 * The database wherever a deployment runs; on a developer's machine the memory store, unless
 * `RYNTRA_HACK_STORE=database` asks for the database there too. Without the database's settings it is memory
 * everywhere — and then production keeps Hack closed (`hackReady`).
 */
export function hackStoreKind(env: Env): "database" | "memory" {
  const configured = !!(env.SUPABASE_URL && env.SUPABASE_ANON_KEY && env.BETA_APP_SECRET);
  const wanted = env.NODE_ENV === "production" || env.RYNTRA_HACK_STORE === "database";
  return configured && wanted ? "database" : "memory";
}

/**
 * Whether Hack answers people: the switch says `open`, and in production the store is shared by every instance and
 * the machine with no network is set up (`machine` — `machineSetup(env).ready`).
 */
export function hackReady(store: { readonly durable: boolean }, flag: string | undefined, mode: string | undefined, machine = false): boolean {
  return flag?.trim() === "open" && (mode !== "production" || (store.durable && machine));
}

/** The settings of the machine that plays the runs (CITY-238). Names only: the values live in the deployment. */
export const HACK_ENV = {
  /** The image's snapshot in Vercel Sandbox (`machine/image.mjs --vercel` prints it). */
  snapshot: "RYNTRA_HACK_SANDBOX_SNAPSHOT",
  /** The Vercel project the machines belong to; the deployment's own (`VERCEL_PROJECT_ID`) when not named. */
  project: "RYNTRA_HACK_SANDBOX_PROJECT",
  /** The Vercel team of that project. */
  team: "RYNTRA_HACK_SANDBOX_TEAM",
  /** An access token for Vercel's API, if the deployment's own OIDC token is not to be used. A secret. */
  token: "RYNTRA_HACK_SANDBOX_TOKEN",
  /** The harness's Ed25519 private key (PKCS#8 PEM) that stamps a run's log: the server's environment, never the repository. */
  stamp: "RYNTRA_HACK_STAMP_KEY",
  /** The day's ceiling on what Hack's models spend, in dollars. */
  ceiling: "RYNTRA_HACK_DAILY_USD",
} as const;

export type MachineSetup = {
  /** Everything a run on the machine needs is named. */
  readonly ready: boolean;
  /** The settings still missing, by name. */
  readonly missing: readonly string[];
  readonly snapshotId: string | null;
  readonly projectId: string | null;
  readonly teamId: string | null;
};

const SNAPSHOT = /^snap_[A-Za-z0-9]{8,64}$/;
const VERCEL_ID = /^[A-Za-z0-9_-]{4,64}$/;

/**
 * How the machine is set up on this deployment: the image's snapshot, the project (and team) its machines belong to,
 * and the stamp key. The token is not asked for here — the deployment has its own.
 */
export function machineSetup(env: Env): MachineSetup {
  const snapshot = env[HACK_ENV.snapshot]?.trim() ?? "";
  const project = env[HACK_ENV.project]?.trim() || env.VERCEL_PROJECT_ID?.trim() || "";
  const team = env[HACK_ENV.team]?.trim() || env.VERCEL_TEAM_ID?.trim() || "";
  const missing: string[] = [];
  if (!SNAPSHOT.test(snapshot)) missing.push(HACK_ENV.snapshot);
  if (!VERCEL_ID.test(project)) missing.push(HACK_ENV.project);
  if (!env[HACK_ENV.stamp]?.trim()) missing.push(HACK_ENV.stamp);
  return { ready: missing.length === 0, missing, snapshotId: SNAPSHOT.test(snapshot) ? snapshot : null, projectId: VERCEL_ID.test(project) ? project : null, teamId: VERCEL_ID.test(team) ? team : null };
}

/**
 * A developer's stand (`RYNTRA_HACK_STAND=1`): agents are names, the wallet is the cookie's, the brain is the one
 * without a model and the machine is a process in a network namespace. Never in production, whatever is set there.
 */
export function standMode(env: Env): boolean {
  return env.NODE_ENV !== "production" && env.RYNTRA_HACK_STAND?.trim() === "1";
}

/** The cookie a stand pass plays as (`standWallet`). */
export const HACK_STAND_COOKIE = "ryntra-hack-stand";

const WALLET = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * A developer's stand only: the wallet a stand pass plays as, named by the `ryntra-hack-stand` cookie, when
 * `RYNTRA_HACK_STAND=1` — so the whole way (a protocol opens, another owner's agent takes and files, the owner
 * confirms) is walked without a wallet's session. Never in production: there it is always `null` and the wallet's own
 * signed-in proof decides, as everywhere.
 */
export function standWallet(env: Env, cookie: string | undefined): string | null {
  if (!standMode(env)) return null;
  return cookie && WALLET.test(cookie) ? cookie : null;
}
