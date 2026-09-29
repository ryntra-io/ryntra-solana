"use client";

import { MagnifyingGlass } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import { STOCK_ISSUER_IDS, type StockIssuerId } from "@/lib/stocks/representations";

import { ISSUER_SHORT, LIQUID_FLOOR_USD, matchRows, sortRows, wordsFor, type SlimStockRow } from "./stock-model";
import { StockTable } from "./stock-table";
import styles from "./stocks.module.css";

type IssuerFilter = "all" | StockIssuerId;
type SessionFilter = "all" | "open" | "closed";
type MarketFilter = "all" | "traded" | "liquid";
/** The class of instrument: listed equities and ETFs, pre-IPO exposure, or both (`RYN-STOCKS-PROVIDERS-001`). */
type KindFilter = "all" | "listed" | "preipo";

type Filters = Readonly<{ issuer: IssuerFilter; session: SessionFilter; market: MarketFilter; kind: KindFilter }>;
const DEFAULT_FILTERS: Filters = { issuer: "all", session: "all", market: "traded", kind: "all" };
const FILTERS_KEY = "ryntra.stocks.screener.v2";
/** Rows drawn before a person asks for more; every row is already in the browser for the search and the sort. */
const PAGE = 100;

const KINDS: readonly KindFilter[] = ["all", "listed", "preipo"];
const MARKETS: readonly MarketFilter[] = ["traded", "liquid", "all"];
const SESSIONS: readonly SessionFilter[] = ["all", "open", "closed"];

/** What a select shows when it differs from what the server drew it with: a choice made before the page could answer it. */
function earlyChoice<T extends string>(select: HTMLSelectElement | null, allowed: readonly T[], drawn: T): T | null {
  const value = select?.value;
  return value !== undefined && value !== drawn && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

function readFilters(): Filters {
  try {
    const raw = window.localStorage.getItem(FILTERS_KEY);
    if (!raw) return DEFAULT_FILTERS;
    const parsed = JSON.parse(raw) as Partial<Filters>;
    return {
      issuer: parsed.issuer === "all" || (STOCK_ISSUER_IDS as readonly string[]).includes(parsed.issuer ?? "") ? (parsed.issuer as IssuerFilter) : "all",
      session: parsed.session === "open" || parsed.session === "closed" ? parsed.session : "all",
      market: parsed.market === "all" || parsed.market === "liquid" ? parsed.market : "traded",
      kind: parsed.kind === "listed" || parsed.kind === "preipo" ? parsed.kind : "all",
    };
  } catch {
    return DEFAULT_FILTERS;
  }
}

/**
 * Screener v1 (canon v4.0 §7.2) over every confirmed representation: search,
 * the issuer, the session, how much of a market the token has — the filters
 * kept in the browser for the person who set them — and every column sorts.
 * The rows are the server's cached universe; nothing here asks a provider.
 */
export function StockScreener({ rows, locale, initialQuery, initialKind = "all", sources }: { rows: readonly SlimStockRow[]; locale: WorkspaceLocale; initialQuery: string; /** A kind the address asked for (`?kind=preipo`) wins over the remembered filter. */ initialKind?: KindFilter; sources: ReactNode }) {
  const word = wordsFor(locale);
  const [query, setQuery] = useState(initialQuery);
  const [filters, setFilters] = useState<Filters>(initialKind === "all" ? DEFAULT_FILTERS : { ...DEFAULT_FILTERS, kind: initialKind });
  const [limit, setLimit] = useState(PAGE);
  const kindSelect = useRef<HTMLSelectElement>(null);
  const marketSelect = useRef<HTMLSelectElement>(null);
  const sessionSelect = useRef<HTMLSelectElement>(null);
  /* Read once, as the page comes alive, for the address it came alive on. */
  const early = useRef<{ forKind: KindFilter; choice: Partial<Filters> } | null>(null);
  useEffect(() => {
    /* A select changed before the page could answer shows the choice while the rows ignore it; that choice is the person's latest word, so it is applied — and kept — over the remembered filter and the address. */
    if (early.current === null) {
      const drawn: Filters = initialKind === "all" ? DEFAULT_FILTERS : { ...DEFAULT_FILTERS, kind: initialKind };
      const kind = earlyChoice(kindSelect.current, KINDS, drawn.kind);
      const market = earlyChoice(marketSelect.current, MARKETS, drawn.market);
      const session = earlyChoice(sessionSelect.current, SESSIONS, drawn.session);
      early.current = { forKind: initialKind, choice: { ...(kind ? { kind } : {}), ...(market ? { market } : {}), ...(session ? { session } : {}) } };
    }
    const choice = early.current.forKind === initialKind ? early.current.choice : {};
    const remembered = readFilters();
    const next: Filters = { ...(initialKind === "all" ? remembered : { ...remembered, kind: initialKind }), ...choice };
    setFilters(next);
    if (Object.keys(choice).length > 0) {
      try {
        window.localStorage.setItem(FILTERS_KEY, JSON.stringify(next));
      } catch {
        /* Nothing to keep. */
      }
    }
  }, [initialKind]);
  const set = (patch: Partial<Filters>) => {
    setFilters((current) => {
      const next = { ...current, ...patch };
      try {
        window.localStorage.setItem(FILTERS_KEY, JSON.stringify(next));
      } catch {
        /* Nothing to keep. */
      }
      return next;
    });
  };

  const shown = useMemo(() => {
    const filtered = rows.filter((row) => {
      if (filters.issuer !== "all" && row.issuer !== filters.issuer) return false;
      if (filters.kind === "listed" && row.kind !== "listed-equity") return false;
      if (filters.kind === "preipo" && row.kind !== "pre-ipo") return false;
      if (filters.session === "open" && row.period !== "market") return false;
      if (filters.session === "closed" && row.period !== "closed") return false;
      if (filters.market === "traded" && !((row.volume ?? 0) > 0)) return false;
      if (filters.market === "liquid" && !((row.liquidity ?? 0) >= LIQUID_FLOOR_USD)) return false;
      return true;
    });
    return query.trim().length > 0 ? matchRows(filtered, query) : sortRows(filtered, "volume", "desc");
  }, [rows, filters, query]);
  const drawn = useMemo(() => shown.slice(0, limit), [shown, limit]);

  return (
    <section className={styles.card} aria-label={word("screenerTitle")}>
      <div className={styles.toolbar}>
        <label className={styles.search}>
          <MagnifyingGlass size={16} aria-hidden="true" />
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={word("search")} aria-label={word("searchLabel")} autoComplete="off" spellCheck={false} />
        </label>
        <div className={styles.filters} role="group" aria-label={word("issuer")}>
          <button type="button" className={styles.chip} aria-pressed={filters.issuer === "all"} onClick={() => set({ issuer: "all" })}>
            {word("allIssuers")}
          </button>
          {STOCK_ISSUER_IDS.map((issuer) => (
            <button key={issuer} type="button" className={styles.chip} aria-pressed={filters.issuer === issuer} onClick={() => set({ issuer })}>
              {ISSUER_SHORT[issuer]}
            </button>
          ))}
        </div>
        <div className={styles.filters}>
          <select ref={kindSelect} className={styles.select} value={filters.kind} onChange={(event) => set({ kind: event.target.value as KindFilter })} aria-label={word("kind")}>
            <option value="all">{word("anyKind")}</option>
            <option value="listed">{word("listedOnly")}</option>
            <option value="preipo">{word("preIpoOnly")}</option>
          </select>
          <select ref={marketSelect} className={styles.select} value={filters.market} onChange={(event) => set({ market: event.target.value as MarketFilter })} aria-label={word("market")}>
            <option value="traded">{word("tradedOnly")}</option>
            <option value="liquid">{word("liquidOnly")}</option>
            <option value="all">{word("anyMarket")}</option>
          </select>
          <select ref={sessionSelect} className={styles.select} value={filters.session} onChange={(event) => set({ session: event.target.value as SessionFilter })} aria-label={word("session")}>
            <option value="all">{word("anySession")}</option>
            <option value="open">{word("exchangeOpen")}</option>
            <option value="closed">{word("exchangeClosed")}</option>
          </select>
        </div>
      </div>
      <StockTable rows={drawn} locale={locale} sort={query.trim().length > 0 ? null : "volume"} emptyWord={word("noRows")} />
      <div className={styles.foot}>
        <span>
          {word("showing")} {drawn.length} {word("of")} {shown.length}
        </span>
        {drawn.length < shown.length ? (
          <button type="button" className={styles.chip} onClick={() => setLimit((current) => current + PAGE)}>
            {word("showMore")}
          </button>
        ) : null}
        <span className={styles.footSpacer} />
        {sources}
      </div>
    </section>
  );
}
