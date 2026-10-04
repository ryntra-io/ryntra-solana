"use client";

import { Star } from "@phosphor-icons/react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { readResolvedTheme, watchResolvedTheme } from "@/app/app/theme";
import type { WorkspaceLocale } from "@/app/shell/locale";
import type { PredictionEvent, PredictionMarket, PredictionMarketPrices } from "@/lib/predictions/model";
import type { PredictionPlan } from "@/lib/predictions/plan";

import { AccountCard } from "../account-card";
import { dateShort, pct, pctPoints, timeLeft, usd, usdCompact } from "../format";
import styles from "../predictions.module.css";
import { usePaperAccount } from "../use-paper-account";
import { outcomeLabel, venueName, wordsFor } from "../words";
import { DepthPanel } from "./depth";
import { useLiveOutcome } from "./live";
import { PlanBuilder } from "./plan-builder";
import { changeOver, PredictionChartCard, useOutcomeChart } from "./prediction-chart";
import { ResearchPanel, ResolutionCard, VenueTable } from "./research";
import { PaperTicket } from "./ticket";

type Tab = "overview" | "research" | "depth";

/**
 * The market detail, by progressive disclosure.
 *
 * The primary layer: the question, the outcomes with live probabilities, the
 * change, the volume, the resolution time, the person's paper position, and
 * the three acts — *Ask Ryntra*, *Build plan*, *Paper Yes / Paper No*.
 * Research and Market depth are one tap deeper, and nothing the provider
 * gives is thrown away to get there. One version for everyone: the venue
 * table is in Research, the route's legs fold in the Review, and the engine's
 * technical line — «Профі»'s once — is no customer's word; no consequence is
 * hidden.
 */
export function MarketDetail({ locale, initial, live: liveConfig }: { locale: WorkspaceLocale; initial: PredictionEvent; live: Readonly<{ appId: string; wsUrl: string }> }) {
  const word = wordsFor(locale);
  /* The one face: details a tap deeper, the same for everyone. */
  const pro = false;
  const account = usePaperAccount();
  const [event, setEvent] = useState(initial);
  const [marketId, setMarketId] = useState(initial.markets[0]?.id ?? "");
  const market: PredictionMarket | undefined = event.markets.find((m) => m.id === marketId) ?? event.markets[0];
  const [outcomeId, setOutcomeId] = useState(market?.outcomes[0]?.id ?? "");
  const outcome = market?.outcomes.find((o) => o.id === outcomeId) ?? market?.outcomes[0];
  const [tab, setTab] = useState<Tab>("overview");
  const [prices, setPrices] = useState<PredictionMarketPrices | null>(null);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [planOpen, setPlanOpen] = useState(false);
  const [savedPlan, setSavedPlan] = useState<PredictionPlan | null>(null);
  const [watched, setWatched] = useState(false);
  const [allMarkets, setAllMarkets] = useState(false);
  const nowMs = useMemo(() => Date.now(), [event]); // eslint-disable-line react-hooks/exhaustive-deps -- the clock the event was read at

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

  const live = useLiveOutcome(liveConfig.appId, liveConfig.wsUrl, tab === "depth" ? (outcome?.id ?? null) : null);
  const chart = useOutcomeChart(outcome?.id ?? null, 1);
  const d1 = changeOver(chart.chart?.bars ?? [], 24, nowMs);

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

  if (!market || !outcome) {
    return (
      <section className={styles.page}>
        <p className={styles.crumbs}>
          <Link href="/app/predictions">{word("title")}</Link>
        </p>
        <div className={`${styles.card} ${styles.unavailable}`}>
          <b>{event.title}</b>
          <p className={styles.muted}>{word("empty")}</p>
        </div>
      </section>
    );
  }

  const category = event.categories[0] ?? null;
  return (
    <section className={styles.page} aria-labelledby="pred-event-title">
      <header className={styles.detailHead}>
        <p className={styles.crumbs}>
          <Link href="/app/predictions" prefetch={false}>
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
            <div className={styles.detailMeta}>
              <span className={styles.venueChips}>
                {event.venues.map((v) => (
                  <span key={v} className={styles.venueChip} data-primary={v === event.venue}>
                    {venueName(v)}
                  </span>
                ))}
              </span>
              <span>
                {word("volume")} <b>{usdCompact(event.volume)}</b>
              </span>
              <span>
                {event.endDate && Date.parse(event.endDate) < nowMs ? word("ended") : word("ends")} <b>{event.endDate ? dateShort(event.endDate, locale) : "—"}</b> {event.endDate ? `· ${timeLeft(event.endDate, locale, nowMs)}` : ""}
              </span>
            </div>
          </div>
          <div className={styles.actions}>
            <span className={styles.paperBadge}>{word("paperBadge")}</span>
            <button type="button" className="rw-btn" aria-pressed={watched} disabled={account.state.status !== "ready"} onClick={() => void onWatch()}>
              <Star size={16} weight={watched ? "fill" : "regular"} aria-hidden="true" /> {watched ? word("watching") : word("watch")}
            </button>
            <button type="button" className="rw-btn" onClick={() => setPlanOpen(true)}>
              {word("buildPlan")}
            </button>
          </div>
        </div>
      </header>

      <div className={styles.detail}>
        <div className={styles.stack}>
          <section className={`${styles.card} ${styles.strip}`} aria-label={word("overview")}>
            <div className={styles.metric}>
              <span className={styles.metricLabel}>{outcomeLabel(outcome.label, locale)}</span>
              <span className={styles.metricValue}>{pct(outcome.probability, 1)}</span>
              <span className={styles.metricSub}>{prices ? `${word("liveMid")} · ${prices.venues.length} ${word("venues").toLowerCase()}` : word("lastPrice")}</span>
            </div>
            <div className={styles.metric}>
              <span className={styles.metricLabel}>{word("change24h")}</span>
              <span className={styles.metricValue} style={d1 != null ? { color: d1 > 0 ? "var(--ry-pnl-pos)" : d1 < 0 ? "var(--ry-pnl-neg)" : undefined } : undefined}>
                {d1 == null ? "—" : pctPoints(d1)}
              </span>
              <span className={styles.metricSub}>{chart.status === "loading" ? word("loading") : d1 == null ? word("noChange") : ""}</span>
            </div>
            <div className={styles.metric}>
              <span className={styles.metricLabel}>{word("volume")}</span>
              <span className={styles.metricValue}>{usdCompact(market.volume ?? event.volume)}</span>
              <span className={styles.metricSub}>{event.marketCount} {event.marketCount === 1 ? word("market") : word("markets")}</span>
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
                      ? word("walletFirst")
                      : word("notLinkedTitle")}
              </span>
            </div>
          </section>

          <div className={styles.tabs} role="tablist" aria-label={word("overview")}>
            {(
              [
                ["overview", word("overview")],
                ["research", word("research")],
                ["depth", word("depth")],
              ] as const
            ).map(([id, label]) => (
              <button key={id} type="button" role="tab" className={styles.tab} aria-selected={tab === id} data-on={tab === id} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </div>

          {tab === "overview" ? (
            <>
              <PredictionChartCard outcomeId={outcome.id} outcomeLabel={outcomeLabel(outcome.label, locale)} locale={locale} theme={theme} compact />
              <section className={styles.card} aria-label={word("outcomes")}>
                <div className={styles.cardHead}>
                  <h2 className={styles.cardTitle}>{word("outcomes")}</h2>
                  <span className={styles.muted}>{event.markets.length} {event.markets.length === 1 ? word("market") : word("markets")}</span>
                </div>
                <div className={styles.marketList}>
                  {(allMarkets ? event.markets : event.markets.slice(0, 6)).map((m) => (
                    <div key={m.id} className={styles.marketRow} aria-current={m.id === market.id}>
                      <p className={styles.marketQuestion}>
                        <span>{m.question}</span>
                        <small>
                          {m.status !== "open" ? `${m.status} · ` : ""}
                          {m.matched.length > 0 ? `${m.matched.length + 1} ${word("venues").toLowerCase()}` : venueName(m.venue)}
                          {m.volume != null ? ` · ${usdCompact(m.volume)}` : ""}
                        </small>
                      </p>
                      <div className={styles.outcomeButtons} role="group" aria-label={m.question}>
                        {m.outcomes.map((o) => (
                          <button key={o.id} type="button" className={styles.outcomeButton} data-winner={o.winner === true} aria-pressed={m.id === market.id && o.id === outcome.id} onClick={() => { setMarketId(m.id); setOutcomeId(o.id); }}>
                            <span>{outcomeLabel(o.label, locale)}</span>
                            <b>{pct(o.probability, 1)}</b>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                {event.markets.length > 6 ? (
                  <div className={styles.cardHead} style={{ borderTop: "1px solid var(--ry-border)", borderBottom: 0 }}>
                    <button type="button" className="rw-btn" onClick={() => setAllMarkets((v) => !v)}>
                      {allMarkets ? word("showFewer") : `${word("showAllMarkets")} · ${event.markets.length}`}
                    </button>
                  </div>
                ) : null}
              </section>
              {pro ? (
                <section className={styles.card} aria-label={word("venueComparison")}>
                  <div className={styles.cardHead}>
                    <h2 className={styles.cardTitle}>{word("venueComparison")}</h2>
                  </div>
                  <VenueTable prices={prices} market={market} locale={locale} />
                </section>
              ) : null}
              <ResolutionCard event={event} market={market} locale={locale} />
            </>
          ) : null}
          {tab === "research" ? <ResearchPanel event={event} market={market} outcomeId={outcome.id} outcomeLabel={outcomeLabel(outcome.label, locale)} prices={prices} locale={locale} theme={theme} /> : null}
          {tab === "depth" ? <DepthPanel event={event} market={market} outcomeLabel={outcomeLabel(outcome.label, locale)} live={live} prices={prices} locale={locale} pro={pro} /> : null}
          <div className={styles.phoneOnly}>
            <AccountCard account={account} locale={locale} compact eventId={event.id} />
          </div>
        </div>

        <aside className={styles.sticky} aria-label={word("paperBuy")}>
          <PaperTicket event={event} market={market} outcomeId={outcome.id} onOutcome={chooseOutcome} locale={locale} account={account} pro={pro} />
          <div className={styles.desktopOnly}>
            <AccountCard account={account} locale={locale} compact eventId={event.id} />
          </div>
          {savedPlan ? (
            <p className={styles.notice}>
              {word("planSaved")} · {savedPlan.current.rules.outcomeLabel} · {usd(savedPlan.current.rules.amountUsd, 0)} · {savedPlan.status === "active" ? word("planActive") : word("planDraft")} —{" "}
              <Link href="/app/strategies" prefetch={false}>
                {locale === "uk" ? "Мої стратегії" : "My strategies"}
              </Link>
            </p>
          ) : null}
        </aside>
      </div>

      {planOpen ? (
        <PlanBuilder
          event={event}
          market={market}
          outcomeId={outcome.id}
          locale={locale}
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
