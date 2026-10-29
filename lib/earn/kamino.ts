/**
 * Kamino Lend — the second provider, built against the same interface and switched off.
 *
 * The
 * adapter exists, answers every call the surface makes and is off behind a flag until the founder says
 * otherwise ({@link KAMINO_ENV}). Off is stated on the page as off — never as a market with nothing in it.
 *
 * ## Why the flag, and why a decision rather than a default
 *
 * Neither provider pays an integrator a share of supply interest today, which is why Earn carries no Ryntra
 * fee at all ({@link EARN_FEE_BPS}). Turning Kamino on
 * is therefore a decision with a price attached, and a flag is where a decision with a price belongs.
 *
 * ## What is here and what the switch still needs
 *
 * The reader below is pure and complete: Kamino's reserve shape — the asset, its decimals, the supply APY and
 * the liquidity standing in the reserve — into the product's own {@link EarnMarket}. What is deliberately not
 * here is an endpoint nobody has called from this repository, so the adapter asks the deployment for the base
 * URL it should read ({@link KAMINO_API_ENV}) instead of hard-coding a host that was never reached. With the
 * flag on and no base URL, the provider reports itself unreachable with that exact reason, which is the truth
 * rather than an outage.
 *
 * Deposits and withdrawals stay closed on this provider until both are settled. The adapter says so in words a surface can draw.
 */

import { minimumRawFor, rawOf, type EarnMarket } from "./model.ts";
import { KAMINO_ENV } from "./providers.ts";

export { KAMINO_ENV };

/** Where the adapter reads Kamino's reserves from, once it is turned on. */
export const KAMINO_API_ENV = "RYNTRA_EARN_KAMINO_API";

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const textOf = (value: unknown): string | null => (typeof value === "string" && value.trim().length > 0 ? value.trim() : null);

function numberOf(value: unknown): number | null {
  const raw = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : Number.NaN;
  return Number.isFinite(raw) ? raw : null;
}

function intOf(value: unknown): number | null {
  const raw = numberOf(value);
  return raw !== null && Number.isInteger(raw) && raw >= 0 && raw <= 18 ? raw : null;
}

/**
 * One reserve of Kamino's as a market of this product.
 *
 * `supplyInterestAPY` is a share rather than a per cent in every shape Kamino publishes it — `0.0412` for
 * 4.12 % — so it is multiplied here, and the same ceiling as Jupiter's reader applies: a figure that would
 * read as hundreds of per cent a year is refused as a unit mix-up rather than drawn.
 */
export function kaminoMarketFrom(entry: unknown, readAt: string): EarnMarket | null {
  if (!isObject(entry)) return null;
  const mint = textOf(entry.liquidityToken ?? entry.mintAddress ?? entry.liquidityMint);
  const decimals = intOf(entry.liquidityTokenDecimals ?? entry.mintDecimals ?? entry.decimals);
  const id = textOf(entry.reserveAddress ?? entry.address ?? entry.reserve);
  if (!mint || decimals === null || !id) return null;

  const apyShare = numberOf(entry.supplyInterestAPY ?? entry.supplyApy ?? entry.supplyAPY);
  const rate = apyShare === null ? null : apyShare * 100;
  const price = numberOf(entry.price ?? entry.priceUsd);
  const supplied = rawOf(entry.totalSupply ?? entry.totalLiquidity ?? entry.depositedAmount);
  const liquid = rawOf(entry.availableAmount ?? entry.availableLiquidity);

  return {
    provider: "kamino",
    id,
    asset: { mint, symbol: textOf(entry.symbol ?? entry.liquidityTokenSymbol) ?? "", decimals },
    /** Kamino's deposit is a share of the reserve rather than a token in the wallet, so the share token is the
        reserve's collateral mint where it names one, and the asset's own mint where it does not. */
    share: {
      mint: textOf(entry.collateralMintAddress ?? entry.collateralMint) ?? mint,
      symbol: textOf(entry.collateralTokenSymbol) ?? "",
      decimals: intOf(entry.collateralMintDecimals) ?? decimals,
    },
    rateAnnualPercent: rate !== null && rate >= 0 && rate <= 300 ? rate : null,
    suppliedRaw: supplied === null ? null : supplied.toString(),
    liquidRaw: liquid === null ? null : liquid.toString(),
    minimumRaw: minimumRawFor(decimals, price)?.toString() ?? null,
    priceUsd: price !== null && price > 0 ? price : null,
    readAt,
  };
}

export function kaminoMarketsFrom(payload: unknown, readAt: string): readonly EarnMarket[] {
  const entries = Array.isArray(payload) ? payload : isObject(payload) && Array.isArray(payload.reserves) ? payload.reserves : [];
  return entries.map((entry) => kaminoMarketFrom(entry, readAt)).filter((market): market is EarnMarket => market !== null);
}

/** What the surface is told when Kamino is on but its action path is not: the two things still outstanding. */
export const KAMINO_ACTIONS_REASON =
  "Kamino Lend is read-only here: a deposit through it waits on a decision about the referrer rate and on one live read of its reserves.";
