"use client";

import { CaretDown, MagnifyingGlass, Star } from "@phosphor-icons/react";
import { Block, Button, EmptyState, Table, type TableColumn } from "@ryntra/core/ui";
import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type HTMLAttributes } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import { useSolanaConnection } from "@/app/solana/workspace/connection";
import { MarketIcon } from "@/app/solana/workspace/spot/market-list";
import { formatPercent, formatUsdCompact, formatUsdPrice, toneOf } from "@/app/solana/workspace/spot/spot-format";
import { useSpotWatchlist } from "@/app/solana/workspace/spot/use-spot-data";
import { useWalletProof } from "@/app/solana/workspace/wallet-proof";
import {
  authorityFlagsShown,
  farFromExchange,
  poolPriceOff,
  isScreenerSort,
  isScreenerTab,
  matchScreener,
  rowsForTab,
  SCREENER_DESK_PX,
  screenerColumns,
  SCREENER_TABS,
  SORT_FIRST_DIRECTION,
  sortScreener,
  type ScreenerColumn,
  type ScreenerRow,
  type ScreenerSort,
  type ScreenerTab,
} from "@/lib/markets/screener";

import { periodTone, periodWord } from "../stocks/stock-model";
import { ReadTime } from "./pools/read-time";
import { MarketEvents } from "./events/market-events";
import { MemeRadar } from "./radar/meme-radar";
import { WalletWatch } from "./wallets/wallet-watch";
import { marketsWords, type MarketsWord } from "./markets-words";
import styles from "./screener.module.css";

const PAGE = 50;
const STORE = "ryntra.markets.screener.v1";

const TAB_WORD: Readonly<Record<ScreenerTab, MarketsWord>> = {
  all: "tabAll",
  memes: "tabMemes",
  events: "tabEvents",
  crypto: "tabCrypto",
  stocks: "tabStocks",
  private: "tabPrivate",
  watchlist: "tabWatchlist",
  wallets: "tabWallets",
};

/* Measured before the first paint, so the columns never jump on a desk; the server's render has no width and draws them all. */
const useBeforePaint = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * The figures the screener's own width has room for — a desk's until the browser says how wide it is.
 *
 * Which figures those are is the pure model's (`lib/markets/screener.ts`): the table's width in, the tab's figures out.
 * Here is only the measuring of that width, which no model can do.
 */
function useRoom(tab: ScreenerTab): [(node: HTMLElement | null) => void, ScreenerColumn[]] {
  const [width, setWidth] = useState<number | null>(null);
  const [node, setNode] = useState<HTMLElement | null>(null);
  useBeforePaint(() => {
    if (!node) return;
    const read = () => setWidth(node.getBoundingClientRect().width);
    read();
    const observer = new ResizeObserver(read);
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  /* Before the browser measures, a desk's table: what the server streams is what a desk keeps. */
  return [setNode, screenerColumns(tab, width ?? SCREENER_DESK_PX)];
}

const COLUMN_WORD: Readonly<Record<ScreenerColumn, MarketsWord>> = {
  price: "colPrice",
  change1h: "col1h",
  change24h: "col24h",
  volume24h: "colVolume",
  liquidity: "colLiquidity",
  marketCap: "colMarketCap",
  age: "colAge",
  top10: "colTop10",
  organic: "colOrganic",
  session: "colSession",
  deviation: "colDeviation",
  premium: "colPremium",
};

/** The sort a column's header sets, where it sets one. */
const COLUMN_SORT: Readonly<Partial<Record<ScreenerColumn, ScreenerSort>>> = {
  price: "price",
  change1h: "change1h",
  change24h: "change24h",
  volume24h: "volume24h",
  liquidity: "liquidity",
  marketCap: "marketCap",
  age: "age",
};

/** The orders the toolbar's one select offers — the first is the day's volume, said as what it is. */
const QUICK: readonly Readonly<{ id: string; word: MarketsWord; sort: ScreenerSort; direction: "asc" | "desc"; coinsOnly?: boolean }>[] = [
  { id: "trending", word: "sortVolume", sort: "volume24h", direction: "desc" },
  { id: "gainers", word: "sortRise", sort: "change24h", direction: "desc" },
  { id: "losers", word: "sortFall", sort: "change24h", direction: "asc" },
  { id: "hour", word: "sortHour", sort: "change1h", direction: "desc", coinsOnly: true },
  { id: "new", word: "sortNew", sort: "age", direction: "asc", coinsOnly: true },
  { id: "liquidity", word: "sortLiquidity", sort: "liquidity", direction: "desc" },
];

type Order = Readonly<{ sort: ScreenerSort; direction: "asc" | "desc" }>;
const DEFAULT_ORDER: Order = { sort: "volume24h", direction: "desc" };

/** The quick order an order is, if it is one — a header's click can make one the list does not name. */
function quickOf(order: Order) {
  return QUICK.find((quick) => quick.sort === order.sort && quick.direction === order.direction);
}

function readStored(): { tab?: ScreenerTab; order?: Order } {
  try {
    const raw = JSON.parse(window.localStorage.getItem(STORE) ?? "null") as { tab?: unknown; sort?: unknown; direction?: unknown } | null;
    if (!raw) return {};
    return {
      tab: isScreenerTab(raw.tab) ? raw.tab : undefined,
      order: isScreenerSort(raw.sort) && (raw.direction === "asc" || raw.direction === "desc") ? { sort: raw.sort, direction: raw.direction } : undefined,
    };
  } catch {
    return {};
  }
}

function writeStored(tab: ScreenerTab, order: Order) {
  try {
    window.localStorage.setItem(STORE, JSON.stringify({ tab, sort: order.sort, direction: order.direction }));
  } catch {
    /* A browser that keeps nothing still draws the table; it just does not remember the choice. */
  }
}

export function MarketsScreener({
  rows,
  locale,
  initialTab,
  down,
  coinsAt,
}: {
  rows: readonly ScreenerRow[];
  locale: WorkspaceLocale;
  initialTab: ScreenerTab;
  down: Readonly<{ coins: boolean; stocks: boolean }>;
  /** When the venue's coin figures were read, and whether that read is older than its cache allows. */
  coinsAt: Readonly<{ at: string; stale: boolean }> | null;
}) {
  const word = marketsWords(locale);
  const lang = locale === "uk" ? "uk" : "en";
  const numberLocale = locale === "uk" ? "uk-UA" : "en-US";
  const [tab, setTab] = useState<ScreenerTab>(initialTab);
  const [order, setOrder] = useState<Order>(DEFAULT_ORDER);
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const { connection } = useSolanaConnection();
  const owner = connection?.address ?? null;
  const proof = useWalletProof();
  const proven = proof.state.status === "proven" && proof.state.address === owner;
  const watchlist = useSpotWatchlist(owner, proven);

  /* The address bar's tab wins; else the one this browser kept, with the order it kept. */
  useEffect(() => {
    const stored = readStored();
    const asked = new URLSearchParams(window.location.search);
    const fromAddress = asked.has("tab") || asked.has("kind") || asked.has("mode");
    if (!fromAddress && stored.tab) setTab(stored.tab);
    if (stored.order) setOrder(stored.order);
  }, []);

  const choose = (next: ScreenerTab) => {
    setTab(next);
    setLimit(PAGE);
    writeStored(next, order);
    const url = new URL(window.location.href);
    url.searchParams.delete("kind");
    url.searchParams.delete("mode");
    if (next === "all") url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  };
  const reorder = (next: Order) => {
    setOrder(next);
    setLimit(PAGE);
    writeStored(tab, next);
  };

  const watched = useMemo(() => new Set(watchlist.mints), [watchlist.mints]);
  const shown = useMemo(() => sortScreener(matchScreener(rowsForTab(rows, tab, watched), query), order.sort, order.direction), [rows, tab, watched, query, order]);
  const [measure, columns] = useRoom(tab);
  /* A phone's row of tabs scrolls: the chosen one is brought into sight, the last («Гаманці») included. */
  const tabsRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const row = tabsRef.current;
    const chosen = row?.querySelector<HTMLElement>(`[data-tab="${tab}"]`);
    if (!row || !chosen || row.scrollWidth <= row.clientWidth) return;
    row.scrollTo({ left: Math.max(0, chosen.offsetLeft - (row.clientWidth - chosen.offsetWidth) / 2) });
  }, [tab]);
  const coinsTab = tab === "memes" || tab === "crypto" || tab === "all" || tab === "watchlist";
  const quick = quickOf(order);
  const quickShown = quick && (!quick.coinsOnly || coinsTab) ? quick : undefined;

  const counts = useMemo(() => {
    const result = {} as Record<ScreenerTab, number>;
    for (const id of SCREENER_TABS) result[id] = rowsForTab(rows, id, watched).length;
    return result;
  }, [rows, watched]);

  /* «Меми» is Market Radar's meme mode (SOL-R1): its own six feeds, read live in the browser, not this table. */
  const radar = tab === "memes";
  /* «Гаманці» (SOL-R4): the wallets the person follows, their trades and results from the chain — no table of assets, no order, no search. */
  const wallets = tab === "wallets";
  /* «Події» (DSC-1): one feed of market events beside the Radar — its own order (the newest first), the search over its tokens. */
  const events = tab === "events";
  const unavailable = (down.coins && tab === "crypto") || (down.stocks && (tab === "stocks" || tab === "private")) || (down.coins && down.stocks);

  /*
   * The core's table draws and announces the order; the screener keeps deciding it (`sortScreener`: its own nulls, its
   * own first direction per column). Each row's sort value is its place in that order, signed so the table's own
   * direction gives the same order back — the table never re-sorts what the screener sorted.
   */
  const place = new Map(shown.map((row, index) => [row.mint, index]));
  const sortValue = (row: ScreenerRow) => (order.direction === "asc" ? (place.get(row.mint) ?? 0) : -(place.get(row.mint) ?? 0));
  const tableColumns: TableColumn<ScreenerRow>[] = [
    {
      key: "name",
      label: word("colAsset"),
      sortable: true,
      sortValue,
      render: (row) => <AssetCell row={row} locale={locale} />,
    },
    ...columns.map(
      (column): TableColumn<ScreenerRow> => ({
        key: COLUMN_SORT[column] ?? column,
        label:
          column === "premium" || column === "deviation" ? (
            <span title={column === "premium" ? word("premiumNote") : word("deviationNote")}>{word(COLUMN_WORD[column])}</span>
          ) : (
            word(COLUMN_WORD[column])
          ),
        numeric: true,
        sortable: Boolean(COLUMN_SORT[column]),
        sortValue,
        render: (row) => (
          <span data-col={column} translate="no">
            {cellOf(row, column, locale, numberLocale)}
          </span>
        ),
      }),
    ),
    {
      key: "star",
      label: <span className={styles.srOnly}>{word("tabWatchlist")}</span>,
      render: (row) => {
        const starred = watched.has(row.mint);
        return (
          <button
            type="button"
            data-dense=""
            className={styles.star}
            aria-pressed={starred}
            aria-label={`${starred ? word("unstar") : word("star")}: ${row.symbol}`}
            title={starred ? word("unstar") : word("star")}
            onClick={() => watchlist.toggle(row.mint)}
          >
            <Star size={15} weight={starred ? "fill" : "regular"} aria-hidden="true" />
          </button>
        );
      },
    },
  ];

  return (
    <section className={styles.screener} aria-label={word("title")} ref={measure}>
      <div className={styles.toolbar}>
        <div className={styles.tabs} role="group" aria-label={word("tabs")} ref={tabsRef}>
          {SCREENER_TABS.map((id) => (
            <button
              key={id}
              type="button"
              className={styles.tab}
              aria-pressed={tab === id}
              data-tab={id}
              onClick={() => choose(id)}
            >
              {id === "watchlist" ? <Star size={14} weight={tab === id ? "fill" : "bold"} aria-hidden="true" /> : null}
              <span>{word(TAB_WORD[id])}</span>
              {id === "watchlist" && counts.watchlist > 0 ? <span className={styles.tabCount}>{counts.watchlist}</span> : null}
            </button>
          ))}
        </div>
        {radar || wallets || events ? null : (
          <label className={styles.sort}>
            <span className={styles.sortWord}>{word("sortBy")}</span>
            <select
              value={quickShown?.id ?? ""}
              onChange={(event) => {
                const quick = QUICK.find((item) => item.id === event.target.value);
                if (quick) reorder({ sort: quick.sort, direction: quick.direction });
              }}
            >
              {quickShown ? null : (
                <option value="" disabled>
                  {word("sortColumn")}
                </option>
              )}
              {QUICK.filter((quick) => !quick.coinsOnly || coinsTab).map((quick) => (
                <option key={quick.id} value={quick.id}>
                  {word(quick.word)}
                </option>
              ))}
            </select>
            <CaretDown size={14} weight="bold" aria-hidden="true" />
          </label>
        )}
        {wallets ? null : (
          <label className={styles.search}>
            <MagnifyingGlass size={16} weight="bold" aria-hidden="true" />
            <span className={styles.srOnly}>{word("searchLabel")}</span>
            <input
              type="search"
              value={query}
              placeholder={word("search")}
              onChange={(event) => {
                setQuery(event.target.value);
                setLimit(PAGE);
              }}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
        )}
      </div>

      {tab === "private" ? <p className={styles.note} data-note="private">{word("privateLine")}</p> : null}
      {tab === "memes" ? <p className={styles.note} data-note="memes">{word("memesRisk")}</p> : null}

      {radar ? (
        <MemeRadar locale={locale} query={query} watched={watchlist.mints} onToggleWatch={watchlist.toggle} />
      ) : events ? (
        <MarketEvents locale={locale} query={query} />
      ) : wallets ? (
        <WalletWatch locale={locale} />
      ) : unavailable ? (
        <EmptyState
          icon="circle-x"
          role="status"
          text={down.coins && down.stocks ? word("allDown") : tab === "stocks" || tab === "private" ? word("stocksDown") : word("coinsDown")}
          action={
            <Button variant="secondary" onClick={() => window.location.reload()} lang={lang}>
              {word("reload")}
            </Button>
          }
        />
      ) : shown.length === 0 ? (
        <EmptyState icon={tab === "watchlist" ? "target" : "search"} role="status" text={tab === "watchlist" && !query ? word("emptyWatchlist") : query ? word("emptySearch") : word("empty")} />
      ) : (
        <Block title={word(TAB_WORD[tab])} titleAs="h2" icon="chart-column" lang={lang} className={styles.tableBlock}>
          <Table
            id="markets-table"
            className={styles.table}
            data-tab={tab}
            caption={word("title")}
            columns={tableColumns}
            rows={shown.slice(0, limit)}
            rowKey={(row) => row.mint}
            rowProps={(row) => ({ "data-kind": row.kind }) as HTMLAttributes<HTMLTableRowElement>}
            sort={{ key: order.sort, direction: order.direction }}
            onSortChange={(next) => {
              if (!isScreenerSort(next.key)) return;
              reorder(next.key === order.sort ? { sort: next.key, direction: order.direction === "asc" ? "desc" : "asc" } : { sort: next.key, direction: next.key === "name" ? "asc" : SORT_FIRST_DIRECTION[next.key] });
            }}
            lang={lang}
          />
          <div className={styles.foot}>
            <span className={styles.footCount}>
              {Math.min(limit, shown.length)} {word("of")} {shown.length} {word("shown")}
            </span>
            {shown.length > limit ? (
              <Button variant="secondary" onClick={() => setLimit((value) => value + PAGE)} lang={lang}>
                {word("showMore")}
              </Button>
            ) : null}
            <span className={styles.sources}>
              {word("sources")}
              {coinsAt ? (
                <>
                  {" · "}
                  <span data-stale={coinsAt.stale || undefined}>
                    {coinsAt.stale ? word("coinsStaleAt") : word("coinsAt")} <ReadTime at={coinsAt.at} locale={numberLocale} />
                  </span>
                </>
              ) : null}
            </span>
          </div>
        </Block>
      )}
    </section>
  );
}

function ageText(days: number | null, word: (key: MarketsWord) => string, numberLocale: string): string {
  if (days === null) return "—";
  if (days < 1) return word("underDay");
  const format = (value: number) => new Intl.NumberFormat(numberLocale, { maximumFractionDigits: 0 }).format(value);
  if (days < 60) return `${format(days)} ${word("days")}`;
  if (days < 730) return `${format(Math.floor(days / 30))} ${word("months")}`;
  return `${format(Math.floor(days / 365))} ${word("years")}`;
}

function organicText(label: string | null, word: (key: MarketsWord) => string): string {
  if (label === "high") return word("organicHigh");
  if (label === "medium") return word("organicMedium");
  if (label === "low") return word("organicLow");
  return "—";
}

/** A figure of a row, in the reader's own number format; a change in its direction's reading shade — the sign says it too. */
function cellOf(row: ScreenerRow, column: ScreenerColumn, locale: WorkspaceLocale, numberLocale: string) {
  const word = marketsWords(locale);
  switch (column) {
    /* A stock token priced by its pool alone: its price and moves in the quiet shade, never a gain's green (UX-155). */
    case "price":
      return poolPriceOff(row) ? <span data-tone="flat">{formatUsdPrice(row.price, numberLocale)}</span> : formatUsdPrice(row.price, numberLocale);
    case "change1h":
      return <span data-tone={poolPriceOff(row) ? "flat" : toneOf(row.change1h)}>{formatPercent(row.change1h, numberLocale)}</span>;
    case "change24h":
      return <span data-tone={poolPriceOff(row) ? "flat" : toneOf(row.change24h)}>{formatPercent(row.change24h, numberLocale)}</span>;
    case "volume24h":
      return formatUsdCompact(row.volume24h, numberLocale);
    case "liquidity":
      return formatUsdCompact(row.liquidity, numberLocale);
    case "marketCap":
      return formatUsdCompact(row.marketCap, numberLocale);
    case "age":
      return ageText(row.ageDays, word, numberLocale);
    case "top10":
      return row.topHoldersPct === null ? "—" : `${new Intl.NumberFormat(numberLocale, { maximumFractionDigits: 1 }).format(row.topHoldersPct)}%`;
    case "organic":
      return <span data-organic={row.organic ?? "none"}>{organicText(row.organic, word)}</span>;
    case "session": {
      const tone = row.period ? periodTone(row.period) : null;
      return tone === null || !row.period ? (
        "—"
      ) : (
        <span className={styles.session} data-tone={tone}>
          <span className={styles.dot} aria-hidden="true" />
          {periodWord(row.period, locale)}
        </span>
      );
    }
    /* Far from the exchange is a caution of its own, not a gain or a loss. */
    case "deviation":
      return farFromExchange(row) ? (
        <span data-tone="far" title={word("farFromExchange")}>
          {formatPercent(row.deviation, numberLocale)}
          <span className={styles.srOnly}> · {word("farFromExchange")}</span>
        </span>
      ) : (
        <span data-tone={toneOf(row.deviation)}>{formatPercent(row.deviation, numberLocale)}</span>
      );
    case "premium":
      return formatPercent(row.markPremium, numberLocale);
    default:
      return "—";
  }
}

/** The honest labels of a row, the strongest first: what it is not, what is wrong with it, what its token allows. */
/** `short`: the words a phone's line keeps when the full label would lose its end. */
function flagsOf(row: ScreenerRow, word: (key: MarketsWord) => string): { text: string; short?: string; title?: string; tone: "private" | "caution" | "plain" }[] {
  const flags: { text: string; short?: string; title?: string; tone: "private" | "caution" | "plain" }[] = [];
  if (row.kind === "private") flags.push({ text: word("notAShare"), tone: "private" });
  if (poolPriceOff(row)) flags.push({ text: word("poolPrice"), short: word("poolPriceShort"), title: word("poolPriceTitle"), tone: "caution" });
  if (row.suspicious) flags.push({ text: word("suspicious"), tone: "caution" });
  if (!row.verified && (row.kind === "meme" || row.kind === "crypto")) flags.push({ text: word("unverified"), tone: "caution" });
  if (authorityFlagsShown(row) && row.mintAuthorityOff === false) flags.push({ text: word("mintOpen"), title: word("mintOpenTitle"), tone: "caution" });
  if (authorityFlagsShown(row) && row.freezeAuthorityOff === false) flags.push({ text: word("freezeOpen"), title: word("freezeOpenTitle"), tone: "caution" });
  if (row.halted) flags.push({ text: word("halted"), tone: "plain" });
  if (!row.tradable) flags.push({ text: word("notOffered"), tone: "plain" });
  return flags;
}

/**
 * The asset in one line of the 40 px row: its picture, its ticker, its name, and the first honest label as a word —
 * the others behind «+n», every one of them in the label's title and for a screen reader. A phone keeps the ticker over
 * the name, and a label takes the name's line in the same words.
 */
function AssetCell({ row, locale }: { row: ScreenerRow; locale: WorkspaceLocale }) {
  const word = marketsWords(locale);
  const flags = flagsOf(row, word);
  const [first, ...more] = flags;
  const all = flags.map((flag) => (flag.title ? `${flag.text}: ${flag.title}` : flag.text)).join(" · ");
  return (
    <Link className={styles.asset} href={row.href} prefetch={false}>
      <MarketIcon mint={row.mint} icon={row.icon} symbol={row.symbol} size={24} className={styles.icon} />
      <span className={styles.names}>
        <span className={styles.symbol} translate="no">
          {row.symbol}
        </span>
        <span className={styles.name} data-flagged={first ? "" : undefined}>
          {row.name}
          {row.issuer ? <span className={styles.issuer}> · {row.issuer}</span> : null}
        </span>
        {/* A phone has no room for the label beside the name: the first label takes the name's line, in words. */}
        {first ? (
          <span className={styles.flagLine} data-flag={first.tone === "plain" ? undefined : first.tone} title={all}>
            {first.short ? (
              <>
                <span aria-hidden="true">{first.short}</span>
                <span className={styles.srOnly}>{first.text}</span>
              </>
            ) : (
              first.text
            )}
            {more.length ? <span className={styles.flagMore}> +{more.length}</span> : null}
            {more.length ? <span className={styles.srOnly}>: {more.map((flag) => flag.text).join(", ")}</span> : null}
          </span>
        ) : null}
        {/* A phone has no room for the session's column: a stock says it under its name. */}
        {row.kind === "stock" && row.period && periodTone(row.period) !== null ? (
          <span className={`${styles.session} ${styles.phoneOnly}`} data-tone={periodTone(row.period) ?? undefined}>
            <span className={styles.dot} aria-hidden="true" />
            {periodWord(row.period, locale)}
          </span>
        ) : null}
      </span>
      {first ? (
        <span className={styles.flag} data-flag={first.tone === "plain" ? undefined : first.tone} title={all}>
          {first.text}
          {more.length ? <span className={styles.flagMore}> +{more.length}</span> : null}
          {more.length ? <span className={styles.srOnly}>: {more.map((flag) => flag.text).join(", ")}</span> : null}
        </span>
      ) : null}
    </Link>
  );
}

/** The table before its figures, in its own shape — the one row of choices, the block with the head and ten rows of 40 — so the rows fill in rather than jump in. */
export function ScreenerSkeleton({ title }: { title: string }) {
  return (
    <div className={styles.screener} aria-busy="true" aria-live="polite" data-surface-state="LOADING">
      <div className={styles.toolbar}>
        <span className={`${styles.bone} ${styles.boneTabs}`} style={{ height: 40 }} />
        <span className={styles.bone} style={{ width: 220, height: 40 }} />
        <span className={`${styles.bone} ${styles.search}`} style={{ height: 40 }} />
      </div>
      <Block title={title} titleAs="h2" icon="chart-column" className={styles.tableBlock}>
        <div className={styles.boneRows}>
          <span className={styles.bone} style={{ height: 40, opacity: 0.4 }} />
          {Array.from({ length: 10 }, (_, index) => (
            <span key={index} className={styles.bone} style={{ height: 40 }} />
          ))}
        </div>
      </Block>
    </div>
  );
}
