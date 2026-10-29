"use client";

import { Star } from "@phosphor-icons/react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { readResolvedTheme, watchResolvedTheme } from "@/app/app/theme";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { eventInPlay, type PredictionEvent, type PredictionMarket, type PredictionMarketPrices } from "@/lib/predictions/model";
import { marketLive, settlementPhase } from "@/lib/predictions/resolution";
import type { PredictionPlanDraft } from "@/lib/predictions/assistant/draft";
import type { AskTopic } from "@/lib/predictions/assistant/topics";
import type { PredictionPlan } from "@/lib/predictions/plan";

import { AccountCard } from "../account-card";
import { chanceHero, chanceSecond, moveText } from "@/lib/predictions/units";

import { dateShort, timeLeft, usd, usdCompact } from "../format";
import styles from "../predictions.module.css";
import { SettingsButton } from "../settings-sheet";
import { SimulationLine } from "../simulation-line";
import { usePredictPrefs } from "../prefs-context";
import { usePaperAccount } from "../use-paper-account";
import { outcomeLabel, venueName, wordsFor } from "../words";
import { DepthPanel } from "./depth";
import { useLiveOutcome } from "./live";
import { PlanBuilder } from "./plan-builder";
import { PredictionCoreChart } from "./core-chart";
import { changeOver, useOutcomeChart } from "./prediction-chart";
import { CatchCard } from "./catch-card";
import { BriefCard, PhaseChip, type RulesHistoryView } from "./resolution-brief";
import { ResearchPanel, ResolutionCard, VenueTable } from "./research";
import { MarketMapPanel } from "./market-map";
import { WatchMarketPanel } from "./watch-panel";
import { MarketWorkspace, type WorkspaceControls } from "./market-workspace";
import { RyntraPanel, useRyntraThread } from "./ryntra-panel";
import { PaperTicket, TicketReview, useTicket } from "./ticket";
import { usePredictionsPaths } from "../surface";

/**
 * The market detail: the question and, under it, the terminal in the core's
 * «Стандарт» — the chart with the outcome's probability over it, and the
 * ticket with its one action. The order book, the markets, the rules, the
 * related markets, the venues' prices, the news and Ryntra come back from
 * «Додати панель». One version for everyone: nothing the provider gives is
 * thrown away, the route's legs fold in the Review, and the engine's
 * technical line is no customer's word; no consequence is hidden.
 */
export function MarketDetail({
  locale,
  initial,
  live: liveConfig,
  rulesHistory = {},
  readAt,
  initialMarketId,
}: {
  locale: WorkspaceLocale;
  initial: PredictionEvent;
  live: Readonly<{ appId: string; wsUrl: string }>;
  /** What changed in the rules of the event's markets since Ryntra first read them. */
  rulesHistory?: RulesHistoryView;
  /** The server's clock when it read the event: the first render counts the deadline from it, so the server and the browser draw the same text. */
  readAt?: number;
  /** The market a link opened the event on (a related market's own); the largest one otherwise. */
  initialMarketId?: string | null;
}) {
  const paths = usePredictionsPaths();
  const word = wordsFor(locale);
  /* The one face: details a tap deeper, the same for everyone. */
  const pro = false;
  const account = usePaperAccount();
  const [event, setEvent] = useState(initial);
  /* A link's market first; else the largest still trading — a settled market's leftover price is no place to start. */
  const [marketId, setMarketId] = useState(
    initial.markets.find((m) => m.id === initialMarketId || m.matched.some((v) => v.id === initialMarketId))?.id ?? initial.markets.find((m) => marketLive(m, initial.endDate, readAt ?? Date.now(), eventInPlay(initial, readAt ?? Date.now())))?.id ?? initial.markets[0]?.id ?? "",
  );
  const market: PredictionMarket | undefined = event.markets.find((m) => m.id === marketId) ?? event.markets[0];
  const [outcomeId, setOutcomeId] = useState(market?.outcomes[0]?.id ?? "");
  const outcome = market?.outcomes.find((o) => o.id === outcomeId) ?? market?.outcomes[0];
  const [prices, setPrices] = useState<PredictionMarketPrices | null>(null);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [planOpen, setPlanOpen] = useState(false);
  /* A plan draft Ryntra prepared, opened in the plan builder for the person to change and save. */
  const [planDraft, setPlanDraft] = useState<PredictionPlanDraft | null>(null);
  /* The ticket's «Ask Ryntra»: the panel brought into view and asked. */
  const [askRequest, setAskRequest] = useState<Readonly<{ topic: AskTopic; n: number }> | null>(null);
  const workspace = useRef<WorkspaceControls | null>(null);
  const [savedPlan, setSavedPlan] = useState<PredictionPlan | null>(null);
  const [watched, setWatched] = useState(false);
  const [allMarkets, setAllMarkets] = useState(false);
  const readMs = useMemo(() => (event === initial && readAt != null ? readAt : Date.now()), [event]); // eslint-disable-line react-hooks/exhaustive-deps -- the clock the event was read at
  /* The clock moves on while the page stays open: a market whose close passes stops offering itself within a minute. */
  const [tickMs, setTickMs] = useState<number | null>(null);
  useEffect(() => {
    const timer = setInterval(() => setTickMs(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const nowMs = tickMs != null && tickMs > readMs ? tickMs : readMs;

  useEffect(() => {
    setTheme(readResolvedTheme());
    return watchResolvedTheme(setTheme);
  }, []);

  /* The selected market's live prices every ten seconds; each outcome's probability follows them. */
  useEffect(() => {
    if (!market) return undefined;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const read = async () => {
      try {
        const r = await fetch(`/api/predictions/markets/${encodeURIComponent(market.id)}/prices`, { headers: { accept: "application/json" }, cache: "no-store" });
        const body = r.ok ? ((await r.json()) as { prices: PredictionMarketPrices[] }) : null;
        if (!alive) return;
        const row = body?.prices.find((p) => p.venueMarketId === market.id) ?? null;
        if (row) {
          setPrices(row);
          setEvent((prev) => ({
            ...prev,
            markets: prev.markets.map((m) =>
              m.id === market.id
                ? { ...m, outcomes: m.outcomes.map((o) => ({ ...o, probability: row.outcomes.find((x) => x.outcomeId === o.id)?.midpoint ?? o.probability })) }
                : m,
            ),
          }));
        }
      } catch {
        /* the next tick reads again */
      }
      if (alive) timer = setTimeout(read, 10_000);
    };
    void read();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [market?.id]); // eslint-disable-line react-hooks/exhaustive-deps -- one poller per market

  useEffect(() => {
    setWatched((account.state.account?.watchlist ?? []).some((e) => e.eventId === event.id));
  }, [account.state.account?.watchlist, event.id]);

  const { prefs } = usePredictPrefs();
  /* The ticket's amount, plan and Review live with the page: the workspace may rebuild the ticket's panel, or the person put it away, at any moment. */
  const ticket = useTicket(account);
  /* The live order book only while the book panel is on screen: a socket per view is the provider's to spend. */
  const [bookShown, setBookShown] = useState(false);
  const onShown = useCallback((ids: ReadonlySet<string>) => setBookShown(ids.has("book")), []);
  const live = useLiveOutcome(liveConfig.appId, liveConfig.wsUrl, bookShown ? (outcome?.id ?? null) : null);
  const chart = useOutcomeChart(outcome?.id ?? null, 1);
  const d1 = changeOver(chart.chart?.bars ?? [], 24, nowMs);
  const d7 = changeOver(chart.chart?.bars ?? [], 24 * 7, nowMs);

  const onWatch = useCallback(async () => {
    if (account.state.status !== "ready") return;
    const next = !watched;
    setWatched(next);
    await fetch("/api/predictions/watchlist", {
      method: "PUT",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ eventId: event.id, watched: next, venueMarketId: market?.id ?? null, outcomeLabel: outcome?.label ?? null, probabilityAtWatch: outcome?.probability ?? null }),
    }).catch(() => null);
    void account.refresh();
  }, [account, watched, event.id, market?.id, outcome]);

  const position = useMemo(() => (account.state.account?.positions ?? []).find((p) => (p.eventId ?? p.venueEventId) === event.id) ?? null, [account.state.account?.positions, event.id]);
  const chooseOutcome = useCallback((id: string) => setOutcomeId(id), []);
  /* The conversation with Ryntra lives with the page, per market outcome. */
  const ryntraThread = useRyntraThread(`${market?.id ?? ""}:${outcome?.id ?? ""}`);
  const askHandled = useCallback(() => setAskRequest(null), []);
  const askRyntra = useCallback((topic: AskTopic) => {
    workspace.current?.show("ryntra");
    setAskRequest((previous) => ({ topic, n: (previous?.n ?? 0) + 1 }));
  }, []);
  const withAccount = account.state.account != null;
  const guestNow = account.state.status === "guest";
  /* A draft that came before the account: kept, and opened once the account is there. */
  const [draftWaiting, setDraftWaiting] = useState(false);
  useEffect(() => {
    if (!withAccount || !draftWaiting) return;
    setDraftWaiting(false);
    setPlanOpen(true);
  }, [withAccount, draftWaiting]);
  const openDraft = useCallback(
    (draft: PredictionPlanDraft) => {
      setPlanDraft(draft);
      if (withAccount) {
        setPlanOpen(true);
        return;
      }
      setDraftWaiting(true);
      if (!guestNow) return;
      // A plan is kept with the account: a guest's one way in, the ticket's button, brought into view and focused.
      workspace.current?.show("ticket");
      let frames = 0;
      const settle = () => {
        const button = document.querySelector<HTMLElement>("[data-panel='ticket'] [data-connect-wallet], [data-panel='ticket'] .rw-btn--primary");
        button?.focus();
        frames += 1;
        if ((!button || document.activeElement !== button) && frames < 30) requestAnimationFrame(settle);
      };
      requestAnimationFrame(settle);
    },
    [withAccount, guestNow],
  );

  if (!market || !outcome) {
    return (
      <section className={styles.page}>
        <p className={styles.crumbs}>
          <Link href={paths.hub}>{word("title")}</Link>
        </p>
        <div className={`${styles.card} ${styles.unavailable}`}>
          <b>{event.title}</b>
          <p className={styles.muted}>{word("empty")}</p>
        </div>
      </section>
    );
  }

  const category = event.categories[0] ?? null;
  /* Where the chosen market stands: still trading, or past its close, delayed or settled — said in the head and in place of its figure. */
  const phase = settlementPhase(market, event.endDate, nowMs);
  /* A game under way trades through play, whatever date the venue gave its markets. */
  const inPlay = eventInPlay(event, nowMs);
  const tradable = (m: PredictionMarket) => marketLive(m, event.endDate, nowMs, inPlay);
  const open = tradable(market);
  /* Watching and a plan are kept with the account: until it is read, neither is offered — a guest never sees them come and go. */
  const member = account.state.account != null;
  const hero = chanceHero(outcome.probability, prefs.units, prefs.amountUsd);
  const overview = (
    <section className={`${styles.card} ${styles.strip}`} aria-label={word("overview")}>
      <div className={styles.metric}>
        <span className={styles.metricLabel}>{outcomeLabel(outcome.label, locale)}</span>
        {open ? (
          <>
            <span className={styles.metricValue} data-units={hero.units}>
              {hero.text}
            </span>
            <span className={styles.metricSub}>{chanceSecond(outcome.probability, prefs.units, prefs.amountUsd, outcomeLabel(outcome.label, locale), locale)}</span>
          </>
        ) : (
          <span className={styles.metricValue} data-prose="true">
            <PhaseChip phase={phase} locale={locale} />
          </span>
        )}
      </div>
      <div className={styles.metric}>
        <span className={styles.metricLabel}>{word("change24h")}</span>
        <span className={styles.metricValue} style={d1 != null && open ? { color: d1 > 0 ? "var(--ry-pnl-pos)" : d1 < 0 ? "var(--ry-pnl-neg)" : undefined } : undefined}>
          {d1 == null || !open ? "—" : moveText(d1, prefs.units)}
        </span>
        <span className={styles.metricSub}>{!open ? "" : chart.status === "loading" ? word("loading") : d1 == null ? word("noChange") : d7 != null ? `7${word("days")} ${moveText(d7, prefs.units)}` : ""}</span>
      </div>
      <div className={styles.metric}>
        <span className={styles.metricLabel}>{word("volumeMarket")}</span>
        <span className={styles.metricValue}>{usdCompact(market.volume)}</span>
        <span className={styles.metricSub}>{venueName(market.venue)}</span>
      </div>
      <div className={styles.metric}>
        <span className={styles.metricLabel}>{word("yourPosition")}</span>
        <span className={styles.metricValue} data-prose={Boolean(position)}>
          {position ? position.outcomes.map((o) => `${outcomeLabel(o.label, locale)} ${o.totalSize.toFixed(1)} · ${usd(o.totalValue)}`).join(" / ") : "—"}
        </span>
        <span className={styles.metricSub}>
          {position
            ? `${word("unrealized")} ${position.outcomes.reduce((a, o) => a + o.unrealizedPnl, 0) >= 0 ? "+" : ""}${usd(position.outcomes.reduce((a, o) => a + o.unrealizedPnl, 0))}`
            : account.state.status === "ready" && account.state.account?.link.state === "active"
              ? word("noPosition")
              : account.state.status === "guest"
                ? ""
                : word("notLinkedTitle")}
        </span>
      </div>
    </section>
  );

  return (
    <section className={`${styles.page} ${styles.marketPage}`} aria-labelledby="pred-event-title">
      <header className={styles.detailHead}>
        <p className={styles.crumbs}>
          <Link href={paths.hub} prefetch={false}>
            {word("title")}
          </Link>
          {category ? (
            <>
              <span aria-hidden="true">›</span>
              <span>{category.name.charAt(0).toUpperCase() + category.name.slice(1)}</span>
            </>
          ) : null}
        </p>
        <div className={styles.head}>
          <div className={styles.headTitle}>
            <h1 id="pred-event-title">{event.title}</h1>
            <SimulationLine locale={locale} />
            <div className={styles.detailMeta}>
              <span className={styles.venueChips}>
                {event.venues.map((v) => (
                  <span key={v} className={styles.venueChip} data-primary={v === event.venue}>
                    {venueName(v)}
                  </span>
                ))}
              </span>
              <span>
                {word("volumeEvent")} <b>{usdCompact(event.volume)}</b>
              </span>
              {inPlay && open ? (
                <span className={styles.liveChip}>{word("inPlay")}</span>
              ) : phase.phase === "open" || phase.phase === "closing" ? (
                <span>
                  {word("ends")} <b>{event.endDate ? dateShort(event.endDate, locale) : "—"}</b> {event.endDate ? `· ${timeLeft(event.endDate, locale, nowMs)}` : ""}
                </span>
              ) : (
                <PhaseChip phase={phase} locale={locale} />
              )}
            </div>
          </div>
          <div className={styles.actions}>
            {/* A guest's one way in is the ticket's «Connect wallet». */}
            {member ? (
              <>
                <button type="button" className="rw-btn" aria-pressed={watched} disabled={account.state.status !== "ready"} onClick={() => void onWatch()}>
                  <Star size={16} weight={watched ? "fill" : "regular"} aria-hidden="true" /> {watched ? word("watching") : word("watch")}
                </button>
                <button
                  type="button"
                  className="rw-btn"
                  onClick={() => {
                    setPlanDraft(null);
                    setPlanOpen(true);
                  }}
                >
                  {word("buildPlan")}
                </button>
              </>
            ) : null}
            <SettingsButton locale={locale} />
          </div>
        </div>
      </header>


      <MarketWorkspace
        locale={locale}
        theme={theme}
        onShown={onShown}
        controls={workspace}
        content={{
          chart: (
            <>
              {overview}
              <PredictionCoreChart market={market} outcome={outcome} onOutcome={chooseOutcome} marketState={phase.phase === "resolved" ? "resolved" : open ? "open" : "closed"} locale={locale} />
            </>
          ),
          ticket: (
            <>
              <PaperTicket event={event} market={market} outcomeId={outcome.id} onOutcome={chooseOutcome} locale={locale} account={account} askPrice={prices?.outcomes.find((o) => o.outcomeId === outcome.id)?.bestAsk ?? null} ticket={ticket} nowMs={nowMs} onAsk={() => askRyntra("yes")} />
              <AccountCard account={account} locale={locale} compact eventId={event.id} />
              {savedPlan ? (
                <p className={styles.notice}>
                  {word("planSaved")} · {savedPlan.current.rules.outcomeLabel} · {usd(savedPlan.current.rules.amountUsd, 0)} · {savedPlan.status === "active" ? word("planActive") : word("planDraft")}
                  {paths.plans ? (
                    <>
                      {" — "}
                      <Link href={paths.plans} prefetch={false}>
                        {paths.plans === "/app/strategies" ? (locale === "uk" ? "Мої стратегії" : "My strategies") : word("myPlans")}
                      </Link>
                    </>
                  ) : null}
                </p>
              ) : null}
            </>
          ),
          ryntra: (
            <RyntraPanel
              event={event}
              market={market}
              outcome={outcome}
              locale={locale}
              amountUsd={prefs.amountUsd}
              request={askRequest}
              onRequestHandled={askHandled}
              thread={ryntraThread}
              side={prefs.side}
              onCollapse={() => workspace.current?.hide("ryntra")}
              onDraft={openDraft}
            />
          ),
          outcomes: (
            <section className={styles.card} aria-label={word("outcomes")}>
              <div className={styles.cardHead}>
                <h2 className={styles.cardTitle}>{word("outcomes")}</h2>
                <span className={styles.muted}>
                  {event.markets.length} {event.markets.length === 1 ? word("market") : word("markets")}
                </span>
              </div>
              <div className={styles.marketList}>
                {(allMarkets ? event.markets : event.markets.slice(0, 6)).map((m) => {
                  const trades = tradable(m);
                  return (
                  <div key={m.id} className={styles.marketRow} aria-current={m.id === market.id}>
                    <p className={styles.marketQuestion}>
                      <span>{m.question}</span>
                      <small>
                        {trades ? "" : m.status === "resolved" || m.outcomes.some((o) => o.winner === true) ? `${word("phaseResolved")} · ` : m.status === "closed" ? `${word("closedWord")} · ` : m.status === "open" ? `${word("cardAwaiting")} · ` : ""}
                        {m.matched.length > 0 ? `${m.matched.length + 1} ${word("venues").toLowerCase()}` : venueName(m.venue)}
                        {m.volume != null ? ` · ${usdCompact(m.volume)}` : ""}
                      </small>
                    </p>
                    <div className={styles.outcomeButtons} role="group" aria-label={m.question}>
                      {m.outcomes.map((o) => (
                        <button
                          key={o.id}
                          type="button"
                          className={styles.outcomeButton}
                          data-winner={o.winner === true}
                          aria-pressed={m.id === market.id && o.id === outcome.id}
                          onClick={() => {
                            setMarketId(m.id);
                            setOutcomeId(o.id);
                          }}
                        >
                          <span>{outcomeLabel(o.label, locale)}</span>
                          {trades ? (
                            <>
                              <b>{chanceHero(o.probability, prefs.units, prefs.amountUsd).text}</b>
                              <small>{chanceSecond(o.probability, prefs.units, prefs.amountUsd, "", locale)}</small>
                            </>
                          ) : (
                            <b>{o.winner === true ? "✓" : "—"}</b>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                  );
                })}
              </div>
              {event.markets.length > 6 ? (
                <div className={styles.cardHead} style={{ borderTop: "1px solid var(--ry-border)", borderBottom: 0 }}>
                  <button type="button" className="rw-btn" onClick={() => setAllMarkets((v) => !v)}>
                    {allMarkets ? word("showFewer") : `${word("showAllMarkets")} · ${event.markets.length}`}
                  </button>
                </div>
              ) : null}
            </section>
          ),
          rules: (
            <>
              <BriefCard event={event} market={market} locale={locale} nowMs={nowMs} history={rulesHistory} />
              <CatchCard event={event} market={market} locale={locale} />
              <ResolutionCard event={event} market={market} locale={locale} />
              {/* The watch stands where the market's own terms are read: a rules change or a late result is the thing it reports. */}
              <WatchMarketPanel event={event} market={market} outcomeId={outcome.id} outcomeLabel={outcomeLabel(outcome.label, locale)} locale={locale} />
            </>
          ),
          map: <MarketMapPanel eventId={event.id} marketId={market.id} outcomeId={outcome.id} outcomeName={outcomeLabel(outcome.label, locale)} locale={locale} />,
          book: <DepthPanel event={event} market={market} outcomeLabel={outcomeLabel(outcome.label, locale)} live={live} prices={prices} locale={locale} pro={pro} />,
          prices: (
            <section className={styles.card} aria-label={word("venueComparison")}>
              <VenueTable prices={prices} market={market} locale={locale} />
            </section>
          ),
          news: <ResearchPanel event={event} market={market} outcomeId={outcome.id} outcomeLabel={outcomeLabel(outcome.label, locale)} prices={prices} locale={locale} theme={theme} alone={false} />,
        }}
      />

      <TicketReview ticket={ticket} event={event} market={market} outcomeId={outcome.id} locale={locale} pro={pro} account={account} />

      {planOpen ? (
        <PlanBuilder
          event={event}
          market={market}
          outcomeId={planDraft?.venueMarketId === market.id ? planDraft.outcomeId : outcome.id}
          locale={locale}
          initial={planDraft?.venueMarketId === market.id ? planDraft : null}
          onClose={() => setPlanOpen(false)}
          onSaved={(plan) => {
            setSavedPlan(plan);
            setPlanOpen(false);
            void account.refresh();
          }}
        />
      ) : null}
    </section>
  );
}
