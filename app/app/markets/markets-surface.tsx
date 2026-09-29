"use client";

import { ArrowRight, ChartLine, Funnel, TrendUp } from "@phosphor-icons/react";
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { premiumLine } from "@/app/app/invest/company-model";
import { LocalClock } from "@/app/app/invest/local-clock";
import { coinItem, companyItem, isShelfCards, isShelfCoins, RowSkeleton, ShelfRow, type ShelfItem } from "@/app/app/invest/shelf-ui";
import { investWords, numberLocale, type InvestWord } from "@/app/app/invest/invest-words";
import { saveShelfCopy } from "@/app/app/invest/shelf-copy";
import { ShelfSlotProvider, useFailedShelf, useLiveShelf, useShelfSlot } from "@/app/app/invest/shelf-slot";
import styles from "@/app/app/invest/invest.module.css";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { CRYPTO_SHOWN, type ShelfCoin } from "@/lib/spot/coin-shelf";
import type { ShelfCard } from "@/lib/stocks/shelf";

import { MARKETS_TABS, type MarketsTab } from "./tabs";

/**
 * Markets (canon v5.4 В33, 2026-09-24): tabs on top — Усі · Компанії ·
 * Приватні · Крипта · Меми · Долари — and on the same top the «Для
 * досвідчених» row: Spot, the screener, Trends. «Усі» shows a few of each,
 * companies first and crypto right after them, so crypto is on the first
 * screen of a desk and of a phone; each other tab is one list whole.
 *
 * Each list streams in on its own, so a cold catalogue never holds the coins
 * or the memes; the lists stand in one board whose order the tab decides
 * (`invest.module.css`, `.board`), and the tab lives in the address
 * (`?tab=`) so a link can open the one a person needs.
 */

const TAB_WORDS: Readonly<Record<MarketsTab, InvestWord>> = {
  all: "tabAll",
  companies: "tabCompanies",
  private: "tabPrivate",
  crypto: "tabCrypto",
  memes: "tabMemes",
  dollars: "tabDollars",
};

/**
 * How many of each list «Усі» carries: two full rows of four from 1600 px
 * (`RYN-WIDTH-PREMIUM-001`); the board shows two rows of three below that and
 * three rows on a phone, so a list never ends on a half-empty row.
 */
const OVERVIEW = { companies: 8, private: 4, crypto: 8, memes: 4 } as const;

const COMPANIES_SHOWN = 24;
const MORE_STEP = 24;

type TabState = Readonly<{ tab: MarketsTab; choose: (tab: MarketsTab) => void }>;

const TabContext = createContext<TabState | null>(null);

function useTab(): TabState {
  const value = useContext(TabContext);
  if (!value) throw new Error("A markets list must be inside MarketsTabs.");
  return value;
}

/** One tool of «Для досвідчених»: a page of the registry Markets holds. */
export type ExperiencedTool = Readonly<{ id: string; label: string; href: string }>;

/* The rail's own glyphs for these pages (`app-shell.tsx`), so a tool looks the same wherever it is drawn. */
const TOOL_ICONS: Readonly<Record<string, ReactNode>> = {
  spot: <ChartLine size={16} weight="bold" />,
  stocks: <Funnel size={16} weight="bold" />,
  trends: <TrendUp size={16} weight="bold" />,
};

export function MarketsTabs({ locale, tools, initialTab, children }: { locale: WorkspaceLocale; tools: readonly ExperiencedTool[]; initialTab: MarketsTab; children: ReactNode }) {
  const word = investWords(locale);
  const [tab, setTab] = useState<MarketsTab>(initialTab);
  const choose = useCallback((next: MarketsTab) => {
    setTab(next);
    /* The address says the tab, so a reload or a shared link opens it — without a navigation. */
    const url = new URL(window.location.href);
    if (next === "all") url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);
  const value = useMemo(() => ({ tab, choose }), [choose, tab]);
  return (
    <TabContext.Provider value={value}>
      <div className={styles.marketsHead}>
        <h1 className={styles.heroTitle}>{word("marketsTitle")}</h1>
        <div className={styles.marketsBar}>
          <div className={styles.tabs} role="tablist" aria-label={word("marketsTabs")}>
            {MARKETS_TABS.map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                id={`markets-tab-${id}`}
                aria-selected={tab === id}
                aria-controls="markets-board"
                className={styles.tab}
                onClick={() => choose(id)}
              >
                {word(TAB_WORDS[id])}
              </button>
            ))}
          </div>
          {tools.length > 0 ? (
            /* «Для досвідчених» (canon v5.3 В28, v5.4 В33): the tools «Профі» held, on the same top as the tabs. */
            <nav className={styles.tools} aria-label={word("experienced")} data-experienced-tools>
              <span className={styles.toolsLabel}>{word("experienced")}</span>
              {tools.map((tool) => (
                <Link key={tool.id} className={styles.toolChip} href={tool.href} prefetch={false}>
                  <span className={styles.toolChipIcon} aria-hidden="true">{TOOL_ICONS[tool.id] ?? null}</span>
                  {tool.label}
                </Link>
              ))}
            </nav>
          ) : null}
        </div>
      </div>
      <div className={styles.board} id="markets-board" role="tabpanel" aria-labelledby={`markets-tab-${tab}`} data-tab={tab}>
        {children}
      </div>
    </TabContext.Provider>
  );
}

/** A list's head: its title, a line under it, and in «Усі» the way to the whole list. */
function SectionHead({ id, title, note, all, locale, aside }: { id: string; title: ReactNode; note?: ReactNode; all?: MarketsTab; locale: WorkspaceLocale; aside?: ReactNode }) {
  const word = investWords(locale);
  const { tab, choose } = useTab();
  return (
    <div className={styles.sectionHead}>
      <div className={styles.sectionTitles}>
        <h2 id={id} className={styles.sectionTitle}>{title}</h2>
        {note ? <p className={styles.sectionNote}>{note}</p> : null}
      </div>
      {aside}
      {tab === "all" && all ? (
        <button
          type="button"
          className={styles.sectionLink}
          onClick={() => {
            choose(all);
            window.scrollTo({ top: 0 });
          }}
        >
          {word("seeAll")}
          <ArrowRight size={14} weight="bold" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

function Rows({ items, locale, shown, onMore, moreLabel }: { items: readonly ShelfItem[]; locale: WorkspaceLocale; shown: number; onMore?: () => void; moreLabel: string }) {
  const numbers = numberLocale(locale);
  return (
    <>
      <div className={styles.rows}>
        {items.slice(0, shown).map((item) => (
          <ShelfRow key={item.key} item={item} locale={numbers} />
        ))}
      </div>
      {onMore && items.length > shown ? (
        <button type="button" className={`rw-btn ${styles.more}`} onClick={onMore}>
          {moreLabel}
        </button>
      ) : null}
    </>
  );
}

/** Whether a list is drawn in this tab: its own tab, or «Усі». */
function inTab(tab: MarketsTab, own: MarketsTab): boolean {
  return tab === "all" || tab === own;
}

/* ------------------------------------------------------------ companies */

export type CompaniesData = Readonly<{ companies: readonly ShelfCard[]; privateCompanies: readonly ShelfCard[] }>;

function isCompaniesData(value: unknown): value is CompaniesData {
  return typeof value === "object" && value !== null && isShelfCards((value as CompaniesData).companies) && isShelfCards((value as CompaniesData).privateCompanies);
}

/** The companies' place: the browser's copy until the live list mounts (see `shelf-slot.tsx`). */
export function CompaniesSlot({ locale, children }: { locale: WorkspaceLocale; children: ReactNode }) {
  const { copy, failed, slot } = useShelfSlot("companies", isCompaniesData);
  const shown = copy !== null;
  return (
    <ShelfSlotProvider slot={slot}>
      <div className={styles.slot} data-copy={shown ? "true" : undefined}>
        {shown ? (
          <div className={styles.copy}>
            <CompaniesView data={copy} locale={locale} updating={!failed} />
          </div>
        ) : null}
        {children}
      </div>
    </ShelfSlotProvider>
  );
}

/** The rows' shape while the list is read — hidden when a copy stands in. */
export function CompaniesSkeleton({ locale }: { locale: WorkspaceLocale }) {
  const word = investWords(locale);
  const { tab } = useTab();
  return (
    <div className={styles.fallback}>
      {inTab(tab, "companies") ? (
        <section className={styles.section} aria-label={word("companies")} data-section="companies">
          <SectionHead id="companies-skeleton-title" title={word("companies")} note={word("byVolume")} locale={locale} />
          <RowSkeleton count={tab === "all" ? OVERVIEW.companies : 12} />
        </section>
      ) : null}
      {inTab(tab, "private") ? (
        <section className={styles.section} aria-label={word("privateCompanies")} data-section="private">
          <SectionHead id="private-skeleton-title" title={word("privateCompanies")} locale={locale} />
          <RowSkeleton count={3} />
        </section>
      ) : null}
    </div>
  );
}

/** The live companies; the browser keeps them as the next visit's copy. */
export function CompaniesSections({ data, locale }: { data: CompaniesData; locale: WorkspaceLocale }) {
  useLiveShelf();
  useEffect(() => {
    saveShelfCopy("companies", data);
  }, [data]);
  return (
    <div className={styles.live}>
      <CompaniesView data={data} locale={locale} />
    </div>
  );
}

/** The catalogue did not answer: the copy, if any, stays; otherwise one line and one action. */
export function CompaniesFailed({ locale }: { locale: WorkspaceLocale }) {
  const word = investWords(locale);
  const { tab } = useTab();
  useFailedShelf();
  if (!inTab(tab, "companies") && !inTab(tab, "private")) return null;
  return (
    <div className={styles.fallback}>
      <section className={styles.section} aria-label={word("companies")} data-section="companies">
        <SectionHead id="companies-failed-title" title={word("companies")} locale={locale} />
        <div className={styles.status} role="status">
          <p>{word("shelfDown")}</p>
          <button type="button" className="rw-btn" onClick={() => window.location.reload()}>{word("reload")}</button>
        </div>
      </section>
    </div>
  );
}

function CompaniesView({ data, locale, updating = false }: { data: CompaniesData; locale: WorkspaceLocale; updating?: boolean }) {
  const word = investWords(locale);
  const { tab } = useTab();
  const [shown, setShown] = useState(COMPANIES_SHOWN);
  const lang = locale === "uk" ? "uk" : "en";
  const companies = useMemo(() => data.companies.map((card) => companyItem(card)), [data.companies]);
  /* A private company's card: «Це не акція» and its one number — the price against PreStocks' valuation (canon v5.2 В27). */
  const privates = useMemo(() => data.privateCompanies.map((card) => companyItem(card, { note: word("notAShare"), premium: premiumLine(card.premiumPct, "PreStocks", lang) })), [data.privateCompanies, word, lang]);
  /* The valuation's time, once for the shelf: every card's number was read from the same answer of the issuer. */
  const valuationAt = useMemo(() => data.privateCompanies.map((card) => card.premiumAt ?? null).find((at): at is string => at !== null) ?? null, [data.privateCompanies]);
  const overview = tab === "all";

  return (
    <>
      {inTab(tab, "companies") && companies.length > 0 ? (
        <section className={styles.section} aria-labelledby="companies-title" data-section="companies">
          <SectionHead
            id="companies-title"
            title={word("companies")}
            note={word("byVolume")}
            all="companies"
            locale={locale}
            aside={updating ? <span className={styles.updating}>{word("updating")}</span> : undefined}
          />
          <Rows items={companies} locale={locale} shown={overview ? OVERVIEW.companies : shown} onMore={overview ? undefined : () => setShown((count) => count + MORE_STEP)} moreLabel={word("showMore")} />
        </section>
      ) : null}
      {inTab(tab, "private") && privates.length > 0 ? (
        <section className={styles.section} aria-labelledby="private-title" data-section="private">
          <SectionHead
            id="private-title"
            title={
              <>
                {word("privateCompanies")} <span>· {word("forExperienced")}</span>
              </>
            }
            note={
              <>
                {word("privateLine")}
                {valuationAt ? (
                  <span className={styles.sectionNoteLine} data-valuation-at>
                    <LocalClock iso={valuationAt} locale={numberLocale(locale)} prefix={`${word("valuationAt")} `} />
                  </span>
                ) : null}
              </>
            }
            all="private"
            locale={locale}
          />
          <Rows items={privates} locale={locale} shown={overview ? OVERVIEW.private : privates.length} moreLabel={word("showMore")} />
        </section>
      ) : null}
    </>
  );
}

/* ---------------------------------------------------------------- coins */

export type CoinsData = Readonly<{ dollars: readonly ShelfCoin[]; crypto: readonly ShelfCoin[] }>;

function isCoinsData(value: unknown): value is CoinsData {
  return typeof value === "object" && value !== null && isShelfCoins((value as CoinsData).dollars) && isShelfCoins((value as CoinsData).crypto);
}

/** The coins' place: the browser's copy until the live list mounts. */
export function CoinsSlot({ locale, children }: { locale: WorkspaceLocale; children: ReactNode }) {
  const { copy, slot } = useShelfSlot("coins", isCoinsData);
  const shown = copy !== null;
  return (
    <ShelfSlotProvider slot={slot}>
      <div className={styles.slot} data-copy={shown ? "true" : undefined}>
        {shown ? (
          <div className={styles.copy}>
            <CoinsView data={copy} locale={locale} />
          </div>
        ) : null}
        {children}
      </div>
    </ShelfSlotProvider>
  );
}

export function CoinsSkeleton({ locale }: { locale: WorkspaceLocale }) {
  const word = investWords(locale);
  const { tab } = useTab();
  return (
    <div className={styles.fallback}>
      {inTab(tab, "crypto") ? (
        <section className={styles.section} aria-label={word("crypto")} data-section="crypto">
          <SectionHead id="crypto-skeleton-title" title={word("crypto")} locale={locale} />
          <RowSkeleton count={tab === "all" ? OVERVIEW.crypto : CRYPTO_SHOWN} />
        </section>
      ) : null}
      {inTab(tab, "dollars") ? (
        <section className={styles.section} aria-label={word("dollars")} data-section="dollars">
          <SectionHead id="dollars-skeleton-title" title={word("dollars")} locale={locale} />
          <RowSkeleton count={2} />
        </section>
      ) : null}
    </div>
  );
}

export function CoinSections({ data, locale }: { data: CoinsData; locale: WorkspaceLocale }) {
  useLiveShelf();
  useEffect(() => {
    saveShelfCopy("coins", data);
  }, [data]);
  return (
    <div className={styles.live}>
      <CoinsView data={data} locale={locale} />
    </div>
  );
}

export function CoinsFailed({ locale }: { locale: WorkspaceLocale }) {
  const word = investWords(locale);
  const { tab } = useTab();
  useFailedShelf();
  if (!inTab(tab, "crypto") && !inTab(tab, "dollars")) return null;
  return (
    <div className={styles.fallback}>
      <section className={styles.section} aria-label={word("crypto")} data-section="crypto">
        <div className={styles.status} role="status">
          <p>{word("coinsDown")}</p>
        </div>
      </section>
    </div>
  );
}

function CoinsView({ data, locale }: { data: CoinsData; locale: WorkspaceLocale }) {
  const word = investWords(locale);
  const { tab } = useTab();
  const [shown, setShown] = useState(CRYPTO_SHOWN * 3);
  const dollars = useMemo(() => data.dollars.map(coinItem), [data.dollars]);
  const crypto = useMemo(() => data.crypto.map(coinItem), [data.crypto]);
  const overview = tab === "all";
  return (
    <>
      {inTab(tab, "crypto") && crypto.length > 0 ? (
        <section className={styles.section} aria-labelledby="crypto-title" data-section="crypto">
          <SectionHead id="crypto-title" title={word("crypto")} note={word("byVolume")} all="crypto" locale={locale} />
          <Rows items={crypto} locale={locale} shown={overview ? OVERVIEW.crypto : shown} onMore={overview ? undefined : () => setShown((count) => count + CRYPTO_SHOWN * 3)} moreLabel={word("showMore")} />
        </section>
      ) : null}
      {inTab(tab, "dollars") && dollars.length > 0 ? (
        <section className={styles.section} aria-labelledby="dollars-title" data-section="dollars">
          <SectionHead id="dollars-title" title={word("dollars")} note={word("dollarsLine")} all="dollars" locale={locale} />
          <Rows items={dollars} locale={locale} shown={dollars.length} moreLabel={word("showMore")} />
        </section>
      ) : null}
    </>
  );
}

/* ---------------------------------------------------------------- memes */

export type MemesData = Readonly<{ memes: readonly ShelfCoin[] }>;

function isMemesData(value: unknown): value is MemesData {
  return typeof value === "object" && value !== null && isShelfCoins((value as MemesData).memes);
}

/** The memes' place: the browser's copy until the live list mounts. */
export function MemesSlot({ locale, children }: { locale: WorkspaceLocale; children: ReactNode }) {
  const { copy, slot } = useShelfSlot("memes", isMemesData);
  const shown = copy !== null;
  return (
    <ShelfSlotProvider slot={slot}>
      <div className={styles.slot} data-copy={shown ? "true" : undefined}>
        {shown ? (
          <div className={styles.copy}>
            <MemesView data={copy} locale={locale} />
          </div>
        ) : null}
        {children}
      </div>
    </ShelfSlotProvider>
  );
}

export function MemesSkeleton({ locale }: { locale: WorkspaceLocale }) {
  const word = investWords(locale);
  const { tab } = useTab();
  if (!inTab(tab, "memes")) return <div className={styles.fallback} />;
  return (
    <div className={styles.fallback}>
      <section className={styles.section} aria-label={word("memes")} data-section="memes">
        <SectionHead id="memes-skeleton-title" title={word("memes")} note={word("memesRisk")} locale={locale} />
        <RowSkeleton count={3} />
      </section>
    </div>
  );
}

export function MemeSections({ data, locale }: { data: MemesData; locale: WorkspaceLocale }) {
  useLiveShelf();
  useEffect(() => {
    saveShelfCopy("memes", data);
  }, [data]);
  return (
    <div className={styles.live}>
      <MemesView data={data} locale={locale} />
    </div>
  );
}

export function MemesFailed({ locale }: { locale: WorkspaceLocale }) {
  const word = investWords(locale);
  const { tab } = useTab();
  useFailedShelf();
  if (tab !== "memes") return null;
  return (
    <div className={styles.fallback}>
      <section className={styles.section} aria-label={word("memes")} data-section="memes">
        <div className={styles.status} role="status">
          <p>{word("memesDown")}</p>
        </div>
      </section>
    </div>
  );
}

function MemesView({ data, locale }: { data: MemesData; locale: WorkspaceLocale }) {
  const word = investWords(locale);
  const { tab } = useTab();
  const [shown, setShown] = useState(CRYPTO_SHOWN * 3);
  const memes = useMemo(() => data.memes.map(coinItem), [data.memes]);
  const overview = tab === "all";
  if (!inTab(tab, "memes") || memes.length === 0) return null;
  return (
    <section className={styles.section} aria-labelledby="memes-title" data-section="memes">
      {/* The risk before a single figure (canon §3, v5.4 В33). */}
      <SectionHead id="memes-title" title={word("memes")} note={word("memesRisk")} all="memes" locale={locale} />
      <Rows items={memes} locale={locale} shown={overview ? OVERVIEW.memes : shown} onMore={overview ? undefined : () => setShown((count) => count + CRYPTO_SHOWN * 3)} moreLabel={word("showMore")} />
    </section>
  );
}
