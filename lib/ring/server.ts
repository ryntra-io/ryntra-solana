import { createModelCatalog } from "../models/catalog.ts";
import { createModelGateway } from "../models/call.ts";
import { modelCatalog, modelGateway, modelKeys } from "../models/gateway.server.ts";
import { readSession } from "../session";
import { rpcResult } from "../supabase-rpc";
import { worldStore } from "../world/server";
import { createRingApi, type AccountRead, type RingApi } from "./api.ts";
import { createRingEngine, type RingEngine } from "./engine.ts";
import { bayOf, garageOf } from "./garage.ts";
import { createRingKeys, quietKeys, type RingKeys } from "./keys.ts";
import { createRingModels, type RingModels } from "./models.ts";
import { SEAL_SECRET_ENV, STAND_COOKIE, catalogKind, keyMode, ringReady, standAccount, storeKind } from "./ready.ts";
import { createSealer } from "./seal.ts";
import { createMemoryRingStore, type RingStore } from "./store.ts";
import { createSupabaseRingStore } from "./supabase-store.ts";
import { stubCatalogFetch } from "./stub-catalog.ts";

/**
 * The Ring as the deployed server runs it (CITY-50): the account session the rest of Ryntra uses (read, never
 * changed), the world's word on whose garage a slot is (`lib/world`, read only), the database through the
 * secret-gated `public.ring_*` functions (`ready.ts` says when), OpenRouter's live catalog and the gateway's key
 * manager (CITY-45). Without `OPENROUTER_MANAGEMENT_KEY` and `RYNTRA_RING_SEAL_SECRET` the Ring is quiet: agents are
 * kept with no key and nothing is called.
 */

export async function account(): Promise<AccountRead> {
  // A developer's stand plays as the account its cookie names (`standAccount`); never in production.
  if (process.env.NODE_ENV !== "production" && process.env.RYNTRA_RING_STAND?.trim() === "1") {
    const { cookies } = await import("next/headers");
    const id = standAccount(process.env, (await cookies()).get(STAND_COOKIE)?.value);
    return id ? { status: "ok", accountId: id } : { status: "absent" };
  }
  const read = await readSession();
  if (read.status === "unavailable") return { status: "unavailable" };
  if (read.status === "ok" && read.session.accountId) return { status: "ok", accountId: read.session.accountId };
  return { status: "absent" };
}

function brains(): RingModels {
  if (catalogKind(process.env) === "stub") {
    // A developer's machine without the network: the fixture catalog through the gateway's own parsing and pinning.
    const catalog = createModelCatalog({ fetch: stubCatalogFetch });
    return createRingModels({ catalog, gateway: createModelGateway({ env: {}, catalog }) });
  }
  return createRingModels({ catalog: modelCatalog(), gateway: modelGateway() });
}

function keys(): RingKeys {
  const sealer = createSealer(process.env[SEAL_SECRET_ENV]);
  return keyMode(process.env) === "live" && sealer ? createRingKeys({ manager: modelKeys(), sealer }) : quietKeys;
}

let store: RingStore | null = null;
let engine: RingEngine | null = null;
let api: RingApi | null = null;

/** The Ring's one store on this server instance: the agents' database, or memory on a developer's machine. */
export function ringStore(): RingStore {
  store ??= storeKind(process.env) === "database" ? createSupabaseRingStore((fn, args) => rpcResult("ring", fn, args)) : createMemoryRingStore();
  return store;
}

export function ringApi(): RingApi {
  const kept = ringStore();
  api ??= createRingApi({
    engine: () => {
      engine ??= createRingEngine({ store: kept, models: brains(), keys: keys(), garage: (input) => garageOf(worldStore(), input), bay: bayOf });
      return engine;
    },
    // The switch is read as the city reads it (inlined at build); production opens on the database only.
    open: () => ringReady(kept, process.env.NEXT_PUBLIC_RYNTRA_CITY_RING, process.env.NODE_ENV),
    account,
    store: kept,
  });
  return api;
}
