/**
 * One representation in full — the asset page's data (canon v4.0 §7.3).
 *
 * Overview: what is bought, who issues it, what it stands for, the reserves
 * the issuer attests. Market: the reference, the session, the token's own
 * market, the deviation on the list basis. Onchain: the mint, the program,
 * the authorities, the multiplier read from the chain itself and compared
 * with the issuer's figure, the pool the token trades in. Fundamentals and
 * Events have no confirmed source and are not returned, so nothing draws a
 * tab over an empty room.
 */

import { decodeRawMintAccount, readMintAccount, type MintReadResult } from "../solana/mint.ts";
import { fetchRawMintAccounts } from "../solana/mint-batch.ts";
import { createSolanaRpcHandle, withRpcDiscipline } from "../solana/rpc.ts";
import { resolveSpotPool } from "../spot/candles.server.ts";
import type { SpotPool } from "../spot/candles.ts";
import { transferFeeOf, type TransferFee } from "./instrument.ts";
import { readXStocksMultiplier, readXStocksReserve, type XStocksReserve } from "./issuer-xstocks.server.ts";
import { sharedRead } from "./shared-read.ts";
import { findStockRow, type StockRow } from "./universe.server.ts";
import { multiplierFromChain, multiplierFromMint, multiplierState, type Multiplier, type MultiplierState } from "./units.ts";

/** AccountState.Frozen in the token programs' own vocabulary. */
const ACCOUNT_STATE_FROZEN = 2;

export type OnchainMint = Readonly<{
  programKind: string;
  decimals: number;
  supplyRaw: string;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  /** Extension kinds present on the mint, in the codec's names. */
  extensions: readonly string[];
  /** The Scaled UI Amount configuration read from the chain, when the extension is present. */
  scaledUi: Readonly<{ multiplier: number; newMultiplier: number; newMultiplierEffectiveAt: string | null; authority: string }> | null;
  /**
   * The two transfer-fee configs the mint stores, as the chain states them;
   * which one is in force is decided against the current epoch
   * (`transferFeeOf`). Null when the mint carries no transfer fee.
   */
  transferFeeConfig: Readonly<{
    older: Readonly<{ epoch: string; basisPoints: number; maximumFeeRaw: string }>;
    newer: Readonly<{ epoch: string; basisPoints: number; maximumFeeRaw: string }>;
    withheldRaw: string;
  }> | null;
  /** The mint's pause state, when it carries the Pausable extension. */
  pausable: Readonly<{ paused: boolean; authority: string | null }> | null;
  /** The permanent delegate — an authority that can move or burn any holder's balance — when the mint names one. */
  permanentDelegate: string | null;
  /** Whether new token accounts of this mint start frozen (an allow-listed token), when the mint states a default. */
  defaultAccountFrozen: boolean | null;
  observedAt: string;
  slot: string | null;
}>;

export type StockAsset = Readonly<{
  row: StockRow;
  onchain: OnchainMint | Readonly<{ error: string }>;
  /** The multiplier as the chain states it, judged now. */
  chainMultiplier: Multiplier | null;
  chainMultiplierState: MultiplierState | null;
  /** The multiplier as the issuer publishes it for the Solana deployment, where the issuer publishes one. */
  issuerMultiplier: Multiplier | null;
  /** Whether the chain and the issuer agree on the current multiplier (to 1e-9). */
  multiplierAgreement: "agree" | "differ" | "unknown";
  reserves: XStocksReserve | null;
  pool: SpotPool | null;
  fetchedAt: string;
}>;

export type StockAssetFailure = Readonly<{ ok: false; code: "UNKNOWN_ASSET" | "PROVIDER"; reason: string }>;

const epochToIso = (value: bigint | number): string | null => {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : null;
};

export async function readOnchainMint(mint: string, deps: Readonly<{ handle?: ReturnType<typeof createSolanaRpcHandle> }> = {}): Promise<OnchainMint | Readonly<{ error: string }>> {
  const handle = deps.handle ?? createSolanaRpcHandle({ network: "mainnet" });
  return shapeOnchainMint(await readMintAccount(handle, mint));
}

/** The chain's answer into the page's shape; a refused read is its sentence. */
export function shapeOnchainMint(read: MintReadResult): OnchainMint | Readonly<{ error: string }> {
  if (!read.ok) return { error: read.reason };
  const extensions = read.decoded.extensions.__option === "Some" ? read.decoded.extensions.value : [];
  const scaled = extensions.find((extension) => extension.__kind === "ScaledUiAmountConfig");
  const fee = extensions.find((extension) => extension.__kind === "TransferFeeConfig");
  const pausable = extensions.find((extension) => extension.__kind === "PausableConfig");
  const delegate = extensions.find((extension) => extension.__kind === "PermanentDelegate");
  const defaultState = extensions.find((extension) => extension.__kind === "DefaultAccountState");
  const authority = (value: { __option: "Some"; value: string } | { __option: "None" }): string | null => (value.__option === "Some" ? String(value.value) : null);
  return {
    programKind: read.programKind,
    decimals: read.decoded.decimals,
    supplyRaw: read.decoded.supply.toString(),
    mintAuthority: authority(read.decoded.mintAuthority as { __option: "Some"; value: string } | { __option: "None" }),
    freezeAuthority: authority(read.decoded.freezeAuthority as { __option: "Some"; value: string } | { __option: "None" }),
    extensions: extensions.map((extension) => extension.__kind),
    scaledUi:
      scaled && scaled.__kind === "ScaledUiAmountConfig"
        ? {
            multiplier: scaled.multiplier,
            newMultiplier: scaled.newMultiplier,
            newMultiplierEffectiveAt: epochToIso(scaled.newMultiplierEffectiveTimestamp),
            authority: String(scaled.authority),
          }
        : null,
    transferFeeConfig:
      fee && fee.__kind === "TransferFeeConfig"
        ? {
            older: { epoch: fee.olderTransferFee.epoch.toString(), basisPoints: fee.olderTransferFee.transferFeeBasisPoints, maximumFeeRaw: fee.olderTransferFee.maximumFee.toString() },
            newer: { epoch: fee.newerTransferFee.epoch.toString(), basisPoints: fee.newerTransferFee.transferFeeBasisPoints, maximumFeeRaw: fee.newerTransferFee.maximumFee.toString() },
            withheldRaw: fee.withheldAmount.toString(),
          }
        : null,
    pausable: pausable && pausable.__kind === "PausableConfig" ? { paused: pausable.paused, authority: authority(pausable.authority as { __option: "Some"; value: string } | { __option: "None" }) } : null,
    permanentDelegate: delegate && delegate.__kind === "PermanentDelegate" ? String(delegate.delegate) : null,
    defaultAccountFrozen: defaultState && defaultState.__kind === "DefaultAccountState" ? Number(defaultState.state) === ACCOUNT_STATE_FROZEN : null,
    observedAt: read.raw.observedAt,
    slot: read.raw.slot,
  };
}

/**
 * The transfer fee a mint charges now, from its stored configs and the epoch
 * given — the kernel's own rule, on the same decoded extensions the passport
 * reads. Null when the mint carries no transfer fee, or could not be read.
 */
export function transferFeeFromMint(onchain: OnchainMint | Readonly<{ error: string }> | null, epoch: bigint | null): TransferFee | null {
  if (onchain === null || "error" in onchain) return null;
  return transferFeeOf(onchain.transferFeeConfig, epoch);
}

const EPOCH_TTL_MS = 10 * 60 * 1000;
let epochCache: { value: bigint; at: number } | null = null;
let epochInflight: Promise<bigint | null> | null = null;

/**
 * The chain's current epoch, cached ten minutes — an epoch lasts about two
 * days, and the transfer-fee config in force is decided by it. Null when the
 * chain did not answer: the fee is then judged on the newer config and says
 * so (`epoch: null`), never silently.
 */
export function readCurrentEpoch(deps: Readonly<{ handle?: ReturnType<typeof createSolanaRpcHandle>; now?: () => number }> = {}): Promise<bigint | null> {
  const now = (deps.now ?? Date.now)();
  if (epochCache && now - epochCache.at < EPOCH_TTL_MS) return Promise.resolve(epochCache.value);
  if (epochInflight) return epochInflight;
  const handle = deps.handle ?? createSolanaRpcHandle({ network: "mainnet" });
  epochInflight = withRpcDiscipline(handle, (abortSignal) => handle.rpc.getEpochInfo().send({ abortSignal }))
    .then((info) => {
      const value = BigInt(info.epoch);
      epochCache = { value, at: Date.now() };
      return value;
    })
    .catch(() => (epochCache ? epochCache.value : null))
    .finally(() => {
      epochInflight = null;
    });
  return epochInflight;
}

/** For tests. */
export function resetEpochCache(): void {
  epochCache = null;
  epochInflight = null;
}

const MINT_TTL_MS = 10 * 60 * 1000;
const mintCache = new Map<string, { at: number; value: OnchainMint | Readonly<{ error: string }> }>();
const mintInflight = new Map<string, Promise<OnchainMint | Readonly<{ error: string }>>>();

/** The mint as the chain states it, cached for ten minutes — the list reads this for every tag-only row. */
export function readOnchainMintCached(mint: string): Promise<OnchainMint | Readonly<{ error: string }>> {
  const hit = mintCache.get(mint);
  if (hit && Date.now() - hit.at < MINT_TTL_MS && !("error" in hit.value)) return Promise.resolve(hit.value);
  const pending = mintInflight.get(mint);
  if (pending) return pending;
  const promise = readOnchainMint(mint)
    .then((value) => {
      mintCache.set(mint, { at: Date.now(), value });
      return value;
    })
    .finally(() => mintInflight.delete(mint));
  mintInflight.set(mint, promise);
  return promise;
}

/**
 * Every mint the list needs, read from the chain in one batched call and
 * left in the same cache the single reads use. The universe warms the cache
 * this way before it builds its rows, so ninety-two rows cost one round trip
 * rather than ninety-two. A mint already fresh in the cache is not asked for
 * again; a mint whose read failed is not cached, so the next build retries it.
 */
export async function warmOnchainMints(mints: readonly string[], deps: Readonly<{ handle?: ReturnType<typeof createSolanaRpcHandle> }> = {}): Promise<void> {
  const now = Date.now();
  const missing = [...new Set(mints)].filter((mint) => {
    const hit = mintCache.get(mint);
    return !(hit && now - hit.at < MINT_TTL_MS && !("error" in hit.value));
  });
  if (missing.length === 0) return;
  const handle = deps.handle ?? createSolanaRpcHandle({ network: "mainnet" });
  const raws = await fetchRawMintAccounts(handle, missing);
  const at = Date.now();
  for (const mint of missing) {
    const raw = raws.get(mint);
    if (!raw) continue;
    const value = "ok" in raw ? shapeOnchainMint(raw) : shapeOnchainMint(decodeRawMintAccount(raw));
    if ("error" in value) continue;
    mintCache.set(mint, { at, value });
  }
}

/** The multiplier a mint carries on chain, judged now; null when the mint could not be read. */
export async function readMintMultiplier(mint: string, nowMs: number): Promise<Multiplier | null> {
  const onchain = await readOnchainMintCached(mint);
  return multiplierFromMint("error" in onchain ? null : onchain, nowMs);
}

export function resetOnchainMintCache(): void {
  mintCache.clear();
  mintInflight.clear();
}

/** Tests only: a mint as the chain would have stated it, placed in the cache the list reads. */
export function primeOnchainMint(mint: string, value: OnchainMint, atMs: number = Date.now()): void {
  mintCache.set(mint, { at: atMs, value });
}

/**
 * How long each fact beside a company's price is kept for every instance: the
 * mint as the chain states it (its multiplier and fee settings change by a
 * scheduled act, stated in advance) five minutes; the issuer's reserves and
 * multiplier and the pool the chart reads ten.
 */
export const ASSET_FACT_SECONDS = { mint: 300, issuer: 600, pool: 600 } as const;

export async function readStockAsset(ticker: string, deps: Readonly<{ now?: () => Date }> = {}): Promise<{ ok: true; asset: StockAsset } | StockAssetFailure> {
  const found = await findStockRow(ticker);
  if (!found.ok) return { ok: false, code: "PROVIDER", reason: found.reason };
  if (!found.row) return { ok: false, code: "UNKNOWN_ASSET", reason: "That token is not a confirmed stock representation." };
  const row = found.row;
  const now = (deps.now ?? (() => new Date()))();
  const xstocks = row.representation.issuer.id === "xstocks";
  const { mint, symbol } = row.representation;
  /* The facts beside the price, kept for every instance a few minutes (`shared-read.ts`); the price itself is the row's. */
  const [onchain, reserves, pool, issuerRead] = await Promise.all([
    sharedRead(["stock-asset", "mint", mint], ASSET_FACT_SECONDS.mint, () => readOnchainMint(mint), (value) => !("error" in value)),
    xstocks ? sharedRead(["stock-asset", "reserve", symbol], ASSET_FACT_SECONDS.issuer, () => readXStocksReserve(symbol), (value) => value.ok) : Promise.resolve(null),
    sharedRead(["stock-asset", "pool", mint], ASSET_FACT_SECONDS.pool, () => resolveSpotPool(mint), (value) => value.ok),
    xstocks ? sharedRead(["stock-asset", "multiplier", symbol], ASSET_FACT_SECONDS.issuer, () => readXStocksMultiplier(symbol), (value) => value.ok) : Promise.resolve(null),
  ]);

  /* The list's multiplier is the chain's; here the issuer's own figure is
     read beside it, so the two sources are compared rather than the chain
     against itself. */
  const chainMultiplier: Multiplier | null = "scaledUi" in onchain && onchain.scaledUi ? multiplierFromChain(onchain.scaledUi, now.getTime()) : null;
  const issuerMultiplier: Multiplier | null = issuerRead && issuerRead.ok ? { current: issuerRead.current, pending: issuerRead.pending, effectiveAt: issuerRead.effectiveAt } : null;
  const agreement: StockAsset["multiplierAgreement"] =
    chainMultiplier && issuerMultiplier ? (Math.abs(chainMultiplier.current - issuerMultiplier.current) < 1e-9 ? "agree" : "differ") : "unknown";

  return {
    ok: true,
    asset: {
      row,
      onchain,
      chainMultiplier,
      chainMultiplierState: chainMultiplier ? multiplierState(chainMultiplier, now.getTime()) : null,
      issuerMultiplier,
      multiplierAgreement: agreement,
      reserves: reserves && reserves.ok ? reserves.reserve : null,
      pool: pool.ok ? pool.pool : null,
      fetchedAt: now.toISOString(),
    },
  };
}
