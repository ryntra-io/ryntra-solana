/**
 * The paper week on the deployment: its switch, its store, its reads and its budget. Closed unless the
 * deployment says `RYNTRA_AGENT_PAPER=open`; open, it stands on the database's store
 * and on Jupiter's quotes,
 * asked within paper's own share of the key's window (`./quota.ts`), one budget and one short cache per instance.
 * Until the migration is applied, every call answers that paper is not open (`PaperStoreUnavailable`).
 *
 * Jupiter's window is the organisation's, so a second key of the same organisation would separate nothing: paper shares
 * the one key and yields to money inside its window instead.
 */

import "server-only";

import { rpcResult } from "../../supabase-rpc.ts";
import { createPaperQuota, createPaperQuoteCache, type PaperQuota, type PaperQuoteCache } from "./quota.ts";
import { jupiterPaperReads } from "./reads.server.ts";
import { PAPER_SECRET_MIN, type PaperDeps } from "./service.server.ts";
import { createSupabasePaperStore } from "./supabase-store.ts";
import type { PaperStore } from "./store.ts";

/** Whether the deployment opens the paper week: its switch, exactly `open`. */
export const paperOpen = (env: Readonly<Record<string, string | undefined>> = process.env): boolean => env.RYNTRA_AGENT_PAPER?.trim().toLowerCase() === "open";

let store: PaperStore | null = null;
let quota: PaperQuota | null = null;
let cache: PaperQuoteCache | null = null;

/** The deployment's paper store, live reads and budget. */
export function paperDeps(): PaperDeps {
  store ??= createSupabasePaperStore((fn, args) => rpcResult("agent-paper", fn, args));
  quota ??= createPaperQuota();
  cache ??= createPaperQuoteCache();
  const kept = { quota, cache };
  return { store, quota, reads: (coin) => jupiterPaperReads(coin, kept) };
}

/**
 * The server's key the start's door names the proven wallet under, in the ledger and in its week's key
 * (`./door.server.ts`): the app secret the store's functions are gated by. Absent or too short — null, and a start is
 * refused rather than named under nothing.
 */
export function paperSecret(env: Readonly<Record<string, string | undefined>> = process.env): string | null {
  const secret = env.BETA_APP_SECRET?.trim() ?? "";
  return secret.length >= PAPER_SECRET_MIN ? secret : null;
}
