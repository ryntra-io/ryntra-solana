/**
 * The reader behind `GET /api/v1/earn/pools`: the engine's pool catalogue (two bounded calls to Meteora,
 * kept two minutes for every visitor by `readPoolCatalog`) and Jupiter Lend's markets (one call, kept two minutes here,
 * a failed one asked again after a minute). Read-only: nothing here builds, signs or moves anything, and nothing throws.
 */

import "server-only";

import { readPoolCatalog } from "../liquidity/catalog/service.server.ts";
import type { EarnAdapter } from "../earn/contract.ts";
import { earnAdapters } from "../earn/service.server.ts";
import { earnPeriods, earnPools, lendRates, type EarnLendRate, type EarnPeriodsAnswer, type EarnPoolsAnswer } from "./model.ts";

export const LEND_TTL_MS = 2 * 60 * 1000;
export const LEND_NEGATIVE_TTL_MS = 60 * 1000;

/** The rates kept, when they were read, and when to ask again (sooner after a failed read). */
type LendEntry = Readonly<{ readAt: number; again: number; rates: readonly EarnLendRate[] }>;
let lendKept: LendEntry | null = null;
let lendInflight: Promise<LendEntry> | null = null;
/** A failed read serves the last good rates while they are this young; older ones are not shown. */
export const LEND_GRACE_MS = 30 * 60 * 1000;

export type EarnPoolsDeps = Readonly<{ lend?: () => EarnAdapter | undefined; now?: () => number }>;

export function resetEarnPoolsCache(): void {
  lendKept = null;
  lendInflight = null;
}

function readLend(deps: EarnPoolsDeps): Promise<LendEntry> {
  const now = deps.now ?? Date.now;
  const nowMs = now();
  if (lendKept && nowMs < lendKept.again) return Promise.resolve(lendKept);
  if (lendInflight) return lendInflight;
  const adapter = (deps.lend ?? (() => earnAdapters().find((entry) => entry.provider === "jupiter")))();
  lendInflight = (async (): Promise<LendEntry> => {
    const read = adapter && !adapter.blocked ? await adapter.markets().catch(() => null) : null;
    const rates = read?.ok ? lendRates(read.markets) : [];
    const kept = lendKept;
    lendKept = rates.length
      ? { readAt: nowMs, again: nowMs + LEND_TTL_MS, rates }
      : { readAt: kept?.readAt ?? nowMs, again: nowMs + LEND_NEGATIVE_TTL_MS, rates: kept && nowMs - kept.readAt < LEND_GRACE_MS ? kept.rates : [] };
    return lendKept;
  })().finally(() => {
    lendInflight = null;
  });
  return lendInflight;
}

/** The chooser's answer: the pools and the lending rates, each source said as read or not. */
export async function readEarnPools(deps: EarnPoolsDeps = {}): Promise<EarnPoolsAnswer> {
  const [catalog, lend] = await Promise.all([readPoolCatalog(null), readLend(deps)]);
  const times = [catalog.sources.dlmm.at, catalog.sources["damm-v2"].at].filter((at): at is string => at !== null).sort();
  return {
    pools: earnPools(catalog.pools),
    lend: lend.rates,
    at: times[0] ?? null,
    sources: { dlmm: catalog.sources.dlmm.ok, dammV2: catalog.sources["damm-v2"].ok, lend: lend.rates.length > 0 },
  };
}

/**
 * The chooser's pools by window (`GET /api/earn/pools/periods`), for the table's «30 min · 1 h · 2 h · 24 h»:
 * the same catalogue read, kept two minutes for every visitor, so the windows cost Meteora no call of their own.
 */
export async function readEarnPeriods(): Promise<EarnPeriodsAnswer> {
  const catalog = await readPoolCatalog(null);
  const times = [catalog.sources.dlmm.at, catalog.sources["damm-v2"].at].filter((at): at is string => at !== null).sort();
  return { pools: earnPeriods(catalog.pools), at: times[0] ?? null };
}
