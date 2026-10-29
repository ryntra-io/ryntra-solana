import { readSession } from "../session";
import { rpcResult } from "../supabase-rpc";
import { createVaultApi, type VaultApiDeps, type WalletRead } from "./api";
import { createVaultEngine, type VaultEngine } from "./engine";
import { storeKind, vaultReady } from "./ready";
import { createMemoryVaultStore, type VaultStore } from "./store";
import { stubGateway } from "./stub";
import { createSupabaseVaultStore } from "./supabase-store";
import { logWorldSink } from "./world";

/**
 * The vault as the deployed server runs it: the account session the rest of Ryntra uses (read, never changed), the
 * server's signing secret, the database through the secret-gated `public.vault_*` functions (`ready.ts` says when),
 * and the model.
 *
 * The model is the stub until the gateway of CITY-45 is in master; then this one line becomes the gateway's guard
 * client (`lib/models`), and nothing else in the vault changes.
 */
const MODEL = stubGateway;

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
      engine ??= createVaultEngine({ model: MODEL, store: kept, secret: key });
      return engine;
    },
    secret,
    // The switch is read as the city reads it (inlined at build); production opens on the database only.
    open: () => vaultReady(kept, process.env.NEXT_PUBLIC_RYNTRA_CITY_VAULT, process.env.NODE_ENV),
    wallet,
    store: kept,
    world: logWorldSink,
  };
  api ??= createVaultApi(deps);
  return api;
}
