/**
 * The DLMM Pro pools' store and indexer as the deployed server runs them: the database through the secret-gated
 * `public.pro_pool_*` functions (`./supabase-store.ts`, the server's usual transport), the node through earning's one
 * door to the venue. Server only.
 *
 * A deployment without the database's settings has no store, and the routes answer from the instance's memory. A
 * store that did not answer is left alone for `REST_MS`, so a database that is down costs a request no wait.
 */

import "server-only";

import type { EarnProNetwork } from "../earn-pro/gate.ts";
import { rpcResult } from "../supabase-rpc.ts";
import { indexerStep, stepLine, type StepReport } from "./indexer.server.ts";
import { readProPools } from "./read.server.ts";
import type { ProStore } from "./store.ts";
import { createSupabaseProStore } from "./supabase-store.ts";
import { nodeTapeSource } from "./tape.server.ts";

const REST_MS = 30_000;

let store: ProStore | null = null;
let restUntil = 0;

const configured = (): boolean => !!(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY && process.env.BETA_APP_SECRET);

/** The deployment's store; null where it has none, or while it rests after not answering. */
export function proStore(now: number = Date.now()): ProStore | null {
  if (!configured() || now < restUntil) return null;
  store ??= createSupabaseProStore((fn, args) => rpcResult("pro-pools", fn, args));
  return store;
}

/** The store did not answer: it is not asked again for a while. */
export function restProStore(now: number = Date.now()): void {
  restUntil = now + REST_MS;
}

/** One step of the network's indexer (`./indexer.server.ts`); it does nothing where another runs or the store is away. */
export async function runProPoolsStep(network: EarnProNetwork): Promise<StepReport> {
  const kept = proStore();
  const report: StepReport = kept
    ? await indexerStep({ network, store: kept, source: nodeTapeSource(network), pools: async () => (await readProPools(network)).pools })
    : { ran: false, reason: "store", leased: false, pools: 0, lists: 0, unlisted: 0, listed: 0, read: 0, lost: 0, counted: 0, purged: 0, ms: 0 };
  if (kept && report.reason === "store") restProStore();
  /* One line a step in the function's log: that the indexer runs, and what it costs. */
  console.info(stepLine(network, report));
  return report;
}
