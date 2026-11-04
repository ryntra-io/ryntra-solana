/**
 * Jupiter Lend, read into the product's own words.
 *
 * Pure: it turns the Lend API's answers into {@link EarnMarket} and {@link EarnPosition} and nothing else — no
 * fetch, no key, no chain. The call itself is `jupiter-adapter.ts`; the wallet's own share balance comes from
 * the chain in `chain.server.ts`, because a provider's word about what a person holds is a claim and the
 * token account is the fact.
 *
 * ## What Jupiter Lend is, in two sentences
 *
 * Supply an asset to an Earn market and a jlToken comes back — `jlUSDC` for USDC. The count of jlTokens never
 * changes; what each one is worth in the asset rises as interest accrues, so a position is read as
 * `shares × exchange rate` and what it earned is that worth less what was put in.
 *
 * ## The field names, and the honest state of them
 *
 * The readers below take the documented Earn shapes (`GET /lend/v1/earn/tokens`, `/earn/positions`,
 * `/earn/earnings`) and accept the few names the docs and the read SDK use for the same figure — a rate under
 * `supplyRate` or `totalRate`, the withdrawable amount under `liquiditySupplyData.withdrawable` — one
 * canonical name first, the alternates after. Every figure that cannot be read is `null` and travels as
 * `null`: a market with an unreadable rate says the rate was not read rather than showing a zero.
 *
 * This is written against the documentation because the key with Lend access is the founder's to issue and had
 * not been issued when this was built. The reading is therefore proven on fixtures shaped like the documented
 * responses (`fixtures.ts`), and the first live answer is the founder's own canary — the card says so rather than
 * this file pretending the contract was observed.
 */

import {
  availableRawOf,
  earnedRawOf,
  minimumRawFor,
  rawOf,
  type EarnMarket,
  type EarnPosition,
  type EarnUnavailable,
} from "./model.ts";

export const JUPITER_LEND_BASE_URL = "https://api.jup.ag/lend/v1";

/** Jupiter Lend's own programs on mainnet, for the Review's detail and the submit lane's check. */
export const JUPITER_LEND_EARN_PROGRAM = "jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9";
export const JUPITER_LEND_LIQUIDITY_PROGRAM = "jupeiUmn818Jg1ekPURTpr4mFo29p46vygyykFJ3wZC";

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

function textOf(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function intOf(value: unknown): number | null {
  if (typeof value === "number") return Number.isInteger(value) && value >= 0 ? value : null;
  if (typeof value === "string" && /^\d{1,3}$/.test(value.trim())) return Number(value.trim());
  return null;
}

/**
 * A rate a year as the API states it — in basis points (live 3.11.2026: USDC `totalRate` "530" is 5.30 %) — as a
 * per-cent figure, refusing nonsense rather than drawing it. The ceiling is deliberate: 300 % is above every rate
 * these markets have paid, so a unit mix-up reads as no rate, never as a figure a person believes once and never
 * forgives.
 */
const MAX_PLAUSIBLE_RATE_PERCENT = 300;

export function ratePercentOf(value: unknown): number | null {
  const bps = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : Number.NaN;
  if (!Number.isFinite(bps) || bps < 0) return null;
  const percent = Math.round(bps) / 100;
  return percent <= MAX_PLAUSIBLE_RATE_PERCENT ? percent : null;
}

function priceOf(value: unknown): number | null {
  const raw = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : Number.NaN;
  return Number.isFinite(raw) && raw > 0 ? raw : null;
}

/** The first field present, by name, so an alternate spelling of the same figure is read rather than lost. */
function pick(source: Json, names: readonly string[]): unknown {
  for (const name of names) {
    const value = source[name];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

/**
 * One Earn market from one entry of `GET /earn/tokens`.
 *
 * Null when the entry does not carry the three things a market cannot be drawn without: the jlToken's mint,
 * the asset's mint and the asset's decimals. Everything else may be missing and is then stated as missing.
 */
export function marketFrom(entry: unknown, readAt: string): EarnMarket | null {
  if (!isObject(entry)) return null;
  const asset = isObject(entry.asset) ? entry.asset : null;
  const shareMint = textOf(pick(entry, ["address", "mint", "jlTokenAddress"]));
  const assetMint = asset ? textOf(pick(asset, ["address", "mint"])) : null;
  const assetDecimals = asset ? intOf(pick(asset, ["decimals"])) : null;
  if (!shareMint || !assetMint || assetDecimals === null) return null;

  const price = asset ? priceOf(pick(asset, ["price", "priceUsd"])) : null;
  const supplied = rawOf(pick(entry, ["totalAssets", "totalSupplyAssets", "supply"]));
  const liquidity = isObject(entry.liquiditySupplyData) ? entry.liquiditySupplyData : null;
  const liquid = liquidity ? rawOf(pick(liquidity, ["withdrawable", "withdrawableUntilLimit", "withdrawalLimit"])) : null;

  return {
    provider: "jupiter",
    /* The market is named by the asset's mint: that is what the deposit and withdraw calls take, so the id a
       Review carries is the id the next call needs. */
    id: assetMint,
    asset: {
      mint: assetMint,
      symbol: (asset ? textOf(pick(asset, ["symbol"])) : null) ?? "",
      decimals: assetDecimals,
    },
    share: {
      mint: shareMint,
      symbol: textOf(pick(entry, ["symbol"])) ?? "",
      decimals: intOf(pick(entry, ["decimals"])) ?? assetDecimals,
    },
    rateAnnualPercent: ratePercentOf(pick(entry, ["totalRate", "supplyRate", "rate"])),
    suppliedRaw: supplied === null ? null : supplied.toString(),
    liquidRaw: liquid === null ? null : liquid.toString(),
    minimumRaw: minimumRawFor(assetDecimals, price)?.toString() ?? null,
    priceUsd: price,
    readAt,
  };
}

/** Every readable market of an answer, in the order it came; an unreadable entry is dropped, not faked. */
export function marketsFrom(payload: unknown, readAt: string): readonly EarnMarket[] {
  const entries = Array.isArray(payload) ? payload : isObject(payload) && Array.isArray(payload.tokens) ? payload.tokens : [];
  return entries.map((entry) => marketFrom(entry, readAt)).filter((market): market is EarnMarket => market !== null);
}

/**
 * What `GET /earn/positions` says about one market for one wallet: the shares held and what they are worth.
 *
 * The provider's figures are kept apart from the chain's on purpose. This is the exchange rate's half — how
 * much asset one share is worth — and the wallet's actual share balance is read from the chain, so a stale
 * provider cache cannot report a position the wallet no longer holds.
 */
export type JupiterPositionRead = Readonly<{
  marketId: string;
  shareMint: string;
  /** The shares the provider believes the wallet holds, base units; null when it did not say. */
  sharesRaw: string | null;
  /** What those shares are worth in the asset, base units; null when it did not say. */
  underlyingRaw: string | null;
}>;

export function positionReadsFrom(payload: unknown): readonly JupiterPositionRead[] {
  const entries = Array.isArray(payload) ? payload : isObject(payload) && Array.isArray(payload.positions) ? payload.positions : [];
  const reads: JupiterPositionRead[] = [];
  for (const entry of entries) {
    if (!isObject(entry)) continue;
    const token = isObject(entry.token) ? entry.token : null;
    const shareMint = textOf(pick(entry, ["address", "tokenAddress"])) ?? (token ? textOf(pick(token, ["address", "mint"])) : null);
    const marketId = token && isObject(token.asset) ? textOf(pick(token.asset, ["address", "mint"])) : textOf(pick(entry, ["asset", "assetAddress"]));
    if (!shareMint || !marketId) continue;
    const shares = rawOf(pick(entry, ["shares", "balance", "tokenBalance"]));
    const underlying = rawOf(pick(entry, ["underlyingAssets", "underlyingBalance", "assets"]));
    reads.push({
      marketId,
      shareMint,
      sharesRaw: shares === null ? null : shares.toString(),
      underlyingRaw: underlying === null ? null : underlying.toString(),
    });
  }
  return reads;
}

/**
 * What `GET /earn/earnings` says a wallet put in, net: deposits less withdrawals, per market.
 *
 * This is the other half of «earned» and the only place it can come from — the chain carries transfers, not a
 * running total of this person's cost basis. Null where the answer did not carry it, which leaves the earned
 * figure unknown rather than equal to the whole position.
 */
export function netDepositsFrom(payload: unknown): ReadonlyMap<string, bigint> {
  const entries = Array.isArray(payload) ? payload : isObject(payload) && Array.isArray(payload.earnings) ? payload.earnings : [];
  const net = new Map<string, bigint>();
  for (const entry of entries) {
    if (!isObject(entry)) continue;
    const shareMint = textOf(pick(entry, ["address", "tokenAddress"]));
    if (!shareMint) continue;
    const deposits = rawOf(pick(entry, ["totalDeposits"]));
    const withdraws = rawOf(pick(entry, ["totalWithdraws", "totalWithdrawals"]));
    if (deposits === null) continue;
    net.set(shareMint, deposits - (withdraws ?? 0n));
  }
  return net;
}

/**
 * One position, from the three sources that each own a piece of it: the market (what asset, what decimals),
 * the chain (how many shares this wallet really holds, and the worth of them at the exchange rate the
 * provider stated) and the provider's own record (what went in).
 *
 * `sharesOnChainRaw` decides the position's existence. When the chain says the wallet holds no shares, the
 * position is empty whatever the provider's cache says, and the worth is scaled to the chain's count rather
 * than copied from the provider's. `null` is the third answer — the chain was not read — and it travels all
 * the way to the screen as «not read» rather than collapsing into an empty position.
 */
export function positionFrom(args: {
  market: EarnMarket;
  sharesOnChainRaw: bigint | null;
  read: JupiterPositionRead | null;
  netDepositRaw: bigint | null;
  readAt: string;
  readFrom: string;
}): EarnPosition {
  const { market, sharesOnChainRaw, read, netDepositRaw, readAt, readFrom } = args;
  const providerShares = read?.sharesRaw === undefined || read?.sharesRaw === null ? null : BigInt(read.sharesRaw);
  const providerUnderlying = read?.underlyingRaw === undefined || read?.underlyingRaw === null ? null : BigInt(read.underlyingRaw);
  /* The worth of the shares the chain says are there: the provider's pair gives the rate, the chain gives the
     count. Equal counts take the provider's figure as it stands; a different count scales it. */
  const underlying =
    sharesOnChainRaw === null
      ? null
      : providerUnderlying === null || providerShares === null || providerShares <= 0n
        ? sharesOnChainRaw === 0n
          ? 0n
          : null
        : (providerUnderlying * sharesOnChainRaw) / providerShares;
  const liquid = market.liquidRaw === null ? null : BigInt(market.liquidRaw);
  return {
    provider: "jupiter",
    marketId: market.id,
    asset: market.asset,
    sharesRaw: sharesOnChainRaw === null ? null : sharesOnChainRaw.toString(),
    underlyingRaw: underlying === null ? null : underlying.toString(),
    depositedRaw: sharesOnChainRaw === null || netDepositRaw === null ? null : netDepositRaw.toString(),
    earnedRaw: earnedRawOf(underlying, netDepositRaw)?.toString() ?? null,
    availableRaw: availableRawOf(underlying, liquid)?.toString() ?? null,
    readAt,
    readFrom,
  };
}

/* ------------------------------------------------------------------ failures */

/**
 * Why a call to the Lend API failed, in the words a surface can act on.
 *
 * `401` and `403` are the key's own answer and are reported as the key's problem rather than as an outage: a
 * key that is missing and a key that Lend does not cover look identical to a person reading the page, and
 * both are the founder's to fix.
 */
export function unavailableFromStatus(status: number): Readonly<{ code: EarnUnavailable; reason: string }> {
  if (status === 401 || status === 403) {
    return { code: "NO_KEY", reason: `Jupiter Lend refused the key (HTTP ${status}). The key needs Lend API access.` };
  }
  return { code: "PROVIDER_DOWN", reason: `Jupiter Lend answered HTTP ${status}.` };
}

/** A base64 transaction as the deposit and withdraw endpoints return it; null for anything else. */
export function transactionFrom(payload: unknown): string | null {
  if (!isObject(payload)) return null;
  const value = pick(payload, ["transaction", "tx", "serializedTransaction"]);
  if (typeof value !== "string") return null;
  const clean = value.trim();
  /* Base64 of a signable transaction: a few hundred bytes at least, and a megabyte is not one. */
  return /^[A-Za-z0-9+/]+={0,2}$/.test(clean) && clean.length >= 64 && clean.length <= 1_000_000 ? clean : null;
}
