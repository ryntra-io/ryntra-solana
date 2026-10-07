/**
 * What a rule names (1.31.0, «Регулярна купівля для всього») — resolved by
 * mint, the one way the rule's create, its turning on again, the read route
 * and the tick read it.
 *
 * **A company** first: a confirmed stock representation of the universe, as
 * since 1.12.0 — a company the issuer is not selling right now, or whose
 * conversion window has closed, is refused with that reason. **Else a token
 * of the venue's list**: a coin, a meme or a new token, priced per token. It
 * must have decimals, must not be flagged suspicious by the venue's own
 * audit, and must stand on the floor (`./floor.ts`) — liquidity and age read
 * now; a figure that cannot be read is unavailability, never a refusal of
 * the token and never a pass. A token the venue has not verified is named
 * with the memes (`kind: "meme"`, issuer `unverified`): the same facts of risk
 * before the button, the same floor.
 *
 * A source that did not answer is `UNAVAILABLE`; a refusal says why in one
 * sentence. Nothing here reads a wallet or builds an order.
 */

import { TOKEN_CONFIRMATION_ISSUER, type PlanAsset, type RuleAssetRead } from "../api/v1/contract.ts";
import { planAssetOf } from "../plans/service.ts";
import { readSpotMarket, readSpotMarketsByMint } from "../spot/markets.server.ts";
import { isUnsupportedMarket, type SpotMarket } from "../spot/markets.ts";
import { eventStateAt } from "../stocks/instrument.ts";
import { lifecycleEventFor } from "../stocks/lifecycle-events.ts";
import { isRetiredMint, RETIRED_REASON } from "../stocks/retired.ts";
import { companyDisplayName } from "../stocks/shelf.ts";
import { findStockRow, type StockRow } from "../stocks/universe.server.ts";
import type { DipPrice } from "./dip.ts";
import { ageHoursOf, checkFloor, floorLine, type RuleFloorCheck, type RuleRiskFacts } from "./floor.ts";
import { referenceKindOf, type PriceReference } from "./price-condition.ts";

export type RuleAssetDeps = Readonly<{
  now?: () => Date;
  findRow?: typeof findStockRow;
  readMarket?: typeof readSpotMarket;
  readMarkets?: typeof readSpotMarketsByMint;
  lifecycle?: typeof lifecycleEventFor;
}>;

/** The issuer field of a token the venue has not verified: nobody confirms it, and the rule says so. */
export const UNVERIFIED_ISSUER = { id: "unverified", label: "Not verified" } as const;

type Inspected = Readonly<{
  class: "stock" | "crypto" | "meme";
  asset: PlanAsset;
  name: string;
  /** The price a person reads now, per unit as the wallet shows it, with when it was read; null when none is stated. */
  price: DipPrice | null;
  reference: PriceReference | null;
  floor: RuleFloorCheck | null;
  risk: RuleRiskFacts | null;
  /** Why no rule can name it, with the token's facts still stated; null when one can. */
  refusal: Readonly<{ code: "ASSET_UNCONFIRMED" | "RULE_LIQUIDITY_LOW"; message: string }> | null;
  row: StockRow | null;
  market: SpotMarket | null;
  observedAt: string;
}>;

export type RuleAssetFailure = Readonly<{ ok: false; code: "ASSET_UNCONFIRMED" | "RULE_LIQUIDITY_LOW" | "UNAVAILABLE"; message: string }>;

const nowOf = (deps: RuleAssetDeps): Date => (deps.now ?? (() => new Date()))();

/** The company's price per unit as its page shows it, with its time — a row with no time of its own was read with the universe just now. */
function stockPrice(row: StockRow, nowMs: number): DipPrice | null {
  /* A partial row (a test's, a copy without markets) states no price. */
  if (!row.market || typeof row.market.priceUsd !== "number" || !(row.market.priceUsd > 0)) return null;
  const observed = row.market.observedAt ? Date.parse(row.market.observedAt) : nowMs;
  return Number.isFinite(observed) ? { usd: row.market.priceUsd, observedAtMs: observed } : null;
}

/** A token of the venue's list as a rule's asset: priced per token, verified ones as `crypto` unless the venue calls them memes. */
export function ruleAssetOfMarket(market: SpotMarket): PlanAsset {
  const kind = market.verified && market.category !== "meme" ? "crypto" : "meme";
  return {
    network: "solana:mainnet",
    mint: market.mint,
    symbol: market.symbol.slice(0, 32),
    issuer: market.verified ? { id: TOKEN_CONFIRMATION_ISSUER.id, label: TOKEN_CONFIRMATION_ISSUER.label } : { ...UNVERIFIED_ISSUER },
    underlying: { symbol: market.symbol.slice(0, 16), name: market.name ? market.name.slice(0, 128) : null },
    decimals: market.decimals,
    unitBasis: "token",
    kind,
  };
}

/** The floor's facts and the facts of risk a market states, read at `observedAtMs`. */
export function tokenFactsOf(market: SpotMarket, observedAtMs: number, nowMs: number): Readonly<{ price: DipPrice | null; floor: RuleFloorCheck; risk: RuleRiskFacts }> {
  const price = typeof market.price === "number" && Number.isFinite(market.price) && market.price > 0 ? { usd: market.price, observedAtMs } : null;
  const floor = checkFloor({ liquidityUsd: market.liquidityUsd, observedAtMs, firstPoolAt: market.firstPoolAt }, nowMs);
  const pct = (value: number | null): number | null => (typeof value === "number" && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : null);
  return {
    price,
    floor,
    risk: {
      verified: market.verified,
      ageHours: ageHoursOf(market.firstPoolAt, nowMs),
      liquidityUsd: floor.liquidityUsd,
      topHoldersPct: pct(market.audit.topHoldersPct),
      mintAuthorityDisabled: market.audit.mintAuthorityDisabled,
      freezeAuthorityDisabled: market.audit.freezeAuthorityDisabled,
      organicScore: pct(market.organicScore),
    },
  };
}

/** Everything a rule on this mint would stand on, or why nothing can be said. */
export async function inspectRuleAsset(mint: string, deps: RuleAssetDeps = {}): Promise<Readonly<{ ok: true; inspected: Inspected }> | RuleAssetFailure> {
  /* A token Ryntra no longer supports is named by no new rule, and no provider is asked about it. */
  if (isRetiredMint(mint)) return { ok: false, code: "ASSET_UNCONFIRMED", message: `No rule can name that token. ${RETIRED_REASON}` };
  const now = nowOf(deps);
  const nowMs = now.getTime();
  const found = await (deps.findRow ?? findStockRow)(mint).catch(() => ({ ok: false as const, reason: "The stock universe did not answer." }));
  const row = found.ok && found.row && found.row.representation.mint === mint ? found.row : null;
  if (row) {
    const rep = row.representation;
    const preIpo = rep.instrument?.class === "pre-ipo";
    let refusal: Inspected["refusal"] = null;
    if (!row.lifecycle.tradable || rep.tradingHalted === true) refusal = { code: "ASSET_UNCONFIRMED", message: "The issuer is not offering new purchases of this company right now." };
    /* The registry's event read with the clock: a conversion window past its cut-off is closed, whatever the file still says. */
    const lifecycle = (deps.lifecycle ?? lifecycleEventFor)(mint);
    if (!refusal && lifecycle && eventStateAt(lifecycle, nowMs) !== "conversion-open") refusal = { code: "ASSET_UNCONFIRMED", message: lifecycle.note };
    return {
      ok: true,
      inspected: {
        class: "stock",
        asset: planAssetOf(row),
        name: companyDisplayName(rep.underlying.name ?? rep.name, preIpo ? null : rep.underlying.symbol).slice(0, 128),
        price: stockPrice(row, nowMs),
        /* A row read without a reference block (a partial copy) offers no condition rather than failing. */
        reference: row.reference?.source ? referenceKindOf(row) : null,
        floor: null,
        risk: null,
        refusal,
        row,
        market: null,
        observedAt: row.market?.observedAt ?? now.toISOString(),
      },
    };
  }
  const read = await (deps.readMarket ?? readSpotMarket)(mint);
  if (!read.ok) return { ok: false, code: "UNAVAILABLE", message: found.ok ? read.reason : `${found.reason} ${read.reason}` };
  if (!read.market) {
    return {
      ok: false,
      code: found.ok ? "ASSET_UNCONFIRMED" : "UNAVAILABLE",
      message: found.ok ? "That mint is neither a confirmed stock representation nor a token the venue lists, so no rule can name it." : `That mint is not a token the venue lists, and the stock universe did not answer: ${found.reason}`,
    };
  }
  const market = read.market;
  if (market.category === "stock") {
    /* A stock is confirmed by the issuer's catalogue, never by the venue's tag alone; when the universe did not answer that is unavailability, not a refusal. */
    if (!found.ok) return { ok: false, code: "UNAVAILABLE", message: found.reason };
    return { ok: false, code: "ASSET_UNCONFIRMED", message: "That mint carries a stock tag but is not a confirmed stock representation, so no rule can name it." };
  }
  if (isUnsupportedMarket(market)) return { ok: false, code: "ASSET_UNCONFIRMED", message: `No rule can name that token. ${RETIRED_REASON}` };
  if (market.decimals === null) return { ok: false, code: "ASSET_UNCONFIRMED", message: `${market.symbol} states no decimals on the venue's list, so its units cannot be counted and no rule can name it.` };
  /* The figures are as new as Ryntra's read of them: a copy served stale is dated when it was read, and the floor and the price judge that. */
  const observedAtMs = Date.parse(read.observedAt);
  /* Judged once the read is in: a figure is never newer than the judgement of it. */
  const facts = tokenFactsOf(market, observedAtMs, Math.max(nowMs, nowOf(deps).getTime()));
  const asset = ruleAssetOfMarket(market);
  const refusal: Inspected["refusal"] = market.audit.suspicious
    ? { code: "ASSET_UNCONFIRMED", message: `${market.symbol} is flagged suspicious by the venue's own audit, so no rule can name it.` }
    : facts.floor.verdict === "below"
      ? { code: "RULE_LIQUIDITY_LOW", message: `${floorLine(facts.floor, market.symbol, "en")}; a rule never names a token below the floor.` }
      : null;
  return {
    ok: true,
    inspected: {
      class: asset.kind === "crypto" ? "crypto" : "meme",
      asset,
      name: market.symbol.slice(0, 128),
      price: facts.price,
      reference: "enabled",
      floor: facts.floor,
      risk: facts.risk,
      refusal,
      row: null,
      market,
      observedAt: read.observedAt,
    },
  };
}

/** The read route's answer: what a rule on this mint would stand on. */
export async function readRuleAsset(mint: string, deps: RuleAssetDeps = {}): Promise<Readonly<{ ok: true; read: RuleAssetRead }> | RuleAssetFailure> {
  const inspected = await inspectRuleAsset(mint, deps);
  if (!inspected.ok) return inspected;
  const { class: assetClass, asset, name, price, reference, floor, risk, refusal, observedAt } = inspected.inspected;
  return {
    ok: true,
    read: {
      asset,
      name,
      class: assetClass,
      priceUsd: price?.usd ?? null,
      priceAt: price && Number.isFinite(price.observedAtMs) ? new Date(price.observedAtMs).toISOString() : null,
      reference,
      floor,
      risk,
      refusal,
      observedAt,
    },
  };
}

/** What a create or a turning on again may name: the token on the floor now, or why not. */
export async function resolveRuleAsset(mint: string, deps: RuleAssetDeps = {}): Promise<Readonly<{ ok: true; inspected: Inspected }> | RuleAssetFailure> {
  const inspected = await inspectRuleAsset(mint, deps);
  if (!inspected.ok) return inspected;
  const { refusal, floor, name } = inspected.inspected;
  if (refusal) return { ok: false, code: refusal.code, message: refusal.message };
  if (floor && floor.verdict !== "met") return { ok: false, code: "UNAVAILABLE", message: `${floorLine(floor, name, "en")}; try again.` };
  return inspected;
}

/**
 * One token of the venue's list as the tick and the order route read it: its
 * price and its floor, now — and `flagged` when the venue's own audit calls
 * it suspicious or Ryntra no longer supports it since the rule was written.
 */
export type TokenMarket = Readonly<{ price: DipPrice | null; floor: RuleFloorCheck; flagged: boolean }>;

/** How many mints one read of the venue carries. */
const READ_BATCH = 100;

/** Many tokens in one read of the venue — the tick's, once a pass; a token the read does not carry is absent. */
export async function readTokenMarkets(mints: readonly string[], nowMs: number, deps: RuleAssetDeps = {}): Promise<ReadonlyMap<string, TokenMarket>> {
  const out = new Map<string, TokenMarket>();
  if (mints.length === 0) return out;
  const unique = [...new Set(mints)];
  /* The venue reads a hundred mints at a time: every rule's token is read, never only the first hundred. */
  for (let start = 0; start < unique.length; start += READ_BATCH) {
    const read = await (deps.readMarkets ?? readSpotMarketsByMint)(unique.slice(start, start + READ_BATCH)).catch(() => null);
    if (!read || !read.ok) continue;
    const observedAtMs = Date.parse(read.observedAt);
    for (const [mint, market] of read.byMint) {
      const facts = tokenFactsOf(market, observedAtMs, nowMs);
      out.set(mint, { price: facts.price, floor: facts.floor, flagged: market.audit.suspicious || isUnsupportedMarket(market) });
    }
  }
  return out;
}

/** One token, now — the order route's read and a rule turned on again. */
export async function readTokenMarket(mint: string, nowMs: number, deps: RuleAssetDeps = {}): Promise<TokenMarket | null> {
  const read = await (deps.readMarket ?? readSpotMarket)(mint).catch(() => null);
  if (!read || !read.ok || !read.market) return null;
  const facts = tokenFactsOf(read.market, Date.parse(read.observedAt), nowMs);
  return { price: facts.price, floor: facts.floor, flagged: read.market.audit.suspicious || isUnsupportedMarket(read.market) };
}
