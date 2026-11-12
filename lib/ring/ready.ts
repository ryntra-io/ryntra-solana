import type { RingStore } from "./store.ts";

/**
 * When the Ring answers people, on which store, with which catalog and whether it makes keys. Pure, so the rules are
 * tested without a server; `server.ts` applies them to the deployment's own settings.
 */

type Env = Record<string, string | undefined>;

/** The variable that holds the seal's secret for agents' keys (`seal.ts`). */
export const SEAL_SECRET_ENV = "RYNTRA_RING_SEAL_SECRET";

/**
 * The database wherever a deployment runs; on a developer's machine the memory store, unless
 * `RYNTRA_RING_STORE=database` asks for the database there too. Without the database's settings it is memory
 * everywhere — and then production keeps the Ring closed (`ringReady`).
 */
export function storeKind(env: Env): "database" | "memory" {
  const configured = !!(env.SUPABASE_URL && env.SUPABASE_ANON_KEY && env.BETA_APP_SECRET);
  const wanted = env.NODE_ENV === "production" || env.RYNTRA_RING_STORE === "database";
  return configured && wanted ? "database" : "memory";
}

/**
 * Whether the Ring answers people. The switch must say `open` — the same switch the city reads; in production the
 * store must also be the database: one instance's memory would let two instances each put an agent in one garage.
 */
export function ringReady(store: Pick<RingStore, "durable">, flag: string | undefined, mode: string | undefined): boolean {
  return flag?.trim() === "open" && (store.durable || mode !== "production");
}

/**
 * `live` when the server can make agents' keys — OpenRouter's management key and the seal's secret are both set;
 * otherwise `quiet`: agents are kept without a key and nothing is called.
 */
export function keyMode(env: Env): "live" | "quiet" {
  const management = env.OPENROUTER_MANAGEMENT_KEY?.trim();
  const seal = env[SEAL_SECRET_ENV]?.trim();
  return management && /^[\x21-\x7e]{8,512}$/.test(management) && seal && /^[\x21-\x7e]{32,512}$/.test(seal) ? "live" : "quiet";
}

/** The fixture catalog only on a developer's machine that asks for it (`RYNTRA_RING_MODELS=stub`); never in production. */
export function catalogKind(env: Env): "live" | "stub" {
  return env.NODE_ENV !== "production" && env.RYNTRA_RING_MODELS === "stub" ? "stub" : "live";
}

/** The cookie a stand pass plays as (`standAccount`). */
export const STAND_COOKIE = "ryntra-ring-stand";

/**
 * A developer's stand only (CITY-217): the account a stand pass plays as, named by the `ryntra-ring-stand` cookie
 * (`stand-<letters>`), when `RYNTRA_RING_STAND=1` — so the whole way, two owners and a rated duel included, is walked
 * without a wallet's session. Never in production: there it is always `null` and the session decides, as everywhere.
 */
export function standAccount(env: Env, cookie: string | undefined): string | null {
  if (env.NODE_ENV === "production" || env.RYNTRA_RING_STAND?.trim() !== "1") return null;
  return cookie && /^stand-[a-z0-9-]{1,32}$/.test(cookie) ? cookie : null;
}
