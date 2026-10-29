"use client";

import { ArrowSquareOut, ArrowsLeftRight, Drop, LockOpen, Plus, Rocket, ShieldWarning, TrendDown, Vault, Warning } from "@phosphor-icons/react";
import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import s from "@/app/app/home/pulse.module.css";
import { formatRaw } from "@/app/app/launch/launch-format";
import { launchWords, type LaunchWordKey } from "@/app/app/launch/launch-words";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { MarketIcon } from "@/app/solana/workspace/spot/market-list";
import type { MarketEventsResponse, MarketEventView } from "@/lib/api/v1/contract";
import { ageSeconds, EVENT_GROUP_IDS, EVENT_GROUPS, orderEvents, type EventGroup, type EventKind } from "@/lib/events/market-events";
import { shortMint } from "@/lib/spot/pulse";

import { agoText, eventsWords, VENUE_NAMES, type EventsWord } from "./events-words";
import e from "./events.module.css";

/**
 * «Події ринку» (DSC-1) — one feed of what happened on Solana's markets, beside the Radar in «Ринки» (`?tab=events`)
 * and as a block on Home under Pulse. Read from `/api/v1/events`: each event with its kind, when it happened and when
 * Ryntra saw it, its sources, how final it is, the transaction or the account on the explorer, and the token's Pulse
 * risk flags; a suspicious token's event with its reason, never at the top (the server's order). No wallet, no advice
 * and no trade button: a token opens its own page, where the quote and the Review are.
 *
 * The feed is read again every twenty seconds while the page is in view; a newer answer never moves the rows under a
 * pointer or a focus — it waits behind «Нові події — показати».
 */

const POLL_MS = 20_000;
const PAGE = 20;
const KIND_ICON: Readonly<Record<EventKind, ReactNode>> = {
  TOKEN_CREATED: <Plus size={14} weight="bold" aria-hidden="true" />,
  DEX_LISTED: <Rocket size={14} weight="bold" aria-hidden="true" />,
  ALPHA_VAULT: <Vault size={14} weight="bold" aria-hidden="true" />,
  LIQUIDITY_CHANGED: <Drop size={14} weight="bold" aria-hidden="true" />,
  CONCENTRATION_CHANGED: <ArrowsLeftRight size={14} weight="bold" aria-hidden="true" />,
  AUTHORITY_OPEN: <ShieldWarning size={14} weight="bold" aria-hidden="true" />,
  UNLOCK: <LockOpen size={14} weight="bold" aria-hidden="true" />,
  CREATOR_SOLD: <TrendDown size={14} weight="bold" aria-hidden="true" />,
  QUOTE_CHANGED: <ArrowsLeftRight size={14} weight="bold" aria-hidden="true" />,
  LAUNCH_LOG: <Rocket size={14} weight="bold" aria-hidden="true" />,
};

type FeedState = Readonly<{ url: string; status: "loading" | "ready" | "failed"; answer: MarketEventsResponse | null }>;

/**
 * The feed, read now and again while the page is in view; the last answer of the same address stands, said to be held,
 * while a read fails. An answer is the answer of its address only: another group's cut is never drawn under this one.
 */
function useEventsFeed(url: string, attempt: number): FeedState {
  const [state, setState] = useState<FeedState>({ url, status: "loading", answer: null });
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let first = true;
    const load = async () => {
      if (!first && document.visibilityState === "hidden") {
        timer = setTimeout(load, POLL_MS);
        return;
      }
      first = false;
      try {
        const response = await fetch(url, { headers: { accept: "application/json", "x-ryntra-api": "1" } });
        if (!response.ok) throw new Error(String(response.status));
        const answer = (await response.json()) as MarketEventsResponse;
        if (live) setState({ url, status: "ready", answer });
      } catch {
        if (live) setState((held) => (held.url === url && held.answer ? { url, status: "ready", answer: { ...held.answer, stale: true } } : { url, status: "failed", answer: null }));
      }
      if (live) timer = setTimeout(load, POLL_MS);
    };
    void load();
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
  }, [url, attempt]);
  return state.url === url ? state : { url, status: "loading", answer: null };
}

/** The clock the «seen … ago» reads by, a tick every ten seconds. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** A row the screener's search finds: by ticker, by name, or by the mint itself. */
function matches(event: MarketEventView, query: string): boolean {
  const text = query.trim().toLowerCase();
  if (!text) return true;
  return event.token.symbol.toLowerCase().includes(text) || event.token.name.toLowerCase().includes(text) || event.token.mint.toLowerCase() === text;
}

/**
 * `place`: «markets» — the whole feed with its kinds, in «Ринки»; «home» — a block of the newest few on Home, with the
 * way to the whole feed. `rows`: how many show before «Показати ще».
 */
export function MarketEvents({ locale, place = "markets", query = "", rows: first = PAGE }: { locale: WorkspaceLocale; place?: "markets" | "home"; query?: string; rows?: number }) {
  const word = eventsWords(locale);
  const numbers = locale === "uk" ? "uk-UA" : "en-US";
  const ids = { title: useId(), panel: useId() };
  const [group, setGroup] = useState<EventGroup>("all");
  const [shown, setShown] = useState(first);
  useEffect(() => setShown(first), [first]);
  const [attempt, setAttempt] = useState(0);
  /* Each group asks the server for its own kinds: a group never loses events to a cut made across every kind. */
  const url = place === "home" ? "/api/v1/events?limit=40" : group === "all" ? "/api/v1/events?limit=200" : `/api/v1/events?kinds=${EVENT_GROUPS[group].join(",")}&limit=200`;
  const state = useEventsFeed(url, attempt);
  const now = useNow();

  /* The rows on screen hold still while the person points at or is inside them; a newer answer waits for them. */
  const [holding, setHolding] = useState(false);
  const [drawn, setDrawn] = useState<MarketEventsResponse | null>(null);
  const latest = state.answer;
  useEffect(() => {
    setDrawn((current) => (holding && current ? current : latest));
  }, [latest, holding]);
  /* The same read marked held after a failed refresh is drawn as held, even under a pointer. */
  const answer = drawn && latest && drawn.observedAt === latest.observedAt ? latest : (drawn ?? latest);
  const pending = answer !== null && latest !== null && answer !== latest && answer.observedAt !== latest.observedAt;

  const choose = useCallback(
    (next: EventGroup) => {
      setGroup(next);
      setShown(first);
      /* A new group draws its own answer at once: nothing held from the last one. */
      setDrawn(null);
      setHolding(false);
    },
    [first],
  );
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const count = EVENT_GROUP_IDS.length;
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : event.key === "Home" ? -index : event.key === "End" ? count - 1 - index : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = (index + step + count) % count;
    choose(EVENT_GROUP_IDS[next] as EventGroup);
    tabs.current[next]?.focus();
  };

  const kinds = useMemo(() => new Set<string>(EVENT_GROUPS[group]), [group]);
  /* Ordered again after the group and the search: a filter never lifts a suspicious token's event to the top. */
  const events = useMemo(() => orderEvents((answer?.events ?? []).filter((event) => kinds.has(event.kind) && matches(event, query))), [answer, kinds, query]);
  const notRead = (answer?.coverage ?? []).filter((item) => item.state === "not-read").map((item) => word(`notRead_${item.kind}` as EventsWord));
  const partRead = (answer?.coverage ?? []).filter((item) => item.state === "partial").map((item) => word(`partRead_${item.kind}` as EventsWord));
  /* An emptied list leaves no element to say the pointer left it: nothing is held over an empty list. */
  useEffect(() => {
    if (events.length === 0) setHolding(false);
  }, [events.length]);
  const logsShort = answer?.logs && answer.logs.read < answer.logs.markets ? word("logsRead", { read: answer.logs.read, markets: answer.logs.markets }) : null;
  const home = place === "home";

  return (
    <section className={`${s.pulse} ${e.events}`} aria-labelledby={ids.title} data-block="events" data-place={place}>
      <div className={s.card}>
        <header className={s.head}>
          <h2 id={ids.title} className={s.title}>
            {home ? word("homeTitle") : word("title")}
          </h2>
          <span className={e.readOnly}>{word("readOnly")}</span>
        </header>
        {home ? null : (
          <div className={s.toolbar}>
            <div className={s.tabs} role="tablist" aria-label={word("groups")}>
              {EVENT_GROUP_IDS.map((id, index) => (
                <button
                  key={id}
                  ref={(node) => {
                    tabs.current[index] = node;
                  }}
                  type="button"
                  role="tab"
                  id={`${ids.panel}-${id}`}
                  aria-selected={group === id}
                  aria-controls={ids.panel}
                  tabIndex={group === id ? 0 : -1}
                  className={s.tab}
                  data-group={id}
                  onClick={() => choose(id)}
                  onKeyDown={(event) => onTabKey(event, index)}
                >
                  {word(`group_${id}` as EventsWord)}
                </button>
              ))}
            </div>
          </div>
        )}
        <div role={home ? undefined : "tabpanel"} id={ids.panel} aria-labelledby={home ? undefined : `${ids.panel}-${group}`} className={s.panel}>
          <p className={`${s.note} ${e.note}`}>{home ? word("lead") : word("noAdvice")}</p>
          {answer?.stale ? <p className={s.held} role="status">{word("held")}</p> : null}
          {answer?.partial ? <p className={s.held} role="status">{word("partial")}</p> : null}
          {state.status === "loading" && !answer ? (
            <div className={s.skeleton} aria-hidden="true">
              {Array.from({ length: home ? 5 : 8 }, (_, index) => (
                <span key={index} className={s.bone} />
              ))}
            </div>
          ) : state.status === "failed" || !answer ? (
            <div className={s.status} role="status">
              <p>
                {word("failed")} {word("failedAuto")}
              </p>
              <button type="button" className="rw-btn" onClick={() => setAttempt((count) => count + 1)}>
                {word("retry")}
              </button>
            </div>
          ) : events.length === 0 ? (
            <div className={`${s.status} ${e.empty}`} role="status">
              <p>{group === "launch" ? word("emptyLaunch") : word("empty")}</p>
              {pending ? (
                <button type="button" className="rw-btn" onClick={() => setDrawn(latest)}>
                  {word("pending")}
                </button>
              ) : null}
            </div>
          ) : (
            <div className={s.list}>
              {pending ? (
                <button type="button" className={s.pending} onClick={() => setDrawn(latest)} data-dense="">
                  {word("pending")}
                </button>
              ) : null}
              <ol
                className={e.rows}
                data-observed-at={answer.observedAt}
                onPointerEnter={() => setHolding(true)}
                onPointerLeave={() => setHolding(false)}
                onFocus={() => setHolding(true)}
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHolding(false);
                }}
              >
                {events.slice(0, shown).map((event) => (
                  <EventLine key={event.id} event={event} locale={locale} numbers={numbers} now={now} />
                ))}
              </ol>
            </div>
          )}
        </div>
        <div className={s.foot}>
          {/* The total the server found for the group; with a search, what the search kept of it. */}
          {answer && events.length > 0 ? <span className={s.count}>{word("shown", { shown: Math.min(shown, events.length), total: query.trim() ? events.length : Math.max(answer.total, events.length) })}</span> : null}
          {answer && events.length > shown && !home ? (
            <button type="button" className={s.more} onClick={() => setShown((count) => count + PAGE)} data-dense="">
              {word("showMore")}
            </button>
          ) : null}
          {home ? (
            <Link className={`${s.more} ${e.moreLink}`} href="/app/markets?tab=events" prefetch={false} data-dense="">
              {word("allEvents")}
            </Link>
          ) : null}
          <span className={s.sources}>
            {answer ? <span>{word("updatedAt", { time: new Date(answer.observedAt).toLocaleTimeString(numbers, { hour: "2-digit", minute: "2-digit", second: "2-digit" }) })} · </span> : null}
            {word("dataFrom", { list: (answer?.sources.length ? answer.sources : (["jupiter"] as const)).map((source) => word(`source_${source}` as EventsWord)).join(" · ") })}
          </span>
          {!home && notRead.length > 0 ? <span className={e.coverage}>{word("notRead", { list: notRead.join(", ") })}</span> : null}
          {!home && partRead.length > 0 ? <span className={e.coverage}>{word("partRead", { list: partRead.join("; ") })}</span> : null}
          {!home && logsShort ? <span className={e.coverage}>{logsShort}</span> : null}
          {!home && answer && answer.total > (answer.events.length ?? 0) && !query.trim() ? <span className={e.coverage}>{word("newestLoaded", { count: answer.events.length })}</span> : null}
        </div>
      </div>
    </section>
  );
}

/** When, in the reader's own clock: the time to the second for today, the day and the time before that. */
function momentText(at: string, numbers: string, now: number): string {
  const date = new Date(at);
  const today = new Date(now).toDateString() === date.toDateString();
  return today
    ? date.toLocaleTimeString(numbers, { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : date.toLocaleString(numbers, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function pctOfBps(bps: number, numbers: string): string {
  return `${new Intl.NumberFormat(numbers, { maximumFractionDigits: bps < 1000 ? 1 : 0 }).format(bps / 100)}${numbers === "uk-UA" ? " %" : "%"}`;
}

/** What an event says, in one line: its route, its actor, its share, its amount — the facts its kind carries. */
function detailOf(event: MarketEventView, locale: WorkspaceLocale, numbers: string): string {
  const word = eventsWords(locale);
  const log = launchWords(locale);
  const amount = event.pairRaw && event.pair && BigInt(event.pairRaw) > 0n ? `${formatRaw(event.pairRaw, event.pair.decimals, locale)} ${event.pair.symbol}` : null;
  switch (event.kind) {
    case "TOKEN_CREATED":
      if (event.token.launchedOnRyntra) return amount ? `${word("launchedOnRyntra")} · ${log("log_LAUNCHED_buy", { tokens: event.tokensRaw && event.tokenDecimals !== null ? formatRaw(event.tokensRaw, event.tokenDecimals, locale, 0) : "—", amount })}` : word("launchedOnRyntra");
      return event.route?.from ? word("bornOn", { venue: VENUE_NAMES[event.route.from] ?? event.route.from }) : word("bornAt");
    case "DEX_LISTED": {
      const from = event.route?.from ? (VENUE_NAMES[event.route.from] ?? event.route.from) : null;
      const to = event.route?.to ? (VENUE_NAMES[event.route.to] ?? event.route.to) : null;
      const route = from && to ? word("routeFull", { from, to }) : from ? word("routeFrom", { from }) : word("routeUnknown");
      return event.actor ? `${route} · ${word(`actor_${event.actor}` as EventsWord)}` : route;
    }
    case "LIQUIDITY_CHANGED":
      if (event.journalKind) return [log(`log_${event.journalKind}` as LaunchWordKey), amount].filter(Boolean).join(" · ");
      return event.changePct === null ? "—" : word("liquidityHourShort", { change: `${event.changePct > 0 ? "+" : "−"}${new Intl.NumberFormat(numbers, { maximumFractionDigits: 0 }).format(Math.abs(event.changePct))}${numbers === "uk-UA" ? " %" : "%"}` });
    case "AUTHORITY_OPEN":
      return event.authority ? word(`authority_${event.authority}`) : "—";
    case "UNLOCK":
      return event.unlock ? word(`unlock_${event.unlock}`) : "—";
    case "CREATOR_SOLD": {
      const share = event.soldBps === null ? null : word(event.soldOf === "supply" ? "soldSupply" : "soldBought", { pct: pctOfBps(event.soldBps, numbers) });
      return [log("log_CREATOR_SOLD"), amount ? word("amountFor", { amount }) : null, share].filter(Boolean).join(" · ");
    }
    case "ALPHA_VAULT":
      return word("vaultNote");
    case "LAUNCH_LOG":
      return [event.journalKind ? log(`log_${event.journalKind}` as LaunchWordKey) : word("kind_LAUNCH_LOG"), amount].filter(Boolean).join(" · ");
    default:
      return word(`kind_${event.kind}` as EventsWord);
  }
}

function flagLine(event: MarketEventView, flag: MarketEventView["flags"][number], locale: WorkspaceLocale): string {
  const word = eventsWords(locale);
  return flag === "BORROWED_NAME" ? word("flag_BORROWED_NAME", { label: event.borrowedLabel ?? "—" }) : word(`flag_${flag}` as EventsWord);
}

function EventLine({ event, locale, numbers, now }: { event: MarketEventView; locale: WorkspaceLocale; numbers: string; now: number }) {
  const word = eventsWords(locale);
  const seen = ageSeconds(event.observedAt, now);
  const flagsText = event.flags.map((flag) => flagLine(event, flag, locale));
  const unstatedText = event.unstated.length > 0 ? word("unstated", { list: event.unstated.map((code) => word(`unstated_${code}` as EventsWord)).join(", ") }) : null;
  const riskTitle = [...flagsText, ...(unstatedText ? [unstatedText] : [])].join(" · ");
  const linkWhat = event.signature ? word("openTx") : word("openAccount");
  const level = event.flags.length > 0 ? (event.flags.includes("FLAGGED") || event.flags.includes("BORROWED_NAME") || event.flags.length >= 2 ? 2 : 1) : event.unstated.length > 0 ? "unread" : 0;
  return (
    <li className={e.row} data-kind={event.kind} data-suspicious={event.suspicious.length > 0 ? "true" : undefined} data-event-id={event.id}>
      <span className={e.kind} data-kind={event.kind}>
        {KIND_ICON[event.kind]}
        <span>{word(`kind_${event.kind}` as EventsWord)}</span>
      </span>
      <span className={e.when}>
        {event.happenedAt ? (
          <time dateTime={event.happenedAt} className={e.happened} title={word("happened")}>
            <span className={s.srOnly}>{event.finality === "scheduled" ? word("scheduled") : word("happened")}: </span>
            {momentText(event.happenedAt, numbers, now)}
          </time>
        ) : (
          <span className={e.happened} data-unknown="true">
            {event.happenedWithin === "h1" ? word("happenedHour") : event.signature ? word("happenedUnread") : word("happenedUnknown")}
          </span>
        )}
        <span className={e.seen} data-stale={event.stale ? "true" : undefined} title={word("seenTitle")}>
          {word("seen", { ago: seen === null ? "—" : seen < 5 ? word("now") : word("ago", { time: agoText(seen, locale) }) })}
          {event.stale ? ` · ${word("staleMark")}` : ""}
        </span>
      </span>
      <span className={e.token}>
        <MarketIcon mint={event.token.mint} icon={event.token.icon} symbol={event.token.symbol} size={28} className={s.icon} plain={event.token.icon === null} />
        <span className={e.tokenText}>
          <Link className={e.tokenLink} href={event.token.href} prefetch={false} aria-label={`${event.token.symbol} · ${event.token.name}. ${word("openToken")}`}>
            <span className={s.symbol} translate="no">
              {event.token.symbol}
            </span>
            <span className={s.name}>{event.token.name}</span>
          </Link>
          <span className={e.tokenMeta}>
            <span className={e.mint} translate="no" title={event.token.mint}>
              {shortMint(event.token.mint)}
            </span>
            {event.token.launchedOnRyntra ? <span className={e.ryntra}>Ryntra</span> : null}
          </span>
        </span>
      </span>
      <span className={e.detail}>{detailOf(event, locale, numbers)}</span>
      <span className={e.facts}>
        <span className={e.sources}>
          <span className={s.srOnly}>{word("sourcesLabel")}: </span>
          {event.sources.map((source) => word(`source_${source}` as EventsWord)).join(" · ")}
        </span>
        <span className={e.finality} data-finality={event.finality}>
          {word(`finality_${event.finality}` as EventsWord)}
        </span>
        {event.network === "devnet" ? <span className={e.devnet}>{word("devnet")}</span> : null}
        <span className={e.risk} data-level={level} title={riskTitle || undefined}>
          {level === 0 ? (
            word("flagsNone")
          ) : level === "unread" ? (
            word("flagsUnread")
          ) : (
            <>
              <ShieldWarning size={13} weight="fill" aria-hidden="true" />
              {word("flags", { count: event.flags.length })}
            </>
          )}
          {riskTitle ? <span className={s.srOnly}>: {riskTitle}</span> : null}
        </span>
      </span>
      <a className={e.explorer} href={event.explorerUrl} target="_blank" rel="noopener noreferrer" aria-label={word("explorerOf", { what: linkWhat, symbol: event.token.symbol })}>
        {linkWhat}
        <ArrowSquareOut size={13} weight="bold" aria-hidden="true" />
      </a>
      {event.suspicious.length > 0 ? (
        <span className={e.why} role="note">
          <Warning size={14} weight="fill" aria-hidden="true" />
          <span>
            <strong>{word("suspiciousTitle")}.</strong>{" "}
            {event.suspicious.map((reason) => (reason === "BORROWED_NAME" ? word("suspicious_BORROWED_NAME", { label: event.borrowedLabel ?? "—" }) : word(`suspicious_${reason}` as EventsWord))).join(" ")}
          </span>
        </span>
      ) : null}
    </li>
  );
}
