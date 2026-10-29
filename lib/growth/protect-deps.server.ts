import type { GuardStore } from "../guard/store.ts";
import { partnerDeps } from "./partner-deps.server.ts";
import { jsonRpc } from "./pool-share-read.server.ts";
import { readCurveTrades, readFunding, readTransfers } from "./protect-chain.server.ts";
import { deviceSignalsOf, type HeaderSource, signalKeyFrom } from "./protect.ts";
import type { ProtectDeps } from "./protect-store.ts";
import { recordDevice } from "./review-store.ts";

/**
 * The production side of protection: the run's lookups, and the device
 * sightings the Growth line's own routes record for a proven wallet.
 *
 * The signal key is derived from the deployment's own secret, never stored or
 * shown; without it nothing that would need it is recorded or run.
 */

/** The public node that keeps Solana's signature history (the same the pool-share journal reads). */
export const PROTECT_SOLANA_RPC = "https://api.mainnet-beta.solana.com";

/**
 * The run's lookups and the chain over a public node. The team is `ownWallets` when the caller passes the launch
 * runtime's list (the internal list, the registry, the executor and the pool payer — `ryntraOwnWallets`), the internal
 * list alone otherwise; `protectNetwork` adds the registry's addresses either way. Null without a signal key.
 */
export function protectDeps(
  store: GuardStore,
  options: Readonly<{
    env?: Readonly<Record<string, string | undefined>>;
    rpcUrl?: string;
    ownWallets?: () => Promise<Readonly<{ wallets: ReadonlySet<string>; complete: boolean }>>;
  }> = {},
): ProtectDeps | null {
  const env = options.env ?? process.env;
  const key = signalKeyFrom(env);
  if (!key) return null;
  const rpc = jsonRpc(options.rpcUrl ?? PROTECT_SOLANA_RPC, { attempts: 4 });
  return {
    ...partnerDeps(store, { env, ...(options.ownWallets ? { ownWallets: options.ownWallets } : {}) }),
    key,
    funding: (wallet) => readFunding(rpc, wallet),
    transfers: (wallet, since) => readTransfers(rpc, wallet, since),
    curveTrades: (curve, since) => readCurveTrades(rpc, curve, since),
  };
}

/**
 * S4: a proven wallet was seen with this request — kept as hashes for the retention period. Never fails the request
 * it rides on: a sighting not kept is a sign not seen, nothing more.
 */
export async function noteDevice(store: GuardStore, wallet: string, headers: HeaderSource, env: Readonly<Record<string, string | undefined>> = process.env): Promise<void> {
  try {
    const key = signalKeyFrom(env);
    if (!key) return;
    const signals = deviceSignalsOf(headers, key);
    if (signals.length) await recordDevice(store, { wallet, signals, now: new Date().toISOString() });
  } catch {
    /* A sighting is never worth a failed page. */
  }
}
