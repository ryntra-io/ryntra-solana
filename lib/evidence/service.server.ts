/**
 * The evidence service — the one door a route or the Review opens to read
 * an observation: rights, cache, governor, adapter, in that order, and one
 * shape out.
 *
 * The order is the policy. The cache is asked first, so five people opening
 * the same asset within its window cost one call and the second reader of
 * the day pays nothing; within one instance concurrent readers share one
 * flight. On a miss the governor reserves before the adapter calls, so a
 * ceiling refuses the read instead of being discovered after the spend. A
 * stale copy inside the rights map's hold is served, marked STALE, when a
 * refresh fails — the person sees a dated figure and the date, not a blank —
 * and a failure is remembered for a minute so a storm costs one call.
 *
 * Two providers behind one door: a read names its
 * provider, or the window does — the rolling windows are Nansen's, the
 * point-in-time `now` is DD.xyz's — and each provider has its own governor,
 * its own ledger, its own rights map and its own key; nothing above this
 * file tells them apart beyond the snapshot's `provider` field. A recipient
 * check reads an address the same way (cache, governor, adapter) through
 * the security provider alone.
 *
 * Every read says where its answer came from (`served`), because a cost that
 * hides behind a cache and a cache that pretends to be a call are the two
 * ways a governor's figures stop reconciling with the provider's.
 *
 * Server-only: the keys, the store and the clock live here. The pure halves
 * — the registry, the conditions, the rights map, the mappers — are what the
 * public slice opens; this file is the private glue.
 */

import { getGuardRuntime } from "../guard/runtime.ts";
import type { GuardStore } from "../guard/store.ts";
import type { AddressEvidenceRead } from "./address.ts";
import { createEvidenceBudgetGovernor, resolveEvidenceBudget, type EvidenceBudgetGovernor, type EvidenceBudgetPolicy, type EvidenceLedgerRecord } from "./budget.ts";
import { addressEvidenceCacheKey, createAddressEvidenceCache, createEvidenceCache, evidenceCacheKey, type AddressEvidenceCache, type EvidenceCache } from "./cache.ts";
import { EVIDENCE_PROVIDERS, providerOfWindow, type EvidenceProvider, type EvidenceWindow } from "./metrics.ts";
import { createDdxyzAdapter, type SecurityEvidenceProvider } from "./providers/ddxyz/adapter.server.ts";
import { createDdxyzClient, ddxyzKeyFromEnv, type DdxyzClient, type DdxyzUsage } from "./providers/ddxyz/client.server.ts";
import { createNansenAdapter, type MarketEvidenceProvider } from "./providers/nansen/adapter.server.ts";
import { createNansenClient, nansenKeyFromEnv } from "./providers/nansen/client.server.ts";
import { providerRights, type ProviderRights } from "./rights.ts";
import type { MarketEvidenceRead } from "./snapshot.ts";

const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export type EvidenceProviderRuntime = Readonly<{
  adapter: MarketEvidenceProvider;
  governor: EvidenceBudgetGovernor;
  rights: ProviderRights;
  policy: EvidenceBudgetPolicy | null;
  /** Whether a provider key is present at all — the card's honest *not configured*. */
  configured: boolean;
}>;

export type EvidenceRuntime = Readonly<{
  providers: Readonly<Record<EvidenceProvider, EvidenceProviderRuntime>>;
  /** The security provider's own read of an address, beside its token read. */
  security: SecurityEvidenceProvider;
  securityClient: DdxyzClient;
  cache: EvidenceCache;
  addressCache: AddressEvidenceCache;
  /* Kept for the callers that knew one provider: the market provider's fields. */
  provider: MarketEvidenceProvider;
  governor: EvidenceBudgetGovernor;
  policy: EvidenceBudgetPolicy | null;
  configured: boolean;
}>;

const globalRuntime = globalThis as typeof globalThis & { __ryntraEvidenceRuntime?: EvidenceRuntime };

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Build the runtime on a store — the production path uses the Guard runtime's; a stand or a test hands its own. */
export function createEvidenceRuntime(input: { store: GuardStore; env: Readonly<Record<string, string | undefined>>; fetchImpl?: FetchLike; securityFetchImpl?: FetchLike }): EvidenceRuntime {
  const nansenPolicy = resolveEvidenceBudget(input.env, "nansen");
  const nansenGovernor = createEvidenceBudgetGovernor({ store: input.store, provider: "nansen", policy: nansenPolicy });
  const nansenClient = createNansenClient({ key: nansenKeyFromEnv(input.env), fetchImpl: input.fetchImpl });
  const nansen: EvidenceProviderRuntime = {
    adapter: createNansenAdapter({ client: nansenClient, governor: nansenGovernor }),
    governor: nansenGovernor,
    rights: providerRights("nansen"),
    policy: nansenPolicy,
    configured: nansenClient.configured,
  };

  const ddxyzPolicy = resolveEvidenceBudget(input.env, "ddxyz");
  const ddxyzGovernor = createEvidenceBudgetGovernor({ store: input.store, provider: "ddxyz", policy: ddxyzPolicy });
  const ddxyzClient = createDdxyzClient({ key: ddxyzKeyFromEnv(input.env), fetchImpl: input.securityFetchImpl ?? input.fetchImpl });
  const security = createDdxyzAdapter({ client: ddxyzClient, governor: ddxyzGovernor });
  const ddxyz: EvidenceProviderRuntime = {
    adapter: security,
    governor: ddxyzGovernor,
    rights: providerRights("ddxyz"),
    policy: ddxyzPolicy,
    configured: ddxyzClient.configured,
  };

  return {
    providers: { nansen, ddxyz },
    security,
    securityClient: ddxyzClient,
    cache: createEvidenceCache(input.store),
    addressCache: createAddressEvidenceCache(input.store),
    provider: nansen.adapter,
    governor: nansen.governor,
    policy: nansen.policy,
    configured: nansen.configured,
  };
}

export function getEvidenceRuntime(): EvidenceRuntime {
  globalRuntime.__ryntraEvidenceRuntime ??= createEvidenceRuntime({ store: getGuardRuntime().store, env: process.env });
  return globalRuntime.__ryntraEvidenceRuntime;
}

export type ReadMarketEvidenceInput = Readonly<{
  mint: string;
  window: EvidenceWindow;
  /** The provider to ask; absent, the window names it (`now` → DD.xyz, the rolling windows → Nansen). */
  provider?: EvidenceProvider;
  nowMs?: number;
  runtime?: EvidenceRuntime;
}>;

/**
 * Read the observation for one mint and window. Never throws: every failure
 * is a read with a state and a reason.
 */
export async function readMarketEvidence(input: ReadMarketEvidenceInput): Promise<MarketEvidenceRead> {
  if (!MINT.test(input.mint)) return { state: "UNKNOWN", snapshot: null, reason: "That is not a token address.", served: "none" };
  const runtime = input.runtime ?? getEvidenceRuntime();
  const nowMs = input.nowMs ?? Date.now();
  const providerId = input.provider ?? providerOfWindow(input.window);
  const provider = runtime.providers[providerId];
  const key = evidenceCacheKey(providerId, input.mint, input.window);

  const cached = await runtime.cache.lookup(key, nowMs);
  if (cached.hit === "fresh") {
    /* Counted before the answer, so the admin's figure is the figure. */
    await provider.governor.countCacheHit(nowMs);
    return { state: "FRESH", snapshot: cached.snapshot, reason: null, served: "cache" };
  }
  if (cached.hit === "failure") {
    if (cached.snapshot) return { state: "STALE", snapshot: cached.snapshot, reason: `${cached.reason} This is the last observation held.`, served: "stale-cache" };
    return { state: cached.state, snapshot: null, reason: cached.reason, served: "cache" };
  }
  if (!provider.configured) {
    /* No key: nothing to call, and a stale copy — if any — is still the last truth. */
    if (cached.hit === "stale") return { state: "STALE", snapshot: cached.snapshot, reason: "The provider key is not configured; this is the last observation held.", served: "stale-cache" };
    return { state: "UNAVAILABLE", snapshot: null, reason: "The provider key is not configured.", served: "none" };
  }

  const fetched = await runtime.cache.singleFlight(key, () => provider.adapter.read({ mint: input.mint, window: input.window, nowMs }));
  if (fetched.state === "FRESH") {
    await runtime.cache.put(key, fetched.snapshot, provider.rights.staleHoldSeconds, nowMs);
    return { state: "FRESH", snapshot: fetched.snapshot, reason: null, served: "provider" };
  }
  await runtime.cache.putFailure(key, fetched.state, fetched.reason, nowMs);
  if (cached.hit === "stale") {
    return { state: "STALE", snapshot: cached.snapshot, reason: `${fetched.reason} This is the last observation held.`, served: "stale-cache" };
  }
  return { state: fetched.state, snapshot: null, reason: fetched.reason, served: "provider" };
}

export type ReadAddressEvidenceInput = Readonly<{
  address: string;
  nowMs?: number;
  runtime?: EvidenceRuntime;
}>;

/**
 * Read what the security provider says about one address — the recipient
 * check. The same door: cache, single flight, governor, adapter; never
 * throws; a program-owned account the source refuses is UNKNOWN, never
 * green.
 */
export async function readAddressEvidence(input: ReadAddressEvidenceInput): Promise<AddressEvidenceRead> {
  if (!MINT.test(input.address)) return { state: "UNKNOWN", evidence: null, reason: "That is not a Solana address.", served: "none" };
  const runtime = input.runtime ?? getEvidenceRuntime();
  const nowMs = input.nowMs ?? Date.now();
  const provider = runtime.providers.ddxyz;
  const key = addressEvidenceCacheKey("ddxyz", input.address);

  const cached = await runtime.addressCache.lookup(key, nowMs);
  if (cached.hit === "fresh") {
    await provider.governor.countCacheHit(nowMs);
    return { state: "FRESH", evidence: cached.snapshot, reason: null, served: "cache" };
  }
  if (cached.hit === "failure") {
    if (cached.snapshot) return { state: "STALE", evidence: cached.snapshot, reason: `${cached.reason} This is the last check held.`, served: "stale-cache" };
    return { state: cached.state, evidence: null, reason: cached.reason, served: "cache" };
  }
  if (!provider.configured) {
    if (cached.hit === "stale") return { state: "STALE", evidence: cached.snapshot, reason: "The provider key is not configured; this is the last check held.", served: "stale-cache" };
    return { state: "UNAVAILABLE", evidence: null, reason: "The provider key is not configured.", served: "none" };
  }

  const fetched = await runtime.addressCache.singleFlight(key, () => runtime.security.readAddress({ address: input.address, nowMs }));
  if (fetched.state === "FRESH") {
    await runtime.addressCache.put(key, fetched.evidence, provider.rights.staleHoldSeconds, nowMs);
    return { state: "FRESH", evidence: fetched.evidence, reason: null, served: "provider" };
  }
  await runtime.addressCache.putFailure(key, fetched.state, fetched.reason, nowMs);
  if (cached.hit === "stale") {
    return { state: "STALE", evidence: cached.snapshot, reason: `${fetched.reason} This is the last check held.`, served: "stale-cache" };
  }
  return { state: fetched.state, evidence: null, reason: fetched.reason, served: "provider" };
}

export type EvidenceUsage = Readonly<{
  provider: EvidenceProvider;
  configured: boolean;
  policy: EvidenceBudgetPolicy | null;
  day: EvidenceLedgerRecord;
  total: EvidenceLedgerRecord;
  rights: Readonly<{ policy: string; readOn: string; attribution: string; families: readonly Readonly<{ family: string; status: string; creditsPerCall: number }>[] }>;
  /** The provider's own metering, read for reconciliation and cached ten minutes; null where the provider reports it in its headers instead (the ledger's `remainingReported`) or did not answer. */
  reported: DdxyzUsage | null;
}>;

const USAGE_RECONCILIATION_MS = 10 * 60 * 1000;
let reportedUsage: Readonly<{ at: number; usage: DdxyzUsage | null }> | null = null;

async function ddxyzReportedUsage(runtime: EvidenceRuntime, nowMs: number, refresh: boolean): Promise<DdxyzUsage | null> {
  if (!runtime.providers.ddxyz.configured) return null;
  if (!refresh && reportedUsage && nowMs - reportedUsage.at < USAGE_RECONCILIATION_MS) return reportedUsage.usage;
  const usage = await runtime.securityClient.usage().catch(() => null);
  reportedUsage = { at: nowMs, usage };
  return usage;
}

/** What the admin reads, per provider: the ledgers, the ceilings, the rights the reads ran under and the provider's own count where it has one. Never a key. */
export async function readEvidenceUsage(input: { nowMs?: number; runtime?: EvidenceRuntime; reconcile?: boolean } = {}): Promise<readonly EvidenceUsage[]> {
  const runtime = input.runtime ?? getEvidenceRuntime();
  const nowMs = input.nowMs ?? Date.now();
  const out: EvidenceUsage[] = [];
  for (const id of EVIDENCE_PROVIDERS) {
    const provider = runtime.providers[id];
    const ledgers = await provider.governor.read(nowMs);
    out.push({
      provider: id,
      configured: provider.configured,
      policy: ledgers.policy,
      day: ledgers.day,
      total: ledgers.total,
      rights: {
        policy: provider.rights.policy,
        readOn: provider.rights.reviewed.readOn,
        attribution: provider.rights.attribution.text,
        families: provider.rights.families.map((family) => ({ family: family.family, status: family.status, creditsPerCall: family.creditsPerCall })),
      },
      reported: id === "ddxyz" ? await ddxyzReportedUsage(runtime, nowMs, input.reconcile === true) : null,
    });
  }
  return out;
}
