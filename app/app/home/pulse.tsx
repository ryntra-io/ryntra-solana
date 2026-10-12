"use client";

import { CaretDown, Funnel, ShieldWarning } from "@phosphor-icons/react";
import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import { MarketIcon } from "@/app/solana/workspace/spot/market-list";
import { useQuickBuySums } from "@/app/solana/workspace/spot/quick-buy";
import { formatCount, formatUsdCompact, formatUsdPrice, toneOf } from "@/app/solana/workspace/spot/spot-format";
import {
  activeFilters,
  ageHoursOf,
  passesFilter,
  PULSE_DEFAULT_WINDOW,
  PULSE_FEEDS,
  PULSE_FILTER_NONE,
  PULSE_WINDOWS,
  pulseHref,
  pulseWindowOf,
  readPulseFilter,
  type PulseFeed,
  type PulseFilter,
  type PulseRow,
} from "@/lib/spot/pulse";
import { quickSumLabel } from "@/lib/spot/quick-trade";
import type { TokenWindow } from "@/lib/spot/token-page";

import { ageText, changeText, parseBound, pctText, pulseWords, type PulseWord } from "./pulse-words";
import s from "./pulse.module.css";

/**
 * Pulse — the top of Home: five feeds of
 * Solana's tokens — Нові · Майже на DEX · Вийшли на DEX · Тренди · Рухи —
 * with the person's filters, each row one tap from its page and four quick
 * sums from its Review. Markets launched on Ryntra stand first wherever their
 * own data meets the feed's condition, marked as Ryntra's. «Топ-трейдери»
 * comes with the signals task, not before.
 *
 * The rows are the server's (`/api/spot/pulse`); the filters are applied
 * here, at once, over what it answered, and kept on the device with the feed
 * and its window. A feed is read again while the page is in view — the newest
 * tokens every fifteen seconds, the rest every thirty — and a new read never
 * moves the rows under a pointer or a focused row: it waits behind «Нові
 * цифри — показати» until the person leaves the list or asks for it.
 */

const VIEW_KEY = "ryntra.pulse.view.v1";
const FILTER_KEY = "ryntra.pulse.filter.v1";
const PAGE = 20;
const POLL_MS: Readonly<Record<PulseFeed, number>> = { new: 15_000, soon: 20_000, dex: 30_000, trending: 30_000, movers: 30_000 };

const FEED_WORD: Readonly<Record<PulseFeed, PulseWord>> = { new: "feedNew", soon: "feedSoon", dex: "feedDex", trending: "feedTrending", movers: "feedMovers" };
const NOTE_WORD: Readonly<Record<PulseFeed, PulseWord>> = { new: "noteNew", soon: "noteSoon", dex: "noteDex", trending: "noteTrending", movers: "noteMovers" };

type Answer = Readonly<{ feed: PulseFeed; window: TokenWindow; rows: readonly PulseRow[]; down?: readonly PulseRow[]; observedAt: string; stale: boolean; partial?: boolean; sources: readonly string[] }>;
type FeedState = Readonly<{ key: string; status: "loading" | "ready" | "failed"; answer: Answer | null }>;

function readStored<T>(key: string, parse: (raw: unknown) => T, fallback: T): T {
  try {
    const text = window.localStorage.getItem(key);
    return text ? parse(JSON.parse(text) as unknown) : fallback;
  } catch {
    return fallback;
  }
}

function store(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Private mode or blocked storage: the choice lasts as long as the page. */
  }
}

function parseView(raw: unknown): { feed: PulseFeed; window: TokenWindow } {
  const value = raw && typeof raw === "object" ? (raw as { feed?: unknown; window?: unknown }) : {};
  const feed = (PULSE_FEEDS as readonly unknown[]).includes(value.feed) ? (value.feed as PulseFeed) : "new";
  return { feed, window: pulseWindowOf(feed, value.window) };
}

/** The feed's rows, read now and again while the page is in view; the last answer of each feed stands while the next is read. */
function usePulseFeed(feed: PulseFeed, window: TokenWindow, attempt: number): FeedState {
  const key = `${feed}:${window}`;
  const kept = useRef(new Map<string, Answer>());
  const [state, setState] = useState<FeedState>({ key, status: "loading", answer: null });
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const known = kept.current.get(key) ?? null;
    setState({ key, status: known ? "ready" : "loading", answer: known });
    let first = true;
    const load = async () => {
      /* The first read always; the next ones only while the page is in view. */
      if (!first && document.visibilityState === "hidden") {
        timer = setTimeout(load, POLL_MS[feed]);
        return;
      }
      first = false;
      try {
        const response = await fetch(`/api/spot/pulse?feed=${feed}&window=${window}`, { headers: { accept: "application/json" } });
        if (!response.ok) throw new Error(String(response.status));
        const answer = (await response.json()) as Answer;
        if (!live) return;
        kept.current.set(key, answer);
        setState({ key, status: "ready", answer });
      } catch {
        if (!live) return;
        /* A held answer stays on screen, said to be held; without one the feed says it was not read. */
        const held = kept.current.get(key) ?? null;
        setState({ key, status: held ? "ready" : "failed", answer: held ? { ...held, stale: true } : null });
      }
      if (live) timer = setTimeout(load, POLL_MS[feed]);
    };
    void load();
    /* Back in view: read at once rather than at the next tick. */
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      clearTimeout(timer);
      void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      live = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [feed, window, key, attempt]);
  return state.key === key ? state : { key, status: "loading", answer: null };
}

export function Pulse({ locale }: { locale: WorkspaceLocale }) {
  const word = pulseWords(locale);
  const numbers = locale === "uk" ? "uk-UA" : "en-US";
  const ids = { title: useId(), panel: useId(), filters: useId(), hint: useId() };
  const [view, setView] = useState<{ feed: PulseFeed; window: TokenWindow }>({ feed: "new", window: PULSE_DEFAULT_WINDOW.new });
  const [filter, setFilter] = useState<PulseFilter>(PULSE_FILTER_NONE);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [down, setDown] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const [attempt, setAttempt] = useState(0);
  /* Every reset draws the filter fields afresh, from the panel or from an empty feed. */
  const [filterGeneration, setFilterGeneration] = useState(0);
  const resetFilters = useCallback(() => {
    setFilterGeneration((count) => count + 1);
    setFilter(PULSE_FILTER_NONE);
    setShown(PAGE);
    store(FILTER_KEY, PULSE_FILTER_NONE);
  }, []);
  /* The device's own choices, after the first paint so the server's page and the first client one agree. */
  useEffect(() => {
    setView(readStored(VIEW_KEY, parseView, { feed: "new", window: PULSE_DEFAULT_WINDOW.new }));
    setFilter(readStored(FILTER_KEY, readPulseFilter, PULSE_FILTER_NONE));
  }, []);
  const state = usePulseFeed(view.feed, view.window, attempt);

  /* The rows on screen hold still while the person is pointing at or inside them; a newer answer waits for them. */
  const [holding, setHolding] = useState(false);
  const [drawn, setDrawn] = useState<Answer | null>(null);
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

  const choose = useCallback((feed: PulseFeed, window?: TokenWindow) => {
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
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : event.key === "Home" ? -index : event.key === "End" ? PULSE_FEEDS.length - 1 - index : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = (index + step + PULSE_FEEDS.length) % PULSE_FEEDS.length;
    choose(PULSE_FEEDS[next] as PulseFeed);
    tabs.current[next]?.focus();
  };

  const source = useMemo(() => (view.feed === "movers" && down ? (answer?.down ?? []) : (answer?.rows ?? [])), [answer, view.feed, down]);
  const rows = useMemo(() => source.filter((row) => passesFilter(row, filter, view.window, now)), [source, filter, view.window, now]);
  const active = activeFilters(filter);
  const windows = PULSE_WINDOWS[view.feed];

  return (
    <section className={s.pulse} aria-labelledby={ids.title} data-block="pulse">
      <header className={s.head}>
        <h1 id={ids.title} className={s.title}>{word("title")}</h1>
        <p className={s.lead}>{word("lead")}</p>
      </header>
      <div className={s.card}>
        <div className={s.toolbar}>
          <div className={s.tabs} role="tablist" aria-label={word("feeds")}>
            {PULSE_FEEDS.map((feed, index) => (
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
                onClick={() => choose(feed)}
                onKeyDown={(event) => onTabKey(event, index)}
              >
                {word(FEED_WORD[feed])}
              </button>
            ))}
          </div>
          <div className={s.tools} data-dense="">
            {view.feed === "movers" ? (
              <div className={s.segment} role="group" aria-label={word("direction")}>
                <button type="button" className={s.chip} aria-pressed={!down} onClick={() => { setDown(false); setShown(PAGE); }}>{word("rising")}</button>
                <button type="button" className={s.chip} aria-pressed={down} onClick={() => { setDown(true); setShown(PAGE); }}>{word("falling")}</button>
              </div>
            ) : null}
            {windows.length > 1 ? (
              <div className={s.segment} role="group" aria-label={word("window")}>
                {windows.map((window) => (
                  <button key={window} type="button" className={s.chip} aria-pressed={view.window === window} onClick={() => choose(view.feed, window)}>
                    {word(window)}
                  </button>
                ))}
              </div>
            ) : null}
            <button type="button" className={s.filterButton} aria-expanded={filtersOpen} aria-controls={ids.filters} onClick={() => setFiltersOpen((open) => !open)} data-active={active > 0 ? "true" : undefined}>
              <Funnel size={16} weight="bold" aria-hidden="true" />
              {word("filters")}
              {active > 0 ? <span className={s.badge}>{active}</span> : null}
              <CaretDown size={12} weight="bold" aria-hidden="true" className={s.caret} />
            </button>
          </div>
        </div>
        {filtersOpen ? <Filters key={filterGeneration} id={ids.filters} filter={filter} onChange={changeFilter} onReset={resetFilters} locale={locale} /> : null}
        <div role="tabpanel" id={ids.panel} aria-labelledby={`${ids.panel}-${view.feed}`} className={s.panel}>
          <p className={s.note}>{word(NOTE_WORD[view.feed])}</p>
          {answer?.stale ? <p className={s.held} role="status">{word("held")}</p> : answer?.partial ? <p className={s.held} role="status">{word("partial")}</p> : null}
          {state.status === "loading" && !answer ? (
            <RowsSkeleton />
          ) : state.status === "failed" || !answer ? (
            <div className={s.status} role="status">
              <p>{word("failed")} {word("failedAuto")}</p>
              <button type="button" className="rw-btn" onClick={() => setAttempt((count) => count + 1)}>{word("retry")}</button>
            </div>
          ) : rows.length === 0 ? (
            <div className={s.status} role="status">
              <p>{source.length > 0 ? word("emptyFiltered") : word(view.feed === "soon" ? "emptySoon" : view.feed === "dex" ? "emptyDex" : "emptyFeed")}</p>
              {source.length > 0 && active > 0 ? <button type="button" className="rw-btn" onClick={resetFilters}>{word("filtersResetAll")}</button> : null}
            </div>
          ) : (
            <>
              <div className={s.columns} aria-hidden="true">
                <span data-col="asset">{word("colAsset")}</span>
                <span data-col="price">{word("colPrice")}</span>
                <span data-col="marketCap">{word("colMarketCap")}</span>
                <span data-col="volume">{word("colVolume")} · {word(view.window)}</span>
                <span data-col="liquidity">{word("colLiquidity")}</span>
                <span data-col="holders">{word("colHolders")}</span>
                <span data-col="top10">{word("colTop10")}</span>
                <span data-col="change">{word("colChange")} · {word(view.window)}</span>
                <span data-col="risk">{word("colRisk")}</span>
                <span data-col="quick">{word("colQuick")}</span>
              </div>
              <div className={s.list}>
              {pending ? (
                <button type="button" className={s.pending} onClick={() => setDrawn(latest)} data-dense="">
                  {word("pending")}
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
                  <PulseLine key={row.mint} row={row} window={view.window} now={now} locale={locale} numbers={numbers} hintId={ids.hint} />
                ))}
              </ol>
              </div>
            </>
          )}
        </div>
        <div className={s.foot}>
          {answer && rows.length > 0 ? <span className={s.count}>{word("shown", { shown: Math.min(shown, rows.length), total: rows.length })}</span> : null}
          {answer && rows.length > shown ? (
            <button type="button" className={s.more} onClick={() => setShown((count) => count + PAGE)} data-dense="">
              {word("showMore")}
            </button>
          ) : null}
          <span id={ids.hint} className={s.hint}>{word("quickHint")}</span>
          <span className={s.sources}>
            {answer ? <span>{word("updatedAt", { time: new Date(answer.observedAt).toLocaleTimeString(numbers, { hour: "2-digit", minute: "2-digit", second: "2-digit" }) })} · </span> : null}
            {word("sourceJupiter")}
            {answer?.sources.includes("geckoterminal") ? ` · ${word("sourceGecko")}` : ""}
            {answer?.sources.includes("chain") ? ` · ${word("sourceChain")}` : ""}
          </span>
        </div>
      </div>
    </section>
  );
}

/** A row's level by its facts: none read, none, one, or a suspicious flag or two facts. */
function levelOf(row: PulseRow): "unread" | 0 | 1 | 2 {
  if (!row.auditRead) return "unread";
  if (row.notices.length === 0) return 0;
  return row.notices.includes("FLAGGED") || row.notices.length >= 2 ? 2 : 1;
}

function PulseLine({ row, window, now, locale, numbers, hintId }: { row: PulseRow; window: TokenWindow; now: number; locale: WorkspaceLocale; numbers: string; hintId: string }) {
  const word = pulseWords(locale);
  const [sums] = useQuickBuySums();
  const lang = locale === "uk" ? "uk" : "en";
  const figures = row.windows[window];
  const change = figures.changePct;
  const age = ageText(ageHoursOf(row, now), locale);
  /* A launch paired with a community token keeps its own amounts on its page: the dollar sums would do nothing there. */
  const quick = row.ryntra === null || row.ryntra.dollarPair;

  /* One stop per row for the keyboard: the token's link; the right arrow moves on to the quick sums, the left one back. */
  const onRowKey = (event: KeyboardEvent<HTMLLIElement>) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    const stops = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-stop]")];
    const at = stops.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    const next = stops[at + (event.key === "ArrowRight" ? 1 : -1)];
    if (!next) return;
    event.preventDefault();
    next.focus();
  };

  return (
    <li className={s.row} data-ryntra={row.ryntra ? "true" : undefined} onKeyDown={onRowKey}>
      <div className={s.asset}>
        <MarketIcon mint={row.mint} icon={row.icon} symbol={row.symbol} size={32} className={s.icon} plain={row.ryntra !== null} />
        <div className={s.names}>
          <Link className={s.link} href={pulseHref(row)} prefetch={false} data-stop="" aria-describedby={quick ? hintId : undefined}>
            <span className={s.symbol}>{row.symbol}</span>
            <span className={s.name}>{row.name}</span>
            {quick ? <span className={s.srOnly}>. {word("quickKeys")}</span> : null}
          </Link>
          <span className={s.tags}>
            {row.ryntra ? <span className={s.ryntra} title={word("launchedOnRyntra")}>{word("ryntra")}</span> : row.launchpad ? <span className={s.pad}>{row.launchpad}</span> : null}
            {row.ryntra?.technicalValidation ? <span className={s.tech} title={word("technical")}>{word("technical")}</span> : null}
            <span className={s.age}>{age}</span>
          </span>
          {row.curve ? (
            <span className={s.curve} data-full={row.curve.complete ? "true" : undefined}>
              <span className={s.curveBar} aria-hidden="true">
                <span style={{ width: `${Math.max(2, row.curve.progressPct)}%` }} />
              </span>
              <span className={s.curveText}>{row.curve.complete ? word("curveFull") : `${pctText(row.curve.progressPct, numbers)} ${word("toDex")}`}</span>
            </span>
          ) : null}
        </div>
      </div>
      <Figure col="price" label={word("colPrice")} value={formatUsdPrice(row.price, numbers)} />
      <Figure col="marketCap" label={word("colMarketCap")} value={formatUsdCompact(row.marketCapUsd, numbers)} />
      <Figure col="volume" label={`${word("colVolume")} · ${word(window)}`} value={formatUsdCompact(figures.volumeUsd, numbers)} />
      <Figure col="liquidity" label={word("colLiquidity")} value={formatUsdCompact(row.liquidityUsd, numbers)} />
      <Figure col="holders" label={word("colHolders")} value={row.holders === null ? "—" : `${row.holdersAtLeast ? "≥ " : ""}${formatCount(row.holders, numbers)}`} />
      <Figure col="top10" label={word("colTop10")} value={row.top10Pct === null ? "—" : pctText(row.top10Pct, numbers, row.top10Pct < 10 ? 1 : 0)} />
      <span className={s.change} data-col="change" data-tone={toneOf(change)}>
        <span className={s.srOnly}>{word("colChange")} · {word(window)}: </span>
        {changeText(change, numbers)}
      </span>
      <Facts row={row} locale={locale} />
      <span className={s.quick} data-col="quick">
        {quick
          ? sums.map((usd, index) => (
              <Link
                key={`${usd}-${index}`}
                className={s.quickSum}
                href={pulseHref(row, usd)}
                prefetch={false}
                tabIndex={-1}
                data-stop=""
                aria-label={word("quickBuyOf", { symbol: row.symbol, sum: quickSumLabel(usd, lang, true) })}
              >
                {quickSumLabel(usd, lang)}
              </Link>
            ))
          : null}
      </span>
    </li>
  );
}

/** The facts against a token: a count by colour, and on a press the facts themselves — never a verdict. */
function Facts({ row, locale }: { row: PulseRow; locale: WorkspaceLocale }) {
  const word = pulseWords(locale);
  const id = useId();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !box.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  const level = levelOf(row);
  const lines = level === "unread" ? [word("noticeUnread")] : row.notices.length === 0 ? [word("noticeNone")] : row.notices.map((code) => word(code));
  return (
    <span ref={box} className={s.facts} data-col="risk">
      <button
        type="button"
        className={s.risk}
        data-level={level}
        aria-expanded={open}
        aria-controls={id}
        aria-label={level === "unread" ? word("noticeUnread") : word("noticeCount", { count: row.notices.length })}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={s.riskLabel} aria-hidden="true">{word("colRisk")}</span>
        {level === "unread" ? "—" : level === 0 ? "0" : (
          <>
            <ShieldWarning size={15} weight="fill" aria-hidden="true" />
            {row.notices.length}
          </>
        )}
      </button>
      {open ? (
        <span id={id} className={s.factsList} role="group" aria-label={word("noticeOf", { symbol: row.symbol })}>
          {lines.map((line) => (
            <span key={line} className={s.factLine}>{line}</span>
          ))}
          {level === "unread" ? null : <span className={s.factNote}>{word("noticeChecked")}</span>}
        </span>
      ) : null}
    </span>
  );
}

function Figure({ col, label, value }: { col: string; label: string; value: string }) {
  return (
    <span className={s.figure} data-col={col}>
      <span className={s.figureLabel}>{label}</span>
      <span className={s.figureValue}>{value}</span>
    </span>
  );
}

function RowsSkeleton() {
  return (
    <div className={s.skeleton} aria-hidden="true">
      {Array.from({ length: 8 }, (_, index) => (
        <span key={index} className={s.bone} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------ filters */

function Filters({ id, filter, onChange, onReset, locale }: { id: string; filter: PulseFilter; onChange: (next: PulseFilter) => void; onReset: () => void; locale: WorkspaceLocale }) {
  const word = pulseWords(locale);
  /* A reset draws every field afresh; a field holding a text that is no number keeps «Скинути» in sight. */
  const [generation, setGeneration] = useState(0);
  const [unread, setUnread] = useState<ReadonlySet<string>>(new Set());
  const markUnread = useCallback((key: string, invalid: boolean) => {
    setUnread((current) => {
      if (current.has(key) === invalid) return current;
      const next = new Set(current);
      if (invalid) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);
  const reset = () => {
    setGeneration((count) => count + 1);
    setUnread(new Set());
    onReset();
  };
  const field = (key: Exclude<keyof PulseFilter, "noNotices">, placeholder: string, label: string) => (
    <BoundInput
      key={`${key}:${generation}`}
      value={filter[key]}
      placeholder={placeholder}
      label={label}
      locale={locale}
      onChange={(value) => onChange({ ...filter, [key]: value })}
      onValidity={(invalid) => markUnread(key, invalid)}
    />
  );
  return (
    <div id={id} className={s.filters} data-dense="">
      <fieldset className={s.group}>
        <legend>{word("fMarketCap")}</legend>
        {field("marketCapMin", word("from"), `${word("fMarketCap")} ${word("from")}`)}
        {field("marketCapMax", word("to"), `${word("fMarketCap")} ${word("to")}`)}
      </fieldset>
      <fieldset className={s.group}>
        <legend>{word("fLiquidity")}</legend>
        {field("liquidityMin", word("from"), `${word("fLiquidity")} ${word("from")}`)}
      </fieldset>
      <fieldset className={s.group}>
        <legend>{word("fVolume")}</legend>
        {field("volumeMin", word("from"), `${word("fVolume")} ${word("from")}`)}
      </fieldset>
      <fieldset className={s.group}>
        <legend>{word("fAge")}</legend>
        {field("ageMinHours", word("from"), `${word("fAge")} ${word("from")}`)}
        {field("ageMaxHours", word("to"), `${word("fAge")} ${word("to")}`)}
      </fieldset>
      <fieldset className={s.group}>
        <legend>{word("fHolders")}</legend>
        {field("holdersMin", word("from"), `${word("fHolders")} ${word("from")}`)}
      </fieldset>
      <fieldset className={s.group}>
        <legend>{word("fTop10")}</legend>
        {field("top10Max", word("atMost"), `${word("fTop10")} ${word("atMost")}`)}
      </fieldset>
      <fieldset className={s.group}>
        <legend>{word("fDev")}</legend>
        {field("devMax", word("atMost"), `${word("fDev")} ${word("atMost")}`)}
      </fieldset>
      <label className={s.check}>
        <input type="checkbox" checked={filter.noNotices} onChange={(event) => onChange({ ...filter, noNotices: event.target.checked })} />
        {word("fNoNotices")}
      </label>
      {activeFilters(filter) > 0 || unread.size > 0 ? (
        <button type="button" className={s.reset} onClick={reset}>
          {word("filtersReset")}
        </button>
      ) : null}
    </div>
  );
}

/** One bound as typed: the text stays the person's while they type; the filter takes the number it reads as, and a text that is no number says so. */
function BoundInput({ value, placeholder, label, locale, onChange, onValidity }: { value: number | null; placeholder: string; label: string; locale: WorkspaceLocale; onChange: (value: number | null) => void; onValidity: (invalid: boolean) => void }) {
  const word = pulseWords(locale);
  const numbers = locale === "uk" ? "uk-UA" : "en-US";
  const format = useCallback((number: number | null) => (number === null ? "" : new Intl.NumberFormat(numbers, { maximumFractionDigits: 2 }).format(number)), [numbers]);
  const [text, setText] = useState(() => format(value));
  const invalid = parseBound(text, locale) === "invalid";
  const errorId = useId();
  useEffect(() => {
    onValidity(invalid);
  }, [invalid, onValidity]);
  return (
    <span className={s.inputBox}>
      <input
        className={s.input}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        placeholder={placeholder}
        aria-label={label}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? errorId : undefined}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          const read = parseBound(event.target.value, locale);
          onChange(read === "invalid" ? null : read);
        }}
        onBlur={() => {
          const read = parseBound(text, locale);
          if (read !== "invalid") setText(format(read));
        }}
      />
      {invalid ? <span id={errorId} className={s.invalid}>{word("fInvalid")}</span> : null}
    </span>
  );
}
