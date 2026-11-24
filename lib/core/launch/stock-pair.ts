/**
 * «У парі з акцією» — a coin launched on a DBC curve whose pair currency is a tokenized stock (Meteora
 * review 19.11 — `docs/research/meteora-full-2026-11-19/REPORT.md`, gap 1 and the hackathon's first idea).
 *
 * The coin is bought with the stock and sold for it: the curve's threshold, its fees, the creator's share of every fee
 * and the move to the DEX are all in the stock's own units, never in SOL or in dollars — the dollars are only said beside
 * them, at the price read when the config was made. DBC takes such a pair currency since program 0.2.1, through
 * Meteora's token badge (`./quote-asset.ts`); Ryntra's part is to choose the stock, to choose the numbers, and to say
 * before the signature what the stock's issuer can do.
 *
 * **The numbers.** The shape is Захищений's — the sniper fee from 50 % down to 1 % over ten minutes, a volatility fee
 * on top, the creator's 40 % of the curve's fee after Meteora's 20 %, a 2 % move to the DEX of which the creator gets
 * 40 %, the graduated DAMM v2 pool compounding with its fee falling from 2 % to 0.5 % as its market cap grows, every
 * share of its liquidity locked for ever, the creator's first purchase at most 2 % of the supply — so a stock-paired
 * launch is held to exactly what «Чесний лаунч» holds every other to. Only the curve's size is its own, named by the
 * threshold in the stock's units (`stockPairThreshold`):
 *
 * - **the floor** — twice $750: Meteora's keeper moves a stock-quoted curve to the DEX on its own from $750 of the stock
 *   (`core-products/dbc/migration-and-liquidity`), so a stock that halves between the config and the last purchase
 *   still graduates without anyone's hand;
 * - **the depth** — never more than 1 % of the stock's own liquidity on chain, as the shelf reads it: buyers of the coin
 *   must first buy the stock, and on a thinly traded name a larger curve would move the stock's price more than the
 *   coin's;
 * - **the ceiling** — $15 000, what a Класичний curve raises before the DEX; a deep stock is not asked for more;
 * - **too thin** — a stock whose floor alone would be over 5 % of its depth is not offered at all;
 * - the threshold is rounded up to two significant figures of the stock — «160 ANT», «110 SPCX» — and fixed in the
 *   config for ever; the market caps follow from it and the curve's multiple of fifteen, as on Micro.
 *
 * **When the exchange is closed.** The curve trades on chain around the clock, and its price is in the stock, so the
 * exchange's hours move nothing on it: the coin's price in the stock stands, and only its dollars move with the stock.
 * A launch is therefore not refused off hours; what is said is that the dollars are of the last price, and that at the
 * open the stock — and with it every dollar figure of the coin — may jump. Ryntra does not stop a curve and cannot.
 *
 * **What the issuer can do** — read from the mint, never from a document, and proved on Meteora's program
 * (`scripts/launch-qa/stock-pair-rehearsal.mjs`): a pause stops every transfer of the stock, so the curve neither sells
 * nor buys while it lasts; a hook program the issuer assigns stops it too, because the curve's swap does not carry a
 * hook's accounts; and the permanent delegate can take every unit of the stock out of the curve's own vault. Each is a
 * code in `honesty.risks`, said before the signature; the words on a screen are not this module's.
 *
 * Pure and client-safe. Behind `RYNTRA_LAUNCH_STOCK_PAIR=open`; closed, nothing here is reached and the engine answers
 * as it did. The stocks themselves are the operator's (`RYNTRA_LAUNCH_QUOTE_ASSETS_REGISTRY`, O-03, O-04): no mint is
 * written here.
 */

import { isShelfCandidate } from "../../stocks/shelf.ts";
import { ISSUER_TERMS } from "../../stocks/issuer-terms.ts";
import { poolFactsOf, type PoolSession } from "../../stocks/pool-facts.ts";
import type { StockIssuerId } from "../../stocks/representations.ts";
import type { StockRow } from "../../stocks/universe.server.ts";
import { LAUNCH_PRESETS, thresholdCurve, type LaunchPreset, type PresetQuote } from "../venues/meteora-dbc/presets.ts";
import { SNIPER_FEES, type AdvancedChoice, type AdvancedTerms } from "./advanced.ts";
import type { QuoteMintFacts } from "./quote-asset.ts";
import { STOCK_PAIR_FLAG, type StockPairRisk, type StockPairThresholdRefusal } from "./stock-pair-codes.ts";

export { STOCK_PAIR_FLAG, STOCK_PAIR_RISKS, STOCK_PAIR_SIZING_REFUSALS, type StockPairRisk, type StockPairThresholdRefusal } from "./stock-pair-codes.ts";

export function stockPairOpen(env: Readonly<Record<string, string | undefined>>): boolean {
  return (env[STOCK_PAIR_FLAG] ?? "").trim() === "open";
}

/** The preset's own name; on chain its config is a «Розширений» one — made for the launch, Ryntra's vault its claimer. */
export const STOCK_PAIR_PRESET_ID = "stock-pair" as const;
export const STOCK_PAIR_NAME = Object.freeze({ uk: "У парі з акцією", en: "Paired with a stock" });

/** The numbers of the preset, each with its reason in the head of this file. */
export const STOCK_PAIR_TERMS = Object.freeze({
  /** Meteora's keeper moves a stock-quoted curve to the DEX from this much of the stock in dollars. */
  keeperFloorUsd: 750,
  /** The floor is twice the keeper's: a stock that halves still graduates. */
  floorMultiple: 2,
  /** The curve asks for at most this share of the stock's liquidity on chain. */
  depthShare: 0.01,
  /** And never more than a Класичний curve raises. */
  ceilingUsd: 15_000,
  /** A stock whose floor alone would be more than this share of its liquidity is too thin to pair with. */
  thinShare: 0.05,
  /** The graduation market cap over the start — every preset's fifteen. */
  multiple: 15,
  supply: 1_000_000_000,
  sniper: "strong" as const,
  creatorTradingFeePct: 40,
  graduationFee: Object.freeze({ pct: 2, creatorPct: 40 }),
  poolStartFeeBps: 200,
  poolEndFeeBps: 50,
  firstBuyCapBps: 200,
});

/* ------------------------------------------------------------------ the shelf */

/** One stock of the shelf as a stock-paired launch reads it: who issues it, how deep it is, and the exchange now. */
export type StockShelfEntry = Readonly<{
  mint: string;
  symbol: string;
  issuer: Readonly<{ id: StockIssuerId; label: string }>;
  /** The stock's liquidity on chain in dollars, as the venue reads it; null — unknown. */
  liquidityUsd: number | null;
  priceUsd: number | null;
  session: PoolSession;
  /** When the session next changes, ISO, when the source says. */
  nextChangeAt: string | null;
  /** The issuer's own document on where its tokens are offered. */
  termsUrl: string | null;
}>;

/**
 * The stocks a launch may pair with: the shelf's own candidates (`isShelfCandidate` — an issuer shown to a beginner,
 * not halted, offered for purchase, priced) that are listed equities. A pre-IPO token is not on it.
 */
export function stockShelfEntries(rows: readonly StockRow[], nowMs: number): readonly StockShelfEntry[] {
  return rows
    .filter((row) => isShelfCandidate(row) && (row.representation.instrument?.class ?? "listed-equity") === "listed-equity")
    .map((row) => {
      const facts = poolFactsOf({ mint: row.representation.mint, row, step: null, nowMs });
      const liquidity = row.market.liquidityUsd;
      return {
        mint: row.representation.mint,
        symbol: row.representation.symbol,
        issuer: { id: row.representation.issuer.id, label: row.representation.issuer.label },
        liquidityUsd: typeof liquidity === "number" && Number.isFinite(liquidity) && liquidity > 0 ? liquidity : null,
        priceUsd: row.market.priceUsd,
        session: facts.session,
        nextChangeAt: facts.nextChangeAt,
        termsUrl: facts.termsUrl,
      };
    });
}

/** The shelf's entry for a mint — by the mint alone: a token borrowing a stock's symbol is never found by it. */
export function stockOnShelf(entries: readonly StockShelfEntry[], mint: string): StockShelfEntry | null {
  return entries.find((entry) => entry.mint === mint) ?? null;
}

/* ------------------------------------------------------------------ the threshold */

export type StockPairThreshold = Readonly<{
  /** The stock the curve raises before the DEX, raw, and in the stock's units. */
  raw: bigint;
  units: string;
  /** In dollars at the price read — said beside the units, never the threshold itself. */
  usd: number;
  /** Which rule set it: the keeper's floor, the stock's depth, or the ceiling. */
  basis: "floor" | "depth" | "ceiling";
}>;

const pow10 = (n: number) => 10n ** BigInt(n);

/** Raw units as a decimal string, without trailing zeros. */
export function unitsOf(raw: bigint, decimals: number): string {
  const whole = raw / pow10(decimals);
  const part = (raw % pow10(decimals)).toString().padStart(decimals, "0").replace(/0+$/, "");
  return part ? `${whole}.${part}` : whole.toString();
}

/** Rounded up to two significant figures, raw — 159.24… ANT is 160, 0.316… is 0.32. */
function upToTwoFigures(raw: bigint): bigint {
  if (raw <= 0n) return 1n;
  const digits = raw.toString().length;
  if (digits <= 2) return raw;
  const step = pow10(digits - 2);
  return ((raw + step - 1n) / step) * step;
}

/**
 * The curve's threshold for a stock, in its own units: 1 % of its liquidity on chain, held between twice the keeper's
 * $750 and a Класичний curve's $15 000, rounded up to two figures. Refused without a price, without a known depth, and
 * for a stock too thin to feed even the floor.
 */
export function stockPairThreshold(
  args: Readonly<{ priceUsd: number | null; decimals: number; liquidityUsd: number | null }>,
): Readonly<{ ok: true; threshold: StockPairThreshold }> | Readonly<{ ok: false; reason: StockPairThresholdRefusal }> {
  const { priceUsd, decimals, liquidityUsd } = args;
  if (priceUsd === null || !Number.isFinite(priceUsd) || priceUsd <= 0) return { ok: false, reason: "PRICE_UNKNOWN" };
  if (liquidityUsd === null || !Number.isFinite(liquidityUsd) || liquidityUsd <= 0) return { ok: false, reason: "DEPTH_UNKNOWN" };
  const terms = STOCK_PAIR_TERMS;
  const floor = terms.keeperFloorUsd * terms.floorMultiple;
  if (floor > liquidityUsd * terms.thinShare) return { ok: false, reason: "TOO_THIN" };
  const depth = liquidityUsd * terms.depthShare;
  const [usdTarget, basis] = depth <= floor ? [floor, "floor" as const] : depth >= terms.ceilingUsd ? [terms.ceilingUsd, "ceiling" as const] : [depth, "depth" as const];
  /* Up, never down: the floor is a floor in the stock as well. */
  const exact = BigInt(Math.ceil((usdTarget / priceUsd) * 10 ** decimals));
  const raw = upToTwoFigures(exact);
  const units = unitsOf(raw, decimals);
  return { ok: true, threshold: { raw, units, usd: Number(units) * priceUsd, basis } };
}

/* ------------------------------------------------------------------ the preset */

/**
 * The preset of a stock-paired launch: Захищений's shape on the «Розширений» template — the one a config made for a
 * single launch is built from — with the curve named by its threshold. Its market caps are in the stock's units: the
 * config is built with the stock as its own unit of account (`stockPairQuote`, a price of one), so nothing on the curve
 * is converted at a dollar price.
 */
export function stockPairPreset(threshold: Pick<StockPairThreshold, "units">): LaunchPreset {
  const terms = STOCK_PAIR_TERMS;
  const units = Number(threshold.units);
  if (!(units > 0)) throw new Error("A stock-paired curve needs a threshold.");
  const curve = thresholdCurve(units, terms.graduationFee.pct, terms.multiple);
  const template = LAUNCH_PRESETS.advanced;
  return {
    ...template,
    pair: "QUOTE_ASSET",
    token: { ...template.token, supply: terms.supply },
    curve: { startMarketCapUsd: curve.startMarketCapUsd, graduationMarketCapUsd: curve.graduationMarketCapUsd, graduationQuote: units },
    sniperFee: SNIPER_FEES[terms.sniper],
    creatorTradingFeePct: terms.creatorTradingFeePct,
    graduationFee: { ...terms.graduationFee },
    graduatedPool: { ...template.graduatedPool, startFeeBps: terms.poolStartFeeBps, endFeeBps: terms.poolEndFeeBps },
    creatorFirstBuyCapBps: terms.firstBuyCapBps,
  };
}

/** The quote a stock-paired config is built on: the stock is its own unit of account. */
export function stockPairQuote(mint: string, decimals: number): PresetQuote {
  return { mint, decimals, usdPrice: 1 };
}

/** The market caps of the preset, in the stock's units and in dollars at the price read. */
export function stockPairMarketCaps(threshold: Pick<StockPairThreshold, "units">, priceUsd: number) {
  const preset = stockPairPreset(threshold);
  const at = (units: number) => ({ units: Number(units.toPrecision(6)), usd: Math.round(units * priceUsd * 100) / 100 });
  return { start: at(preset.curve.startMarketCapUsd), graduation: at(preset.curve.graduationMarketCapUsd) };
}

/**
 * The terms a stock-paired config is kept with, as every config made for one launch is (`advanced.server.ts`): the
 * choice in dollars at the price read — what the record of a «Розширений» config says — and the preset's own move to
 * the DEX and first-purchase cap. The curve itself is the one built in the stock's units.
 */
export function stockPairTermsOf(threshold: Pick<StockPairThreshold, "units">, quoteMint: string, priceUsd: number): AdvancedTerms {
  const caps = stockPairMarketCaps(threshold, priceUsd);
  const terms = STOCK_PAIR_TERMS;
  const choice: AdvancedChoice = {
    quoteMint,
    supply: terms.supply,
    startMarketCapUsd: caps.start.usd,
    graduationMarketCapUsd: caps.graduation.usd,
    creatorTradingFeePct: terms.creatorTradingFeePct,
    sniper: terms.sniper,
    poolStartFeeBps: terms.poolStartFeeBps,
    poolEndFeeBps: terms.poolEndFeeBps,
  };
  return { ...choice, graduationFee: { ...terms.graduationFee }, firstBuyCapBps: terms.firstBuyCapBps };
}

/* ------------------------------------------------------------------ before the signature */

export type StockPairHonesty = Readonly<{
  issuer: Readonly<{ id: StockIssuerId; label: string }>;
  /** The issuer's powers as the mint states them now. */
  powers: Readonly<{ pause: boolean; take: boolean; freeze: boolean; setHook: boolean; mint: boolean }>;
  /** Whether the issuer has paused the stock right now. */
  paused: boolean;
  exchange: Readonly<{ session: PoolSession; nextChangeAt: string | null }>;
  /** The issuer's terms: its document, where its tokens are not offered, and whether the document is the issuer's own. */
  terms: Readonly<{ title: string | null; url: string | null; excluded: readonly Readonly<{ en: string; uk: string }>[]; issuerOwn: boolean }>;
  /** The line before the signature, as codes in the order said; the words are the screen's. */
  risks: readonly StockPairRisk[];
}>;

/** The facts of the line before the signature: the issuer's powers from the mint, the exchange and the terms from the shelf. */
export function stockPairHonesty(facts: Pick<QuoteMintFacts, "pausable" | "permanentDelegate" | "freezeAuthority" | "transferHook" | "mintAuthority">, entry: StockShelfEntry): StockPairHonesty {
  const powers = {
    pause: facts.pausable !== null && facts.pausable.authority !== null,
    take: facts.permanentDelegate !== null,
    freeze: facts.freezeAuthority !== null,
    setHook: facts.transferHook !== null && facts.transferHook.authority !== null,
    mint: facts.mintAuthority !== null,
  };
  const risks: StockPairRisk[] = [];
  if (powers.pause) risks.push("ISSUER_CAN_PAUSE");
  if (powers.take) risks.push("ISSUER_CAN_TAKE");
  if (powers.freeze) risks.push("ISSUER_CAN_FREEZE");
  if (powers.setHook) risks.push("ISSUER_CAN_SET_HOOK");
  if (entry.session === "unknown") risks.push("EXCHANGE_UNKNOWN");
  else if (entry.session !== "open") risks.push("EXCHANGE_CLOSED");
  const issuerTerms = ISSUER_TERMS[entry.issuer.id] ?? null;
  return {
    issuer: entry.issuer,
    powers,
    paused: facts.pausable?.paused === true,
    exchange: { session: entry.session, nextChangeAt: entry.nextChangeAt },
    terms: {
      title: issuerTerms?.document.title ?? null,
      url: entry.termsUrl,
      excluded: issuerTerms ? issuerTerms.excluded.map((place) => ({ en: place.en, uk: place.uk })) : [],
      issuerOwn: issuerTerms?.issuerOwn ?? false,
    },
    risks,
  };
}
