"use client";

import { CaretDown, MagnifyingGlass } from "@phosphor-icons/react";
import { Block, Button, EmptyState, Table, type TableColumn } from "@ryntra/core/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useState } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import { formatUsdCompact } from "@/app/solana/workspace/spot/spot-format";
import {
  CATALOG_PER_VENUE,
  CATALOG_VIEWS,
  catalogRows,
  feeTvl24hPct,
  isPoolAddress,
  LIQUIDITY_POOL_KINDS,
  matchCatalog,
  type CatalogPool,
  type CatalogSort,
  type CatalogView,
  type PoolCatalog,
} from "@/lib/liquidity/catalog/model";

import { ReadTime } from "./read-time";
import { POOL_KEY, poolsWords, type PoolsWord } from "./pools-words";
import styles from "./pools.module.css";

const PAGE = 25;

/* A venue's kind in a person's words, never the engine's name: the tab says the kind, a row says its pool. */
const VIEW_KEY: Readonly<Record<Exclude<CatalogView, "all">, PoolsWord>> = { dlmm: "kindStepped", "damm-v2": "kindSmooth" };
/* A row says its kind alone — every pool here is Meteora's, the page and its source line say so. */
const ROW_KIND: Readonly<Record<Exclude<CatalogView, "all">, PoolsWord>> = { dlmm: "rowStepped", "damm-v2": "rowSmooth" };

type Order = Readonly<{ sort: CatalogSort; direction: "asc" | "desc" }>;
/* The orders the toolbar's one select offers; «the highest fee» is not one — it lifts the newest memes, not good pools (B17). */
const QUICK: ReadonlyArray<Readonly<{ sort: CatalogSort; word: PoolsWord }>> = [
  { sort: "volume24h", word: "sortVolume" },
  { sort: "feeTvl", word: "sortFeeTvl" },
  { sort: "tvl", word: "sortTvl" },
  { sort: "fees24h", word: "sortFees" },
  { sort: "age", word: "sortAge" },
];

type Column = "tvl" | "volume24h" | "fees24h" | "feeTvl" | "fee";
const COLUMNS: readonly Column[] = ["tvl", "volume24h", "fees24h", "feeTvl", "fee"];
/**
 * The columns follow the catalogue's own width — on a desk the side column of positions takes part of the screen — the
 * pool, its depth and its fees against it always, the rest as the width allows; the table never scrolls sideways.
 */
const NARROW: ReadonlyArray<Readonly<{ under: number; drop: readonly Column[] }>> = [
  { under: 860, drop: ["fee"] },
  { under: 760, drop: ["fees24h"] },
  { under: 560, drop: ["volume24h"] },
];

/* Measured before the first paint, so the columns never jump on a desk; the server's render has no width and draws them all. */
const useBeforePaint = typeof window === "undefined" ? useEffect : useLayoutEffect;

function useRoom(): [(node: HTMLElement | null) => void, (column: Column) => boolean] {
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
  /* Before the browser measures, a desk's catalogue on its own: what the server streams is what a desk keeps. */
  const room = width ?? 1100;
  return [setNode, (column) => !NARROW.some((rule) => room < rule.under && rule.drop.includes(column))];
}

const sortKey: Readonly<Record<Column, CatalogSort | null>> = { tvl: "tvl", volume24h: "volume24h", fees24h: "fees24h", feeTvl: "feeTvl", fee: "fee" };
const COLUMN_WORD: Readonly<Record<Column, PoolsWord>> = { tvl: "colTvl", volume24h: "colVolume", fees24h: "colFees", feeTvl: "colFeeTvl", fee: "colFee" };

export function PoolsCatalog({ catalog, locale, initialView }: { catalog: PoolCatalog; locale: WorkspaceLocale; initialView: CatalogView }) {
  const word = poolsWords(locale);
  const lang = locale === "uk" ? "uk" : "en";
  const numberLocale = locale === "uk" ? "uk-UA" : "en-US";
  const router = useRouter();
  const [measure, room] = useRoom();
  const [view, setView] = useState<CatalogView>(initialView);
  const [order, setOrder] = useState<Order>({ sort: "volume24h", direction: "desc" });
  const [query, setQuery] = useState(catalog.search ?? "");
  const [limit, setLimit] = useState(PAGE);

  const down = LIQUIDITY_POOL_KINDS.every((kind) => !catalog.sources[kind].ok);
  const filtered = useMemo(() => matchCatalog(catalogRows(catalog.pools, view, order.sort, order.direction), catalog.search ? "" : query), [catalog, view, order, query]);
  const counts = useMemo(() => ({ all: catalog.pools.length, dlmm: catalog.pools.filter((p) => p.kind === "dlmm").length, "damm-v2": catalog.pools.filter((p) => p.kind === "damm-v2").length }), [catalog]);

  const choose = (next: CatalogView) => {
    setView(next);
    setLimit(PAGE);
    const url = new URL(window.location.href);
    if (next === "all") url.searchParams.delete("venue");
    else url.searchParams.set("venue", next);
    window.history.replaceState(null, "", url);
  };

  const open = (pool: CatalogPool) => router.push(`/app/markets/pools/${pool.address}`);

  const columns: TableColumn<CatalogPool>[] = [
    {
      key: "pool",
      label: word("colPool"),
      render: (pool) => (
        <Link href={`/app/markets/pools/${pool.address}`} className={styles.pairLine} prefetch={false} onClick={(event) => event.stopPropagation()}>
          <span className={styles.pairName}>
            {pool.x.symbol}
            <span className={styles.pairSep}>/</span>
            {pool.y.symbol}
          </span>
          <span className={styles.pairVenue}>
            {word(ROW_KIND[pool.kind])}
            {pool.hasFarm ? <span className={styles.tag}>{word("farm")}</span> : null}
          </span>
          {!pool.x.verified || !pool.y.verified ? (
            <span className={styles.unverified} title={word("unverifiedToken")}>
              {word("unverifiedShort")}
            </span>
          ) : null}
        </Link>
      ),
    },
    ...COLUMNS.filter(room).map(
      (column): TableColumn<CatalogPool> => ({
        key: column,
        label: column === "feeTvl" ? <span title={word("feeTvlNote")}>{word(COLUMN_WORD[column])}</span> : word(COLUMN_WORD[column]),
        numeric: true,
        render: (pool) => <span data-col={column}>{cell(pool, column, numberLocale)}</span>,
      }),
    ),
  ];

  const shown = filtered.slice(0, limit);
  /* The order is made above; each row's sort value is its place in it, signed so the table's own sort keeps it. */
  const place = new Map(filtered.map((pool, index) => [pool.address, index]));
  const sortValue = (pool: CatalogPool) => (order.direction === "asc" ? (place.get(pool.address) ?? 0) : -(place.get(pool.address) ?? 0));
  /* A venue that did not answer is named, never shown as a venue with no pools. */
  const silent = LIQUIDITY_POOL_KINDS.filter((kind) => !catalog.sources[kind].ok);
  const viewSilent = view !== "all" && silent.includes(view);
  const address = query.trim();
  const reads = LIQUIDITY_POOL_KINDS.map((kind) => catalog.sources[kind]).filter((source) => source.ok && source.at !== null);
  const oldest = reads.map((source) => source.at as string).sort()[0] ?? null;
  const readAt = oldest ? { at: oldest, stale: reads.some((source) => source.stale) } : null;

  return (
    <section className={styles.catalog} aria-label={word("title")} ref={measure}>
      <div className={styles.toolbar}>
        <div className={styles.tabs} role="group" aria-label={word("venues")}>
          {CATALOG_VIEWS.map((id) => (
            <button key={id} type="button" className={styles.tab} aria-pressed={view === id} data-view={id} onClick={() => choose(id)}>
              <span>{id === "all" ? word("viewAll") : word(VIEW_KEY[id])}</span>
              <span className={styles.tabCount}>{id !== "all" && !catalog.sources[id].ok ? "—" : counts[id]}</span>
            </button>
          ))}
        </div>
        <label className={styles.sort}>
          <span className={styles.sortWord}>{word("sortBy")}</span>
          <select
            value={QUICK.some((quick) => quick.sort === order.sort) && order.direction === "desc" ? order.sort : ""}
            onChange={(event) => {
              const quick = QUICK.find((item) => item.sort === event.target.value);
              if (!quick) return;
              setOrder({ sort: quick.sort, direction: "desc" });
              setLimit(PAGE);
            }}
          >
            {QUICK.some((quick) => quick.sort === order.sort) && order.direction === "desc" ? null : (
              <option value="" disabled>
                {word("sortColumn")}
              </option>
            )}
            {QUICK.map((quick) => (
              <option key={quick.sort} value={quick.sort}>
                {word(quick.word)}
              </option>
            ))}
          </select>
          <CaretDown size={14} weight="bold" aria-hidden="true" />
        </label>
        <form className={styles.search} action="/app/markets/pools" method="get" role="search">
          <MagnifyingGlass size={16} weight="bold" aria-hidden="true" />
          <label className={styles.srOnly} htmlFor="pools-search">
            {word("searchLabel")}
          </label>
          <input
            id="pools-search"
            name="q"
            type="search"
            value={query}
            placeholder={word("search")}
            onChange={(event) => {
              setQuery(event.target.value);
              setLimit(PAGE);
            }}
            autoComplete="off"
            spellCheck={false}
            maxLength={44}
          />
          {view !== "all" ? <input type="hidden" name="venue" value={view} /> : null}
          <button type="submit" className={styles.searchGo} title={word("searchVenue")}>
            <span className={styles.srOnly}>{word("searchVenue")}</span>
            <span aria-hidden="true">↵</span>
          </button>
        </form>
      </div>

      {catalog.search ? (
        <p className={styles.searchLine}>
          {word("searchFor")} {word("quoteOpen")}
          {catalog.search}
          {word("quoteClose")}
          {catalog.searchLimited ? ` · ${word("searchBusy")}` : ""} · <Link href={view === "all" ? "/app/markets/pools" : `/app/markets/pools?venue=${view}`}>{word("clearSearch")}</Link>
        </p>
      ) : null}

      {!down && silent.length ? (
        <p className={styles.note} role="status">
          {silent.map((kind) => word(VIEW_KEY[kind])).join(", ")}: {word("venueDown")}
        </p>
      ) : null}

      {down || viewSilent ? (
        <EmptyState
          icon="circle-x"
          role="status"
          text={word("down")}
          action={
            <Button variant="secondary" onClick={() => window.location.reload()} lang={lang}>
              {word("reload")}
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="search"
          role="status"
          text={query || catalog.search ? word("emptySearch") : word("empty")}
          action={
            isPoolAddress(address) ? (
              <Button variant="secondary" lang={lang} onClick={() => router.push(`/app/markets/pools/${address}`)}>
                {word("openAddress")}
              </Button>
            ) : query && !catalog.search ? (
              <Button variant="secondary" lang={lang} onClick={() => router.push(`/app/markets/pools?q=${encodeURIComponent(query.trim())}`)}>
                {word("searchVenue")}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Block title={view === "all" ? word("title") : word(VIEW_KEY[view])} titleAs="h2" icon="chart-column" lang={lang} className={styles.tableBlock}>
          <Table
            id="pools-table"
            className={styles.table}
            caption={word("title")}
            columns={columns.map((column) => {
              const key = sortKey[column.key as Column];
              return key ? { ...column, sortable: true, sortValue } : column;
            })}
            sort={{ key: COLUMNS.find((c) => sortKey[c] === order.sort) ?? "pool", direction: order.direction }}
            onSortChange={(next) => {
              const key = sortKey[next.key as Column];
              if (!key) return;
              setOrder({ sort: key, direction: next.direction });
              setLimit(PAGE);
            }}
            rows={shown}
            rowKey={(pool) => pool.address}
            onRowClick={open}
            rowLabel={(pool) => `${pool.x.symbol}/${pool.y.symbol}, ${word(POOL_KEY[pool.kind])}`}
            lang={lang}
          />
          <div className={styles.foot}>
            <span className={styles.footCount}>
              {shown.length} {word("of")} {filtered.length} {word("shown")}
            </span>
            {filtered.length > limit ? (
              <Button variant="secondary" lang={lang} onClick={() => setLimit((n) => n + PAGE)}>
                {word("showMore")}
              </Button>
            ) : null}
            {/* One quiet line: where the figures come from and when — the oldest read of the venues that answered. */}
            {readAt ? (
              <span className={styles.sources}>
                {word("sourceData")} · {readAt.stale ? word("keptAt") : word("readAt")} <ReadTime at={readAt.at} locale={numberLocale} /> · {word("listedTop").replace("{n}", String(CATALOG_PER_VENUE))} · {word(order.sort === "feeTvl" ? "feeTvlOrder" : "feeTvlFoot")}
              </span>
            ) : null}
          </div>
        </Block>
      )}
    </section>
  );
}

function cell(pool: CatalogPool, column: Column, locale: string): string {
  switch (column) {
    case "tvl":
      return formatUsdCompact(pool.tvlUsd, locale);
    case "volume24h":
      return formatUsdCompact(pool.volume24hUsd, locale);
    case "fees24h":
      return formatUsdCompact(pool.fees24hUsd, locale);
    case "feeTvl": {
      /* Two decimals in every row, so the column reads down by its digits. */
      const pct = feeTvl24hPct(pool);
      return pct === null ? "—" : `${new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(pct)}%`;
    }
    case "fee": {
      const pct = pool.dynamicFeePct && pool.dynamicFeePct > (pool.baseFeePct ?? 0) ? pool.dynamicFeePct : pool.baseFeePct;
      return pct === null || !Number.isFinite(pct) ? "—" : `${new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 3 }).format(pct)}%`;
    }
  }
}

/** The catalogue before its figures, in its own shape — the one row of choices, the table's head and ten rows of the table's 40 —
    so the rows fill in where they will stand rather than the page jumping when they come (B15, B17). */
export function CatalogSkeleton({ label }: { label?: string }) {
  return (
    <div className={styles.catalog} aria-busy="true" data-surface-state="LOADING" data-pools-skeleton>
      {label ? (
        <span className={styles.srOnly} role="status">
          {label}
        </span>
      ) : null}
      <div className={styles.toolbar}>
        <span className={styles.bone} style={{ width: 260, height: 36 }} />
        <span className={styles.bone} style={{ width: 200, height: 40 }} />
        <span className={styles.bone} style={{ width: "min(300px, 100%)", height: 40, marginInlineStart: "auto" }} />
      </div>
      <div className={styles.boneRows}>
        <span className={styles.bone} style={{ height: 40, opacity: 0.4 }} />
        {Array.from({ length: 10 }, (_, i) => (
          <span key={i} className={styles.bone} style={{ height: 40 }} />
        ))}
      </div>
    </div>
  );
}
