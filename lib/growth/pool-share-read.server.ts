import { getAddressEncoder, getProgramDerivedAddress, type Address } from "@solana/kit";

import { REWARD_PAR_MINTS } from "../rewards/model.ts";
import { fetchTokenCatalog } from "../solana/catalog.ts";
import {
  DBC_PROGRAM,
  SOLANA_CHAIN,
  base58Encode,
  extractSolanaClaims,
  launchConfigPlans,
  receivedOf,
  valueReceived,
  type LaunchConfigPlan,
  type PoolShareClaim,
  type PriceAt,
  type RawTransaction,
  type RegistryRowLike,
} from "./pool-share.ts";
import type { PoolShareRead } from "./pool-share-store.ts";

/**
 * Reading the claims from Solana — read only, public RPCs.
 *
 * Every finalized transaction of each fee claimer the attribution registry
 * names for a counted launch config (`/api/stats/registry`), its DBC and DAMM
 * v2 claim instructions decoded by `extractSolanaClaims`. The JSON-RPC caller
 * here serves any network's reader.
 *
 * Only finalized data is read, so a row can never be left behind by a
 * reorganisation; a transaction the finalized commitment does not return yet is
 * pending, not absent. Any request that fails turns the whole read into
 * `NO_DATA` — half a history would look like fewer claims.
 */

export type JsonRpc = (method: string, params: readonly unknown[]) => Promise<unknown>;

/** A JSON-RPC caller over `fetch`, retrying a failed request a few times before giving up. */
export function jsonRpc(url: string, options: Readonly<{ fetchImpl?: typeof fetch; timeoutMs?: number; attempts?: number }> = {}): JsonRpc {
  const fetchImpl = options.fetchImpl ?? fetch;
  let id = 0;
  return async (method, params) => {
    let failure: unknown = null;
    for (let attempt = 0; attempt < (options.attempts ?? 7); attempt += 1) {
      try {
        const response = await fetchImpl(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
          signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
        });
        if (response.status === 429 || response.status >= 500) {
          /* A public RPC's rate limit: wait what it asks, or the backoff below. */
          const wait = Number(response.headers.get("retry-after"));
          if (Number.isFinite(wait) && wait > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(wait, 30) * 1000));
          throw new Error(`${method}: HTTP ${response.status}`);
        }
        const body = (await response.json()) as { result?: unknown; error?: { message?: string } };
        if (body.error) throw new Error(`${method}: ${body.error.message ?? "error"}`);
        return body.result ?? null;
      } catch (error) {
        failure = error;
        await new Promise((resolve) => setTimeout(resolve, Math.min(500 * 2 ** attempt, 16_000)));
      }
    }
    throw failure instanceof Error ? failure : new Error(String(failure));
  };
}

/** Run `work` over `items`, `limit` at a time, in order of results. */
async function pool<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      out[index] = await work(items[index]!);
    }
  }));
  return out;
}

/* ------------------------------------------------------------------------------------------------
 * Solana
 * --------------------------------------------------------------------------------------------- */

const SYMBOLS: Readonly<Record<string, string>> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: "USDC",
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: "USDT",
  So11111111111111111111111111111111111111112: "SOL",
};

/** A DBC virtual pool's fields this read needs, from its account bytes. */
export type DbcPoolFacts = Readonly<{ config: string; creator: string; baseMint: string }>;

/** `config` at 72, `creator` at 104, `base_mint` at 136 — the offsets the SDK's own filters use. */
export function decodeDbcPool(data: Uint8Array): DbcPoolFacts | null {
  if (data.length < 168) return null;
  return { config: base58Encode(data.subarray(72, 104)), creator: base58Encode(data.subarray(104, 136)), baseMint: base58Encode(data.subarray(136, 168)) };
}

export type SolanaChainReader = Readonly<{
  /** Finalized signatures of `address`, newest first, down to (not including) `until`. */
  signatures(address: string, until: string | null): Promise<readonly Readonly<{ signature: string; err: unknown; confirmationStatus?: string | null }>[]>;
  /** The finalized transaction, or null when the finalized commitment does not return it yet. */
  transaction(signature: string): Promise<RawTransaction | null>;
  /** A DBC virtual pool, or null when there is no such account. */
  dbcPool(address: string): Promise<DbcPoolFacts | null>;
  decimals(mint: string): Promise<number | null>;
  /** The DBC pool a config gives a base and quote mint — the address, not whether it exists. */
  dbcPoolAddress(config: string, baseMint: string, quoteMint: string): Promise<string>;
}>;

/** The reader over a public JSON-RPC (`api.mainnet-beta.solana.com` keeps the signature history publicnode does not). */
export function solanaChainReader(rpc: JsonRpc, options: Readonly<{ pageLimit?: number; maxPages?: number }> = {}): SolanaChainReader {
  const encoder = getAddressEncoder();
  return {
    async signatures(address, until) {
      const out: Array<{ signature: string; err: unknown; confirmationStatus?: string | null }> = [];
      let before: string | undefined;
      for (let page = 0; page < (options.maxPages ?? 20); page += 1) {
        const batch = (await rpc("getSignaturesForAddress", [address, { limit: options.pageLimit ?? 1_000, commitment: "finalized", ...(before ? { before } : {}), ...(until ? { until } : {}) }])) as Array<{ signature: string; err: unknown; confirmationStatus?: string | null }> | null;
        if (!Array.isArray(batch)) throw new Error(`getSignaturesForAddress ${address} answered without a list`);
        if (!batch.length) return out;
        out.push(...batch);
        if (batch.length < (options.pageLimit ?? 1_000)) return out;
        before = batch.at(-1)!.signature;
      }
      throw new Error(`More than ${options.maxPages ?? 20} pages of signatures for ${address}; pass a newer "until".`);
    },
    async transaction(signature) {
      /* Version 1 (SIMD-0385): asked for 0, a node refuses a v1 transaction (-32015) — and a Micro created with its first buy is one. */
      return (await rpc("getTransaction", [signature, { encoding: "jsonParsed", commitment: "finalized", maxSupportedTransactionVersion: 1 }])) as RawTransaction | null;
    },
    async dbcPool(address) {
      const info = (await rpc("getAccountInfo", [address, { encoding: "base64", commitment: "finalized" }])) as { value: { owner: string; data: [string, string] } | null } | null;
      if (!info?.value || info.value.owner !== DBC_PROGRAM) return null;
      return decodeDbcPool(Buffer.from(info.value.data[0], "base64"));
    },
    async decimals(mint) {
      if (REWARD_PAR_MINTS[mint] !== undefined) return REWARD_PAR_MINTS[mint]!;
      const info = (await rpc("getAccountInfo", [mint, { encoding: "jsonParsed", commitment: "finalized" }])) as { value: { data: { parsed?: { info?: { decimals?: number } } } } | null } | null;
      return info?.value?.data?.parsed?.info?.decimals ?? null;
    },
    async dbcPoolAddress(config, baseMint, quoteMint) {
      const quote = encoder.encode(quoteMint as Address);
      const base = encoder.encode(baseMint as Address);
      const quoteFirst = Buffer.compare(Buffer.from(quote), Buffer.from(base)) > 0;
      const [pda] = await getProgramDerivedAddress({
        programAddress: DBC_PROGRAM as Address,
        seeds: [new TextEncoder().encode("pool"), encoder.encode(config as Address), quoteFirst ? quote : base, quoteFirst ? base : quote],
      });
      return pda;
    },
  };
}

/** A price for a non-dollar pair asset at the claim's moment — by default Jupiter's current price, which only stands for a claim of the last five minutes. */
export type PriceReader = (mint: string, at: string) => Promise<PriceAt | null>;

export const currentJupiterPrice: PriceReader = async (mint) => {
  try {
    const catalog = await fetchTokenCatalog([mint], 4_000);
    if (!catalog.ok) return null;
    const entry = catalog.byMint[mint];
    if (!entry?.usdPrice) return null;
    return { price: entry.usdPrice, sourceRef: `${entry.source.ref}:price:${mint}`, observedAt: catalog.observedAt };
  } catch {
    return null;
  }
};

/**
 * Ryntra's received part of every claim the registry's launch claimers made.
 *
 * `until` — per claimer, a signature to stop at, so a regular run reads only
 * what is new. It must be older than every claim still pending, or a pending
 * claim is never read again; leaving it out reads the whole history (at most
 * `maxPages` of a thousand signatures per claimer, beyond which the read is
 * `NO_DATA`).
 */
export async function readSolanaPoolShares(args: Readonly<{
  chain: SolanaChainReader;
  registry: readonly RegistryRowLike[];
  until?: Readonly<Record<string, string>>;
  priceAt?: PriceReader;
  now?: string;
  concurrency?: number;
}>): Promise<PoolShareRead> {
  const now = args.now ?? new Date().toISOString();
  const plans = launchConfigPlans(args.registry);
  const claimers = new Set(plans.claimers);
  const rows: PoolShareClaim[] = [];
  const chainClaims: Array<{ network: "solana"; tx: string; index: string; claimedRaw: string }> = [];
  const skipped: Array<{ tx: string; index: string; reason: string }> = [];
  const pending: Array<{ tx: string; index: string; reason: string }> = [];
  try {
    const signatures = new Map<string, { err: unknown; confirmationStatus?: string | null }>();
    for (const claimer of claimers) {
      for (const row of await args.chain.signatures(claimer, args.until?.[claimer] ?? null)) signatures.set(row.signature, row);
    }
    const landed = [...signatures].filter(([, row]) => row.err === null || row.err === undefined);
    const transactions = await pool(landed, args.concurrency ?? 2, async ([signature, row]) => {
      if (row.confirmationStatus && row.confirmationStatus !== "finalized") return { signature, tx: null };
      return { signature, tx: await args.chain.transaction(signature) };
    });
    const pools = new Map<string, Promise<DbcPoolFacts | null>>();
    const dbcPool = (address: string) => {
      if (!pools.has(address)) pools.set(address, args.chain.dbcPool(address));
      return pools.get(address)!;
    };
    for (const { signature, tx } of transactions) {
      if (!tx) {
        pending.push({ tx: signature, index: "-", reason: "not finalized yet" });
        continue;
      }
      for (const fact of extractSolanaClaims(tx, claimers)) {
        const place = { tx: fact.signature, index: fact.index };
        let plan: LaunchConfigPlan | undefined;
        let curve: string;
        let facts: DbcPoolFacts | null;
        if (fact.source === "lp") {
          /* The DAMM v2 pool a counted config's curve migrated to: the curve its config gives these two mints. */
          let found: { plan: LaunchConfigPlan; curve: string; facts: DbcPoolFacts } | null = null;
          if (fact.baseMint && fact.quoteMint) {
            for (const candidate of plans.counted.values()) {
              if (candidate.claimer !== fact.claimer) continue;
              const address = await args.chain.dbcPoolAddress(candidate.config, fact.baseMint, fact.quoteMint);
              const read = await dbcPool(address);
              if (read && read.config === candidate.config && read.baseMint === fact.baseMint) {
                found = { plan: candidate, curve: address, facts: read };
                break;
              }
            }
          }
          if (!found) {
            skipped.push({ ...place, reason: "a DAMM v2 position of no counted launch config" });
            continue;
          }
          if (fact.owner !== null && fact.owner !== fact.claimer) {
            skipped.push({ ...place, reason: "the position the event names is not the claimer's" });
            continue;
          }
          ({ plan, curve, facts } = found);
        } else {
          const config = fact.config ?? "";
          plan = plans.counted.get(config);
          if (!plan) {
            skipped.push({ ...place, reason: plans.skipped.get(config) ?? "a config with no row in the attribution registry" });
            continue;
          }
          if (plan.claimer !== fact.claimer) {
            skipped.push({ ...place, reason: "claimed by a wallet that is not this config's claimer in the registry" });
            continue;
          }
          curve = fact.pool;
          facts = await dbcPool(curve);
          if (!facts) {
            pending.push({ ...place, reason: "the curve's account could not be read" });
            continue;
          }
          if (facts.config !== plan.config) {
            skipped.push({ ...place, reason: "the curve belongs to another config than the instruction names" });
            continue;
          }
        }
        if (fact.source === "migration" && fact.flag !== 0) {
          skipped.push({ ...place, reason: "the creator's part of the migration fee" });
          continue;
        }
        /* Only what reached the claimer's own account is Ryntra's. The executor is also the holders' collector: as a
           delegate it claims holders' positions into the holders' own accounts. (A SOL pair's temporary wrapped
           account closes in the same transaction and states no owner — such a claim waits as pending; every
           Ryntra config pairs USDC today.) */
        if (fact.destinationOwner === null) {
          pending.push({ ...place, reason: "the account the fees were paid into has no stated owner" });
          continue;
        }
        if (fact.destinationOwner !== fact.claimer) {
          skipped.push({ ...place, reason: fact.source === "lp" ? "a holder's position — the fees went to the holder (collector's claim)" : "the fees were paid into an account the claimer does not own" });
          continue;
        }
        if (fact.pairRaw === null) {
          pending.push({ ...place, reason: "the claim's event was not found — no amount" });
          continue;
        }
        if (!fact.at || !fact.quoteMint) {
          pending.push({ ...place, reason: "no block time or pair mint" });
          continue;
        }
        const decimals = await args.chain.decimals(fact.quoteMint);
        if (decimals === null) {
          pending.push({ ...place, reason: "the pair asset's decimals could not be read" });
          continue;
        }
        chainClaims.push({ network: "solana", ...place, claimedRaw: fact.pairRaw.toString() });
        const receivedRaw = receivedOf(plan.rule, fact.source, fact.pairRaw);
        const value = valueReceived({
          network: "solana",
          mint: fact.quoteMint,
          decimals,
          raw: receivedRaw,
          at: fact.at,
          price: REWARD_PAR_MINTS[fact.quoteMint] === decimals ? null : await (args.priceAt ?? currentJupiterPrice)(fact.quoteMint, fact.at),
        });
        rows.push({
          kind: "CLAIM",
          schema: 1,
          network: "solana",
          chain: SOLANA_CHAIN,
          pool: curve,
          venuePool: fact.source === "lp" ? fact.pool : null,
          config: plan.config,
          creator: facts.creator,
          source: fact.source,
          claimer: fact.claimer,
          claim: { tx: fact.signature, index: fact.index, block: fact.slot, at: fact.at, finality: "finalized" },
          asset: { mint: fact.quoteMint, symbol: SYMBOLS[fact.quoteMint] ?? null, decimals },
          claimedRaw: fact.pairRaw.toString(),
          receivedRaw: receivedRaw.toString(),
          tokenRaw: fact.tokenRaw === null ? null : receivedOf(plan.rule, fact.source, fact.tokenRaw).toString(),
          rule: plan.rule,
          usdMicros: value.usdMicros,
          valuation: value.valuation,
          allocation: null,
          recordedAt: now,
        });
      }
    }
  } catch (error) {
    return { state: "NO_DATA", reason: `Solana: ${error instanceof Error ? error.message : String(error)}` };
  }
  return { state: "OK", rows, chain: chainClaims, skipped, pending };
}
