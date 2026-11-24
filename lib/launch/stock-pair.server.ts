/**
 * «У парі з акцією» on the server (the preset and its reasons — `../core/launch/stock-pair.ts`).
 *
 * Two doors, both behind `RYNTRA_LAUNCH_STOCK_PAIR=open`:
 * - the offer: every checked pair currency of the register that is a stock of the shelf, read now — open or closed
 *   with the reasons, the curve's threshold in the stock's units, its market caps, and the facts of the line before
 *   the signature (what the issuer can do, the exchange, the issuer's terms);
 * - the config: a config made for one launch, exactly as «Розширений» makes one (`./advanced.server.ts`) — the creator
 *   signs it first and pays its rent, Ryntra's partner vault is its claimer — with the preset's numbers instead of a
 *   creator's choice and Meteora's token badge of the stock named in it. `submitAdvancedConfig` sends it, and the
 *   launch on it is an ordinary `«Розширений»` build that names it: one config, one launch.
 *
 * Closed, both answer that the preset is not offered, and nothing else of the engine changes. Reads the chain, the
 * price and the stocks engine; signs nothing but the config's own fresh key, sealed until the creator has signed.
 */

import { quoteAssetRefusalWords, type QuoteAssetRefusal } from "../core/launch/quote-asset.ts";
import {
  STOCK_PAIR_NAME,
  STOCK_PAIR_PRESET_ID,
  STOCK_PAIR_TERMS,
  stockPairHonesty,
  stockPairMarketCaps,
  stockPairOpen,
  stockPairPreset,
  stockPairQuote,
  stockPairTermsOf,
  stockPairThreshold,
  type StockPairHonesty,
  type StockPairThreshold,
  type StockPairThresholdRefusal,
} from "../core/launch/stock-pair.ts";
import { ticketKeyConfigured } from "../liquidity/studio/ticket.ts";
import { buildOneLaunchConfig, type PreparedAdvancedConfig } from "./advanced.server.ts";
import type { LaunchDeps, LaunchFailure } from "./flow.server.ts";
import { quoteAssetFor, readQuoteAssets, type QuoteAssetDeps, type QuoteAssetState } from "./quote-asset.server.ts";
import { quotePaused } from "./quote-watch.server.ts";

const fail = (code: LaunchFailure["code"], message: string): LaunchFailure => ({ ok: false, code, message });

const THRESHOLD_WORDS: Readonly<Record<StockPairThresholdRefusal, string>> = Object.freeze({
  PRICE_UNKNOWN: "the stock's price is not known now",
  DEPTH_UNKNOWN: "the stock's liquidity on chain is not known now, so its curve cannot be sized",
  TOO_THIN: "the stock is too thin: even the smallest curve would need more than a twentieth of its liquidity",
});

/** The threshold of a curve on this stock as a plain amount: raw as a string, in the stock's units, in dollars. */
export type StockPairThresholdView = Readonly<{ raw: string; units: string; usd: number; basis: StockPairThreshold["basis"] }>;

/** One stock a launch may pair with, as it reads now. */
export type StockPairOffer = Readonly<{
  mint: string;
  symbol: string;
  decimals: number;
  /** `OPEN` — a config may be built on it now; `CLOSED` — not, and the reasons say why. */
  state: "OPEN" | "CLOSED";
  /** The register's own refusals (`../core/launch/quote-asset.ts`). */
  reasons: readonly QuoteAssetRefusal[];
  /** Why the curve could not be sized, where the register itself is content; null otherwise. */
  sizing: StockPairThresholdRefusal | null;
  threshold: StockPairThresholdView | null;
  marketCaps: ReturnType<typeof stockPairMarketCaps> | null;
  priceUsd: number | null;
  priceAt: string | null;
  /** The line before the signature; null where the mint or the shelf could not be read. */
  honesty: StockPairHonesty | null;
}>;

const thresholdView = (threshold: StockPairThreshold): StockPairThresholdView => ({ raw: threshold.raw.toString(), units: threshold.units, usd: Math.round(threshold.usd * 100) / 100, basis: threshold.basis });

/** One checked pair currency as a stock-paired launch reads it: its curve's size and the line before the signature. */
export function stockPairOfferOf(state: QuoteAssetState): StockPairOffer {
  const shelf = state.shelf ?? null;
  const sized = shelf ? stockPairThreshold({ priceUsd: state.priceUsd, decimals: state.record.decimals, liquidityUsd: shelf.liquidityUsd }) : null;
  const threshold = sized?.ok ? sized.threshold : null;
  const sizing = sized && !sized.ok ? sized.reason : null;
  const reasons = [...state.problems];
  /* A mint the register opens but the shelf does not hold — a permissionless token of the register — is no stock to pair with. */
  if (!shelf && !reasons.includes("STOCK_NOT_ON_SHELF") && !reasons.includes("SHELF_NOT_READ")) reasons.push("STOCK_NOT_ON_SHELF");
  return {
    mint: state.record.mint,
    symbol: state.record.symbol,
    decimals: state.record.decimals,
    state: reasons.length === 0 && threshold !== null ? "OPEN" : "CLOSED",
    reasons,
    sizing,
    threshold: threshold ? thresholdView(threshold) : null,
    marketCaps: threshold && state.priceUsd ? stockPairMarketCaps(threshold, state.priceUsd) : null,
    priceUsd: state.priceUsd,
    priceAt: state.priceAt,
    honesty: state.facts && shelf ? stockPairHonesty(state.facts, shelf) : null,
  };
}

/** The line before the signature as plain data — its lists copied out of the frozen shape, as an answer carries them. */
export function honestyPlain(honesty: StockPairHonesty) {
  return { ...honesty, terms: { ...honesty.terms, excluded: honesty.terms.excluded.map((place) => ({ ...place })) }, risks: [...honesty.risks] };
}

/** An offer as an answer carries it. */
export function offerPlain(offer: StockPairOffer) {
  return { ...offer, reasons: [...offer.reasons], honesty: offer.honesty ? honestyPlain(offer.honesty) : null };
}

/** The preset as a page says it: its name and the numbers every stock-paired curve shares. */
export const STOCK_PAIR_PRESET_VIEW = Object.freeze({
  id: STOCK_PAIR_PRESET_ID,
  name: STOCK_PAIR_NAME,
  sniperFee: stockPairPreset({ units: "1" }).sniperFee,
  creatorTradingFeePct: STOCK_PAIR_TERMS.creatorTradingFeePct,
  graduationFee: STOCK_PAIR_TERMS.graduationFee,
  graduatedPool: { startFeeBps: STOCK_PAIR_TERMS.poolStartFeeBps, endFeeBps: STOCK_PAIR_TERMS.poolEndFeeBps },
  creatorFirstBuyCapBps: STOCK_PAIR_TERMS.firstBuyCapBps,
  supply: STOCK_PAIR_TERMS.supply,
  multiple: STOCK_PAIR_TERMS.multiple,
});

/** The stocks a launch may pair with now; null — the preset is not offered here (the flag closed). */
export async function readStockPairOffers(deps: QuoteAssetDeps): Promise<readonly StockPairOffer[] | null> {
  if (!stockPairOpen(deps.env ?? process.env)) return null;
  const states = await readQuoteAssets(deps, { cache: true });
  return states.map(stockPairOfferOf);
}

export type PreparedStockPairConfig = PreparedAdvancedConfig &
  Readonly<{
    stockPair: Readonly<{
      threshold: StockPairThresholdView;
      marketCaps: ReturnType<typeof stockPairMarketCaps>;
      priceUsd: number;
      priceAt: string | null;
      honesty: StockPairHonesty;
    }>;
  }>;

/**
 * The config of one stock-paired launch: the stock read now — the register, the badge, the shelf —, the curve sized
 * on it, and the bytes the creator signs first. A single refusal builds nothing.
 */
export async function prepareStockPairConfig(deps: LaunchDeps, input: Readonly<{ creator: string; quoteMint: string }>): Promise<PreparedStockPairConfig | LaunchFailure> {
  const env = deps.env ?? {};
  if (!stockPairOpen(env)) return fail("PRESET_UNAVAILABLE", "A launch paired with a stock is not offered here.");
  if (!deps.network.advanced) return fail("PRESET_UNAVAILABLE", "A config of one launch is not offered on this network.");
  if (!ticketKeyConfigured(env)) return fail("BUILD_FAILED", "Launching is paused; nothing was built.");
  const asset = await quoteAssetFor({ cluster: deps.network.cluster, connection: deps.connection, env, now: deps.now, price: deps.quotePrice, shelf: deps.stockShelf }, input.quoteMint);
  if (!asset) return fail("ADVANCED_INVALID", "This stock is not one Ryntra checked on this network.");
  const offer = stockPairOfferOf(asset);
  if (asset.state !== "OPEN" || offer.reasons.length > 0) {
    const why = quoteAssetRefusalWords(offer.reasons) || "the stock could not be checked now";
    return fail("QUOTE_PAUSED", `A launch paired with this stock is closed: ${why}. Nothing was built.`);
  }
  const sized = stockPairThreshold({ priceUsd: asset.priceUsd, decimals: asset.record.decimals, liquidityUsd: asset.shelf?.liquidityUsd ?? null });
  if (!sized.ok) return fail("QUOTE_PAUSED", `A launch paired with this stock is closed: ${THRESHOLD_WORDS[sized.reason]}. Nothing was built.`);
  if (!asset.facts || !asset.shelf || asset.priceUsd === null) return fail("QUOTE_PAUSED", "The stock could not be checked now; nothing was built.");
  /* SOL-L12: a stock whose issuer changed its mint since Ryntra first read it waits for Ryntra's check. */
  if (await quotePaused(deps.store, deps.network.cluster, asset.record.mint)) return fail("QUOTE_PAUSED", "The stock's issuer changed its token's rules; launches on it wait for Ryntra's check. Nothing was built.");
  const threshold = sized.threshold;
  const built = await buildOneLaunchConfig(deps, {
    creator: input.creator,
    terms: stockPairTermsOf(threshold, asset.record.mint, asset.priceUsd),
    preset: stockPairPreset(threshold),
    quote: stockPairQuote(asset.record.mint, asset.record.decimals),
    asset,
  });
  if (!built.ok) return built;
  return {
    ...built,
    stockPair: {
      threshold: thresholdView(threshold),
      marketCaps: stockPairMarketCaps(threshold, asset.priceUsd),
      priceUsd: asset.priceUsd,
      priceAt: asset.priceAt,
      honesty: stockPairHonesty(asset.facts, asset.shelf),
    },
  };
}
