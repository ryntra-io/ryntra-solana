"use client";

import { Block, Button, HeroNumber, Icon, Page, Skeleton, Table, type TableColumn } from "@ryntra/core/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from "react";

import { fundingNeed, fundsOf } from "@/app/app/invest/funding-model";
import { numberLocale } from "@/app/app/invest/invest-words";
import { usePortfolioRisk } from "@/app/app/invest/use-portfolio-risk";
import { useWalletReach } from "@/app/app/invest/use-wallet-reach";
import { formatMoneyShort } from "@/app/app/launch/launch-format";
import { readSearchIndex } from "@/app/app/search/search-index";
import type { PortfolioValue, ValuePart } from "@/app/app/portfolio-value";
import { usePortfolioValue } from "@/app/app/use-portfolio-value";
import { useWalletData } from "@/app/app/wallet-data";
import { holdingValue, usdValueIn, type WalletHolding } from "@/app/app/wallet-view-model";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { useSolanaConnection } from "@/app/solana/workspace/connection";
import { futuresWord, type FuturesWordKey } from "@/app/solana/workspace/futures/futures-words";
import { actionStateWord, describeAction } from "@/app/solana/workspace/history/history-lines";
import { useSolanaI18n } from "@/app/solana/workspace/i18n/provider";
import { MarketIcon } from "@/app/solana/workspace/spot/market-list";
import { formatAmount, formatPercent, formatPrice, formatUsdPrice, toneOf } from "@/app/solana/workspace/spot/spot-format";
import type { LimitOrdersRead } from "@/app/solana/workspace/spot/use-limit-orders";
import type { LaunchMarketsResponse } from "@/lib/api/v1/contract";
import { riskStateWord } from "@/lib/monitoring/risk-words";
import type { SolanaWalletAction } from "@/lib/solana/action-ledger";
import type { LimitOrderState } from "@/lib/solana/limits/store.server";
import type { SearchIndex } from "@/lib/search/product-search";
import { isWatched, shortEventLine } from "@/lib/stocks/conversion-watch";
import { lifecycleEventFor } from "@/lib/stocks/lifecycle-events";
import { isRetiredMint, RETIRED_WORDS } from "@/lib/stocks/retired";
import { companyFromTokenName } from "@/lib/stocks/shelf";

import {
  assetRows,
  attentionItems,
  dayChangeOf,
  HOME_ACTION_HREF,
  homeAction,
  homeRows,
  launchLines,
  MARKET_ROWS,
  MARKET_ROWS_PHONE,
  MARKET_TABS,
  marketRows,
  ORDER_ROWS,
  ordersView,
  recentOperations,
  type AssetRow,
  type HomeAction,
  type HomePosition,
  type HomeRow,
  type LaunchLine,
  type MarketRow,
  type MarketTab,
  type OrdersNote,
} from "./home-model";
import home from "./home.module.css";
import { homeWords, type HomeWords } from "./home-words";
import { PortfolioRisk } from "./portfolio-risk";
import { MarketEvents } from "../markets/events/market-events";
import { Pulse } from "./pulse";

/**
 * Home 2 (B2b, огляд B13 п. 2): a working overview, never a sentence and a door.
 *
 * A guest meets the market — «Ринки зараз» (Акції · Крипта · Меми, eight rows
 * by the day's volume, and the day's movers) and Pulse open under it in the
 * main column: one list of markets and Pulse (SOL-C5); beside them «Почни за
 * три кроки», and «Лаунчі на Ryntra» once people have launched — an empty block
 * is not drawn (аудит UX 21.10: UX-103, UX-104). The page's one orange action is
 * «Підключити гаманець», pinned to the foot of a phone. A browser that
 * remembers a wallet sees the wallet's shape instead of the steps for the
 * moment the wallet takes to come back (the boot script marks it before paint).
 *
 * A wallet meets its money: «Вартість портфеля» — wallet, pools and orders by
 * the one rule Portfolio draws (`portfolio-value.ts`) — with its four quick
 * actions, «Мої активи» and «Останні операції» from the server's history; beside
 * them «Потребує уваги» and «Відкриті ордери»; «Ринки зараз» and Pulse below.
 * The one orange action is the step that works next: «Поповнити» while there
 * are no dollars, «Поповнити SOL» while there is nothing for the network,
 * «Торгувати» after. Under «Деталі» stays only the portfolio's full risk check.
 */

const WRAPPED_SOL = "So11111111111111111111111111111111111111112";
/** How long a remembered wallet is waited for before the guest's Home is drawn. */
const RESTORE_WAIT_MS = 2_000;
/** Pulse's rows on Home before «Показати ще»: six on a desk, five on a phone. */
const PULSE_ROWS = 6;
const PULSE_ROWS_PHONE = 5;
/** «Події ринку» on Home: the newest five on a desk, four on a phone. */
const EVENTS_ROWS = 5;
const EVENTS_ROWS_PHONE = 4;

/** A desk or a tablet (true) or a phone: the columns and rows a table keeps are chosen by the width, not hidden by CSS. */
function useWide(): boolean {
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 600px)");
    const update = () => setWide(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return wide;
}

/** The market index (`/api/search`), the lists Markets draws — read once per visit and shared with the search. */
function useMarketIndex(): Readonly<{ status: "loading" | "ready" | "failed"; index: (SearchIndex & { readAt?: string }) | null; retry: () => void }> {
  const [state, setState] = useState<{ status: "loading" | "ready" | "failed"; index: (SearchIndex & { readAt?: string }) | null }>({ status: "loading", index: null });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    void readSearchIndex().then((index) => {
      if (live) setState(index ? { status: "ready", index } : { status: "failed", index: null });
    });
    return () => {
      live = false;
    };
  }, [attempt]);
  return {
    ...state,
    retry: () => {
      setState({ status: "loading", index: null });
      setAttempt((value) => value + 1);
    },
  };
}

/** When, in the few characters a table cell has: the hour for today, the day before that. */
function shortMoment(at: Date, locale: WorkspaceLocale): string {
  const tag = locale === "uk" ? "uk-UA" : "en-US";
  const today = new Date().toDateString() === at.toDateString();
  return new Intl.DateTimeFormat(tag, today ? { hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "short" }).format(at);
}

function sourceLine(readAt: string | undefined, words: HomeWords, locale: WorkspaceLocale): string | null {
  const at = readAt ? new Date(readAt) : null;
  return at && !Number.isNaN(at.getTime()) ? words.source(shortMoment(at, locale)) : null;
}

export function HomeSurface({ locale }: { locale: WorkspaceLocale }) {
  const { connection } = useSolanaConnection();
  if (connection) return <WalletHome locale={locale} owner={connection.address} />;
  return <GuestHome locale={locale} />;
}

/* -------------------------------------------------------------- guest -- */

function GuestHome({ locale }: { locale: WorkspaceLocale }) {
  const words = homeWords(locale);
  const lang = locale === "uk" ? "uk" : "en";
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(true), RESTORE_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, []);
  /* A phone's browser without a wallet: the one way in is this page inside Phantom. */
  const { openInWallet, reach } = useWalletReach();
  const wide = useWide();
  const door = openInWallet ? words.openInPhantom : words.connectWallet;
  const settledMark = settled ? "true" : undefined;
  return (
    <Page
      kind="overview"
      title={words.title}
      help={words.help}
      lang={lang}
      className={home.page}
      action={
        <Button variant="primary" icon="wallet" onClick={reach} lang={lang} className={home.guest} data-settled={settledMark} data-home-action="connect">
          {door}
        </Button>
      }
      /* The side column on a desk; below 1280 px the launches stand in the main column instead, after Pulse — a block that
         appears once read never pushes the feed down. */
      aside={
        <>
          <StartSteps words={words} lang={lang} settled={settled} className={home.deskOnly} />
          <LaunchesBlock locale={locale} className={home.deskOnly} />
        </>
      }
    >
      <StartStrip words={words} settled={settled} className={home.narrowOnly} />
      <div className={home.pending} data-settled={settledMark} aria-hidden="true">
        <Skeleton hero lines={3} label={words.loading} />
      </div>
      <MarketsNow locale={locale} />
      <Pulse locale={locale} rows={wide ? PULSE_ROWS : PULSE_ROWS_PHONE} />
      {/* «Події ринку» (DSC-1) where Pulse is: the newest few, and the way to the whole feed in «Ринки». */}
      <MarketEvents locale={locale} place="home" rows={wide ? EVENTS_ROWS : EVENTS_ROWS_PHONE} />
      <LaunchesBlock locale={locale} className={home.narrowOnly} />
    </Page>
  );
}

/** «Почни за три кроки»: the first step is the one to take — the page's own action is its door — the next two grey until it is done. */
function StartSteps({ words, lang, settled, className }: { words: HomeWords; lang: "en" | "uk"; settled: boolean; className: string }) {
  return (
    <Block title={words.stepsTitle} titleAs="h2" icon="target" lang={lang} className={`${className} ${home.guest}`} data-settled={settled ? "true" : undefined} data-home="steps">
      <ol className={home.steps}>
        {words.steps.map((step, index) => (
          <li key={step} className={home.step} data-current={index === 0 ? "true" : undefined}>
            <span className={home.stepDot} aria-hidden="true">
              {index + 1}
            </span>
            <span className={home.stepText}>{step}</span>
          </li>
        ))}
      </ol>
    </Block>
  );
}

/** The steps on a phone and a tablet: three dots and the step that is next, in one line — the door is the pinned action. */
function StartStrip({ words, settled, className }: { words: HomeWords; settled: boolean; className: string }) {
  return (
    <section className={`${className} ${home.guest} ${home.strip}`} data-settled={settled ? "true" : undefined} aria-label={words.stepsTitle} data-home="steps-strip">
      <span className={home.stripDots} aria-hidden="true">
        <span data-current="true" />
        <span />
        <span />
      </span>
      <span className={home.stripText}>
        <b>{words.stepsTitle}</b> · {words.steps[0]}
      </span>
    </section>
  );
}

/** A quiet link at the foot of a block: the block's one action, never orange. */
function BlockLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link className="ryntra-button ryntra-button--secondary" href={href} prefetch={false}>
      <span className="ryntra-button__label">{children}</span>
    </Link>
  );
}

function RetryButton({ label, onRetry, lang }: { label: string; onRetry: () => void; lang: "en" | "uk" }) {
  return (
    <Button variant="secondary" onClick={onRetry} lang={lang}>
      {label}
    </Button>
  );
}

/** A block's foot: its one action, and where its figures came from and when. */
function BlockFoot({ action, source }: { action: ReactNode; source: string | null }) {
  return (
    <div className={home.foot}>
      {action}
      {source ? <span className={home.source}>{source}</span> : null}
    </div>
  );
}

function AssetCell({ name, symbol, mint, icon, sub }: { name: string; symbol: string; mint: string; icon: string | null; sub?: ReactNode }) {
  return (
    <span className={home.asset}>
      <MarketIcon mint={mint} icon={icon} symbol={symbol} size={24} />
      <span className={home.cell}>
        <b className={`${home.cellMain} ${home.assetName}`} translate="no">
          {name}
        </b>
        <span className={home.cellSub} translate="no">
          {sub ?? symbol}
        </span>
      </span>
    </span>
  );
}

function Change({ value, numbers }: { value: number | null; numbers: string }) {
  return (
    <span className={home.change} data-tone={toneOf(value)}>
      {formatPercent(value, numbers)}
    </span>
  );
}

/** «Ринки зараз»: one of the three lists Markets draws or the day's movers, eight rows on a desk and five on a phone, each opening its market. */
function MarketsNow({ locale }: { locale: WorkspaceLocale }) {
  const words = homeWords(locale);
  const lang = locale === "uk" ? "uk" : "en";
  const numbers = numberLocale(locale);
  const router = useRouter();
  const wide = useWide();
  const market = useMarketIndex();
  /* Until the person picks a list, the first one that has markets: a list whose source is quiet never greets them empty. */
  const [chosen, setTab] = useState<MarketTab | null>(null);
  const tab = chosen ?? (market.index ? (MARKET_TABS.find((id) => marketRows(market.index as SearchIndex, id, 1).length > 0) ?? "stocks") : "stocks");
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const rows = useMemo(() => (market.index ? marketRows(market.index, tab, wide ? MARKET_ROWS : MARKET_ROWS_PHONE) : []), [market.index, tab, wide]);

  const columns: TableColumn<MarketRow>[] = [
    { key: "asset", label: words.asset, render: (row) => <AssetCell name={row.name} symbol={row.symbol} mint={row.mint} icon={row.icon} /> },
    { key: "price", label: words.price, numeric: true, render: (row) => formatUsdPrice(row.price, numbers) },
    { key: "day", label: words.day, numeric: true, render: (row) => <Change value={row.change24h} numbers={numbers} /> },
    ...(wide ? [{ key: "volume", label: words.volume, numeric: true, render: (row: MarketRow) => formatMoneyShort(row.volume24h, locale, true, "") }] : []),
  ];

  const onKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = (index + step + MARKET_TABS.length) % MARKET_TABS.length;
    setTab(MARKET_TABS[next] as MarketTab);
    tabs.current[next]?.focus();
  };

  return (
    <Block
      title={words.marketsTitle}
      titleAs="h2"
      icon="chart-line"
      lang={lang}
      data-home="markets"
      action={
        market.status === "failed" ? (
          <RetryButton label={words.retry} onRetry={market.retry} lang={lang} />
        ) : (
          <BlockFoot action={<BlockLink href={tab === "movers" ? "/app/markets" : `/app/markets?tab=${tab}`}>{words.marketsAll}</BlockLink>} source={sourceLine(market.index?.readAt, words, locale)} />
        )
      }
    >
      <div className={home.tabs} role="tablist" aria-label={words.marketsTitle}>
        {MARKET_TABS.map((id, index) => (
          <button
            key={id}
            ref={(node) => {
              tabs.current[index] = node;
            }}
            type="button"
            role="tab"
            className={home.tab}
            aria-selected={tab === id}
            tabIndex={tab === id ? 0 : -1}
            onClick={() => setTab(id)}
            onKeyDown={(event) => onKey(event, index)}
          >
            {words.tabs[id]}
          </button>
        ))}
      </div>
      {market.status === "failed" ? (
        <p className={home.sentence}>{words.marketsUnread}</p>
      ) : (
        <Table
          columns={columns}
          rows={rows}
          rowKey={(row) => row.key}
          caption={`${words.marketsTitle} · ${words.tabs[tab]}`}
          loading={market.status === "loading"}
          skeletonRows={wide ? MARKET_ROWS : MARKET_ROWS_PHONE}
          empty={<p className={home.sentence}>{tab === "movers" ? words.moversQuiet : words.marketsEmpty}</p>}
          onRowClick={(row) => router.push(row.href)}
          rowLabel={(row) => `${row.name} ${row.symbol}`}
          lang={lang}
        />
      )}
    </Block>
  );
}

/* The launches' list, read once for the page: the side column's block and the narrow screen's one share the answer. */
let launchesRead: Promise<readonly LaunchLine[] | null> | null = null;
function readLaunches(): Promise<readonly LaunchLine[] | null> {
  if (!launchesRead) {
    launchesRead = fetch("/api/v1/launch/markets", { headers: { "X-Ryntra-API": "1" }, cache: "no-store" })
      .then(async (response) => (response.ok ? launchLines(((await response.json()) as LaunchMarketsResponse).markets) : null))
      .catch(() => null)
      .then((rows) => {
        if (!rows) launchesRead = null;
        else window.setTimeout(() => (launchesRead = null), 60_000);
        return rows;
      });
  }
  return launchesRead;
}

/**
 * «Лаунчі на Ryntra»: people's launches — the token, its way to the DEX as a bar, its holders. Drawn only once there is
 * one to show (аудит UX 21.10: UX-104): an empty or unread list is no block on Home — «Запустити токен» stays in the
 * menu and on Launch's own page.
 */
function LaunchesBlock({ locale, className }: { locale: WorkspaceLocale; className: string }) {
  const words = homeWords(locale);
  const lang = locale === "uk" ? "uk" : "en";
  const numbers = numberLocale(locale);
  const [rows, setRows] = useState<readonly LaunchLine[]>([]);
  useEffect(() => {
    let live = true;
    void readLaunches().then((read) => {
      if (live) setRows(read ?? []);
    });
    return () => {
      live = false;
    };
  }, []);
  const pct = (value: number) => `${new Intl.NumberFormat(numbers, { maximumFractionDigits: 0 }).format(value)}${locale === "uk" ? " %" : "%"}`;
  if (rows.length === 0) return null;
  return (
    <Block title={words.launchesTitle} titleAs="h2" icon="chart-column" lang={lang} className={className} data-home="launches" action={<BlockLink href="/app/launch/markets">{words.launchesAll}</BlockLink>}>
      <ul className={home.launches}>
        {rows.map((row) => (
          <li key={row.key}>
            <Link href={row.href} prefetch={false} className={home.launch}>
              {/* Letters, not the creator's picture: no check reads a launch's image yet, and this is a guest's first screen. */}
              <MarketIcon mint={row.key} icon={null} symbol={row.symbol} size={28} />
              <span className={home.launchBody}>
                <span className={home.launchHead}>
                  <b className={home.cellMain} translate="no">
                    {row.name}
                  </b>
                  <span className={home.cellSub}>{row.holders === null ? "—" : words.holders(`${row.holdersAtLeast ? "≥ " : ""}${new Intl.NumberFormat(numbers).format(row.holders)}`)}</span>
                </span>
                {row.onDex ? (
                  <span className={home.cellSub}>{words.onDex}</span>
                ) : row.progressPct !== null ? (
                  <span className={home.curve}>
                    <span className={home.curveBar} aria-hidden="true">
                      <span style={{ width: `${Math.max(2, row.progressPct)}%` }} />
                    </span>
                    <span className={home.cellSub}>{words.toDex(pct(row.progressPct))}</span>
                  </span>
                ) : null}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Block>
  );
}

/* ------------------------------------------------------------- wallet -- */

/** What a holding's row says beside its name: a token no longer supported, or its issuer's deadline. */
function positionNote(mint: string, locale: WorkspaceLocale): string | undefined {
  const lang = locale === "uk" ? "uk" : "en";
  if (isRetiredMint(mint)) return RETIRED_WORDS.state[lang];
  const event = lifecycleEventFor(mint);
  return isWatched(event) ? shortEventLine(event, lang, Date.now()) : undefined;
}

type Holding = HomePosition & Readonly<{ symbol: string; mint: string; icon: string | null }>;

function positionOf(holding: WalletHolding, locale: WorkspaceLocale): Holding | null {
  const value = holdingValue(holding);
  if (value === null) return null;
  const mint = holding.kind === "NATIVE_SOL" ? WRAPPED_SOL : holding.mint;
  if (!mint) return null;
  const catalog = holding.catalog ?? null;
  const symbol = holding.kind === "NATIVE_SOL" ? "SOL" : (catalog?.symbol ?? holding.symbol ?? "");
  const stock = catalog?.category === "stock";
  const rawName = catalog?.name ?? holding.name ?? symbol;
  /* A company by its name, a coin by the name people know it by. */
  const name = mint === WRAPPED_SOL ? "Solana" : stock ? companyFromTokenName(rawName) : rawName;
  const change = catalog?.dayChangePct;
  return {
    /* Native SOL and a wrapped-SOL account share the mint: the row's key keeps them apart. */
    key: holding.kind === "NATIVE_SOL" ? "native-sol" : mint,
    name,
    symbol,
    mint,
    icon: catalog?.icon ?? null,
    href: stock && symbol ? `/app/stocks/${encodeURIComponent(symbol)}` : `/app/spot?mint=${encodeURIComponent(mint)}`,
    value,
    change: typeof change === "number" && Number.isFinite(change) ? change : null,
    note: positionNote(mint, locale),
  };
}

function WalletHome({ locale, owner }: { locale: WorkspaceLocale; owner: string }) {
  const words = homeWords(locale);
  const lang = locale === "uk" ? "uk" : "en";
  const { holdings, activity, refresh } = useWalletData();
  const { value, limits, pools, phoenix } = usePortfolioValue(owner);
  /* How near liquidation the Phoenix account is, Phoenix's own tier: beside its collateral whenever it is not «safe». */
  const tier = phoenix.value?.margin?.riskTier ?? null;
  const collateralRisk = tier && tier !== "safe" ? futuresWord(locale === "uk" ? "uk" : "en", `risk.${tier}` as FuturesWordKey) : null;
  const wide = useWide();
  const risk = usePortfolioRisk();
  const riskState = risk.phase === "ready" ? (risk.body?.risk?.state ?? null) : null;
  const [details, setDetails] = useState(false);
  const detailsRef = useRef<HTMLDetailsElement>(null);

  const funds = useMemo(() => (holdings.status === "ready" ? fundsOf(holdings.data, holdings.complete) : null), [holdings]);
  const action = homeAction(funds ? fundingNeed(funds) : "unknown");
  const positions = useMemo(
    () =>
      holdings.status === "ready"
        ? holdings.data
            .map((holding) => positionOf(holding, locale))
            .filter((row): row is Holding => row !== null)
            .sort((a, b) => (a.value > b.value ? -1 : a.value < b.value ? 1 : 0))
        : [],
    [holdings, locale],
  );
  const attention = useMemo(
    () =>
      attentionItems({
        actions: activity.status === "ready" ? activity.data : [],
        orders: limits.status === "ready" ? limits.orders : [],
        pools: pools.status === "ready" ? pools.answer.positions : [],
        risk: riskState,
      }),
    [activity, limits.status, limits.orders, pools, riskState],
  );

  const openDetails = () => {
    const element = detailsRef.current;
    if (!element) return;
    element.open = true;
    setDetails(true);
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    element.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });
    element.querySelector("summary")?.focus({ preventScroll: true });
  };

  /* Nothing is called calm while a read it rests on failed: the block says so instead. */
  const attentionUnread = activity.status === "error" || limits.status === "failed" || pools.status === "failed";
  const attentionBlock = (className: string) => (
    <AttentionBlock locale={locale} items={attention} reading={activity.status === "idle" || activity.status === "loading"} unread={attentionUnread} onRisk={openDetails} className={className} />
  );
  const ordersBlock = (className: string) => <OrdersBlock locale={locale} limits={limits} onRetry={() => limits.reload()} className={className} />;

  return (
    <Page
      kind="overview"
      title={words.title}
      lang={lang}
      className={home.page}
      action={<HomeActionLink action={action} words={words} />}
      aside={
        <>
          {attentionBlock(home.deskOnly)}
          {ordersBlock(home.deskOnly)}
        </>
      }
    >
      <ValueBlock locale={locale} value={value} holdings={holdings.status === "ready" ? holdings.data : []} collateralRisk={collateralRisk} riskState={riskState} onRisk={openDetails} riskOpen={details} onRetry={refresh} />
      {/* On a phone and a tablet what needs the person comes right after the number — and only when something does. */}
      {attention.length > 0 || attentionUnread ? attentionBlock(home.narrowOnly) : null}
      {/* A share of the wallet, as Portfolio counts it — one denominator in both places. */}
      <AssetsBlock locale={locale} positions={positions} total={value.phase === "ready" ? value.parts.wallet : null} status={holdings.status} />
      <RecentBlock locale={locale} actions={activity.status === "ready" ? activity.data : []} status={activity.status} onRetry={refresh} />
      {ordersBlock(home.narrowOnly)}
      {/* One list of markets and Pulse, as a guest's Home (SOL-C5): the day's movers are a list of «Ринки зараз». */}
      <MarketsNow locale={locale} />
      <Pulse locale={locale} rows={wide ? PULSE_ROWS : PULSE_ROWS_PHONE} />
      <MarketEvents locale={locale} place="home" rows={wide ? EVENTS_ROWS : EVENTS_ROWS_PHONE} />
      <Details summary={words.detailsNote} words={words} open={details} onOpenChange={setDetails} detailsRef={detailsRef}>
        <PortfolioRisk locale={locale} place="main" />
      </Details>
    </Page>
  );
}

function HomeActionLink({ action, words }: { action: HomeAction; words: HomeWords }) {
  const label = action === "top-up" ? words.actionTopUp : action === "top-up-sol" ? words.actionTopUpSol : words.actionTrade;
  return (
    <Link className="ryntra-button ryntra-button--primary" href={HOME_ACTION_HREF[action]} data-home-action={action}>
      <span className="ryntra-button__label">{label}</span>
    </Link>
  );
}

/**
 * «Деталі»: folded below the blocks, its content drawn only once opened — the
 * portfolio's full risk check reads only while someone looks at it.
 */
function Details({
  summary,
  words,
  open,
  onOpenChange,
  detailsRef,
  children,
}: {
  summary: string;
  words: HomeWords;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  detailsRef?: Ref<HTMLDetailsElement>;
  children: ReactNode;
}) {
  const [shown, setShown] = useState(false);
  const isOpen = open ?? shown;
  return (
    <details
      ref={detailsRef}
      id="home-details"
      className={home.details}
      data-home="details"
      onToggle={(event) => {
        setShown(event.currentTarget.open);
        onOpenChange?.(event.currentTarget.open);
      }}
    >
      <summary className={home.summary}>
        <Icon name="chevron-right" size={16} className={home.chevron} />
        <span>{words.details}</span>
        <span className={home.summaryNote}>{summary}</span>
      </summary>
      {isOpen ? <div className={home.detailsBody}>{children}</div> : null}
    </details>
  );
}

/* -------------------------------------------------------------- value -- */

/* A balance owed (Phoenix collateral below zero) is said with its sign, never as its absolute. */
const signedUsd = (micro: bigint, locale: WorkspaceLocale): string => (micro < 0n ? `−${usdValueIn(-micro, locale)}` : usdValueIn(micro, locale));

const PARTS: readonly ValuePart[] = ["wallet", "pools", "orders", "collateral"];

/* Collateral is a row where there is some, its read failed, or the tab's first read of it is still on its way (named,
   as pools and orders are, never silently left out); a wallet Phoenix has never seen keeps three rows after that. */
export const partShown = (value: PortfolioValue, part: ValuePart): boolean => part !== "collateral" || value.reads.collateral !== "ready" || (value.parts.collateral ?? 0n) !== 0n;

function ValueBlock({
  locale,
  value,
  holdings,
  collateralRisk,
  riskState,
  onRisk,
  riskOpen,
  onRetry,
}: {
  locale: WorkspaceLocale;
  value: PortfolioValue;
  holdings: readonly WalletHolding[];
  collateralRisk: string | null;
  riskState: string | null;
  onRisk: () => void;
  riskOpen: boolean;
  onRetry: () => void;
}) {
  const words = homeWords(locale);
  const lang = locale === "uk" ? "uk" : "en";
  const numbers = numberLocale(locale);
  /* The wallet's own day: pools and orders carry no day of their own, so the change is the wallet's and says so. */
  const day = useMemo(() => (value.phase === "ready" && value.parts.wallet !== null ? dayChangeOf(holdings, value.parts.wallet) : null), [value, holdings]);
  const beyondWallet = (value.parts.pools ?? 0n) > 0n || (value.parts.orders ?? 0n) > 0n || (value.parts.collateral ?? 0n) > 0n;
  const total = value.total ?? 0n;
  const shown = PARTS.filter((part) => partShown(value, part));
  const notes = [value.unpriced > 0 ? words.unpriced(value.unpriced) : null, value.partial ? words.floor : null].filter(Boolean).join(" · ");
  return (
    <section className={home.value} aria-label={words.value} data-home="value">
      <div className={home.valueHead}>
        <HeroNumber
          label={words.value}
          value={value.phase === "ready" && value.total !== null ? signedUsd(value.total, locale) : "—"}
          change={
            day
              ? {
                  value: `${day.usd >= 0 ? "+" : "−"}${usdValueIn(BigInt(Math.round(Math.abs(day.usd) * 1_000_000)), locale)} · ${formatPercent(day.pct, numbers)} ${beyondWallet ? words.dayChangeWallet : words.dayChange}`,
                  direction: day.usd > 0 ? "up" : day.usd < 0 ? "down" : "flat",
                }
              : undefined
          }
          href="/app/portfolio"
          loading={value.phase === "loading"}
          unavailable={value.reason === "unread" ? words.valueUnread : value.reason === "partial" ? words.valuePartial : value.reason === "unpriced" ? words.valueUnpriced : undefined}
          note={notes || undefined}
          lang={lang}
        />
        {/* No number because the wallet was not read, or not whole: it can be asked again right here. */}
        {value.reason === "unread" || value.reason === "partial" ? <RetryButton label={words.retry} onRetry={onRetry} lang={lang} /> : null}
        {/* Beside the number, not inside its link: the verdict opens «Деталі», the number opens Portfolio. */}
        {riskState ? (
          <button type="button" className={home.riskNote} data-risk={riskState} onClick={onRisk} aria-controls="home-details" aria-expanded={riskOpen}>
            {words.riskLine} · {riskStateWord(riskState as Parameters<typeof riskStateWord>[0], lang)}
          </button>
        ) : null}
      </div>
      {/* The parts stand under the number, and under a dash too: what was read is said, a wallet read in part as «≥». */}
      {value.phase !== "loading" ? (
        <div className={home.parts}>
          {value.phase === "ready" ? (
            <div className={home.partsBar} role="img" aria-label={shown.map((part) => `${words.parts[part]} ${value.parts[part] === null ? "—" : signedUsd(value.parts[part] as bigint, locale)}`).join(", ")}>
              {PARTS.map((part) => {
                const amount = value.parts[part];
                return amount && amount > 0n && total > 0n ? <span key={part} data-part={part} style={{ flexGrow: Number(amount) }} /> : null;
              })}
            </div>
          ) : null}
          <dl className={home.partsList}>
            {shown.map((part) => (
              <div key={part} className={home.part} data-part={part}>
                <dt>
                  <span className={home.partDot} data-part={part} aria-hidden="true" />
                  {/* Collateral is taken back where it was put: «Perps», where «Your Phoenix account» and its margin are. */}
                  {part === "collateral" && value.reads.collateral === "ready" ? (
                    <Link className={home.partLink} href="/app/perps" prefetch={false}>
                      {words.parts[part]}
                    </Link>
                  ) : (
                    words.parts[part]
                  )}
                </dt>
                <dd translate="no">
                  {value.reads[part] === "loading"
                    ? words.partReading
                    : value.reads[part] === "failed"
                      ? words.partUnread
                      : part === "wallet" && value.reason === "unpriced"
                        ? "—"
                        : `${part === "wallet" && value.reason === "partial" ? "≥ " : ""}${signedUsd(value.parts[part] ?? 0n, locale)}`}
                  {part === "collateral" && collateralRisk ? (
                    <span className={home.partRisk} data-home="collateral-risk">
                      {" · "}
                      {collateralRisk}
                    </span>
                  ) : null}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
      <nav className={home.quick} aria-label={words.value}>
        <BlockLink href="/app/top-up">{words.quick.topUp}</BlockLink>
        <BlockLink href="/app/send">{words.quick.send}</BlockLink>
        <BlockLink href="/app/receive">{words.quick.receive}</BlockLink>
        <BlockLink href="/app/swap">{words.quick.swap}</BlockLink>
      </nav>
    </section>
  );
}

/* ------------------------------------------------------------- assets -- */

function AssetsBlock({
  locale,
  positions,
  total,
  status,
}: {
  locale: WorkspaceLocale;
  positions: readonly Holding[];
  total: bigint | null;
  status: "idle" | "loading" | "ready" | "error";
}) {
  const words = homeWords(locale);
  const lang = locale === "uk" ? "uk" : "en";
  const numbers = numberLocale(locale);
  const router = useRouter();
  const wide = useWide();
  const rows = useMemo(() => assetRows(positions, total, wide ? 5 : 3) as readonly (AssetRow & Holding)[], [positions, total, wide]);
  const percent = new Intl.NumberFormat(numbers, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const columns: TableColumn<AssetRow & Holding>[] = [
    { key: "asset", label: words.asset, render: (row) => <AssetCell name={row.name} symbol={row.symbol} mint={row.mint} icon={row.icon} sub={row.note ?? row.symbol} /> },
    { key: "worth", label: words.worth, numeric: true, render: (row) => usdValueIn(row.value, locale) },
    { key: "day", label: words.day, numeric: true, render: (row) => <Change value={row.change} numbers={numbers} /> },
    /* A share only of a wallet read whole: no column of dashes when there is nothing to share. */
    ...(wide && total !== null ? [{ key: "share", label: words.share, numeric: true, render: (row: AssetRow & Holding) => (row.sharePct === null ? "—" : `${percent.format(row.sharePct)}${locale === "uk" ? " %" : "%"}`) }] : []),
  ];
  return (
    <Block
      title={words.assetsTitle}
      titleAs="h2"
      icon="chart-pie"
      lang={lang}
      loading={status === "idle" || status === "loading"}
      data-home="assets"
      /* The wallet's read is asked again beside the number above: one «Спробувати ще» for one read. */
      action={status === "error" ? undefined : rows.length > 0 ? <BlockLink href="/app/portfolio">{words.assetsAll}</BlockLink> : undefined}
    >
      {status === "error" ? (
        <p className={home.sentence}>{words.assetsUnread}</p>
      ) : rows.length > 0 ? (
        <Table columns={columns} rows={rows} rowKey={(row) => row.key} caption={words.assetsTitle} onRowClick={(row) => router.push(row.href)} rowLabel={(row) => row.name} lang={lang} />
      ) : (
        <p className={home.sentence}>{words.assetsNone}</p>
      )}
    </Block>
  );
}

/* ------------------------------------------------------------- recent -- */

function RecentBlock({ locale, actions, status, onRetry }: { locale: WorkspaceLocale; actions: readonly SolanaWalletAction[]; status: "idle" | "loading" | "ready" | "error"; onRetry: () => void }) {
  const words = homeWords(locale);
  const lang = locale === "uk" ? "uk" : "en";
  const { text } = useSolanaI18n();
  const router = useRouter();
  const wide = useWide();
  const rows = useMemo(() => recentOperations(actions, wide ? 5 : 3), [actions, wide]);
  const columns: TableColumn<SolanaWalletAction>[] = [
    {
      key: "what",
      label: words.what,
      render: (row) => {
        const lines = describeAction(row, text);
        return (
          <span className={home.cell}>
            <b className={home.cellMain} data-side={lines.side?.toLowerCase()} translate="no">
              {lines.title}
            </b>
            <span className={home.cellSub} translate="no">
              {lines.sub}
            </span>
          </span>
        );
      },
    },
    {
      key: "status",
      label: words.status,
      render: (row) => (
        <span className={home.state} data-outcome={row.outcome}>
          {actionStateWord(row.outcome, text)}
        </span>
      ),
    },
    {
      key: "when",
      label: words.when,
      numeric: true,
      render: (row) => {
        const at = new Date(row.updatedAt);
        return Number.isNaN(at.getTime()) ? "—" : <time dateTime={row.updatedAt}>{shortMoment(at, locale)}</time>;
      },
    },
  ];
  return (
    <Block
      title={words.recentTitle}
      titleAs="h2"
      icon="receipt"
      lang={lang}
      loading={status === "idle" || status === "loading"}
      data-home="recent"
      action={status === "error" ? <RetryButton label={words.retry} onRetry={onRetry} lang={lang} /> : <BlockLink href="/app/activity">{words.recentAll}</BlockLink>}
    >
      {status === "error" ? (
        <p className={home.sentence}>{words.recentUnread}</p>
      ) : rows.length > 0 ? (
        <Table
          columns={columns}
          rows={rows}
          rowKey={(row) => row.actionId}
          caption={words.recentTitle}
          onRowClick={(row) => router.push(`/app/activity?action=${encodeURIComponent(row.actionId)}`)}
          rowLabel={(row) => describeAction(row, text).title}
          lang={lang}
        />
      ) : (
        <p className={home.sentence}>{words.recentNone}</p>
      )}
    </Block>
  );
}

/* ---------------------------------------------------------- attention -- */

function AttentionBlock({
  locale,
  items,
  reading,
  unread,
  onRisk,
  className,
}: {
  locale: WorkspaceLocale;
  items: ReturnType<typeof attentionItems>;
  reading: boolean;
  unread: boolean;
  onRisk: () => void;
  className: string;
}) {
  const words = homeWords(locale);
  const lang = locale === "uk" ? "uk" : "en";
  return (
    <Block title={words.attentionTitle} titleAs="h2" icon="triangle-alert" lang={lang} loading={reading && items.length === 0} className={className} data-home="attention">
      {items.length === 0 && unread ? (
        <p className={home.sentence}>{words.attentionUnread}</p>
      ) : items.length === 0 ? (
        <p className={home.calm}>
          <Icon name="circle-check" size={16} className={home.calmIcon} />
          {words.calm}
        </p>
      ) : (
        <ul className={home.attention}>
          {items.map((item) => (
            <li key={item.kind}>
              {item.kind === "risk" ? (
                <button type="button" className={home.attentionRow} onClick={onRisk} aria-controls="home-details">
                  <span>{words.attention.risk()}</span>
                  <Icon name="chevron-right" size={16} className={home.attentionCaret} />
                </button>
              ) : (
                <Link href={item.href} prefetch={false} className={home.attentionRow} data-attention={item.kind}>
                  <span>{words.attention[item.kind](item.count)}</span>
                  <Icon name="chevron-right" size={16} className={home.attentionCaret} />
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </Block>
  );
}

/* ------------------------------------------------------------- orders -- */

function stateWord(state: LimitOrderState, words: HomeWords): string {
  if (state === "PARTIAL") return words.partFilled;
  if (state === "PLACING") return words.placing;
  if (state === "CANCELLING") return words.cancelling;
  return words.waiting;
}

const NOTE_WORD: Readonly<Record<OrdersNote, "ordersUnread" | "ordersPartial" | "positionsUnread">> = {
  "orders-unread": "ordersUnread",
  "orders-partial": "ordersPartial",
  "positions-unread": "positionsUnread",
};

/** «Відкриті ордери»: how many wait, and the newest three — each opening its market, where «Мої ордери» cancels it. */
function OrdersBlock({ locale, limits, onRetry, className }: { locale: WorkspaceLocale; limits: LimitOrdersRead; onRetry: () => void; className: string }) {
  const words = homeWords(locale);
  const lang = locale === "uk" ? "uk" : "en";
  const numbers = numberLocale(locale);
  const router = useRouter();
  const all = useMemo(() => homeRows(limits.orders, limits.tokens, [], Number.MAX_SAFE_INTEGER), [limits.orders, limits.tokens]);
  const rows = all.slice(0, ORDER_ROWS);
  const view = ordersView(limits, "ready", rows.length);
  const first = rows[0];
  const notes = view.notes.map((note) => (
    <p key={note} className={rows.length > 0 ? home.blockNote : home.sentence}>
      {words[NOTE_WORD[note]]}
    </p>
  ));
  const columns: TableColumn<HomeRow>[] = [
    {
      key: "what",
      label: words.asset,
      render: (row) =>
        row.kind === "order" ? (
          <span className={home.cell}>
            <b className={home.cellMain} data-side={row.side}>
              {row.side === "buy" ? words.buy : words.sell} {row.baseSymbol ?? words.token}
            </b>
            <span className={home.cellSub}>
              {words.limit} · {stateWord(row.state, words)}
            </span>
          </span>
        ) : null,
    },
    {
      key: "amount",
      label: words.amount,
      numeric: true,
      render: (row) =>
        row.kind === "order" ? (
          <span className={home.cell}>
            <b className={home.cellMain}>{row.price === null ? "—" : `${formatPrice(row.price, numbers)} ${row.quoteSymbol ?? ""}`.trim()}</b>
            <span className={home.cellSub}>{row.amount === null ? "—" : `${formatAmount(row.amount, numbers)} ${row.amountSymbol ?? ""}`.trim()}</span>
          </span>
        ) : null,
    },
  ];
  return (
    <Block
      title={all.length > 0 ? `${words.ordersTitle} · ${all.length}` : words.ordersTitle}
      titleAs="h2"
      icon="chart-candlestick"
      lang={lang}
      loading={view.loading}
      className={className}
      data-home="orders"
      action={view.retry ? <RetryButton label={words.retry} onRetry={onRetry} lang={lang} /> : first ? <BlockLink href={first.href}>{words.ordersAll}</BlockLink> : undefined}
    >
      {rows.length > 0 ? (
        <>
          <Table columns={columns} rows={rows} rowKey={(row) => row.key} caption={words.ordersTitle} onRowClick={(row) => router.push(row.href)} lang={lang} />
          {notes}
        </>
      ) : view.notes.length > 0 && !view.notes.every((note) => note === "orders-partial") ? (
        notes
      ) : (
        <>
          <p className={home.sentence}>{words.ordersNone}</p>
          {view.notes.length > 0 ? <p className={home.blockNote}>{words.ordersPartial}</p> : null}
        </>
      )}
    </Block>
  );
}
