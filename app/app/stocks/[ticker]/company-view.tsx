import { ArrowLeft, ArrowRight } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { Suspense } from "react";

import { exchangeShort, truthTopic } from "@/app/app/invest/company-facts-model";
import { exchangeState, premiumLine, truthLine } from "@/app/app/invest/company-model";
import { investWords } from "@/app/app/invest/invest-words";
import { saleAssetOf } from "@/app/app/invest/sale-model";
import { LensPanel } from "@/app/app/lens/lens-panel";
import { helpTopic } from "@/app/shell/help-topics";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { EvidenceCard } from "@/app/solana/workspace/evidence/evidence-card";
import { RiskCard } from "@/app/solana/workspace/evidence/risk-card";
import { MarketIcon } from "@/app/solana/workspace/spot/market-list";
import { priceFactsOf, referenceKindOf } from "@/lib/autoinvest/price-condition";
import type { StockAsset } from "@/lib/stocks/asset.server";
import { companyFactsFor, companyFigures, fiscalYearEndWords, headquartersLabel } from "@/lib/stocks/company-facts";
import { companyNoticeFor } from "@/lib/stocks/company-notices";
import { companyLine, isKnownFund } from "@/lib/stocks/company-profiles";
import { FUND_SECTOR, PRIVATE_SECTOR, sectorLabel } from "@/lib/stocks/company-sectors";
import { eventLine, isWatched, SELL_FOR_USDC, swapActionWord, windowState, type WatchedEvent } from "@/lib/stocks/conversion-watch";
import { lifecycleEventFor } from "@/lib/stocks/lifecycle-events";
import { RETIRED_WORDS, type RetiredToken } from "@/lib/stocks/retired";
import { companyDisplayName } from "@/lib/stocks/shelf";
import type { StockRow } from "@/lib/stocks/universe.server";

import styles from "../stocks.module.css";
import { AssetDetailsFold, MarketCard, WhatYouBuyCard } from "./asset-facts";
import company from "./company.module.css";
import { CompanyActions } from "./company-actions";
import { CompanyWarning, PathEvent, type CompanyEventFacts } from "./company-event";
import { AboutCompany, KeyStats, PopularAside, TokenTrading, TokenTradingSkeleton, WhatYouBuy } from "./company-facts-blocks";
import { CompanyPathStrip } from "./company-path";
import { pathDay, swapLines } from "./company-path-words";
import { YourPosition } from "./company-live";
import { CompanyQuote } from "./company-quote";
import { DealBlock } from "./deal-block";
import { LiquidityBlock, LiquiditySkeleton } from "./liquidity-block";
import { AboutPreStocksToken, StructureRisks } from "./pre-ipo-research";

/**
 * A company's page, one for everyone — drawn for a phone first, laid out like
 * Home from 1280 px: the company in the main column, its purchase and the
 * other popular companies beside it, staying in view.
 *
 * The head says who the company is — its logo and name («Apple», never the
 * token's ticker), and under the name its ticker on its exchange and its
 * industry — then the price in dollars with the move in dollars and per cent,
 * whether the exchange is open, and the line over a day, a week, a month or a
 * year. *Купити* is the one orange action and opens the purchase in dollars;
 * *Автоінвест* stands quiet beside it — or, once a rule exists, the rule
 * itself (`company-actions.tsx`) — and the reader's own position under them,
 * when the wallet holds the token.
 *
 * Then the facts, at rest, as figures (`company-facts-blocks.tsx`): «Ключові
 * показники» — the company's market value, P/E, revenue and net income over
 * twelve months from its SEC filings, its dividend, the price over the year;
 * «Про компанію» — what it does, its industry, headquarters, exchange, fiscal
 * year and latest report; «Що ти купуєш» — the issuer's label, the backing,
 * the dividends, the issuer's fee; «Торги на Solana» — the token's day.
 *
 * A private company comes through PreStocks only: its truth says what the
 * token is not, the issuer's fee on every transfer and that the issuer can
 * freeze or take the token, before any figure; a company that has spoken
 * about tokens like it (OpenAI, Anthropic) has that dated line under the
 * truth; one number stands under the price — the token against PreStocks' own
 * valuation, with its time — and the valuation stands among the statistics.
 *
 * «Шлях компанії» stands under the name: where the company is on its way from
 * a private token to its stock on Solana, this token's step and the company's
 * other token one press away — SPACEX and SPCXx one company at two steps —
 * with the private token's swap deadline under the steps; on the private
 * token's own page that line is the event's, with a holder's swap under it,
 * and the truth box keeps the truth alone.
 *
 * Everything technical stays one press deep under *Деталі*, nothing dropped:
 * Ryntra's Brief and Critic on request; the issuer's reference and the
 * deviation, the reserves, the multiplier (`asset-facts.tsx`); the estimate
 * for an amount compared across the same company's tokens (`deal-block.tsx`,
 * quiet); the pools; the onchain activity and the risk card; the mint. The
 * candles and the full ticket are Spot's, one press from the line.
 */
export function CompanyView({ locale, asset, target = null, counterpart = null, nowMs = Date.now() }: { locale: WorkspaceLocale; asset: StockAsset; target?: StockRow | null; counterpart?: StockRow | null; nowMs?: number }) {
  const word = investWords(locale);
  const lang = locale === "uk" ? "uk" : "en";
  const { row } = asset;
  const rep = row.representation;
  const preIpo = rep.instrument.class === "pre-ipo";
  const name = companyDisplayName(rep.underlying.name ?? rep.name, preIpo ? null : rep.underlying.symbol);
  const feeBps = row.transferFee?.basisPoints ?? null;
  const truth = truthLine(rep.issuer.id, name, locale, feeBps);
  const notice = preIpo ? companyNoticeFor(rep.companyKey) : null;
  const premium = preIpo ? premiumLine(row.markPremiumPct, rep.issuer.label, lang) : null;
  const exchange = preIpo ? null : exchangeState(row.session);
  const onchain = "error" in asset.onchain ? null : asset.onchain;
  const multiplier = asset.chainMultiplier?.current ?? row.multiplier?.current ?? null;
  /* The IPO and conversion watch: the issuer's event before any figure, the holder's one action and the swap's facts. */
  const watched = preIpo ? lifecycleEventFor(rep.mint) : null;
  const read = isWatched(watched) ? eventFacts(watched, target, lang, nowMs) : null;
  /* «Шлях компанії»: the company's way and this token's step; on the private token's page the event becomes the strip's own line, with the issuer's minute. */
  const path = row.companyPath ?? null;
  const pathEvent = read && path?.swap && path.at === "private" ? { ...read, lines: swapLines(path.swap, lang) } : null;
  const event = pathEvent ? null : read;
  const privateFeeBps = path?.at === "solana" ? (counterpart?.transferFee?.basisPoints ?? null) : feeBps;
  const publicSince = preIpo && path?.swap ? (path.steps.find((step) => step.step === "ipo")?.date ?? null) : null;
  const buyerLine = isWatched(watched) && read?.open ? eventLine(watched, "buyer", lang, nowMs) : null;
  const buyable = row.lifecycle.tradable && rep.tradingHalted !== true && typeof row.market.priceUsd === "number";
  /* «Продати з позиції»: the holder's sale beside the position, read as the page reads the company — unless the issuer's event already offers the holder a sale on this page, so no one sees two. */
  const sale = read ? null : saleAssetOf(asset, lang);
  /* «Умова ціни»: the facts a rule's price condition is judged on, as this read states them — the sheets read them again while they are open. */
  const assetReadAt = Date.parse(asset.fetchedAt);
  const conditionFacts = priceFactsOf(row, Number.isFinite(assetReadAt) ? assetReadAt : null);
  const conditionReference = referenceKindOf(row);
  const spotHref = `/app/spot?view=stock&mint=${encodeURIComponent(rep.mint)}`;
  /* A plan can be made where the issuer offers the token (the builder's own rule). */
  const planHref = row.lifecycle.tradable ? `/app/strategies/new?mint=${encodeURIComponent(rep.mint)}` : null;

  /* The company's facts: its filings by its ticker, the price of one share for what is set against it, its industry and its one line. */
  const ticker = preIpo ? null : rep.underlying.symbol;
  const facts = preIpo ? null : companyFactsFor(ticker);
  const fund = !preIpo && (facts?.kind === "fund" || isKnownFund(ticker));
  const figures = companyFigures(ticker ?? "", fund ? null : facts, row.reference.perShare ?? row.tokenPerShareUsd);
  /* A private token whose company has gone public: the company is no longer «private», and the head says what the token is. */
  const sector = preIpo ? (publicSince ? (lang === "uk" ? `Публічна з ${pathDay(publicSince, lang)}` : `Public since ${pathDay(publicSince, lang)}`) : PRIVATE_SECTOR[lang]) : fund ? FUND_SECTOR[lang] : sectorLabel(ticker, facts?.sic, lang);
  const exchangeName = preIpo ? null : exchangeShort(rep.exchange, facts?.exchange ?? null);
  const line = companyLine(rep.underlying.symbol, lang);
  const subline = publicSince ? `${rep.symbol} · ${lang === "uk" ? "токен PreStocks" : "PreStocks token"}` : [ticker && exchangeName ? `${ticker} · ${exchangeName}` : ticker, sector].filter(Boolean).join(" · ");
  const label = helpTopic(truthTopic(rep.issuer.id), locale).title;
  const unit = rep.instrument.unitBasis === "token" ? "token" : "share";

  return (
    <section className={company.page} aria-labelledby="company-title">
      <Link className={company.back} href="/app/markets" prefetch={false}>
        <ArrowLeft size={16} weight="bold" aria-hidden="true" />
        {word("marketsTitle")}
      </Link>

      <div className={company.layout}>
        <div className={company.main}>
          <header className={company.head}>
            <MarketIcon mint={rep.mint} icon={row.market.icon} symbol={name} size={56} className={company.logo} />
            <div className={company.headText}>
              <h1 id="company-title" className={company.name}>
                {name}
              </h1>
              {subline ? (
                <p className={company.subline} translate="no">
                  {subline}
                </p>
              ) : null}
            </div>
          </header>
          {path ? (
            <CompanyPathStrip
              path={path}
              locale={locale}
              privateFeeBps={privateFeeBps}
              footer={pathEvent ? <PathEvent event={pathEvent} token={{ mint: rep.mint, symbol: rep.symbol, name, icon: row.market.icon, decimals: onchain?.decimals ?? null, multiplier, issuerFeeBps: feeBps }} locale={locale} /> : null}
            />
          ) : null}
          {/* A private company: what the token is not, before any figure — the company's own dated word about tokens like it, where it spoke — and the issuer's event with a holder's one action. */}
          {preIpo ? (
            <CompanyWarning
              truth={truth}
              notice={notice ? notice.line[lang] : null}
              event={event}
              token={{ mint: rep.mint, symbol: rep.symbol, name, icon: row.market.icon, decimals: onchain?.decimals ?? null, multiplier, issuerFeeBps: feeBps }}
              locale={locale}
            />
          ) : null}
          <CompanyQuote
            mint={rep.mint}
            name={name}
            price={row.market.priceUsd}
            dayChangePct={row.market.change24hPct}
            locale={locale}
            premium={premium ? { line: premium, at: row.issuerMark?.fetchedAt ?? null } : null}
            defaultRange={rep.issuer.id === "prestocks" ? "1m" : "1d"}
            status={
              exchange ? (
                <p className={company.exchange} data-state={exchange}>
                  <span className={company.dot} aria-hidden="true" />
                  {exchange === "open" ? word("exchangeOpen") : `${word("exchangeClosed")} · ${word("closedDrift")}`}
                </p>
              ) : null
            }
            aside={
              /* The line is the company's; the candles, the drawing and the full ticket are Spot's, one press away. */
              <Link className={company.toSpot} href={spotHref} prefetch={false}>
                {word("chartInSpot")}
                <ArrowRight size={14} weight="bold" aria-hidden="true" />
              </Link>
            }
          />
        </div>

        <aside className={company.aside} aria-label={word("buy")}>
          <div className={company.asideStick}>
            <div className={company.buyCard}>
              <p className={company.buyTitle}>{`${word("buyCompany")} ${name}`}</p>
              {preIpo ? null : (
                <p className={company.truth} data-company-truth>
                  <span className={company.truthLabel}>{label}</span>
                  <span className={company.truthText}>{truth}</span>
                </p>
              )}
              {buyable ? (
                <CompanyActions
                  mint={rep.mint}
                  symbol={rep.symbol}
                  name={name}
                  icon={row.market.icon}
                  decimals={onchain?.decimals ?? null}
                  multiplier={multiplier}
                  unit={unit}
                  preIpo={preIpo}
                  truth={truth}
                  priceUsd={row.market.priceUsd}
                  eventLine={buyerLine}
                  quietWhenHeld={read?.open === true && read.into !== null}
                  conditionFacts={conditionFacts}
                  conditionReference={conditionReference}
                  locale={locale}
                />
              ) : (
                <p className={company.status} role="status">
                  {rep.tradingHalted ? word("halted") : word("notOffered")}
                </p>
              )}
              {buyable ? <p className={company.buyNote}>{word("fromDollarWallet")}</p> : null}
              <YourPosition mint={rep.mint} name={name} price={row.market.priceUsd} unit={unit} locale={locale} sale={sale} />
            </div>
            {/* The way on to the next company: the same popular companies as Home, in the same published order, without this one. */}
            <Suspense fallback={null}>
              <PopularAside locale={locale} mint={rep.mint} />
            </Suspense>
          </div>
        </aside>

        <div className={company.facts2}>
          <KeyStats
            locale={locale}
            mint={rep.mint}
            price={row.market.priceUsd}
            figures={figures}
            facts={fund ? null : facts}
            preIpoMark={preIpo && row.issuerMark ? { valuationUsd: row.issuerMark.valuationUsd, impliedValuationUsd: row.issuerMark.impliedValuationUsd, issuer: rep.issuer.label } : null}
          />
          <div className={company.pair}>
            <AboutCompany
              locale={locale}
              fund={fund}
              preIpo={preIpo}
              line={line}
              sector={sector}
              headquarters={fund ? null : headquartersLabel(facts, lang)}
              exchange={exchangeName}
              ticker={ticker}
              fiscalYear={fund ? null : fiscalYearEndWords(facts, lang)}
              facts={fund ? null : facts}
            />
            <WhatYouBuy locale={locale} asset={asset} feeBps={feeBps} multiplier={multiplier} />
          </div>
          <Suspense fallback={<TokenTradingSkeleton locale={locale} />}>
            <TokenTrading locale={locale} mint={rep.mint} fallback={{ volume24hUsd: row.market.volume24hUsd, liquidityUsd: row.market.liquidityUsd }} />
          </Suspense>
        </div>
      </div>

      {/* What the stock desk's asset page showed, one press deep — the same cards, nothing dropped. */}
      <details className={company.details}>
        <summary>{word("details")}</summary>
        <div className={`${styles.grid} ${company.detailsGrid}`}>
          {/* Ryntra's Brief on this company, and the Critic on request — closed until pressed, so no text of the assistant sits on the way to a purchase. */}
          <div className={styles.w12}>
            <LensPanel subject={{ kind: "asset", mint: rep.mint, symbol: rep.symbol }} locale={locale} trigger="own" />
          </div>
          <MarketCard asset={asset} locale={locale} />
          <WhatYouBuyCard asset={asset} locale={locale} />
          {/* The estimate for an amount on either side, the same company's other tokens compared, the way into Spot or a plan — quiet: *Купити* above is the page's one orange action. */}
          <DealBlock mint={rep.mint} ticker={rep.symbol} underlying={rep.underlying.symbol} unitBasis={rep.instrument.unitBasis} tradable={row.lifecycle.tradable} quiet className={styles.w12} locale={locale} />
          <Suspense fallback={<LiquiditySkeleton locale={locale} />}>
            <LiquidityBlock mint={rep.mint} symbol={rep.symbol} locale={locale} routePool={asset.pool ? { name: asset.pool.name, dex: asset.pool.dex, reserveUsd: asset.pool.reserveUsd } : null} />
          </Suspense>
          {rep.issuer.id === "prestocks" ? <AboutPreStocksToken row={row} locale={locale} /> : null}
          {preIpo ? <StructureRisks asset={asset} locale={locale} /> : null}
          {/* The onchain activity and the risk card, read on request, each one press from a rule of a plan where a plan can be made. */}
          <div className={styles.w6}>
            <EvidenceCard mint={rep.mint} locale={locale} planHref={planHref} />
          </div>
          <div className={styles.w6}>
            <RiskCard mint={rep.mint} locale={locale} planHref={planHref} assetKind="issuer-backed" />
          </div>
          <AssetDetailsFold asset={asset} locale={locale} />
        </div>
      </details>
    </section>
  );
}

/**
 * The issuer's event as the page hands it to the client (the IPO and
 * conversion watch): the lines in the reader's language, the window's state
 * now, the two actions' words and the swap's facts — the listed token it goes
 * into, read from the same universe (its icon, its multiplier, the company's
 * price on the exchange by its issuer's reference, what it is). Without that
 * row the swap is not offered; the sale is.
 */
function eventFacts(event: WatchedEvent, target: StockRow | null, lang: "en" | "uk", nowMs: number): CompanyEventFacts {
  const into = event.watch.into;
  const listed = into && target && target.representation.mint === into.mint ? target : null;
  return {
    lines: { holder: eventLine(event, "holder", lang, nowMs), everyone: eventLine(event, "everyone", lang, nowMs) },
    open: windowState(event, nowMs) === "open",
    swapWord: swapActionWord(event.watch, lang),
    sellWord: SELL_FOR_USDC[lang],
    deadline: event.deadline,
    noticeUrl: event.url,
    mechanicsUrl: event.watch.mechanics?.url ?? null,
    into:
      into && listed
        ? {
            mint: into.mint,
            symbol: into.symbol,
            company: into.company,
            icon: listed.market.icon,
            multiplier: listed.multiplier?.current ?? null,
            exchangeUsd: listed.reference.perShare ?? listed.market.priceUsd ?? null,
            truth: truthLine(listed.representation.issuer.id, into.company, lang),
          }
        : null,
  };
}

/**
 * A token Ryntra no longer supports: the page a holder, an old plan or an
 * old receipt still links to says what the token is now and the way out — a
 * sale in the person's own wallet — and offers nothing to buy, plan or trade
 * here. No issuer is named.
 */
export function RetiredCompany({ locale, token }: { locale: WorkspaceLocale; token: RetiredToken }) {
  const word = investWords(locale);
  const lang = locale === "uk" ? "uk" : "en";
  return (
    <section className={company.page} aria-labelledby="company-title" data-retired>
      <Link className={company.back} href="/app/markets" prefetch={false}>
        <ArrowLeft size={16} weight="bold" aria-hidden="true" />
        {word("marketsTitle")}
      </Link>
      <div className={company.identity}>
        <MarketIcon mint={token.mint} icon={null} symbol={token.symbol} size={48} className={company.logo} />
        <h1 id="company-title" className={company.name} translate="no">
          {token.symbol}
        </h1>
      </div>
      <div className={company.retired} role="status" data-retired-state>
        <p className={company.retiredState}>{RETIRED_WORDS.state[lang]}</p>
        <p>{RETIRED_WORDS.exit[lang]}</p>
        <Link className="rw-btn" href="/app/portfolio" prefetch={false}>
          {word("allInPortfolio")}
        </Link>
      </div>
    </section>
  );
}

/** The company could not be read right now: one line and one action — read it again. */
export function CompanyUnavailable({ locale, ticker }: { locale: WorkspaceLocale; ticker: string }) {
  const word = investWords(locale);
  return (
    <section className={company.page}>
      <Link className={company.back} href="/app/markets" prefetch={false}>
        <ArrowLeft size={16} weight="bold" aria-hidden="true" />
        {word("marketsTitle")}
      </Link>
      <div className={company.status} role="status">
        <p>{word("companyDown")}</p>
        <a className="rw-btn" href={`/app/stocks/${encodeURIComponent(ticker)}`}>
          {word("reload")}
        </a>
      </div>
    </section>
  );
}
