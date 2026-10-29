"use client";

import { ArrowDown, ArrowRight } from "@phosphor-icons/react";
import { Button } from "@ryntra/core/ui";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import { MarketIcon } from "@/app/solana/workspace/spot/market-list";
import { formatAmount, formatPercent, formatUsdCompact, formatUsdPrice, toneOf } from "@/app/solana/workspace/spot/spot-format";
import { parseDecimalInput } from "@/lib/plans/decimal-input";
import type { CompareRow, RelatedInstrument, StockComparison } from "@/lib/stocks/compare.server";
import { LIFECYCLE_WORDS, RIGHTS_WORDS, type UnitBasis } from "@/lib/stocks/instrument";
import type { StockQuote } from "@/lib/stocks/quote.server";
import type { LossLimitPreset } from "@/lib/plans/purchase";
import { STOCK_QUOTE_PRESETS_USD } from "@/lib/stocks/units";

import { clockOf, ISSUER_FULL, referenceWord, wordsFor } from "../stock-model";
import styles from "../stocks.module.css";
import { announceBuyActions, BUY_PANEL_ID, BUY_REVIEW_ID } from "./buy-actions";
import { LossLimitCard, LossLimitPresets } from "./loss-limit";

/**
 * The estimate for an amount, and the representations compared, read the way
 * a person reads money since the clarity pass of 2026-09-16.
 *
 * One amount, one side, one read: `/api/stocks/compare` quotes the open token
 * and every other confirmed representation of the same underlying together,
 * through the path Spot executes on. The first card is this token's own
 * estimate for that amount — *you spend $1,000 → you get about 40.245759
 * DKNG* on a Buy, *you sell 40.245759 DKNG → you get about $1,000* on a Sell
 * — the least a signature accepts, the price per share against the
 * reference, the costs already inside the quote, the impact, the time; and
 * beside the result the one next step, *Review purchase*, which opens the
 * Spot ticket on this mint and side with the amount the person chose. The
 * preset pressed and the amount field show one and the same sum. The second
 * card, drawn only when the underlying has more than one representation, is
 * the same amount on every one of them, per share through each token's own
 * multiplier, with the lowest named as exactly that — the lowest quoted cost
 * for this amount — and never as the best token. A Sell compares nothing: a
 * person sells the token they hold.
 *
 * Presets are examples for orientation; an amount travels to Spot or into a
 * plan only after the person pressed or typed it. The Review in Spot quotes
 * the real amount again before anything is signed.
 *
 * The first-screen pass of 2026-09-23: the page's one orange action is *Buy*
 * (`BuyJump`), which brings the person to this card rather than away to Spot;
 * the presets are the sums a first purchase is made of; the estimate shows
 * what goes out, what comes back and the fees, and every other line of it —
 * the price per share, the minimum, the deviation, the impact, the units, the
 * time — waits one press deep under *Details*. Nothing in the Review path
 * changes.
 *
 * One version since 2026-09-24: the stock desk's asset page is gone into the
 * company page, and this block lives under its *Деталі*, `quiet` — the
 * company's *Купити* is the page's one orange action and its sheet owns the
 * loss limit.
 */

export { BUY_PANEL_ID } from "./buy-actions";
const BUY_EVENT = "ryntra:stock-buy";

type State = Readonly<{ status: "loading" | "ready" | "failed"; comparison: StockComparison | null; reason: string | null }>;

const DEFAULT_USD = STOCK_QUOTE_PRESETS_USD[1];

/* The figures in the reader's own number style — `0,025797` and `0,10%` in Ukrainian — through the product's one amount formatter. */
const amountOf = (scaled: string, numberLocale: string): string => formatAmount(Number(scaled), numberLocale);
const basisPointsOf = (bps: number, numberLocale: string): string => `${new Intl.NumberFormat(numberLocale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(bps / 100)}%`;
const multiplierOf = (value: number, numberLocale: string): string => new Intl.NumberFormat(numberLocale, { minimumFractionDigits: 6, maximumFractionDigits: 6 }).format(value);

export function DealBlock({
  mint,
  ticker,
  underlying,
  unitBasis = "share",
  tradable = true,
  quiet = false,
  className,
  locale,
}: {
  mint: string;
  ticker: string;
  underlying: string;
  /** The unit the figures are in; a token for the pre-IPO issuers. */
  unitBasis?: UnitBasis;
  /** False when the issuer does not offer a new purchase — the block opens on Sell and says why. */
  tradable?: boolean;
  /**
   * Under a company page's *Деталі* (what the stock desk's asset page held, a
   * tap deeper): the page's own *Купити* is its one orange action and its
   * sheet owns the loss limit, so here the estimate, the representations
   * compared and the way into Spot or a plan stay, quiet.
   */
  quiet?: boolean;
  /** The card's width in the page's grid. */
  className?: string;
  locale: WorkspaceLocale;
}) {
  const word = wordsFor(locale);
  const numberLocale = locale === "uk" ? "uk-UA" : "en-US";
  const [side, setSide] = useState<"buy" | "sell">(tradable ? "buy" : "sell");
  const [usd, setUsd] = useState<number>(DEFAULT_USD);
  /* The field shows the sum being quoted; `chosen` says whether the person picked it (a press or a typed sum) or it is still the example. */
  const [custom, setCustom] = useState(String(DEFAULT_USD));
  const [chosen, setChosen] = useState(false);
  /* The loss limit the person chose for this purchase, or none — then the plain Review. */
  const [limit, setLimit] = useState<LossLimitPreset | null>(null);
  const [state, setState] = useState<State>({ status: "loading", comparison: null, reason: null });
  const cardRef = useRef<HTMLElement | null>(null);
  /*
   * Quoted only once it is seen: under the company page's closed «Деталі» the
   * comparison asked Jupiter for up to five quotes on every visit — of the
   * key's shared window of about ten requests in ten seconds — and the
   * person's own order, pressed a minute later, was refused for rate
   * (2026-09-28). Opened once, it stays read.
   */
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const folded = cardRef.current?.closest("details") ?? null;
    if (!folded) {
      setSeen(true);
      return undefined;
    }
    const look = () => {
      if (folded.open) setSeen(true);
    };
    look();
    folded.addEventListener("toggle", look);
    return () => folded.removeEventListener("toggle", look);
  }, []);

  useEffect(() => {
    /* The card's one orange action changes with the side and the limit; the page's Buy watches the new one. */
    announceBuyActions();
  }, [side, limit]);

  useEffect(() => {
    /* The page's *Buy*: the Buy side where the issuer offers one, the card in view, the focus on it — no keyboard pushed up on a phone. */
    const onBuy = () => {
      if (tradable) setSide("buy");
      const card = cardRef.current;
      if (!card) return;
      const still = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
      card.scrollIntoView({ block: "start", behavior: still ? "auto" : "smooth" });
      card.focus({ preventScroll: true });
    };
    window.addEventListener(BUY_EVENT, onBuy);
    return () => window.removeEventListener(BUY_EVENT, onBuy);
  }, [tradable]);

  useEffect(() => {
    if (!seen) return undefined;
    let live = true;
    setState((current) => ({ status: "loading", comparison: current.comparison, reason: null }));
    fetch(`/api/stocks/compare?ticker=${encodeURIComponent(mint)}&side=${side.toUpperCase()}&usd=${usd}`, { headers: { accept: "application/json" } })
      .then(async (response) => {
        const body = (await response.json()) as StockComparison | { error?: { message?: string } };
        if (!live) return;
        if (response.ok && "rows" in body) setState({ status: "ready", comparison: body, reason: null });
        /* The server's message is for the log; the person reads the card's own words. */
        else setState({ status: "failed", comparison: null, reason: word("quoteUnavailable") });
      })
      .catch(() => {
        if (live) setState({ status: "failed", comparison: null, reason: word("quoteUnavailable") });
      });
    return () => {
      live = false;
    };
    // The words are a pure function of the locale; the effect keys on what changes the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mint, side, usd, locale, seen]);

  const comparison = state.comparison;
  const anchor = comparison?.rows.find((row) => row.anchor) ?? null;
  const quote = anchor?.quote ?? null;
  const pick = (preset: number) => {
    setUsd(preset);
    setCustom(String(preset));
    setChosen(true);
  };
  const submitCustom = () => {
    const value = parseDecimalInput(custom);
    if (value !== null && value >= 1) {
      /* The sum as typed, to the cent, within what one estimate covers ($1 000 000). */
      const cents = Math.min(1_000_000, Math.round(value * 100) / 100);
      setUsd(cents);
      setCustom(new Intl.NumberFormat(numberLocale, { maximumFractionDigits: 2, useGrouping: false }).format(cents));
      setChosen(true);
    }
  };
  const amountLabel = formatUsdPrice(usd, numberLocale);
  /* The way on: Spot's ticket on this mint and side, with the sum only when the person chose it; a plan with that sum as its budget on the same rule. */
  const carried = chosen ? `&amount=${usd}` : "";
  const reviewHref = `/app/spot?view=stock&mint=${encodeURIComponent(mint)}&side=${side}${side === "buy" ? carried : ""}`;
  const planHref = `/app/strategies/new?mint=${encodeURIComponent(mint)}${chosen ? `&budget=${usd}` : ""}`;

  return (
    <>
      <section ref={cardRef} id={quiet ? undefined : BUY_PANEL_ID} tabIndex={-1} className={`${styles.card} ${className ?? styles.w4} ${styles.dealCard}`} aria-label={side === "buy" ? word("dealTerms") : word("sellEstimate")}>
        <div className={styles.cardHead}>
          <h2>{side === "buy" ? word("dealTerms") : word("sellEstimate")}</h2>
        </div>
        <div className={styles.cardBody}>
          <div className={styles.sides} role="group" aria-label={word("market")}>
            {/* Which side the comparison counts: the page's own ticket buys and sells, this block only compares. */}
            <Button variant={side === "buy" ? "secondary" : "ghost"} data-side="buy" aria-pressed={side === "buy"} onClick={() => setSide("buy")} lang={locale === "uk" ? "uk" : "en"}>
              {word("buy")}
            </Button>
            <Button variant={side === "sell" ? "secondary" : "ghost"} data-side="sell" aria-pressed={side === "sell"} onClick={() => setSide("sell")} lang={locale === "uk" ? "uk" : "en"}>
              {word("sell")}
            </Button>
          </div>
          <div className={styles.presets} role="group" aria-label={word("quoteForAmount")}>
            {STOCK_QUOTE_PRESETS_USD.map((preset) => (
              <Button key={preset} variant={usd === preset ? "secondary" : "ghost"} aria-pressed={usd === preset} onClick={() => pick(preset)} lang={locale === "uk" ? "uk" : "en"}>
                ${preset.toLocaleString("en-US")}
              </Button>
            ))}
          </div>
          <form
            className={styles.amountRow}
            onSubmit={(event) => {
              event.preventDefault();
              submitCustom();
            }}
          >
            <label className={styles.search}>
              <input value={custom} onChange={(event) => setCustom(event.target.value)} inputMode="decimal" placeholder={word("yourAmount")} aria-label={word("yourAmount")} />
            </label>
            <Button type="submit" variant="secondary" lang={locale === "uk" ? "uk" : "en"}>
              {word("quote")}
            </Button>
          </form>
          {side === "buy" && tradable && !quiet ? <LossLimitPresets value={limit} onChange={setLimit} locale={locale} /> : null}
          {state.status === "failed" ? (
            <p className={styles.quoteStatus} data-kind="failed" role="status">
              {state.reason}
            </p>
          ) : null}
          {state.status === "ready" && anchor && !quote ? (
            <p className={styles.quoteStatus} data-kind="failed" role="status">
              {anchor.failure?.code === "NO_ROUTE" ? word("noRouteAtSize") : anchor.failure?.code === "LIFECYCLE" ? word("notPurchasable") : anchor.failure?.code === "PROVIDER" ? word("venueRefused") : word("quoteUnavailable")}
            </p>
          ) : null}
          {state.status === "loading" && !quote ? <div className={`${styles.bone} ${styles.quoteBone}`} aria-busy="true" /> : null}
          {quote ? <Terms quote={quote} side={side} ticker={ticker} underlying={underlying} unitBasis={unitBasis} locale={locale} /> : null}
          {side === "buy" && tradable && limit ? (
            /* A loss limit chosen: the purchase is a plan Ryntra prepared from the person's figures, and the one action writes it and opens its Review. */
            <LossLimitCard mint={mint} amountUsd={usd} preset={limit} planHref={planHref} actionId={BUY_REVIEW_ID} locale={locale} />
          ) : (
            <div className={styles.quoteActions}>
              {side === "buy" && !tradable ? null : (
                <Link id={quiet ? undefined : BUY_REVIEW_ID} className={quiet ? "ryntra-button ryntra-button--secondary" : "ryntra-button ryntra-button--primary"} href={reviewHref} prefetch={false}>
                  <span className="ryntra-button__label">
                    {side === "buy" ? word("reviewPurchase") : word("reviewSale")}
                    <ArrowRight size={16} weight="bold" aria-hidden="true" />
                  </span>
                </Link>
              )}
              {side === "buy" && tradable ? (
                <Link className="ryntra-button ryntra-button--secondary" href={planHref} prefetch={false}>
                  <span className="ryntra-button__label">{word("planThisPurchase")}</span>
                </Link>
              ) : null}
            </div>
          )}
          <p className={styles.quoteNote}>{side === "sell" ? word("sellNote") : word("quoteNotPromise")}</p>
        </div>
      </section>

      {/* The same company from another issuer — a different instrument, named and not compared. */}
      {comparison && comparison.related && comparison.related.length > 0 ? <Related related={comparison.related} locale={locale} /> : null}

      {/* Alternatives only where there are any: a token compared with itself says nothing. */}
      {side === "buy" && comparison && comparison.rows.length > 1 ? (
        <section className={`${styles.card} ${styles.w12}`} aria-label={word("otherRepresentations")}>
          <div className={styles.cardHead}>
            <h2>{word("otherRepresentations")}</h2>
            <span className={styles.cardHeadSpacer} />
            <span className={styles.metricSub}>
              {underlying}
              {comparison.underlying.isin ? ` · ISIN ${comparison.underlying.isin}` : ""} · {amountLabel}
              {` · ${clockOf(comparison.observedAt, locale)} UTC`}
            </span>
          </div>
          <Representations comparison={comparison} loading={state.status === "loading"} locale={locale} />
        </section>
      ) : null}
    </>
  );
}

function Terms({ quote, side, ticker, underlying, unitBasis, locale }: { quote: StockQuote; side: "buy" | "sell"; ticker: string; underlying: string; unitBasis: UnitBasis; locale: WorkspaceLocale }) {
  const word = wordsFor(locale);
  const numberLocale = locale === "uk" ? "uk-UA" : "en-US";
  const tone = toneOf(quote.deviationPct);
  const perToken = (quote.unitBasis ?? unitBasis) === "token";
  /* Underlying units only through a known multiplier; without one the leg is the token itself, never a share count assumed at one-to-one. A token-priced instrument is counted in tokens as the wallet shows them. */
  const unit = quote.multiplier === null || perToken ? ticker : underlying;
  const fee = quote.transferFee ?? null;
  const observed = clockOf(quote.observedAt, locale);
  const until = clockOf(quote.reviewExpiresAt, locale);
  const usd = formatUsdPrice(quote.usd, numberLocale);
  return (
    <div className={styles.quoteResult}>
      {/* What goes out, what comes back — in that order, on both sides. */}
      <div className={styles.quoteFlow}>
        <span className={styles.quoteLeg}>
          <span>{side === "buy" ? word("youSpend") : word("youSell")}</span>
          <b translate="no">{side === "buy" ? usd : `${amountOf(quote.tokenScaled, numberLocale)} ${unit}`}</b>
        </span>
        <ArrowDown size={14} weight="bold" aria-hidden="true" className={styles.quoteArrow} />
        <span className={styles.quoteLeg}>
          <span>{word("aboutReceive")}</span>
          <b translate="no">{side === "buy" ? `${amountOf(quote.tokenScaled, numberLocale)} ${unit}` : usd}</b>
        </span>
      </div>
      {/* The money in the open: the fees inside the quote, and a withholding mint's fee where there is one. */}
      <dl className={styles.facts}>
        <div>
          <dt>{word("feesInQuote")}</dt>
          <dd translate="no">
            {basisPointsOf(quote.feeBasisPoints, numberLocale)}<span className={styles.factSub}>{quote.source.label}</span>
          </dd>
        </div>
        {fee ? (
          <div>
            <dt>{word("transferFee")}</dt>
            <dd translate="no">
              {basisPointsOf(fee.basisPoints, numberLocale)}<span className={styles.factSub}>{word("transferFeeNote")}</span>
            </dd>
          </div>
        ) : null}
      </dl>
      {/* Every other line of the estimate, one press deep: the same facts, nothing dropped. */}
      <details className={styles.dealDetails}>
        <summary>{word("details")}</summary>
        <dl className={styles.facts}>
          <div>
            <dt>{perToken ? word("orderPerToken") : word("orderPerShare")}</dt>
            <dd translate="no">{quote.executablePerShare === null ? "—" : formatUsdPrice(quote.executablePerShare, numberLocale)}</dd>
          </div>
          <div>
            <dt>{word("minimumReceived")}</dt>
            {/* A quote without a taker carries no slippage bound, so its "minimum" would equal the expected figure — a number that promises nothing. The Review sets the bound; until then the fact is where it is set. */}
            {quote.slippageBps > 0 ? (
              <dd translate="no">
                {side === "buy" ? `${amountOf(quote.minReceivedScaled, numberLocale)} ${unit}` : formatUsdPrice(Number(quote.minReceivedScaled), numberLocale)}
                <span className={styles.factSub}>
                  {word("minimumNote")} {basisPointsOf(quote.slippageBps, numberLocale)}
                </span>
              </dd>
            ) : (
              <dd data-prose="true">
                <span className={styles.dash}>—</span>
                <span className={styles.factSub}>{word("minimumAtReview")}</span>
              </dd>
            )}
          </div>
          {perToken ? null : (
            <div>
              <dt>{word("deviation")}</dt>
              <dd data-tone={quote.deviationPct === null ? undefined : tone} translate="no">
                {formatPercent(quote.deviationPct, numberLocale)}
                <span className={styles.factSub} data-tone={quote.reference.state === "stale" ? "caution" : undefined}>
                  {quote.reference.perShare !== null
                    ? `${word("referencePerShare").toLowerCase()} ${formatUsdPrice(quote.reference.perShare, numberLocale)} · ${referenceWord(quote.reference.state, locale).toLowerCase()}`
                    : `${word("referencePerShare").toLowerCase()} · ${referenceWord("unavailable", locale).toLowerCase()}`}
                </span>
              </dd>
            </div>
          )}
          <div>
            <dt>{word("priceImpact")}</dt>
            <dd translate="no">{formatPercent(Number(quote.priceImpactPct), numberLocale)}</dd>
          </div>
          <div>
            <dt>{word("units")}</dt>
            <dd translate="no">{quote.multiplier === null ? "—" : perToken ? `${word("tokensAsShown")}${Math.abs(quote.multiplier - 1) > 1e-9 ? ` · ${word("chainMultiplier")} ×${multiplierOf(quote.multiplier, numberLocale)}` : ""}` : `1 ${ticker} = ${multiplierOf(quote.multiplier, numberLocale)} ${underlying}`}</dd>
          </div>
          <div>
            <dt>{word("quoteTime")}</dt>
            <dd translate="no">
              {observed ? `${observed} UTC` : "—"}
              {until ? <span className={styles.factSub}>{`${word("reviewUntil")} ${until} UTC`}</span> : null}
            </dd>
          </div>
        </dl>
      </details>
    </div>
  );
}

/** The same company from another issuer: its own unit price, its own mark, its own rights — a card, never a row of the comparison. */
function Related({ related, locale }: { related: readonly RelatedInstrument[]; locale: WorkspaceLocale }) {
  const word = wordsFor(locale);
  const numberLocale = locale === "uk" ? "uk-UA" : "en-US";
  const lang = locale === "uk" ? "uk" : "en";
  return (
    <section className={`${styles.card} ${styles.w12}`} aria-label={word("sameCompany")}>
      <div className={styles.cardHead}>
        <h2>{word("sameCompany")}</h2>
      </div>
      <div className={styles.cardBody}>
        <dl className={styles.facts}>
          {related.map((entry) => {
            const rep = entry.representation;
            const rights = RIGHTS_WORDS[rep.instrument.rights];
            return (
              <div key={rep.mint}>
                <dt>
                  <Link className={styles.stock} href={`/app/stocks/${encodeURIComponent(rep.symbol)}`} prefetch={false}>
                    <MarketIcon mint={rep.mint} icon={rep.icon} symbol={rep.symbol} size={28} className={styles.icon} />
                    <span className={styles.names}>
                      <span className={styles.symbol} translate="no">{rep.symbol}</span>
                      <span className={styles.name}>{ISSUER_FULL[rep.issuer.id]}</span>
                    </span>
                  </Link>
                </dt>
                <dd translate="no">
                  {/* A tag-only issuer's unit is implied by the token's symbol, and is said so rather than called a share. */}
                  {entry.priceUsd === null ? "—" : `${formatUsdPrice(entry.priceUsd, numberLocale)} ${rep.instrument.unitBasis === "token" ? word("perToken") : rep.confidence === "implied" ? `· ${word("impliedBySymbol")}` : word("perShare")}`}
                  <span className={styles.factSub}>
                    {rights.title[lang]}
                    {entry.issuerMark?.perUnit != null ? ` · ${word("issuerMark").toLowerCase()} ${formatUsdPrice(entry.issuerMark.perUnit, numberLocale)}` : ""}
                    {` · ${LIFECYCLE_WORDS[entry.lifecycle.state][lang].toLowerCase()}`}
                  </span>
                </dd>
              </div>
            );
          })}
        </dl>
        <p className={styles.compareNote}>{word("sameCompanyNote")}</p>
      </div>
    </section>
  );
}

function Representations({ comparison, loading, locale }: { comparison: StockComparison; loading: boolean; locale: WorkspaceLocale }) {
  const word = wordsFor(locale);
  const numberLocale = locale === "uk" ? "uk-UA" : "en-US";
  const amountLabel = formatUsdPrice(comparison.usd, numberLocale);
  return (
    <>
      <div className={styles.tableWrap} data-stale={loading ? "true" : "false"}>
        <table className={`${styles.table} ${styles.compare}`}>
          <thead>
            <tr>
              <th scope="col">{word("colRepresentation")}</th>
              <th scope="col">{word("units")}</th>
              <th scope="col">{word("colForAmount")}</th>
              <th scope="col">{word("perShare")}</th>
              <th scope="col">{word("colCosts")}</th>
              <th scope="col">{word("colLiquidity")}</th>
              <th scope="col" aria-label={word("trade")} />
            </tr>
          </thead>
          <tbody>
            {comparison.rows.map((row) => (
              <RepresentationRow key={row.representation.mint} row={row} compared={comparison.compared} amountLabel={amountLabel} batchAt={comparison.observedAt} locale={locale} />
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.compareNote}>
        {word("sameBasis")} {word("notBestToken")}
      </p>
    </>
  );
}

function RepresentationRow({ row, compared, amountLabel, batchAt, locale }: { row: CompareRow; compared: boolean; amountLabel: string; batchAt: string; locale: WorkspaceLocale }) {
  const word = wordsFor(locale);
  const numberLocale = locale === "uk" ? "uk-UA" : "en-US";
  const rep = row.representation;
  const quote = row.quote;
  const tone = toneOf(quote?.deviationPct ?? null);
  const spotHref = `/app/spot?view=stock&mint=${encodeURIComponent(rep.mint)}`;
  const planHref = `/app/strategies/new?mint=${encodeURIComponent(rep.mint)}`;
  /* The quotes are taken together and the card's head carries that moment; a row names its own time only when it differs (a quote served from the short cache). */
  const observed = quote ? clockOf(quote.observedAt, locale) : null;
  const ownTime = observed !== null && observed !== clockOf(batchAt, locale) ? observed : null;
  /* The venue's reason stays in the answer for a log; the row says it in the person's words, never as an HTTP status. */
  const failure = row.failure ? (row.failure.code === "NO_ROUTE" ? word("noRouteAtSize") : row.failure.code === "NOT_QUOTED" ? word("notQuoted") : row.failure.code === "PROVIDER" ? word("venueRefused") : word("quoteUnavailable")) : null;
  return (
    <tr className={styles.row} data-anchor={row.anchor ? "true" : "false"} data-lowest={row.lowestCost ? "true" : "false"}>
      <th scope="row">
        <Link className={styles.stock} href={`/app/stocks/${encodeURIComponent(rep.symbol)}`} prefetch={false}>
          <MarketIcon mint={rep.mint} icon={rep.icon} symbol={rep.symbol} size={28} className={styles.icon} />
          <span className={styles.names}>
            <span className={styles.symbol} translate="no">
              {rep.symbol}
              {row.anchor ? <span className={styles.flag}>{word("thisPage")}</span> : null}
              {compared && row.lowestCost ? (
                <span className={styles.lowest}>
                  {word("lowestCost")}
                  <span className={styles.lowestAmount}>{` ${word("lowestFor")} ${amountLabel}`}</span>
                </span>
              ) : null}
            </span>
            <span className={styles.name}>
              {ISSUER_FULL[rep.issuer.id]} · {rep.confidence === "confirmed" ? word("confirmedByCatalogue") : word("impliedBySymbol")}
            </span>
          </span>
        </Link>
      </th>
      <td className={styles.num} translate="no">
        {rep.multiplier === null ? <span className={styles.dash}>—</span> : `1 ${rep.symbol} = ${multiplierOf(rep.multiplier, numberLocale)} ${rep.underlying.symbol}`}
      </td>
      <td className={styles.num} translate="no">
        {quote ? (
          <>
            {amountOf(quote.tokenScaled, numberLocale)} {quote.multiplier === null ? rep.symbol : rep.underlying.symbol}
            {quote.multiplier === null ? (
              <span className={styles.state}>{word("unitsUnknown")}</span>
            ) : quote.slippageBps > 0 ? (
              <span className={styles.state}>{`${word("minimumReceived").toLowerCase()} ${amountOf(quote.minReceivedScaled, numberLocale)}`}</span>
            ) : ownTime ? (
              <span className={styles.state}>{`${ownTime} UTC`}</span>
            ) : null}
          </>
        ) : (
          <span className={styles.stateQuiet}>{failure}</span>
        )}
      </td>
      {/* The per-share price with the reference beneath it: the deviation, the reference figure and its state on one short line, so the comparison reads on one basis without a column of its own. */}
      <td className={styles.num} translate="no">
        {quote && quote.executablePerShare !== null ? formatUsdPrice(quote.executablePerShare, numberLocale) : <span className={styles.dash}>—</span>}
        {quote && quote.reference.perShare !== null ? (
          <span className={styles.state} data-state={quote.reference.state}>
            <span data-tone={quote.deviationPct === null ? undefined : tone}>{formatPercent(quote.deviationPct, numberLocale)}</span>
            {` ${word("versus")} ${formatUsdPrice(quote.reference.perShare, numberLocale)} · ${referenceWord(quote.reference.state, locale).toLowerCase()}`}
          </span>
        ) : (
          <span className={styles.state}>{`${word("colReference").toLowerCase()} · ${referenceWord("unavailable", locale).toLowerCase()}`}</span>
        )}
      </td>
      <td className={styles.num} translate="no">
        {quote ? (
          <>
            {basisPointsOf(quote.feeBasisPoints, numberLocale)}<span className={styles.state}>{`${word("priceImpact").toLowerCase()} ${formatPercent(Number(quote.priceImpactPct), numberLocale)}`}</span>
          </>
        ) : (
          <span className={styles.dash}>—</span>
        )}
      </td>
      <td className={styles.num} translate="no">
        {rep.liquidityUsd === null || rep.liquidityUsd < 1 ? word("noPool") : formatUsdCompact(rep.liquidityUsd, numberLocale)}
      </td>
      <td>
        <span className={styles.rowActions}>
          <Link className="ryntra-button ryntra-button--secondary" href={planHref} prefetch={false}>
            <span className="ryntra-button__label">{word("plan")}</span>
          </Link>
          {/* Quiet: the screen's one orange action is the buy card's own. */}
          <Link className="ryntra-button ryntra-button--secondary" href={spotHref} prefetch={false}>
            <span className="ryntra-button__label">{word("trade")}</span>
          </Link>
        </span>
      </td>
    </tr>
  );
}
