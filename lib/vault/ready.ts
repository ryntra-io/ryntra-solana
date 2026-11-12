import { readKey } from "../models/env.ts";
import type { VaultStore } from "./store";

/**
 * When the vault answers people, and on which store. Pure, so the rules are tested without a server; `server.ts`
 * applies them to the deployment's own settings.
 */

type Env = Record<string, string | undefined>;

/**
 * The database wherever a deployment runs; on a developer's machine the memory store, unless
 * `RYNTRA_VAULT_STORE=database` asks for the database there too. Without the database's settings it is memory
 * everywhere — and then production keeps the vault closed (`vaultReady`).
 */
export function storeKind(env: Env): "database" | "memory" {
  const configured = !!(env.SUPABASE_URL && env.SUPABASE_ANON_KEY && env.BETA_APP_SECRET);
  const wanted = env.NODE_ENV === "production" || env.RYNTRA_VAULT_STORE === "database";
  return configured && wanted ? "database" : "memory";
}

/**
 * Whether the vault answers people. The switch must say `open` — the same switch the city reads; in production the
 * store must also be the database: one instance's memory would give every instance its own limits, progress and feed,
 * so turning the switch on can never ship the memory store.
 */
export function vaultReady(store: Pick<VaultStore, "durable">, flag: string | undefined, mode: string | undefined): boolean {
  return flag?.trim() === "open" && (store.durable || mode !== "production");
}

/** The deployment's settings the guards stand on — by name only; the values live in the deployment's environment. */
export const VAULT_ENV = {
  /** The switch the city and the routes read: `open`. */
  flag: "NEXT_PUBLIC_RYNTRA_CITY_VAULT",
  /** The day's ceiling on the guards' model, in dollars: `5` or `2.50`. */
  ceiling: "RYNTRA_VAULT_DAILY_USD",
  /** The vault's own OpenRouter key; best made with a daily limit of the same dollars in OpenRouter. */
  key: "RYNTRA_VAULT_OPENROUTER_KEY",
  /** The shared key of the model gateway (CITY-45), used when the vault has no key of its own. */
  sharedKey: "OPENROUTER_API_KEY",
  /** `stub` plays the scripted guards on a developer's machine or a stand; never in production. */
  guard: "RYNTRA_VAULT_GUARD",
  /** Optional: another pinned model, `vendor/model@provider`. */
  pin: "RYNTRA_VAULT_GUARD_MODEL",
} as const;

/** The most a ceiling may say, so a slip of the keyboard is not a fortune: $1 000 a day. */
export const MAX_CEILING_USD = 1_000;
/** A developer's machine without a ceiling of its own: $1 a day of the scripted guards' make-believe cost. */
export const DEV_CEILING_MICRO_USD = 1_000_000;

/** Dollars as the deployment writes them, in millionths of a dollar; null for anything that is not a sane ceiling. */
export function readCeiling(value: string | undefined): number | null {
  const text = value?.trim() ?? "";
  if (!/^\d{1,4}(\.\d{1,6})?$/.test(text)) return null;
  const dollars = Number(text);
  return dollars > 0 && dollars <= MAX_CEILING_USD ? Math.round(dollars * 1_000_000) : null;
}

export type GuardSetup = {
  /** The real model through the gateway, or the scripted guards. */
  model: "live" | "stub";
  /** The vault's own key, when it has one; otherwise the gateway reads its shared key itself. */
  apiKey: string | null;
  ceilingMicroUsd: number | null;
  /** What production still lacks before the guards may answer people, by setting name; empty when nothing. */
  missing: string[];
};

/**
 * How the guards run on this deployment. Production speaks to the real model only, with a key and a ceiling, and
 * lists what is missing so the vault stays closed rather than open half-made. A developer's machine plays the
 * scripted guards unless it has a key, with a dollar a day of make-believe ceiling unless it sets one.
 */
export function guardSetup(env: Env): GuardSetup {
  const production = env.NODE_ENV === "production";
  const own = readKey(env, VAULT_ENV.key);
  const shared = readKey(env, VAULT_ENV.sharedKey);
  const stub = env[VAULT_ENV.guard]?.trim() === "stub";
  const set = readCeiling(env[VAULT_ENV.ceiling]);
  const missing: string[] = [];
  if (production) {
    if (stub) missing.push(VAULT_ENV.guard);
    if (!own && !shared) missing.push(VAULT_ENV.key);
    if (set === null) missing.push(VAULT_ENV.ceiling);
  }
  return {
    model: production || (!stub && (own || shared)) ? "live" : "stub",
    apiKey: own,
    ceilingMicroUsd: set ?? (production ? null : DEV_CEILING_MICRO_USD),
    missing,
  };
}
