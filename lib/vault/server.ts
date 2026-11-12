import { modelGateway } from "../models/gateway.server.ts";
import { readSession } from "../session";
import { rpcResult } from "../supabase-rpc";
import { createVaultApi, type VaultApiDeps, type WalletRead } from "./api";
import { createVaultEngine, type VaultEngine } from "./engine";
import { guardModel, readGuardPin } from "./guard-model";
import type { ModelGateway } from "./model";
import { VAULT_ENV, guardSetup, storeKind, vaultReady } from "./ready";
import { createMemoryVaultStore, type VaultStore } from "./store";
import { stubGateway } from "./stub";
import { createSupabaseVaultStore } from "./supabase-store";
import { logWorldSink } from "./world";

/**
 * The vault as the deployed server runs it: the account session the rest of Ryntra uses (read, never changed), the
 * server's signing secret, the database through the secret-gated `public.vault_*` functions (`ready.ts` says when),
 * the model gateway of CITY-45 with the vault's key (`guard-model.ts`) and the day's dollar ceiling on it. A
 * developer's machine and a stand play the scripted guards (`stub.ts`) unless they have a key.
 *
 * Production opens to people only when everything is there — the switch, the database, the key and the ceiling — and
 * otherwise stays closed, naming what is missing once in the log.
 */
const setup = guardSetup(process.env);

function model(): ModelGateway {
  if (setup.model === "stub") return stubGateway;
  return guardModel({ gateway: modelGateway(), pin: readGuardPin(process.env[VAULT_ENV.pin]), apiKey: setup.apiKey });
}

let told = false;
function complete(): boolean {
  const missing = [...setup.missing];
  if (process.env.NODE_ENV === "production") {
    if (storeKind(process.env) !== "database") missing.push("SUPABASE_URL", "SUPABASE_ANON_KEY", "BETA_APP_SECRET");
    if (!process.env.BETA_TOKEN_SECRET) missing.push("BETA_TOKEN_SECRET");
  }
  if (!missing.length) return true;
  if (!told) console.error(`[vault] closed: ${missing.join(", ")} not set on this deployment`);
  told = true;
  return false;
}

/** Development keeps working without the deployment's secret; a deployment without one makes no guests. */
function secret(): string | null {
  return process.env.BETA_TOKEN_SECRET ?? (process.env.NODE_ENV === "production" ? null : "ryntra-dev-only-vault-secret");
}

async function wallet(): Promise<WalletRead> {
  const read = await readSession();
  if (read.status === "unavailable") return { status: "unavailable" };
  if (read.status === "ok" && read.session.accountId) return { status: "ok", accountId: read.session.accountId };
  return { status: "absent" };
}

let store: VaultStore | null = null;
let engine: VaultEngine | null = null;
let api: ReturnType<typeof createVaultApi> | null = null;

export function vaultApi(): ReturnType<typeof createVaultApi> {
  store ??= storeKind(process.env) === "database" ? createSupabaseVaultStore((fn, args) => rpcResult("vault", fn, args)) : createMemoryVaultStore();
  const kept = store;
  const deps: VaultApiDeps = {
    engine: () => {
      const key = secret();
      if (!key) return null;
      engine ??= createVaultEngine({ model: model(), store: kept, secret: key, ceilingMicroUsd: setup.ceilingMicroUsd });
      return engine;
    },
    secret,
    // The switch is read as the city reads it (inlined at build); production opens on the database only.
    open: () => process.env.NEXT_PUBLIC_RYNTRA_CITY_VAULT?.trim() === "open" && complete() && vaultReady(kept, process.env.NEXT_PUBLIC_RYNTRA_CITY_VAULT, process.env.NODE_ENV),
    wallet,
    store: kept,
    world: logWorldSink,
  };
  api ??= createVaultApi(deps);
  return api;
}
