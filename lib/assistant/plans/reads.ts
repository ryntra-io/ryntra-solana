/**
 * What a trade plan stands on — read once, through the agent's own readers
 * (the plan engine's asset resolution, the Spot catalogue, the token's daily
 * candles, the news digest), and numbered as sources `s1`, `s2`, … so every
 * figure the plan, the critic or a model's sentence uses carries where it
 * came from and when.
 *
 * Nothing here calls a provider of its own: the readers are the seam the
 * stand and the tests bind fixtures to. Headlines are third-party words —
 * they travel apart, marked, and never become a fact.
 */

import type { AgentState, PlanAssetRead } from "../../api/v1/contract.ts";
import type { AgentReaders, CandleBar } from "../../agent/tools/readers.ts";
import { FRESHNESS_MS, pctText, stateOf, usdCompactText, usdText, type Locale } from "../../agent/provenance.ts";
import type { SpotMarket } from "../../spot/markets.ts";

export type PlanSource = Readonly<{ id: string; source: string; observedAt: string; state: AgentState; href: string | null }>;
/** One figure a sentence may state: its value, its unit, the text a person reads it in, and the source it cites. */
export type PlanFact = Readonly<{ key: string; label: string; value: number; unit: "USD" | "%" | "count"; text: string; cite: string }>;
export type PlanHeadline = Readonly<{ title: string; source: string; publishedAt: string; cite: string }>;

export type PlanReads = Readonly<{
  asset: PlanAssetRead;
  market: SpotMarket | null;
  /** The price the plan is planned against: the plan engine's, else the catalogue's. */
  priceUsd: number | null;
  priceCite: string | null;
  priceState: AgentState;
  liquidityUsd: number | null;
  candles: readonly CandleBar[];
  headlines: readonly PlanHeadline[];
  sources: readonly PlanSource[];
  facts: readonly PlanFact[];
}>;

export type PlanReadFailure = Readonly<{ ok: false; code: "ASSET_UNCONFIRMED" | "UNAVAILABLE"; reason: string }>;

const DAY_MS = 86_400_000;

/** The reads for one mint; the asset must be one a plan can name (the plan engine decides), the rest may be missing and are then named as missing. */
export async function readPlanInputs(readers: AgentReaders, mint: string, nowMs: number, locale: Locale = "en"): Promise<Readonly<{ ok: true; reads: PlanReads }> | PlanReadFailure> {
  const resolved = await readers.planAsset(mint).catch(() => null);
  if (!resolved) return { ok: false, code: "UNAVAILABLE", reason: "The plan engine did not answer for this token right now." };
  if (!resolved.ok) return { ok: false, code: resolved.code === "ASSET_UNCONFIRMED" ? "ASSET_UNCONFIRMED" : "UNAVAILABLE", reason: resolved.message };
  const asset = resolved.read;
  const sources: PlanSource[] = [];
  const facts: PlanFact[] = [];
  const textOf = (value: number, unit: PlanFact["unit"], compact = false): string => (unit === "%" ? pctText(value, locale) : unit === "USD" ? (compact ? usdCompactText(value, locale) : usdText(value, locale)) : String(value));
  const fact = (key: string, label: string, value: number, unit: PlanFact["unit"], cite: string, compact = false) => facts.push({ key, label, value, unit, text: textOf(value, unit, compact), cite });
  const cite = (source: string, observedAt: string, state: AgentState, href: string | null): string => {
    const id = `s${sources.length + 1}`;
    sources.push({ id, source, observedAt, state, href });
    return id;
  };

  let priceUsd: number | null = null;
  let priceCite: string | null = null;
  let priceState: AgentState = "unavailable";
  if (asset.planningPrice) {
    priceState = asset.planningPrice.state;
    priceCite = cite(asset.planningPrice.source === "jupiter-token-price" ? "Jupiter" : asset.planningPrice.source === "issuer-reference" ? "Issuer reference" : "Jupiter per share", asset.planningPrice.observedAt, priceState, `/app/spot/${mint}`);
    priceUsd = asset.planningPrice.perUnit;
    fact("price", "Price now", priceUsd, "USD", priceCite);
  }

  const marketRead = await readers.spotMarket(mint).catch(() => null);
  const market = marketRead && marketRead.ok ? marketRead.market : null;
  if (market && marketRead && marketRead.ok) {
    const state: AgentState = marketRead.stale ? "stale" : stateOf(marketRead.observedAt, FRESHNESS_MS.market, nowMs);
    const id = cite("Jupiter (Spot catalogue)", marketRead.observedAt, state, `/app/spot/${mint}`);
    if (priceUsd === null && market.price !== null) {
      priceUsd = market.price;
      priceCite = id;
      priceState = state;
      fact("price", "Price now", market.price, "USD", id);
    }
    if (market.change24hPct !== null) fact("change24h", "Change over 24 h", market.change24hPct, "%", id);
    if (market.volume24hUsd !== null) fact("volume24h", "Volume over 24 h", market.volume24hUsd, "USD", id, true);
    if (market.liquidityUsd !== null) fact("liquidity", "Liquidity", market.liquidityUsd, "USD", id, true);
  }
  const liquidityUsd = asset.liquidityUsd ?? market?.liquidityUsd ?? null;

  const candleRead = await readers.candles(mint, "1d").catch(() => null);
  const candles = candleRead && candleRead.ok ? candleRead.candles.slice(-30) : [];
  if (candleRead && candleRead.ok && candles.length > 0) {
    const id = cite(`GeckoTerminal (${candleRead.pool.dex})`, candleRead.observedAt, candleRead.stale ? "stale" : "current", null);
    const last7 = candles.filter((bar) => bar.time * 1000 >= nowMs - 7 * DAY_MS);
    const low30 = Math.min(...candles.map((bar) => bar.low));
    const high30 = Math.max(...candles.map((bar) => bar.high));
    fact("low30d", "Lowest daily low, 30 days", low30, "USD", id);
    fact("high30d", "Highest daily high, 30 days", high30, "USD", id);
    if (last7.length > 0) {
      fact("low7d", "Lowest daily low, 7 days", Math.min(...last7.map((bar) => bar.low)), "USD", id);
      fact("high7d", "Highest daily high, 7 days", Math.max(...last7.map((bar) => bar.high)), "USD", id);
    }
  }

  const newsRead = await readers.news(mint).catch(() => null);
  const headlines: PlanHeadline[] = [];
  if (newsRead && newsRead.ok && newsRead.digest) {
    for (const story of newsRead.digest.stories.slice(0, 4)) {
      const id = cite(story.source, story.publishedAt, newsRead.stale ? "stale" : "current", story.url);
      headlines.push({ title: story.title.slice(0, 200), source: story.source, publishedAt: story.publishedAt, cite: id });
    }
  }

  return { ok: true, reads: { asset, market, priceUsd, priceCite, priceState, liquidityUsd, candles, headlines, sources: sources.slice(0, 12), facts } };
}
