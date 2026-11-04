import 'server-only';

import { readWalletPositions } from '../../../lib/liquidity/catalog/chain.server.ts';
import { readPoolRecord } from '../../../lib/liquidity/catalog/service.server.ts';
import { rpcResult } from '../../../lib/supabase-rpc';
import { readRecord, reportCopy, runPass, type CaptainDeps, type ReportInput } from './captain-ledger.ts';
import { captainReady, captainStoreKind, createMemoryCaptainStore, type CaptainStore } from './captain-store.ts';
import { createSupabaseCaptainStore } from './captain-db.ts';

/**
 * «Like the Captain» as the deployed server runs it (CITY-99): the ledger in the database through the secret-gated
 * `public.city_captain_*` functions (memory on a developer's machine), and the engine's own read-only reads — the
 * wallet's DLMM positions from the program's accounts and the venue's record of each pool. It builds, signs and sends
 * nothing.
 */

let store: CaptainStore | null = null;

export function captainStore(): CaptainStore {
  store ??= captainStoreKind(process.env) === 'database' ? createSupabaseCaptainStore((fn, args) => rpcResult('city-captain', fn, args)) : createMemoryCaptainStore();
  return store;
}

/** Copies are counted here now: Earn open, and in production on the database. */
export function captainCounting(): boolean {
  return captainReady(captainStore(), process.env.NEXT_PUBLIC_RYNTRA_CITY_EARN, process.env.NODE_ENV);
}

const engine: CaptainDeps = {
  positions: async (owner) => {
    const read = await readWalletPositions(owner);
    return read.dlmm.ok ? read.dlmm.value : null;
  },
  record: (pool) => readPoolRecord('dlmm', pool, { meteora: { timeoutMs: 4_000 } }),
  now: () => Date.now(),
};

export const captainReport = (input: ReportInput) => reportCopy(captainStore(), input, engine);
export const captainPass = () => runPass(captainStore(), engine);
export const captainRecord = () => readRecord(captainStore(), captainCounting(), Date.now());
