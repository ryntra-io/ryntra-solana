/**
 * The checked pair currencies of Ryntra Launch, read from the chain (SOL-L11; the rule and the register —
 * `../core/launch/quote-asset.ts`).
 *
 * Each record the operator named is read here and judged there: the mint's own account, Meteora's token badge for it, the
 * epoch the read was made in, the scaled unit the issuer sets, and the price of one token with the time it was
 * observed. A pair whose every fact reads as it was checked, whose badge is there and whose price is fresh is open; a
 * single difference closes it, with the plain word of the refusal. Nothing is offered on a read that did not answer.
 *
 * Reads only — the badge is Meteora's to create, the mint is the issuer's, and this module signs nothing. The public
 * listing may be answered from a read of the last few seconds; a build asks for its own, because the figures a creator
 * signs on must be of the moment.
 */

import { PublicKey } from "@solana/web3.js";
import { getScaledUiAmountConfig, unpackMint } from "@solana/spl-token";

import {
  quoteAssetProblems,
  quoteAssetsOffered,
  quoteConfigVersion,
  quoteFeeAt,
  quoteFeeLive,
  type QuoteAssetObservation,
  type QuoteAssetRecord,
  type QuoteAssetRefusal,
  type QuoteConfigVersion,
  type QuoteEpochFee,
  type QuoteMultiplier,
} from "../core/launch/quote-asset.ts";
import { DBC_PROGRAM_ID, dbcSdkOf, dbcTokenBadgeAddress } from "../core/venues/meteora-dbc/sdk.server.ts";
import { fetchTokenCatalog } from "../solana/catalog.ts";
import { mintProfileOf } from "../solana/mint-profile.ts";
import { multiplierFromChain } from "../stocks/units.ts";
import type { LaunchCluster } from "./config.server.ts";

/** How long a read of the chain serves the public listing; a build never takes one of these. */
const CACHE_MS = 20_000;

type AccountBytes = Readonly<{ owner: PublicKey; data: Uint8Array; lamports: number; executable: boolean }>;

export type QuoteAssetReader = Readonly<{
  getMultipleAccountsInfo: (keys: PublicKey[], commitment?: "confirmed") => Promise<readonly (AccountBytes | null)[]>;
  getEpochInfo: (commitment?: "confirmed") => Promise<Readonly<{ epoch: number }>>;
}>;

/** The price of one token in dollars, with the moment it was observed; null — the source did not answer. */
export type QuotePriceReader = (mints: readonly string[]) => Promise<Readonly<{ usdByMint: Readonly<Record<string, number>>; observedAt: string }> | null>;

export type QuoteAssetDeps = Readonly<{
  cluster: LaunchCluster;
  connection: QuoteAssetReader;
  env?: Readonly<Record<string, string | undefined>>;
  now?: () => Date;
  price?: QuotePriceReader;
}>;

/** One checked pair currency as it stands after a read. */
export type QuoteAssetState = Readonly<{
  record: QuoteAssetRecord;
  /** `OPEN` — a launch may be built on this pair now; `CLOSED` — it may not, and `problems` says why. */
  state: "OPEN" | "CLOSED";
  problems: readonly QuoteAssetRefusal[];
  /** The DBC version a config on it needs, read from its fee; null — the mint was not read. */
  configVersion: QuoteConfigVersion | null;
  /** The fee a transfer of it pays now, as the mint and the epoch say; null — none. */
  feeNow: QuoteEpochFee | null;
  priceUsd: number | null;
  priceAt: string | null;
  checkedAt: string;
}>;

/** Jupiter's price of a token, the moment of the read its freshness — the source every Ryntra surface prices with. */
export const jupiterQuotePrice: QuotePriceReader = async (mints) => {
  const catalog = await fetchTokenCatalog(mints).catch(() => null);
  if (!catalog || !catalog.ok) return null;
  const usdByMint: Record<string, number> = {};
  for (const [mint, entry] of Object.entries(catalog.byMint)) {
    const usd = entry.usdPrice === null ? Number.NaN : Number(entry.usdPrice);
    if (Number.isFinite(usd) && usd > 0) usdByMint[mint] = usd;
  }
  return { usdByMint, observedAt: catalog.observedAt };
};

/** The scaled unit of a mint as the chain states it: one token is `current` of the unit; null — no such extension. */
function multiplierOf(mint: string, account: AccountBytes, nowMs: number): QuoteMultiplier | null {
  const parsed = unpackMint(new PublicKey(mint), { ...account, data: Buffer.from(account.data) }, account.owner);
  const scaled = getScaledUiAmountConfig(parsed);
  if (!scaled) return null;
  const effectiveAt = Number(scaled.newMultiplierEffectiveTimestamp) > 0 ? new Date(Number(scaled.newMultiplierEffectiveTimestamp) * 1000).toISOString() : null;
  return multiplierFromChain({ multiplier: scaled.multiplier, newMultiplier: scaled.newMultiplier, newMultiplierEffectiveAt: effectiveAt }, nowMs);
}

type Cached = Readonly<{ cluster: string; at: number; value: Promise<readonly QuoteAssetState[]> }>;
let CACHE: Cached | null = null;

/**
 * Every checked pair currency, read and judged. `cache` — the public listing's read, good for a few seconds; a build
 * passes nothing and gets its own read. A read that did not answer closes every pair rather than offering a stale one.
 */
export async function readQuoteAssets(deps: QuoteAssetDeps, options: Readonly<{ cache?: boolean }> = {}): Promise<readonly QuoteAssetState[]> {
  const env = deps.env ?? process.env;
  const records = quoteAssetsOffered(env);
  if (!records.length) return [];
  const now = deps.now ?? (() => new Date());
  if (options.cache && CACHE && CACHE.cluster === deps.cluster && now().getTime() - CACHE.at < CACHE_MS) return CACHE.value;
  const value = judge(deps, records, env, now);
  if (options.cache) {
    const cached: Cached = { cluster: deps.cluster, at: now().getTime(), value };
    value.catch(() => {
      if (CACHE === cached) CACHE = null;
    });
    CACHE = cached;
  }
  return value;
}

async function judge(
  deps: QuoteAssetDeps,
  records: readonly QuoteAssetRecord[],
  env: Readonly<Record<string, string | undefined>>,
  now: () => Date,
): Promise<readonly QuoteAssetState[]> {
  const sdk = dbcSdkOf(env);
  /* A record whose mint is no address on this chain is left out rather than allowed to close the reading of the rest. */
  const kept = records.filter((record) => {
    try {
      new PublicKey(record.mint);
      return true;
    } catch {
      return false;
    }
  });
  if (!kept.length) return [];
  const mints = kept.map((record) => new PublicKey(record.mint));
  const badges = kept.map((record) => dbcTokenBadgeAddress(record.mint, sdk));
  const [accounts, epoch, price] = await Promise.all([
    deps.connection.getMultipleAccountsInfo([...mints, ...badges], "confirmed").catch(() => null),
    deps.connection.getEpochInfo("confirmed").catch(() => null),
    (deps.price ?? jupiterQuotePrice)(kept.map((record) => record.mint)).catch(() => null),
  ]);
  const at = now();
  const checkedAt = at.toISOString();
  /* A node that answered something other than an epoch has not told us the epoch: the rate in force is then unknown. */
  const readEpoch = typeof epoch?.epoch === "number" && Number.isFinite(epoch.epoch) ? BigInt(Math.floor(epoch.epoch)) : null;
  return kept.map((record, index) => {
    const account = accounts?.[index] ?? null;
    const badgeAccount = accounts?.[kept.length + index] ?? null;
    let facts: QuoteAssetObservation["facts"] = null;
    let multiplier: QuoteMultiplier | null = null;
    if (account) {
      try {
        facts = mintProfileOf(record.mint, account);
        multiplier = multiplierOf(record.mint, account, at.getTime());
      } catch {
        facts = null;
        multiplier = null;
      }
    }
    const observed: QuoteAssetObservation = {
      facts,
      /* A read that did not answer leaves the badge unknown; an answer with no account is a badge Meteora has not given. */
      badge: accounts === null ? null : badgeAccount !== null && badgeAccount.owner.equals(DBC_PROGRAM_ID),
      epoch: readEpoch,
      multiplier,
      priceUsd: price?.usdByMint[record.mint] ?? null,
      priceAt: price?.observedAt ?? null,
    };
    const problems = quoteAssetProblems(record, observed, { nowMs: at.getTime(), sdk });
    const fee = facts?.transferFee ?? null;
    return {
      record,
      state: problems.length === 0 ? "OPEN" : "CLOSED",
      problems,
      configVersion: facts && observed.epoch !== null ? quoteConfigVersion(facts, observed.epoch) : null,
      feeNow: fee && observed.epoch !== null && quoteFeeLive({ transferFee: fee }, observed.epoch) ? quoteFeeAt(fee, observed.epoch) : null,
      priceUsd: observed.priceUsd,
      priceAt: observed.priceAt,
      checkedAt,
    } satisfies QuoteAssetState;
  });
}

/** One checked pair currency by its mint, read now; null — this deployment does not carry it. */
export async function quoteAssetFor(deps: QuoteAssetDeps, mint: string): Promise<QuoteAssetState | null> {
  const states = await readQuoteAssets(deps);
  return states.find((state) => state.record.mint === mint) ?? null;
}

/** Only the read's cache; for tests of a module that holds one. */
export function forgetQuoteAssets(): void {
  CACHE = null;
}
