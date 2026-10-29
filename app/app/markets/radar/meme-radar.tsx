"use client";

import { CaretDown, Funnel } from "@phosphor-icons/react";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { Filters, PulseLine, readStored, RowsSkeleton, store, usePulseFeed, type PulseAnswer } from "@/app/app/home/pulse";
import { pulseWords } from "@/app/app/home/pulse-words";
import s from "@/app/app/home/pulse.module.css";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { isOffensiveName } from "@/lib/spot/offensive-names";
import {
  activeFilters,
  passesFilter,
  PULSE_DEFAULT_WINDOW,
  PULSE_FILTER_NONE,
  PULSE_WINDOWS,
  pulseWindowOf,
  RADAR_FEEDS,
  readPulseFilter,
  twinsOf,
  WATCHLIST_MAX,
  type PulseFilter,
  type PulseRow,
  type RadarFeed,
} from "@/lib/spot/pulse";
import type { TokenWindow } from "@/lib/spot/token-page";

import { RadarCard } from "./radar-card";
import { radarWords, type RadarWord } from "./radar-words";
import r from "./radar.module.css";

/**
 * Market Radar — meme mode (SOL-R1), «Ринки» → «Меми»: six feeds of the
 * tokens born on Meteora DBC, pump.fun and Raydium LaunchLab — Нові · Ростуть
 * · Майже на DEX · Вийшли на DEX · Тренди · Обране — read live from
 * `/api/spot/pulse?mode=meme` with the time of the read and its sources under
 * them; the filters of liquidity, age, holders, the creator's history and
 * concentration over every row; and a token's card from its name — its chart,
 * the facts against it and the total fees of a buy before the Review
 * (`radar-card.tsx`). Read-only: nothing here buys; a sum opens the token's
 * own Review, and the wallet signs there or nothing happens.
 *
 * The rows, the windows and the filters are Pulse's (`app/app/home/pulse.tsx`),
 * so a row reads the same on Home and here; the feed and the filters are kept
 * on the device apart from Home's.
 */

const VIEW_KEY = "ryntra.radar.view.v1";
const FILTER_KEY = "ryntra.radar.filter.v1";
const PAGE = 20;
const POLL_MS: Readonly<Record<RadarFeed, number>> = { new: 15_000, growing: 30_000, soon: 20_000, dex: 30_000, trending: 30_000, watchlist: 30_000 };
const FEED_WORD: Readonly<Record<RadarFeed, RadarWord>> = { new: "feedNew", growing: "feedGrowing", soon: "feedSoon", dex: "feedDex", trending: "feedTrending", watchlist: "feedWatchlist" };
const NOTE_WORD: Readonly<Record<RadarFeed, RadarWord>> = { new: "noteNew", growing: "noteGrowing", soon: "noteSoon", dex: "noteDex", trending: "noteTrending", watchlist: "noteWatchlist" };

function parseView(raw: unknown): { feed: RadarFeed; window: TokenWindow } {
  const value = raw && typeof raw === "object" ? (raw as { feed?: unknown; window?: unknown }) : {};
  const feed = (RADAR_FEEDS as readonly unknown[]).includes(value.feed) ? (value.feed as RadarFeed) : "new";
  return { feed, window: pulseWindowOf(feed, value.window) };
}

/** A row the search finds: by ticker, by name, or by the mint itself. */
function matches(row: PulseRow, query: string): boolean {
  const text = query.trim().toLowerCase();
  if (!text) return true;
  return row.symbol.toLowerCase().includes(text) || row.name.toLowerCase().includes(text) || row.mint.toLowerCase() === text;
}

export function MemeRadar({
  locale,
  query = "",
  watched,
  onToggleWatch,
}: {
  locale: WorkspaceLocale;
  /** The screener's search, applied to the feed's rows. */
  query?: string;
  /** The person's watchlist, the same as «Ринки» → «Обране». */
  watched: readonly string[];
  onToggleWatch: (mint: string) => void;
}) {
  const word = radarWords(locale);
  const pulse = pulseWords(locale);
  const numbers = locale === "uk" ? "uk-UA" : "en-US";
  const ids = { title: useId(), panel: useId(), filters: useId(), hint: useId() };
  const [view, setView] = useState<{ feed: RadarFeed; window: TokenWindow }>({ feed: "new", window: PULSE_DEFAULT_WINDOW.new });
  const [filter, setFilter] = useState<PulseFilter>(PULSE_FILTER_NONE);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const [attempt, setAttempt] = useState(0);
  const [filterGeneration, setFilterGeneration] = useState(0);
  const [opened, setOpened] = useState<PulseRow | null>(null);
  const resetFilters = useCallback(() => {
    setFilterGeneration((count) => count + 1);
    setFilter(PULSE_FILTER_NONE);
    setShown(PAGE);
    store(FILTER_KEY, PULSE_FILTER_NONE);
  }, []);
  useEffect(() => {
    setView(readStored(VIEW_KEY, parseView, { feed: "new", window: PULSE_DEFAULT_WINDOW.new }));
    setFilter(readStored(FILTER_KEY, readPulseFilter, PULSE_FILTER_NONE));
  }, []);

  /* «Обране» asks for the person's mints, in their order; the others for the feed and its window. */
  const mints = watched.slice(0, WATCHLIST_MAX).join(",");
  const url =
    view.feed === "watchlist"
      ? `/api/spot/pulse?feed=watchlist&mode=meme&window=${view.window}&mints=${encodeURIComponent(mints)}`
      : `/api/spot/pulse?feed=${view.feed}&mode=meme&window=${view.window}`;
  const key = view.feed === "watchlist" ? `watchlist:${view.window}:${mints}` : `${view.feed}:${view.window}`;
  const state = usePulseFeed({ key, url, pollMs: POLL_MS[view.feed] }, attempt);

  /* The rows hold still under a pointer or a focus; a newer answer waits behind «Нові цифри — показати». */
  const [holding, setHolding] = useState(false);
  const [drawn, setDrawn] = useState<PulseAnswer | null>(null);
  const latest = state.answer;
  useEffect(() => {
    if (latest === null) {
      setDrawn(null);
      return;
    }
    setDrawn((current) => (holding && current && current.feed === latest.feed && current.window === latest.window ? current : latest));
  }, [latest, holding]);
  const answer = drawn && latest && drawn.feed === latest.feed && drawn.window === latest.window ? drawn : latest;
  const pending = answer !== null && latest !== null && answer !== latest;
  const now = useMemo(() => (answer ? Date.parse(answer.observedAt) || 0 : 0), [answer]);

  const choose = useCallback((feed: RadarFeed, window?: TokenWindow) => {
    const next = { feed, window: window ?? pulseWindowOf(feed, null) };
    setView(next);
    setShown(PAGE);
    store(VIEW_KEY, next);
  }, []);
  const changeFilter = useCallback((next: PulseFilter) => {
    setFilter(next);
    setShown(PAGE);
    store(FILTER_KEY, next);
  }, []);

  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : event.key === "Home" ? -index : event.key === "End" ? RADAR_FEEDS.length - 1 - index : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = (index + step + RADAR_FEEDS.length) % RADAR_FEEDS.length;
    choose(RADAR_FEEDS[next] as RadarFeed);
    tabs.current[next]?.focus();
  };

  /* People's tokens only: the team's technical validations and names with a hate word are not on a public feed (B15, B2b). */
  const source = useMemo(() => (answer?.rows ?? []).filter((row) => !row.ryntra?.technicalValidation && !isOffensiveName(row.name, row.symbol)), [answer]);
  /* Copies of one name among the feed's rows, told apart by their own address (UX-154). */
  const twins = useMemo(() => twinsOf(source), [source]);
  const rows = useMemo(() => source.filter((row) => passesFilter(row, filter, view.window, now) && matches(row, query)), [source, filter, view.window, now, query]);
  const active = activeFilters(filter);
  const windows = PULSE_WINDOWS[view.feed];
  const watchedSet = useMemo(() => new Set(watched), [watched]);
  const emptyWord =
    view.feed === "watchlist"
      ? word("emptyWatchlist")
      : view.feed === "growing"
        ? word("emptyGrowing")
        : pulse(view.feed === "soon" ? "emptySoon" : view.feed === "dex" ? "emptyDex" : "emptyFeed");

  return (
    <section className={`${s.pulse} ${r.radar}`} aria-labelledby={ids.title} data-block="radar">
      <div className={s.card}>
        <header className={s.head}>
          <h2 id={ids.title} className={s.title}>
            {word("title")}
          </h2>
          <span className={r.readOnly}>{word("readOnly")}</span>
        </header>
        <div className={s.toolbar}>
          <div className={s.tabs} role="tablist" aria-label={word("feeds")}>
            {RADAR_FEEDS.map((feed, index) => (
              <button
                key={feed}
                ref={(node) => {
                  tabs.current[index] = node;
                }}
                type="button"
                role="tab"
                id={`${ids.panel}-${feed}`}
                aria-selected={view.feed === feed}
                aria-controls={ids.panel}
                tabIndex={view.feed === feed ? 0 : -1}
                className={s.tab}
                data-feed={feed}
                onClick={() => choose(feed)}
                onKeyDown={(event) => onTabKey(event, index)}
              >
                {word(FEED_WORD[feed])}
                {feed === "watchlist" && watched.length > 0 ? <span className={r.count}>{watched.length}</span> : null}
              </button>
            ))}
          </div>
          <div className={s.tools} data-dense="">
            {windows.length > 1 ? (
              <div className={s.segment} role="group" aria-label={pulse("window")}>
                {windows.map((window) => (
                  <button key={window} type="button" className={s.chip} aria-pressed={view.window === window} onClick={() => choose(view.feed, window)}>
                    {pulse(window)}
                  </button>
                ))}
              </div>
            ) : null}
            <button type="button" className={s.filterButton} aria-expanded={filtersOpen} aria-controls={ids.filters} onClick={() => setFiltersOpen((open) => !open)} data-active={active > 0 ? "true" : undefined}>
              <Funnel size={16} weight="bold" aria-hidden="true" />
              {pulse("filters")}
              {active > 0 ? <span className={s.badge}>{active}</span> : null}
              <CaretDown size={12} weight="bold" aria-hidden="true" className={s.caret} />
            </button>
          </div>
        </div>
        {filtersOpen ? <Filters key={filterGeneration} id={ids.filters} filter={filter} onChange={changeFilter} onReset={resetFilters} locale={locale} /> : null}
        <div role="tabpanel" id={ids.panel} aria-labelledby={`${ids.panel}-${view.feed}`} className={s.panel}>
          <p className={s.note}>{word(NOTE_WORD[view.feed])}</p>
          {answer?.stale ? <p className={s.held} role="status">{pulse("held")}</p> : answer?.partial ? <p className={s.held} role="status">{pulse("partial")}</p> : null}
          {view.feed === "watchlist" && answer && (answer.unlisted ?? 0) > 0 ? <p className={s.held}>{word("unlisted", { count: answer.unlisted ?? 0 })}</p> : null}
          {state.status === "loading" && !answer ? (
            <RowsSkeleton />
          ) : state.status === "failed" || !answer ? (
            <div className={s.status} role="status">
              <p>
                {pulse("failed")} {pulse("failedAuto")}
              </p>
              <button type="button" className="rw-btn" onClick={() => setAttempt((count) => count + 1)}>
                {pulse("retry")}
              </button>
            </div>
          ) : rows.length === 0 ? (
            <div className={s.status} role="status">
              <p>{source.length > 0 ? pulse("emptyFiltered") : emptyWord}</p>
              {source.length > 0 && active > 0 ? (
                <button type="button" className="rw-btn" onClick={resetFilters}>
                  {pulse("filtersResetAll")}
                </button>
              ) : null}
            </div>
          ) : (
            <>
              <div className={s.columns} aria-hidden="true">
                <span data-col="asset">{pulse("colAsset")}</span>
                <span data-col="price">{pulse("colPrice")}</span>
                <span data-col="marketCap">{pulse("colMarketCap")}</span>
                <span data-col="volume">
                  {pulse("colVolume")} · {pulse(view.window)}
                </span>
                <span data-col="liquidity">{pulse("colLiquidity")}</span>
                <span data-col="holders">{pulse("colHolders")}</span>
                <span data-col="top10">{pulse("colTop10")}</span>
                <span data-col="change">
                  {pulse("colChange")} · {pulse(view.window)}
                </span>
                <span data-col="risk">{pulse("colRisk")}</span>
                <span data-col="quick">{pulse("colQuick")}</span>
              </div>
              <div className={s.list}>
                {pending ? (
                  <button type="button" className={s.pending} onClick={() => setDrawn(latest)} data-dense="">
                    {pulse("pending")}
                  </button>
                ) : null}
                <ol
                  className={s.rows}
                  onPointerEnter={() => setHolding(true)}
                  onPointerLeave={() => setHolding(false)}
                  onFocus={() => setHolding(true)}
                  onBlur={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHolding(false);
                  }}
                >
                  {rows.slice(0, shown).map((row) => (
                    <PulseLine
                      key={row.mint}
                      row={row}
                      window={view.window}
                      now={now}
                      locale={locale}
                      numbers={numbers}
                      hintId={ids.hint}
                      plainMark={view.feed === "new" || view.feed === "growing" || view.feed === "soon"}
                      twins={twins.get(row.mint) ?? 0}
                      onOpen={setOpened}
                    />
                  ))}
                </ol>
              </div>
            </>
          )}
        </div>
        <div className={s.foot}>
          {answer && rows.length > 0 ? <span className={s.count}>{pulse("shown", { shown: Math.min(shown, rows.length), total: rows.length })}</span> : null}
          {answer && rows.length > shown ? (
            <button type="button" className={s.more} onClick={() => setShown((count) => count + PAGE)} data-dense="">
              {pulse("showMore")}
            </button>
          ) : null}
          <span id={ids.hint} className={s.hint}>
            {pulse("quickHint")}
          </span>
          <span className={s.sources} data-radar-sources="">
            {answer ? (
              <span data-observed-at={answer.observedAt}>
                {pulse("updatedAt", { time: new Date(answer.observedAt).toLocaleTimeString(numbers, { hour: "2-digit", minute: "2-digit", second: "2-digit" }) })} ·{" "}
              </span>
            ) : null}
            {pulse("sourceJupiter")}
            {answer?.sources.includes("geckoterminal") ? ` · ${pulse("sourceGecko")}` : ""}
            {answer?.sources.includes("chain") ? ` · ${pulse("sourceChain")}` : ""}
            {` · ${word("sources")}`}
          </span>
        </div>
      </div>
      <RadarCard row={opened} now={now} locale={locale} watched={opened ? watchedSet.has(opened.mint) : false} onToggleWatch={onToggleWatch} onClose={() => setOpened(null)} />
    </section>
  );
}
