/**
 * What the team routes need on this deployment (TEAM-1), or why they are not served.
 *
 * Teams are served where the treasury is (`NEXT_PUBLIC_RYNTRA_TREASURY_NETWORK` names the network — a team's
 * high-risk rights run through its Squads treasury) and the deployment says `RYNTRA_TEAMS=open`, which the project's owner sets
 * only after applying the TEAM-1 migration (`db/migrations/README.md`). The store is the Postgres one when the Guard
 * store is (its own Postgres setting, the same `DATABASE_URL`); per-process memory serves a local stand on one
 * instance and nothing behind several.
 *
 * Server only.
 */

import { Connection, PublicKey } from "@solana/web3.js";

import { resolveGuardDeployment, resolveGuardStoreConfig } from "../guard/runtime-config.ts";
import { resolveEndpoint } from "../solana/rpc.ts";
import { readMultisig } from "../solana/treasury/squads.server.ts";
import { treasuryNetwork } from "../solana/treasury/service.server.ts";
import { TREASURY_CHAIN } from "../solana/treasury/model.ts";
import type { TeamDeps, ReadSigners } from "./service.server.ts";
import { createMemoryTeamStore, type TeamStore } from "./store.ts";
import { createPostgresTeamStore } from "./store-postgres.server.ts";

export type TeamsServed = Readonly<{ served: true; deps: TeamDeps }> | Readonly<{ served: false; reason: "NOT_SERVED" | "CLOSED" | "NO_STORE" }>;

export function teamsOpen(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env.RYNTRA_TEAMS?.trim().toLowerCase() === "open";
}

let cachedStore: { key: string; store: TeamStore } | null = null;
let cachedConnection: { url: string; connection: Connection } | null = null;

function storeFor(env: Readonly<Record<string, string | undefined>>): TeamStore | null {
  let config;
  try {
    config = resolveGuardStoreConfig(env);
  } catch {
    return null;
  }
  const key = config.kind === "postgres" ? `postgres:${config.connectionString}` : "memory";
  if (cachedStore?.key === key) return cachedStore.store;
  if (config.kind === "postgres") cachedStore = { key, store: createPostgresTeamStore({ connectionString: config.connectionString }) };
  /* Memory only where one instance serves: a list kept by one instance would be another's empty one. */
  else if (resolveGuardDeployment(env) === "SINGLE_INSTANCE") cachedStore = { key, store: createMemoryTeamStore() };
  else return null;
  return cachedStore.store;
}

export function teamsServed(env: Readonly<Record<string, string | undefined>> = process.env): TeamsServed {
  const network = treasuryNetwork(env);
  if (!network) return { served: false, reason: "NOT_SERVED" };
  if (!teamsOpen(env)) return { served: false, reason: "CLOSED" };
  const store = storeFor(env);
  if (!store) return { served: false, reason: "NO_STORE" };
  const url = resolveEndpoint(network);
  if (!cachedConnection || cachedConnection.url !== url) cachedConnection = { url, connection: new Connection(url, "confirmed") };
  const connection = cachedConnection.connection;
  const readSigners: ReadSigners = async (multisig) => {
    /* A string of the address's alphabet that is no 32-byte key is no multisig — said so, never «try again». */
    try {
      new PublicKey(multisig);
    } catch {
      throw Object.assign(new Error("Not a public key."), { code: "TREASURY_NOT_SQUADS" });
    }
    return (await readMultisig(connection, multisig)).members;
  };
  return { served: true, deps: { store, network: TREASURY_CHAIN[network], now: () => new Date(), readSigners, env } };
}
