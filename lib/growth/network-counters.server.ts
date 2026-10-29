import { REWARD_PAR_MINTS } from "../rewards/model.ts";
import { base58Encode, DBC_PROGRAM, launchConfigPlans, receivedOf, type RegistryRowLike } from "./pool-share.ts";
import type { JsonRpc } from "./pool-share-read.server.ts";
import { countersKey, DBC_CONFIG_OFFSETS, decodeDbcPoolCounters, type PoolCounters } from "./network.ts";

/**
 * What a Solana launch pool still holds of Ryntra's part — the partner's
 * unclaimed fees the DBC program counts in the pool's own account — for the
 * shadow ledger's "in the pool" figure. Read only, finalized, public RPC; an
 * estimate to show, never a base: nothing is written from it.
 *
 * The pool's account names its config; the config names its pair (quote) mint.
 * Ryntra's part follows the config's rule (all of it, or Micro's three
 * quarters of the curve's fee). A pair that is not a dollar this product
 * counts at par has no figure here (null — not read, not zero): the in-pool
 * estimate does not look prices up. A graduated pool's locked position earns
 * in DAMM v2, which this reader does not count.
 */

const BATCH = 100;

type AccountInfo = Readonly<{ owner: string; data: readonly [string, string] }> | null;

async function accounts(rpc: JsonRpc, keys: readonly string[]): Promise<AccountInfo[]> {
  const out: AccountInfo[] = [];
  for (let start = 0; start < keys.length; start += BATCH) {
    const answer = (await rpc("getMultipleAccounts", [keys.slice(start, start + BATCH), { encoding: "base64", commitment: "finalized" }])) as { value?: AccountInfo[] } | null;
    const value = answer?.value ?? [];
    for (let index = 0; index < Math.min(BATCH, keys.length - start); index += 1) out.push(value[index] ?? null);
  }
  return out;
}

const bytes = (info: AccountInfo): Uint8Array | null => (info && info.data?.[1] === "base64" ? Uint8Array.from(Buffer.from(info.data[0], "base64")) : null);

/**
 * The unclaimed part of every pool asked about, by `countersKey`. A pool whose
 * account cannot be read, is not the program's or names another config than
 * the launch was bound under is left out — the read shows "no data" for it.
 * A failed request leaves every pool out.
 */
export async function readSolanaPoolCounters(
  rpc: JsonRpc,
  pools: readonly Readonly<{ pool: string; config: string }>[],
  registry: readonly RegistryRowLike[],
  now: string = new Date().toISOString(),
): Promise<PoolCounters> {
  const out = new Map<string, { receivedRaw: string; mint: string; receivedUsdMicros: string | null; readAt: string }>();
  if (!pools.length) return out;
  const plans = launchConfigPlans(registry).counted;
  let poolInfos: AccountInfo[];
  let configInfos: AccountInfo[];
  const configs = [...new Set(pools.map((entry) => entry.config))];
  try {
    [poolInfos, configInfos] = await Promise.all([accounts(rpc, pools.map((entry) => entry.pool)), accounts(rpc, configs)]);
  } catch {
    return out;
  }
  const quoteMint = new Map<string, string>();
  configs.forEach((config, index) => {
    const data = bytes(configInfos[index] ?? null);
    if (configInfos[index]?.owner === DBC_PROGRAM && data && data.length >= DBC_CONFIG_OFFSETS.feeClaimer) quoteMint.set(config, base58Encode(data.subarray(DBC_CONFIG_OFFSETS.quoteMint, DBC_CONFIG_OFFSETS.quoteMint + 32)));
  });
  pools.forEach((entry, index) => {
    const info = poolInfos[index] ?? null;
    const data = bytes(info);
    if (!info || info.owner !== DBC_PROGRAM || !data) return;
    const decoded = decodeDbcPoolCounters(data);
    if (!decoded || base58Encode(decoded.config) !== entry.config) return;
    const plan = plans.get(entry.config);
    const mint = quoteMint.get(entry.config);
    if (!plan || !mint) return;
    const received = receivedOf(plan.rule, "curve", decoded.partnerQuoteRaw);
    const par = REWARD_PAR_MINTS[mint] === 6;
    out.set(countersKey("solana", entry.pool), { receivedRaw: received.toString(), mint, receivedUsdMicros: par ? received.toString() : null, readAt: now });
  });
  return out;
}
