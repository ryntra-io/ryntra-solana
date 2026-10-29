import { authorize, draftStore } from '@/city/lib/moments/drafts/server';
import { decideBearerAuth } from '@/lib/security';
import { rpcResult } from '@/lib/supabase-rpc';
import { createXApi, type XApi } from './api';
import { xConfig, xSender } from './connect';
import { MemoryXLedger, type XLedger } from './ledger';
import { SupabaseXLedger } from './supabase-ledger';

/**
 * The publisher as the deployed server runs it: the drafts queue and its door (`city/lib/moments/drafts/server.ts`),
 * the ledger in the database through its secret-gated `x_post*` functions, `x-sender` from the environment, and the
 * cron's `CRON_SECRET`. Server only.
 */

let ledger: XLedger | null = null;
let api: XApi | null = null;

/** In development the ledger lives in memory beside the queue (`RYNTRA_MOMENTS_STORE=memory`); production never. */
export function xLedger(): XLedger {
  if (process.env.NODE_ENV !== 'production' && process.env.RYNTRA_MOMENTS_STORE === 'memory') {
    const shared = globalThis as typeof globalThis & { __ryntraXLedger?: XLedger };
    shared.__ryntraXLedger ??= new MemoryXLedger();
    return shared.__ryntraXLedger;
  }
  ledger ??= new SupabaseXLedger((fn, args) => rpcResult('x', fn, args));
  return ledger;
}

export function xApi(): XApi {
  api ??= createXApi({
    store: draftStore(),
    ledger: xLedger(),
    sender: xSender(),
    config: xConfig(),
    authorize,
    cronAuthorized: (req) =>
      decideBearerAuth({ authorization: req.headers.get('authorization'), legacyKeyPresent: new URL(req.url).searchParams.has('key') }, process.env.CRON_SECRET) === 'authorized',
  });
  return api;
}
