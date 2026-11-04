/**
 * Stops as the deployed server runs them (CITY-149): the database through the secret-gated `public.spot_stops_*`
 * functions where `ready.ts` says so, the switch the city reads, and the swap engine's quote. Server only.
 */

import { rpcResult } from "../supabase-rpc.ts";
import { createStopsApi, type StopsApi } from "./api.ts";
import { engineQuote } from "./quote.server.ts";
import { stopsReady, storeKind } from "./ready.ts";
import { createMemoryStopsStore, type StopsStore } from "./store.ts";
import { createSupabaseStopsStore } from "./supabase-store.ts";

let store: StopsStore | null = null;
let api: StopsApi | null = null;

export function stopsStore(): StopsStore {
  store ??= storeKind(process.env) === "database" ? createSupabaseStopsStore((fn, args) => rpcResult("stops", fn, args)) : createMemoryStopsStore();
  return store;
}

/** Whether stops answer on this deployment: the switch is read as the city reads it (inlined at build). */
export function stopsOpen(): boolean {
  return stopsReady(stopsStore(), process.env.NEXT_PUBLIC_RYNTRA_CITY_STOPS, process.env.NODE_ENV);
}

export function stopsApi(): StopsApi {
  api ??= createStopsApi({ store: stopsStore(), open: stopsOpen, quote: engineQuote, now: Date.now });
  return api;
}
