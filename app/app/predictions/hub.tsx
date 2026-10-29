"use client";

import { ArrowDown, ArrowUp, Eye, EyeSlash, MagnifyingGlass, SlidersHorizontal } from "@phosphor-icons/react";
import { ChartCaption } from "@ryntra/core/chart/compact";
import { EmptyState } from "@ryntra/core/ui";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import { marketAccess } from "@/lib/predictions/access";
import { hubList, type HubTab } from "@/lib/predictions/hub-lists";
import type { PredictionCategory, PredictionEventSummary } from "@/lib/predictions/model";
import { arrangeCategories, moveCategory } from "@/lib/predictions/preferences";

import { AccountCard, ConnectAction } from "./account-card";
import { EventCard } from "./event-card";
import { pct, pctPoints, timeLeft } from "./format";
import styles from "./predictions.module.css";
import { usePredictPrefs } from "./prefs-context";
import { useAccessFacts, useWeeksStatus } from "./use-market-facts";
import { usePaperAccount } from "./use-paper-account";
import { categoryName, wordsFor } from "./words";
import { usePredictionsPaths } from "./surface";

/**
 * The Predictions hub: search, Trending, Ending soon, New, the watchlist, the
 * provider's real categories with a count each (an empty one is not drawn),
 * and *needs attention* — what moved since the person watched it, what is
 * about to end, where a position is open. The first page arrives with the
 * server render; every other list is one read of `/api/predictions/discover`.
 * A browsed list shows only what still trades; New holds the short recurring
 * rounds back behind one button.
 */

type Tab = HubTab;

type ListState =
  | Readonly<{ status: "ready"; events: readonly PredictionEventSummary[]; readAt: string }>
  | Readonly<{ status: "loading"; events: readonly PredictionEventSummary[] }>
  | Readonly<{ status: "failed"; events: readonly PredictionEventSummary[]; code: string }>;

type DiscoverAnswer = { events: PredictionEventSummary[]; readAt: string; error?: { code?: string } };

const SORT_OF: Readonly<Record<"trending" | "ending" | "newest", "volume24h" | "ending" | "newest">> = { trending: "volume24h", ending: "ending", newest: "newest" };
const MOVE_PP = 0.05;
const SOON_MS = 24 * 3_600_000;

export function PredictionsHub({
  locale,
  categories,
  initial,
  initialReadAt,
  feedFailed,
}: {
  locale: WorkspaceLocale;
  categories: readonly PredictionCategory[];
  initial: readonly PredictionEventSummary[];
  initialReadAt: string;
  /** The server could not read the feed: the page says so and the browser retries. */
  feedFailed: string | null;
}) {
  const paths = usePredictionsPaths();
  const word = wordsFor(locale);
  const account = usePaperAccount();
  const access = useAccessFacts(account.state);
  const weeksStatus = useWeeksStatus();
  const [tab, setTab] = useState<Tab>("trending");
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [list, setList] = useState<ListState>(feedFailed ? { status: "failed", events: [], code: feedFailed } : { status: "ready", events: initial, readAt: initialReadAt });
  const [watchedIds, setWatchedIds] = useState<ReadonlySet<string>>(new Set());
  const [watchedEvents, setWatchedEvents] = useState<readonly PredictionEventSummary[]>([]);
  /* The clock the list was read at: the server and the browser filter the first page alike. */
  const nowMs = useMemo(() => (list.status === "ready" && Number.isFinite(Date.parse(list.readAt)) ? Date.parse(list.readAt) : Date.now()), [list]);
  const generation = useRef(0);
  const { prefs, change } = usePredictPrefs();
  const [arranging, setArranging] = useState(false);
  /* New with the short recurring rounds in it: the person's ask, for this visit. */
  const [rounds, setRounds] = useState(false);

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(handle);
  }, [query]);

  /* The watchlist as the account holds it; the events behind it read once per account refresh. */
  const watchlist = account.state.account?.watchlist;
  const entries = useMemo(() => watchlist ?? [], [watchlist]);
  useEffect(() => {
    setWatchedIds(new Set(entries.map((e) => e.eventId)));
    if (entries.length === 0) {
      setWatchedEvents([]);
      return;
    }
    let live = true;
    void fetch(`/api/predictions/events?ids=${encodeURIComponent(entries.map((e) => e.eventId).join(","))}`, { headers: { accept: "application/json" }, cache: "no-store" })
      .then(async (r) => (r.ok ? ((await r.json()) as { events: PredictionEventSummary[] }).events : []))
      .then((events) => {
        if (live) setWatchedEvents(events);
      })
      .catch(() => null);
    return () => {
      live = false;
    };
  }, [entries]);

  const read = useCallback(
    async (nextTab: Tab, q: string) => {
      const mine = ++generation.current;
      setList((prev) => ({ status: "loading", events: prev.events }));
      const params = new URLSearchParams();
      if (q.length > 0) params.set("q", q);
      else if (nextTab.startsWith("category:")) params.set("category", nextTab.slice(9));
      else if (nextTab !== "watchlist") params.set("sort", SORT_OF[nextTab as "trending" | "ending" | "newest"]);
      /* New reads a longer page: the short rounds it holds back would otherwise leave it near empty. */
      params.set("limit", nextTab === "newest" && q.length === 0 ? "50" : "24");
      try {
        const response = await fetch(`/api/predictions/discover?${params.toString()}`, { headers: { accept: "application/json" }, cache: "no-store" });
        const body = (await response.json()) as DiscoverAnswer;
        if (mine !== generation.current) return;
        if (!response.ok) {
          setList((prev) => ({ status: "failed", events: prev.events, code: body.error?.code ?? "UNAVAILABLE" }));
          return;
        }
        setList({ status: "ready", events: body.events, readAt: body.readAt });
      } catch {
        if (mine !== generation.current) return;
        setList((prev) => ({ status: "failed", events: prev.events, code: "NETWORK" }));
      }
    },
    [],
  );

  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      if (!feedFailed) return;
    }
    if (tab === "watchlist" && debounced.length === 0) return;
    void read(tab, debounced);
  }, [tab, debounced, read, feedFailed]);

  const onWatch = useCallback(
    async (event: PredictionEventSummary, watched: boolean) => {
      if (account.state.status !== "ready") return;
      setWatchedIds((prev) => {
        const next = new Set(prev);
        if (watched) next.add(event.id);
        else next.delete(event.id);
        return next;
      });
      const leading = event.leading[0] ?? null;
      await fetch("/api/predictions/watchlist", {
        method: "PUT",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ eventId: event.id, watched, venueMarketId: leading?.venueMarketId ?? null, outcomeLabel: leading?.label ?? null, probabilityAtWatch: leading?.probability ?? null }),
      }).catch(() => null);
      void account.refresh();
    },
    [account],
  );

  /* What moved since it was watched: the leading outcome now against the probability kept at watch time. */
  const deltas = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of entries) {
      const current = watchedEvents.find((e) => e.id === entry.eventId);
      const lead = current?.leading.find((o) => o.label === entry.outcomeLabel) ?? current?.leading[0];
      /* Only the market that was watched: once the card leads with another, its price is a different question. */
      const same = !entry.venueMarketId || lead?.venueMarketId === entry.venueMarketId;
      if (same && entry.probabilityAtWatch != null && lead?.probability != null) map.set(entry.eventId, lead.probability - entry.probabilityAtWatch);
    }
    return map;
  }, [entries, watchedEvents]);

  const attention = useMemo(() => {
    const rows: { key: string; eventId: string; title: string; why: string; tone: "pos" | "neg" | undefined }[] = [];
    for (const event of watchedEvents) {
      const delta = deltas.get(event.id);
      if (delta != null && Math.abs(delta) >= MOVE_PP) rows.push({ key: `move:${event.id}`, eventId: event.id, title: event.title, why: `${pctPoints(delta)} ${word("sinceWatched")} · ${pct(event.leading[0]?.probability)}`, tone: delta > 0 ? "pos" : "neg" });
      if (event.endDate && Date.parse(event.endDate) - nowMs < SOON_MS && Date.parse(event.endDate) > nowMs) rows.push({ key: `soon:${event.id}`, eventId: event.id, title: event.title, why: `${word("ends")} ${timeLeft(event.endDate, locale, nowMs)}`, tone: undefined });
    }
    for (const position of account.state.account?.positions ?? []) {
      const eventId = position.eventId ?? position.venueEventId;
      const outcome = position.outcomes[0];
      rows.push({ key: `pos:${eventId}`, eventId, title: position.question, why: outcome ? `${word("yourPosition")}: ${outcome.label} · ${pct(outcome.currentPrice)} · ${outcome.unrealizedPnl >= 0 ? "+" : ""}${outcome.unrealizedPnl.toFixed(2)}` : word("yourPosition"), tone: outcome ? (outcome.unrealizedPnl >= 0 ? "pos" : "neg") : undefined });
    }
    return rows.slice(0, 8);
  }, [watchedEvents, deltas, account.state.account?.positions, nowMs, locale, word]);

  const liveCategories = categories.filter((c) => c.eventCount > 0);
  const shownCategories = arrangeCategories(liveCategories, prefs.hub);
  /* Every category in the person's order, the put-away ones included, for the hub's own settings. */
  const orderedCategories = arrangeCategories(liveCategories, { ...prefs.hub, hidden: [] });
  const hiddenCategories = new Set(prefs.hub.hidden);
  /* Only the categories the provider lists today count as put away. */
  const hiddenListed = liveCategories.filter((c) => hiddenCategories.has(c.slug)).length;
  const searching = debounced.length > 0;
  const listed = hubList(tab === "watchlist" && !searching ? watchedEvents : list.events, { tab, searching, rounds }, nowMs);
  const shown = listed.events;
  const canWatch = account.state.status === "ready";

  return (
    <>
      {account.state.status === "ready" && attention.length > 0 ? (
        <section className={styles.card} aria-labelledby="pred-attention">
          <div className={styles.cardHead}>
            <h2 id="pred-attention" className={styles.cardTitle}>
              {word("attention")}
            </h2>
          </div>
          <div className={styles.attention}>
            {attention.map((row) => (
              <div key={row.key} className={styles.attentionRow}>
                <span>
                  <Link href={paths.event(row.eventId)} prefetch={false}>
                    {row.title}
                  </Link>
                  <br />
                  <span className={styles.attentionWhy}>{row.why}</span>
                </span>
                <span className={styles.delta} data-tone={row.tone} aria-hidden="true">
                  →
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className={styles.card} aria-labelledby="pred-markets">
        <div className={styles.toolbar}>
          <label className={styles.search}>
            <MagnifyingGlass size={16} aria-hidden="true" />
            <input type="search" value={query} placeholder={word("searchPlaceholder")} aria-label={word("search")} onChange={(e) => setQuery(e.target.value)} autoComplete="off" spellCheck={false} />
          </label>
          <div className={styles.tabs} role="tablist" aria-label={word("markets")}>
            {(
              [
                ["trending", word("trending")],
                ["ending", word("endingSoon")],
                ["newest", word("newest")],
                ["watchlist", `${word("watchlist")}${entries.length ? ` · ${entries.length}` : ""}`],
              ] as const
            ).map(([id, label]) => (
              <button key={id} type="button" role="tab" className={styles.tab} aria-selected={!searching && tab === id} data-on={!searching && tab === id} onClick={() => { setQuery(""); setTab(id); }}>
                {label}
              </button>
            ))}
          </div>
        </div>
        {liveCategories.length > 0 ? (
          <div className={styles.chipRow} role="group" aria-label={word("categories")}>
            <button type="button" className={styles.chip} aria-pressed={!searching && !tab.startsWith("category:")} onClick={() => { setQuery(""); setTab("trending"); }}>
              {word("allCategories")}
            </button>
            {shownCategories.map((c) => (
              <button key={c.id} type="button" className={styles.chip} aria-pressed={!searching && tab === `category:${c.slug}`} onClick={() => { setQuery(""); setTab(`category:${c.slug}`); }}>
                {categoryName(c.slug, c.name, locale)}
                <small>{c.eventCount.toLocaleString("en-US")}</small>
              </button>
            ))}
            {change ? (
              <button type="button" className={styles.chip} aria-expanded={arranging} title={word("hubCategoriesHelp")} onClick={() => setArranging((open) => !open)}>
                <SlidersHorizontal size={14} aria-hidden="true" />
                <span className="sr-only">{word("hubCategories")}</span>
                {hiddenListed > 0 ? <small>{`${word("hiddenCategories")} · ${hiddenListed}`}</small> : null}
              </button>
            ) : null}
          </div>
        ) : null}
        {arranging && change ? (
          <div className={styles.panelList} role="region" aria-label={word("hubCategories")}>
            <p className={styles.muted}>{word("hubCategoriesHelp")}</p>
            <ul>
              {orderedCategories.map((c, index) => {
                const name = categoryName(c.slug, c.name, locale);
                const hidden = hiddenCategories.has(c.slug);
                const order = orderedCategories.map((x) => x.slug);
                return (
                  <li key={c.id} data-hidden={hidden || undefined}>
                    <span>{name}</span>
                    <button type="button" className={styles.iconButton} aria-label={`${word("moveUp")}: ${name}`} disabled={index === 0} onClick={() => change({ hub: { ...prefs.hub, order: moveCategory(order, c.slug, -1) } })}>
                      <ArrowUp size={16} aria-hidden="true" />
                    </button>
                    <button type="button" className={styles.iconButton} aria-label={`${word("moveDown")}: ${name}`} disabled={index === orderedCategories.length - 1} onClick={() => change({ hub: { ...prefs.hub, order: moveCategory(order, c.slug, 1) } })}>
                      <ArrowDown size={16} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className={styles.iconButton}
                      aria-pressed={!hidden}
                      aria-label={`${word("panelShow")}: ${name}`}
                      onClick={() => {
                        // The category on screen put away: the hub goes back to what is trending.
                        if (!hidden && tab === `category:${c.slug}`) setTab("trending");
                        change({ hub: { ...prefs.hub, hidden: hidden ? prefs.hub.hidden.filter((slug) => slug !== c.slug) : [...prefs.hub.hidden, c.slug] } });
                      }}
                    >
                      {hidden ? <EyeSlash size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
        <h2 id="pred-markets" className="sr-only">
          {word("markets")}
        </h2>
        {list.status === "failed" && shown.length === 0 ? (
          <div className={styles.unavailable} role="status">
            <b>{word("unavailableTitle")}</b>
            <p className={styles.muted}>{list.code === "RATE_LIMITED" ? word("rateLimited") : word("unavailable")}</p>
            <button type="button" className="rw-btn" onClick={() => void read(tab, debounced)}>
              {word("retry")}
            </button>
          </div>
        ) : list.status === "loading" && shown.length === 0 ? (
          <div className={styles.skeleton} aria-busy="true" aria-label={word("loading")}>
            <span className={styles.bone} data-tall="true" />
            <span className={styles.bone} data-tall="true" />
            <span className={styles.bone} data-tall="true" />
          </div>
        ) : shown.length === 0 && listed.heldRounds === 0 ? (
          <div className={styles.unavailable} role="status">
            {tab === "watchlist" && !searching && account.state.status === "guest" ? (
              <EmptyState icon="wallet" text={word("watchlistGuest")} action={<ConnectAction account={account} locale={locale} />} />
            ) : (
              <p className={styles.muted}>{searching ? word("searchEmpty") : word("empty")}</p>
            )}
          </div>
        ) : shown.length === 0 ? null : (
          <>
          {/* Access the provider has not stated yet is said once over the cards, not on each of them. */}
          {/* Until the account is read nobody knows whose access it is: said once it is. */}
          {account.state.status !== "loading" && shown.some((event) => marketAccess(event.venues, access) === "unknown") ? (
            <p className={styles.accessLine}>{account.state.status === "guest" ? word("accessAfterConnect") : word("accessUnknownWhy")}</p>
          ) : null}
          <div className={styles.grid} style={{ "--pred-cols": prefs.hub.columns } as React.CSSProperties} aria-busy={list.status === "loading"}>
            {shown.map((event) => (
              <EventCard key={event.id} event={event} locale={locale} watched={watchedIds.has(event.id)} onWatch={canWatch ? onWatch : null} nowMs={nowMs} access={access} />
            ))}
          </div>
          {weeksStatus ? <ChartCaption className={styles.gridCaption} status={weeksStatus} lang={locale === "uk" ? "uk" : "en"} size="short" /> : null}
          </>
        )}
        {listed.heldRounds > 0 ? (
          <div className={styles.moreRow}>
            <button type="button" className="rw-btn" onClick={() => setRounds(true)}>
              {word("showRounds")} · {listed.heldRounds}
            </button>
          </div>
        ) : null}
        <details className={styles.disclosure}>
          <summary>{word("sources")}</summary>
          <div className={styles.disclosureBody}>
            <p>{word("providerNote")}</p>
            <p>
              {word("dataAsOf")} <span className={styles.mono}>{list.status === "ready" ? list.readAt.replace("T", " ").slice(0, 19) : "—"} UTC</span>
            </p>
          </div>
        </details>
      </section>

      <AccountCard account={account} locale={locale} compact />
    </>
  );
}
