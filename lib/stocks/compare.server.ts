/**
 * The comparison of representations — canon v4.0 §7.7 (`RYN-STOCKS-CHOICE-001`).
 *
 * One underlying, several tokens: the representation the page is open on and
 * every other confirmed representation of the same underlying
 * (`underlying-group.ts`), each quoted for the **same** amount, on the same
 * side, in the same settlement asset (USDC), at about the same moment, through
 * the one quote path Spot executes on. The figure compared is the executable
 * price per underlying share — the token leg through that mint's own
 * multiplier, applied once, by the quote — so two issuers with different
 * multipliers are read on one basis. A mint whose multiplier is unknown is
 * shown and not ranked; a mint the venue has no route for at this size says
 * so with the venue's reason, never with an invented price.
 *
 * The lowest per-share price among the compared rows is named as exactly
 * that — the lowest quoted cost for this amount — and never as the best
 * token: the issuers' terms differ, and cheaper is not the same rights or
 * less risk. A Sell compares nothing: a person sells the token they hold,
 * and a representation of another issuer is not in their wallet by virtue
 * of the same company's name; the Sell answer carries the open token alone.
 *
 * Budget: the open asset and its group at the chosen amount only — at most
 * `COMPARE_LIMIT` quotes, two at a time, through the quote cache — never the
 * universe.
 */

import type { IssuerMark, Lifecycle } from "./instrument.ts";
import { quoteStock, type StockQuote, type StockQuoteFailure, type StockSide } from "./quote.server.ts";
import type { StockRepresentation } from "./representations.ts";
import { groupUnderlying, sameCompanyOtherIssuer, underlyingConfidence, type UnderlyingConfidence } from "./underlying-group.ts";
import { findStockRow, type StockRow } from "./universe.server.ts";

/** The anchor and at most this many others are quoted; the rest are named without a quote. */
export const COMPARE_LIMIT = 5;
const CONCURRENCY = 2;

export type CompareRepresentation = Readonly<{
  mint: string;
  symbol: string;
  name: string;
  issuer: StockRepresentation["issuer"];
  instrument: StockRepresentation["instrument"];
  confidence: UnderlyingConfidence;
  underlying: StockRepresentation["underlying"];
  icon: string | null;
  tradingHalted: boolean | null;
  liquidityUsd: number | null;
  /** The multiplier the list read from the chain; null when the mint could not be read. */
  multiplier: number | null;
  multiplierState: StockRow["multiplierState"];
}>;

/**
 * Another issuer's instrument on the same company — named beside the
 * comparison, never inside it: its own unit price, its own mark, its own
 * rights, and a way to its page. No figure of it is set against the anchor's.
 */
export type RelatedInstrument = Readonly<{
  representation: CompareRepresentation;
  priceUsd: number | null;
  issuerMark: IssuerMark | null;
  lifecycle: Lifecycle;
}>;

export type CompareRow = Readonly<{
  representation: CompareRepresentation;
  /** True for the representation the page is open on. */
  anchor: boolean;
  quote: StockQuote | null;
  /** Why there is no quote: the venue's answer, or that this row is past the budget. */
  failure: Readonly<{ code: StockQuoteFailure["code"] | "NOT_QUOTED"; reason: string }> | null;
  /** True on the one row with the lowest executable per-share price among the ranked rows. */
  lowestCost: boolean;
  /** Whether the row took part in the ranking (a per-share price exists). */
  ranked: boolean;
}>;

export type StockComparison = Readonly<{
  underlying: Readonly<{ symbol: string; isin: string | null }>;
  side: StockSide;
  usd: number;
  rows: readonly CompareRow[];
  /** Whether more than one row was ranked — the only case a "lowest cost" is stated. */
  compared: boolean;
  /** Other issuers' instruments on the same company, outside the comparison. */
  related: readonly RelatedInstrument[];
  /** The moment the comparison was assembled; each quote carries its own observation time. */
  observedAt: string;
}>;

export type StockComparisonFailure = Readonly<{ ok: false; code: "UNKNOWN_ASSET" | "PROVIDER" | "AMOUNT" | "LIFECYCLE"; reason: string }>;

function summarize(row: StockRow): CompareRepresentation {
  const rep = row.representation;
  return {
    mint: rep.mint,
    symbol: rep.symbol,
    name: rep.underlying.name ?? rep.name,
    issuer: rep.issuer,
    instrument: rep.instrument,
    confidence: underlyingConfidence(rep),
    underlying: rep.underlying,
    icon: row.market.icon,
    tradingHalted: rep.tradingHalted,
    liquidityUsd: row.market.liquidityUsd,
    multiplier: row.multiplier?.current ?? null,
    multiplierState: row.multiplierState,
  };
}

async function mapLimited<T, R>(items: readonly T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      out[index] = await run(items[index]);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function compareRepresentations(
  input: Readonly<{ ticker: string; side: StockSide; usd: number }>,
  deps: Readonly<{ now?: () => Date; findRow?: typeof findStockRow; quote?: typeof quoteStock }> = {},
): Promise<{ ok: true; comparison: StockComparison } | StockComparisonFailure> {
  const found = await (deps.findRow ?? findStockRow)(input.ticker);
  if (!found.ok) return { ok: false, code: "PROVIDER", reason: found.reason };
  if (!found.row) return { ok: false, code: "UNKNOWN_ASSET", reason: "That token is not a confirmed stock representation." };
  const now = (deps.now ?? (() => new Date()))();
  const group = groupUnderlying(found.universe.rows, found.row);
  /* A Sell is the open token alone: nothing else is in the wallet by name. */
  const members = input.side === "SELL" ? [group.anchor] : [group.anchor, ...group.others];
  const quoted = members.slice(0, COMPARE_LIMIT);
  const beyond = members.slice(COMPARE_LIMIT);
  const ask = deps.quote ?? quoteStock;

  const answers = await mapLimited(quoted, CONCURRENCY, async (row) => ask({ ticker: row.representation.mint, side: input.side, usd: input.usd }, deps.now ? { now: deps.now } : {}));
  if (answers.length > 0 && !answers[0].ok && answers[0].code === "AMOUNT") {
    return { ok: false, code: "AMOUNT", reason: answers[0].reason };
  }
  const related: RelatedInstrument[] = sameCompanyOtherIssuer(found.universe.rows, found.row).map((row) => ({
    representation: summarize(row),
    priceUsd: row.market.priceUsd,
    issuerMark: row.issuerMark,
    lifecycle: row.lifecycle,
  }));

  const rows: CompareRow[] = quoted.map((row, index) => {
    const answer = answers[index];
    const quote = answer.ok ? answer.quote : null;
    return {
      representation: summarize(row),
      anchor: index === 0,
      quote,
      failure: answer.ok ? null : { code: answer.code, reason: answer.reason },
      lowestCost: false,
      ranked: quote !== null && quote.executablePerShare !== null,
    };
  });
  for (const row of beyond) {
    rows.push({
      representation: summarize(row),
      anchor: false,
      quote: null,
      failure: { code: "NOT_QUOTED", reason: `More than ${COMPARE_LIMIT} representations; open this one to quote it.` },
      lowestCost: false,
      ranked: false,
    });
  }

  const ranked = rows.filter((row) => row.ranked);
  const compared = input.side === "BUY" && ranked.length > 1;
  let out = rows;
  if (compared) {
    /* Buy: the lowest executable price per share for this amount. */
    const best = ranked.reduce((lowest, row) => ((row.quote!.executablePerShare as number) < (lowest.quote!.executablePerShare as number) ? row : lowest));
    out = rows.map((row) => (row === best ? { ...row, lowestCost: true } : row));
  }

  return {
    ok: true,
    comparison: {
      underlying: { symbol: group.symbol, isin: group.isin },
      side: input.side,
      usd: input.usd,
      rows: out,
      compared,
      related,
      observedAt: now.toISOString(),
    },
  };
}
