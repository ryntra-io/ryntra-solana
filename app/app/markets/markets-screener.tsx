"use client";

import { CaretDown, CaretUp, MagnifyingGlass, Star } from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import { useSolanaConnection } from "@/app/solana/workspace/connection";
import { MarketIcon } from "@/app/solana/workspace/spot/market-list";
import { formatPercent, formatUsdCompact, formatUsdPrice, toneOf } from "@/app/solana/workspace/spot/spot-format";
import { useSpotWatchlist } from "@/app/solana/workspace/spot/use-spot-data";
import { useWalletProof } from "@/app/solana/workspace/wallet-proof";
import {
  isScreenerSort,
  isScreenerTab,
  matchScreener,
  rowsForTab,
  SCREENER_TABS,
  SORT_FIRST_DIRECTION,
  sortScreener,
  type ScreenerRow,
  type ScreenerSort,
  type ScreenerTab,
} from "@/lib/markets/screener";

import { periodTone, periodWord } from "../stocks/stock-model";
import { marketsWords, type MarketsWord } from "./markets-words";
import styles from "./screener.module.css";

const PAGE = 50;
const STORE = "ryntra.markets.screener.v1";

const TAB_WORD: Readonly<Record<ScreenerTab, MarketsWord>> = {
  all: "tabAll",
  memes: "tabMemes",
  crypto: "tabCrypto",
  stocks: "tabStocks",
  private: "tabPrivate",
  watchlist: "tabWatchlist",
};

type Column = "price" | "change1h" | "change24h" | "volume24h" | "liquidity" | "marketCap" | "age" | "top10" | "organic" | "session" | "deviation" | "premium";

/** The columns each tab draws: for every asset price, change, volume, liquidity and market cap; for coins the hour and the venue's facts; for stocks the exchange's session and the deviation; for a private company the token against the issuer's valuation. */
const COLUMNS: Readonly<Record<ScreenerTab, readonly Column[]>> = {
  all: ["price", "change1h", "change24h", "volume24h", "liquidity", "marketCap"],
  memes: ["price", "change1h", "change24h", "volume24h", "liquidity", "marketCap", "age", "top10", "organic"],
  crypto: ["price", "change1h", "change24h", "volume24h", "liquidity", "marketCap", "age", "top10", "organic"],
  stocks: ["price", "change24h", "volume24h", "liquidity", "session", "deviation"],
  private: ["price", "change24h", "volume24h", "liquidity", "premium"],
  watchlist: ["price", "change1h", "change24h", "volume24h", "liquidity", "marketCap"],
};

const COLUMN_WORD: Readonly<Record<Column, MarketsWord>> = {
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
const COLUMN_SORT: Readonly<Partial<Record<Column, ScreenerSort>>> = {
  price: "price",
  change1h: "change1h",
  change24h: "change24h",
  volume24h: "volume24h",
  liquidity: "liquidity",
  marketCap: "marketCap",
  age: "age",
};

/** The quick orders above the table — «У тренді» is the day's volume, the trends of the list. */
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
  const columns = COLUMNS[tab];
  const coinsTab = tab === "memes" || tab === "crypto" || tab === "all" || tab === "watchlist";

  const counts = useMemo(() => {
    const result = {} as Record<ScreenerTab, number>;
    for (const id of SCREENER_TABS) result[id] = rowsForTab(rows, id, watched).length;
    return result;
  }, [rows, watched]);

  const pressColumn = (column: Column) => {
    const key = COLUMN_SORT[column];
    if (!key) return;
    reorder(order.sort === key ? { sort: key, direction: order.direction === "asc" ? "desc" : "asc" } : { sort: key, direction: SORT_FIRST_DIRECTION[key] });
  };

  const unavailable = (down.coins && (tab === "memes" || tab === "crypto")) || (down.stocks && (tab === "stocks" || tab === "private")) || (down.coins && down.stocks);

  return (
    <section className={styles.screener} aria-label={word("title")}>
      <div className={styles.toolbar}>
        <div className={styles.tabs} role="group" aria-label={word("tabs")}>
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
      </div>

      <div className={styles.orders} role="group" aria-label={word("sortBy")}>
        {QUICK.filter((quick) => !quick.coinsOnly || coinsTab).map((quick) => (
          <button
            key={quick.id}
            type="button"
            className={styles.order}
            aria-pressed={order.sort === quick.sort && order.direction === quick.direction}
            onClick={() => reorder({ sort: quick.sort, direction: quick.direction })}
          >
            {word(quick.word)}
          </button>
        ))}
      </div>

      {tab === "private" ? <p className={styles.note} data-note="private">{word("privateLine")}</p> : null}
      {tab === "memes" ? <p className={styles.note} data-note="memes">{word("memesRisk")}</p> : null}

      {unavailable ? (
        <div className={styles.status} role="status">
          <p>{down.coins && down.stocks ? word("allDown") : tab === "stocks" || tab === "private" ? word("stocksDown") : word("coinsDown")}</p>
          <button type="button" className="rw-btn" onClick={() => window.location.reload()}>
            {word("reload")}
          </button>
        </div>
      ) : shown.length === 0 ? (
        <p className={styles.empty} role="status">
          {tab === "watchlist" && !query ? word("emptyWatchlist") : query ? word("emptySearch") : word("empty")}
        </p>
      ) : (
        <>
          <div className={styles.tableWrap} id="markets-table">
            <table className={styles.table} data-tab={tab}>
              <thead>
                <tr>
                  <th scope="col" className={styles.cStar}>
                    <span className={styles.srOnly}>{word("tabWatchlist")}</span>
                  </th>
                  <th scope="col" className={styles.cAsset}>
                    <button type="button" className={styles.sortButton} data-active={order.sort === "name"} onClick={() => reorder(order.sort === "name" ? { sort: "name", direction: order.direction === "asc" ? "desc" : "asc" } : { sort: "name", direction: "asc" })}>
                      {word("colAsset")}
                      <SortMark order={order} sort="name" />
                    </button>
                  </th>
                  {columns.map((column) => {
                    const key = COLUMN_SORT[column];
                    const title = column === "premium" ? word("premiumNote") : column === "deviation" ? word("deviationNote") : undefined;
                    return (
                      <th
                        key={column}
                        scope="col"
                        className={styles.cNum}
                        data-col={column}
                        title={title}
                        aria-sort={key && order.sort === key ? (order.direction === "asc" ? "ascending" : "descending") : undefined}
                      >
                        {key ? (
                          <button type="button" className={styles.sortButton} data-active={order.sort === key} onClick={() => pressColumn(column)}>
                            {word(COLUMN_WORD[column])}
                            <SortMark order={order} sort={key} />
                          </button>
                        ) : (
                          <span className={styles.headText}>{word(COLUMN_WORD[column])}</span>
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {shown.slice(0, limit).map((row) => (
                  <Row
                    key={row.mint}
                    row={row}
                    columns={columns}
                    locale={locale}
                    numberLocale={numberLocale}
                    starred={watched.has(row.mint)}
                    onStar={() => watchlist.toggle(row.mint)}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <div className={styles.foot}>
            <span className={styles.footCount}>
              {Math.min(limit, shown.length)} {word("of")} {shown.length} {word("shown")}
            </span>
            {shown.length > limit ? (
              <button type="button" className="rw-btn" onClick={() => setLimit((value) => value + PAGE)}>
                {word("showMore")}
              </button>
            ) : null}
            <span className={styles.sources}>
              {word("sources")}
              {coinsAt ? (
                <>
                  {" · "}
                  {coinsAt.stale ? word("coinsStaleAt") : word("coinsAt")} {clock(coinsAt.at)} UTC
                </>
              ) : null}
            </span>
          </div>
        </>
      )}
    </section>
  );
}

/** «14:05» — the UTC time a read was made. */
function clock(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? "—" : at.toISOString().slice(11, 16);
}

function SortMark({ order, sort }: { order: Order; sort: ScreenerSort }) {
  if (order.sort !== sort) return null;
  return order.direction === "asc" ? <CaretUp size={11} weight="bold" aria-hidden="true" /> : <CaretDown size={11} weight="bold" aria-hidden="true" />;
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

function Row({
  row,
  columns,
  locale,
  numberLocale,
  starred,
  onStar,
}: {
  row: ScreenerRow;
  columns: readonly Column[];
  locale: WorkspaceLocale;
  numberLocale: string;
  starred: boolean;
  onStar: () => void;
}) {
  const word = marketsWords(locale);
  const cell = (column: Column) => {
    switch (column) {
      case "price":
        return formatUsdPrice(row.price, numberLocale);
      case "change1h":
        return <span data-tone={toneOf(row.change1h)}>{formatPercent(row.change1h, numberLocale)}</span>;
      case "change24h":
        return <span data-tone={toneOf(row.change24h)}>{formatPercent(row.change24h, numberLocale)}</span>;
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
      case "deviation":
        return <span data-tone={toneOf(row.deviation)}>{formatPercent(row.deviation, numberLocale)}</span>;
      case "premium":
        return formatPercent(row.markPremium, numberLocale);
      default:
        return "—";
    }
  };
  return (
    <tr className={styles.row} data-kind={row.kind}>
      <td className={styles.cStar}>
        <button
          type="button"
          className={styles.star}
          aria-pressed={starred}
          aria-label={`${starred ? word("unstar") : word("star")}: ${row.symbol}`}
          title={starred ? word("unstar") : word("star")}
          onClick={onStar}
        >
          <Star size={15} weight={starred ? "fill" : "regular"} aria-hidden="true" />
        </button>
      </td>
      <th scope="row" className={styles.cAsset}>
        <Link className={styles.asset} href={row.href} prefetch={false}>
          <MarketIcon mint={row.mint} icon={row.icon} symbol={row.symbol} size={28} className={styles.icon} />
          <span className={styles.names}>
            <span className={styles.symbol} translate="no">
              {row.symbol}
              {row.kind === "private" ? <span className={styles.flag} data-flag="private">{word("notAShare")}</span> : null}
              {row.halted ? <span className={styles.flag}>{word("halted")}</span> : null}
              {!row.tradable ? <span className={styles.flag}>{word("notOffered")}</span> : null}
              {!row.verified && (row.kind === "meme" || row.kind === "crypto") ? <span className={styles.flag} data-flag="caution">{word("unverified")}</span> : null}
              {row.suspicious ? <span className={styles.flag} data-flag="caution">{word("suspicious")}</span> : null}
              {row.mintAuthorityOff === false ? <span className={styles.flag} data-flag="caution" title={word("mintOpenTitle")}>{word("mintOpen")}</span> : null}
              {row.freezeAuthorityOff === false ? <span className={styles.flag} data-flag="caution" title={word("freezeOpenTitle")}>{word("freezeOpen")}</span> : null}
            </span>
            <span className={styles.name}>
              {row.name}
              {row.issuer ? <span className={styles.issuer}> · {row.issuer}</span> : null}
            </span>
            {/* A phone has no room for the session's column: a stock says it under its name. */}
            {row.kind === "stock" && row.period && periodTone(row.period) !== null ? (
              <span className={`${styles.session} ${styles.phoneOnly}`} data-tone={periodTone(row.period) ?? undefined}>
                <span className={styles.dot} aria-hidden="true" />
                {periodWord(row.period, locale)}
              </span>
            ) : null}
          </span>
        </Link>
      </th>
      {columns.map((column) => (
        <td key={column} className={styles.cNum} data-col={column} translate="no">
          {cell(column)}
        </td>
      ))}
    </tr>
  );
}

/** The table before its figures: the toolbar's shape and ten rows, so the rows fill in rather than jump in. */
export function ScreenerSkeleton() {
  return (
    <div className={styles.screener} aria-busy="true" aria-live="polite" data-surface-state="LOADING">
      <div className={styles.toolbar}>
        <span className={styles.bone} style={{ width: "min(420px, 100%)", height: 40 }} />
        <span className={styles.bone} style={{ width: "min(300px, 100%)", height: 40 }} />
      </div>
      <div className={styles.boneRows}>
        {Array.from({ length: 10 }, (_, index) => (
          <span key={index} className={styles.bone} style={{ height: 44 }} />
        ))}
      </div>
    </div>
  );
}
