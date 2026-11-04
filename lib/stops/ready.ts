import type { StopsStore } from "./store.ts";

/**
 * When stops live in the engine, and on which store (CITY-149). Pure, so the rules are tested without a server;
 * `server.ts` applies them to the deployment's own settings.
 */

type Env = Record<string, string | undefined>;

/**
 * The database wherever a deployment runs; on a developer's machine the memory store, unless
 * `RYNTRA_STOPS_STORE=database` asks for the database there too. Without the database's settings it is memory
 * everywhere — and then production keeps stops shut (`stopsReady`).
 */
export function storeKind(env: Env): "database" | "memory" {
  const configured = !!(env.SUPABASE_URL && env.SUPABASE_ANON_KEY && env.BETA_APP_SECRET);
  const wanted = env.NODE_ENV === "production" || env.RYNTRA_STOPS_STORE === "database";
  return configured && wanted ? "database" : "memory";
}

/**
 * Whether the routes and the cron answer. The switch must say `open` — the same switch the city reads
 * (`NEXT_PUBLIC_RYNTRA_CITY_STOPS`), opened by the operator once the migration is applied; in production the store must
 * also be the database: one instance's memory would give every instance its own stops and the cron none of them.
 */
export function stopsReady(store: Pick<StopsStore, "durable">, flag: string | undefined, mode: string | undefined): boolean {
  return flag?.trim() === "open" && (store.durable || mode !== "production");
}
