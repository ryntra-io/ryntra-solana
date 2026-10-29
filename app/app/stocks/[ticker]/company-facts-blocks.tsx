import { ArrowRight, ArrowUpRight } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import type { ReactNode } from "react";

import { backingPct, buyShare, countShort, dayShort, dividendWord, moneyShort, multiplierWord, pctShort, periodWord, ratioShort, truthTopic } from "@/app/app/invest/company-facts-model";
import { investWords, numberLocale, type InvestWord } from "@/app/app/invest/invest-words";
import { Help } from "@/app/shell/help";
import { helpTopic } from "@/app/shell/help-topics";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { MarketIcon } from "@/app/solana/workspace/spot/market-list";
import { formatPercent, formatUsdPrice, toneOf } from "@/app/solana/workspace/spot/spot-format";
import { readSpotMarket } from "@/lib/spot/markets.server";
import type { StockAsset } from "@/lib/stocks/asset.server";
import type { CompanyFactsRecord, CompanyFigures } from "@/lib/stocks/company-facts";
import type { StockIssuerId } from "@/lib/stocks/representations";
import { popularCompanies } from "@/lib/stocks/popular";
import { readStockUniverse } from "@/lib/stocks/universe.server";

import { YearRange } from "./company-live";
import company from "./company.module.css";

/**
 * The company page's facts at rest — four blocks, each a set of figures with
 * its label and, once under the block, where the figures come from and when:
 * «Ключові показники» (the company's size and results from its SEC filings, the
 * price over the year), «Про компанію» (what it does, its industry, where it
 * is, where it lists, its latest report), «Що ти купуєш» (the issuer's label
 * and line, the backing, the dividends, the issuer's fee) and «Торги на Solana»
 * (the token's day: volume, liquidity, holders, traders, buying against
 * selling). A figure no source states is not drawn; a block with nothing to say
 * is not drawn at all.
 */

type Lang = "en" | "uk";

type Stat = Readonly<{
  label: string;
  value: string;
  hint?: string | null;
  tone?: "down" | null;
}>;

/* As many columns as figures, up to five: one or two figures never leave half a desk's row blank. */
function columnsFor(count: number): 2 | 3 | 4 | 5 {
  return count >= 5 ? 5 : count <= 2 ? 2 : count === 3 ? 3 : 4;
}

function Stats({ items, columns = 4 }: { items: readonly Stat[]; columns?: 2 | 3 | 4 | 5 }) {
  return (
    <dl className={company.stats} data-columns={columns}>
      {items.map((item) => (
        <div key={item.label} className={company.stat}>
          <dt className={company.statLabel}>{item.label}</dt>
          <dd className={company.statValue} data-tone={item.tone ?? undefined} translate="no">
            {item.value}
          </dd>
          {item.hint ? <dd className={company.statHint}>{item.hint}</dd> : null}
        </div>
      ))}
    </dl>
  );
}

type Fact = Readonly<{ label: string; value: ReactNode }>;

function Facts({ items }: { items: readonly Fact[] }) {
  return (
    <dl className={company.facts}>
      {items.map((item) => (
        <div key={item.label} className={company.fact}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Block({ id, title, children, source, className }: { id: string; title: string; children: ReactNode; source?: ReactNode; className?: string }) {
  return (
    <section className={`${company.block}${className ? ` ${className}` : ""}`} aria-labelledby={id} data-block={id}>
      <h2 id={id} className={company.blockTitle}>
        {title}
      </h2>
      {children}
      {source ? <p className={company.source}>{source}</p> : null}
    </section>
  );
}

function SourceLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className={company.sourceLink} href={href} target="_blank" rel="noopener noreferrer">
      {children}
      <ArrowUpRight size={12} weight="bold" aria-hidden="true" />
    </a>
  );
}

/* ── Ключові показники ──────────────────────────────────────────────────── */

export function KeyStats({
  locale,
  mint,
  price,
  figures,
  facts,
  preIpoMark,
}: {
  locale: WorkspaceLocale;
  mint: string;
  price: number | null;
  figures: CompanyFigures;
  facts: CompanyFactsRecord | null;
  /** A private company: the issuer's valuation and the one the token's price implies. */
  preIpoMark: Readonly<{
    valuationUsd: number | null;
    impliedValuationUsd: number | null;
    issuer: string;
  }> | null;
}) {
  const word = investWords(locale);
  const lang: Lang = locale === "uk" ? "uk" : "en";
  const items: Stat[] = [];
  const cap = moneyShort(figures.marketCapUsd, lang);
  if (cap) items.push({ label: word("marketCap"), value: cap });
  const pe = ratioShort(figures.pe, lang);
  if (pe) items.push({ label: word("peRatio"), value: pe, hint: "P/E" });
  const revenue = moneyShort(figures.revenue?.value, lang);
  if (revenue)
    items.push({
      label: word("revenue"),
      value: revenue,
      hint: periodWord(figures.revenue, lang),
    });
  const income = moneyShort(figures.netIncome?.value, lang);
  if (income)
    items.push({
      label: word("netIncome"),
      value: income,
      hint: periodWord(figures.netIncome, lang),
      tone: (figures.netIncome?.value ?? 0) < 0 ? "down" : null,
    });
  const yieldPct = pctShort(figures.dividendYieldPct, lang);
  if (yieldPct)
    items.push({
      label: word("dividendYield"),
      value: yieldPct,
      hint: word("perYear"),
    });
  if (preIpoMark) {
    const valuation = moneyShort(preIpoMark.valuationUsd, lang);
    if (valuation)
      items.push({
        label: word("companyValuation"),
        value: valuation,
        hint: preIpoMark.issuer,
      });
    const implied = moneyShort(preIpoMark.impliedValuationUsd, lang);
    if (implied)
      items.push({
        label: word("byTokenPrice"),
        value: implied,
        hint: preIpoMark.issuer,
      });
  }
  const report = facts?.report ?? null;
  const filed = cap || revenue || income;
  return (
    <Block
      id="company-stats"
      title={word("keyStats")}
      source={
        filed && report ? (
          <>
            {`${word("filingsSource")} · `}
            <SourceLink href={report.url}>{`${report.form} · ${dayShort(report.filed, lang) ?? report.filed}`}</SourceLink>
          </>
        ) : null
      }
    >
      {items.length ? <Stats items={items} columns={columnsFor(items.length)} /> : null}
      <YearRange mint={mint} price={price} locale={locale} />
    </Block>
  );
}

/* ── Про компанію ───────────────────────────────────────────────────────── */

export function AboutCompany({
  locale,
  fund,
  preIpo,
  line,
  sector,
  headquarters,
  exchange,
  ticker,
  fiscalYear,
  facts,
}: {
  locale: WorkspaceLocale;
  fund: boolean;
  preIpo: boolean;
  line: string | null;
  sector: string | null;
  headquarters: string | null;
  exchange: string | null;
  ticker: string | null;
  fiscalYear: string | null;
  facts: CompanyFactsRecord | null;
}) {
  const word = investWords(locale);
  const lang: Lang = locale === "uk" ? "uk" : "en";
  const items: Fact[] = [];
  if (sector)
    items.push({
      label: preIpo ? word("statusWord") : fund ? word("fundType") : word("industry"),
      value: sector,
    });
  if (headquarters && !fund)
    items.push({
      label: word("headquarters"),
      value: <span translate="no">{headquarters}</span>,
    });
  if (exchange)
    items.push({
      label: word("exchangeWord"),
      value: <span translate="no">{ticker ? `${exchange} · ${ticker}` : exchange}</span>,
    });
  if (fiscalYear && !fund) items.push({ label: word("fiscalYear"), value: fiscalYear });
  const report = facts?.report ?? null;
  if (report && !fund)
    items.push({
      label: word("latestReport"),
      value: <SourceLink href={report.url}>{`${report.form} · ${dayShort(report.filed, lang) ?? report.filed}`}</SourceLink>,
    });
  if (!line && items.length === 0) return null;
  return (
    <Block id="company-about" title={fund ? word("aboutFund") : word("aboutCompany")}>
      {line ? <p className={company.lead}>{line}</p> : null}
      {items.length ? <Facts items={items} /> : null}
    </Block>
  );
}

/* ── Що ти купуєш ───────────────────────────────────────────────────────── */

export function WhatYouBuy({ locale, asset, feeBps, multiplier }: { locale: WorkspaceLocale; asset: StockAsset; feeBps: number | null; multiplier: number | null }) {
  const word = investWords(locale);
  const lang: Lang = locale === "uk" ? "uk" : "en";
  const rep = asset.row.representation;
  const issuer: StockIssuerId = rep.issuer.id;
  const topic = truthTopic(issuer);
  const items: Fact[] = [
    {
      label: word("issuerWord"),
      value: <span translate="no">{rep.issuer.label}</span>,
    },
  ];
  const reserves = asset.reserves;
  const backed = reserves ? backingPct(reserves.sharesHeld, reserves.circulatingSupply) : null;
  if (reserves && backed !== null) {
    const shares = Number(reserves.sharesHeld);
    const held = Number.isFinite(shares)
      ? new Intl.NumberFormat(numberLocale(locale), {
          maximumFractionDigits: 0,
        }).format(shares)
      : null;
    const custodian = reserves.custodians[0] ?? null;
    items.push({
      label: word("backing"),
      value: (
        <span className={company.factStack}>
          <span translate="no">{pctShort(backed, lang)}</span>
          <span className={company.factNote}>{[held && custodian ? `${held} ${word("sharesHeldBy")} ${custodian}` : null, dayShort(reserves.observedAt, lang) ? `${word("reservesAt")} ${dayShort(reserves.observedAt, lang)}` : null].filter(Boolean).join(" · ")}</span>
        </span>
      ),
    });
  }
  const scaled = multiplierWord(multiplier, lang);
  items.push({
    label: word("dividendsWord"),
    value:
      scaled && issuer === "xstocks" ? (
        <span className={company.factStack}>
          <span>{dividendWord(issuer, lang)}</span>
          <span className={company.factNote} translate="no">
            {lang === "uk" ? `1 токен = ${scaled.slice(1)} акції` : `1 token = ${scaled.slice(1)} shares`}
          </span>
        </span>
      ) : (
        dividendWord(issuer, lang)
      ),
  });
  const onchainRead = !("error" in asset.onchain);
  /* The fee the chain states, in one format for the fact and the help line. */
  const fee = feeBps !== null && feeBps > 0 ? pctShort(feeBps / 100, lang) : null;
  if (fee)
    items.push({
      label: word("issuerFee"),
      value: <span translate="no">{fee}</span>,
    });
  else if (onchainRead) items.push({ label: word("issuerFee"), value: word("noFee") });
  return (
    <Block id="company-token" title={word("whatYouBuy")}>
      <div className={company.truthRow}>
        <span className={company.truthChip} data-issuer={issuer}>
          {helpTopic(topic, locale).title}
          <Help topic={topic} locale={locale} fee={fee} />
        </span>
        {/* The fee in this line is the one the chain states — the same text
            as «Issuer fee» below, never a rate typed into the help. */}
        <p className={company.truthLine}>{helpTopic(topic, locale, { fee }).short}</p>
      </div>
      <Facts items={items} />
    </Block>
  );
}

/* ── Популярні компанії — beside the page on a wide screen, at its end on a phone ── */

/**
 * The same companies Home shows, in the same published order — by the day's
 * trading — without the one on this page: a way on to the next company, never
 * a suggestion about this one. The server's one list (`lib/stocks/popular.ts`,
 * contract 1.20.0 «Популярне»), the phone's too.
 */
export async function PopularAside({ locale, mint }: { locale: WorkspaceLocale; mint: string }) {
  const word = investWords(locale);
  const numbers = numberLocale(locale);
  const read = await readStockUniverse().catch(() => null);
  if (!read || !read.ok) return null;
  const cards = popularCompanies(read.universe.rows, { limit: 6, exclude: mint });
  if (cards.length === 0) return null;
  return (
    <section className={company.popular} aria-labelledby="company-popular" data-block="company-popular">
      <div className={company.popularHead}>
        <h2 id="company-popular" className={company.blockTitle}>
          {word("popularCompanies")}
        </h2>
        <Link className={company.popularAll} href="/app/markets?tab=companies" prefetch={false}>
          {word("allCompanies")}
          <ArrowRight size={14} weight="bold" aria-hidden="true" />
        </Link>
      </div>
      <ul className={company.popularList}>
        {cards.map((card) => (
          <li key={card.mint}>
            <Link className={company.popularRow} href={`/app/stocks/${encodeURIComponent(card.ticker)}`} prefetch={false}>
              <MarketIcon mint={card.mint} icon={card.icon} symbol={card.name} size={32} className={company.popularLogo} />
              <span className={company.popularName}>{card.name}</span>
              <span className={company.popularFigures}>
                {card.price === null ? null : (
                  <span className={company.popularPrice} translate="no">
                    {formatUsdPrice(card.price, numbers)}
                  </span>
                )}
                {card.change24h === null ? null : (
                  <span className={company.popularChange} data-tone={toneOf(card.change24h)} translate="no">
                    {formatPercent(card.change24h, numbers)}
                  </span>
                )}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ── Торги на Solana ────────────────────────────────────────────────────── */

export async function TokenTrading({
  locale,
  mint,
  fallback,
}: {
  locale: WorkspaceLocale;
  mint: string;
  fallback: Readonly<{
    volume24hUsd: number | null;
    liquidityUsd: number | null;
  }>;
}) {
  const word = investWords(locale);
  const lang: Lang = locale === "uk" ? "uk" : "en";
  const read = await readSpotMarket(mint).catch(() => null);
  const market = read && read.ok ? read.market : null;
  const volume = moneyShort(market?.volume24hUsd ?? fallback.volume24hUsd, lang);
  const liquidity = moneyShort(market?.liquidityUsd ?? fallback.liquidityUsd, lang);
  const holders = countShort(market?.holders, lang);
  const traders = countShort(market?.stats.h24.traders, lang);
  const buys = market?.stats.h24.buys ?? null;
  const sells = market?.stats.h24.sells ?? null;
  const trades = countShort(buys !== null && sells !== null ? buys + sells : null, lang);
  const items: Stat[] = [];
  const add = (label: InvestWord, value: string | null, hint?: string | null) => {
    if (value) items.push({ label: word(label), value, hint: hint ?? null });
  };
  add("volume24h", volume);
  add("liquidity", liquidity);
  add("holders", holders);
  add("traders24h", traders);
  add("trades24h", trades);
  const buying = buyShare(buys, sells);
  const since = dayShort(market?.firstPoolAt, lang);
  if (items.length === 0 && buying === null) {
    return (
      <Block id="company-trading" title={word("tradingOnSolana")}>
        <p className={company.blockNote}>{word("tradingUnread")}</p>
      </Block>
    );
  }
  return (
    <Block id="company-trading" title={word("tradingOnSolana")} source={market ? word("marketSource") : null}>
      <Stats items={items} columns={columnsFor(items.length)} />
      {buying !== null ? (
        <div className={company.pressure}>
          <div className={company.pressureHead}>
            <span>
              <span className={company.pressureBuy}>{`${word("buysWord")} ${pctShort(buying, lang)}`}</span>
              <span className={company.pressureSell}>{`${word("sellsWord")} ${pctShort(100 - buying, lang)}`}</span>
            </span>
            <span className={company.pressureWhy}>{word("byTrades")}</span>
          </div>
          <div className={company.pressureBar} role="img" aria-label={`${word("buysWord")} ${pctShort(buying, lang)}, ${word("sellsWord")} ${pctShort(100 - buying, lang)}`}>
            <span className={company.pressureBuyFill} style={{ width: `${buying}%` }} />
          </div>
        </div>
      ) : null}
      {since ? (
        <p className={company.sinceLine}>
          {`${word("onSolanaSince")} `}
          <span translate="no">{since}</span>
        </p>
      ) : null}
    </Block>
  );
}

export function TokenTradingSkeleton({ locale }: { locale: WorkspaceLocale }) {
  const word = investWords(locale);
  return (
    <section className={company.block} aria-busy="true" data-block="company-trading">
      <h2 className={company.blockTitle}>{word("tradingOnSolana")}</h2>
      <div className={company.statsBone} aria-hidden="true" />
    </section>
  );
}
