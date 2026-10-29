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
