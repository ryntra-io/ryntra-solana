"use client";

import { useEffect, useState } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import type { PredictionEvent, PredictionMarket, PredictionMarketPrices, PredictionNews, PredictionRelatedMarket, PredictionRipple, PredictionSignals } from "@/lib/predictions/model";
import { freshTheses } from "@/lib/predictions/theses";

import { dateShort, pct } from "../format";
import styles from "../predictions.module.css";
import { venueName, wordsFor } from "../words";
import { OutcomeWeekCard } from "./prediction-chart";

/**
 * Research — a Ryntra composition over everything the provider gives: *What
 * the market says* (each venue's live price), *What changed* (the chart with
 * its day and week), *Model theses* (the provider's model, not advice: no
 * side they lean to, no model id, nothing older than two weeks — and no block
 * at all without fresh ones),
 * *News*, *Resolution* (each venue's own words and where they differ), and
 * *What is uncertain*. The related markets and the ripple are a panel of
 * their own (`market-map.tsx`). Every part answers on its
 * own; a part the provider does not have is a sentence, never a broken page.
 */

type Part<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; code: string }>;
type ResearchAnswer = Readonly<{ signals: Part<PredictionSignals | null>; expand: Part<PredictionRipple>; hedge: Part<PredictionRipple>; news: Part<PredictionNews>; related: Part<readonly PredictionRelatedMarket[]>; readAt: string }>;

/** Without the question: the related markets are the map panel's, which reads them itself. */
export function useResearch(marketId: string): Readonly<{ status: "loading" | "ready" | "failed"; data: ResearchAnswer | null }> {
  const [state, setState] = useState<{ status: "loading" | "ready" | "failed"; data: ResearchAnswer | null }>({ status: "loading", data: null });
  useEffect(() => {
    let live = true;
    setState({ status: "loading", data: null });
    void fetch(`/api/predictions/markets/${encodeURIComponent(marketId)}/research`, { headers: { accept: "application/json" }, cache: "no-store" })
      .then(async (r) => (r.ok ? ((await r.json()) as ResearchAnswer) : null))
      .then((data) => {
        if (live) setState(data ? { status: "ready", data } : { status: "failed", data: null });
      })
      .catch(() => {
        if (live) setState({ status: "failed", data: null });
      });
    return () => {
      live = false;
    };
  }, [marketId]);
  return state;
}

export function ResearchPanel({
  event,
  market,
  outcomeId,
  outcomeLabel,
  prices,
  locale,
  alone = true,
}: {
  event: PredictionEvent;
  market: PredictionMarket;
  outcomeId: string;
  outcomeLabel: string;
  prices: PredictionMarketPrices | null;
  locale: WorkspaceLocale;
  /** The page's theme; the core's charts read it from the page itself. */
  theme?: "dark" | "light";
  /** Drawn on its own; beside the workspace's chart, prices and rules panels it leaves those to them. */
  alone?: boolean;
}) {
  const word = wordsFor(locale);
  const research = useResearch(market.id);
  const data = research.data;
  const theses = data?.signals.ok ? freshTheses(data.signals.value, Date.parse(data.readAt) || Date.now()) : null;
  return (
    <div className={styles.stack}>
      {alone ? (
        <>
          <section className={styles.card} aria-label={word("whatMarketSays")}>
            <div className={styles.cardHead}>
              <h2 className={styles.cardTitle}>{word("whatMarketSays")}</h2>
            </div>
            <VenueTable prices={prices} market={market} locale={locale} />
          </section>

          <OutcomeWeekCard outcomeId={outcomeId} outcomeLabel={outcomeLabel} noLabel={null} locale={locale} />
        </>
      ) : null}

      {theses ? (
        <section className={styles.card} aria-label={word("signals")}>
          <div className={styles.cardHead}>
            <h2 className={styles.cardTitle}>{word("signals")}</h2>
            <span className={styles.muted}>{dateShort(theses.writtenAt, locale)}</span>
          </div>
          <p className={styles.note} style={{ padding: "var(--ry-s3) var(--ry-s4) 0" }}>
            {word("signalsNote")}
          </p>
          <div className={styles.list}>
            {theses.texts.map((s) => (
              <div key={s.id} className={styles.item}>
                <span lang="en">{s.text}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className={styles.card} aria-label={word("news")}>
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>{word("news")}</h2>
          {data?.news.ok && data.news.value.window ? <span className={styles.muted}>{data.news.value.window}</span> : null}
        </div>
        <ListOrState loading={research.status === "loading"} failed={research.status === "failed"} empty={data?.news.ok ? data.news.value.articles.length === 0 : true} emptyText={word("noNews")} locale={locale}>
          {data?.news.ok
            ? data.news.value.articles.map((a, i) => (
                <div key={`${a.url ?? a.title}:${i}`} className={styles.item}>
                  {a.url ? (
                    <a href={a.url} target="_blank" rel="noreferrer noopener">
                      {a.title}
                    </a>
                  ) : (
                    <span style={{ fontWeight: 600 }}>{a.title}</span>
                  )}
                  {a.summary ? <span>{a.summary}</span> : null}
                  <span className={styles.itemMeta}>
                    {a.source ? <span>{a.source}</span> : null}
                    {a.publishedAt ? <span>{a.publishedAt.slice(0, 10)}</span> : null}
                  </span>
                </div>
              ))
            : null}
        </ListOrState>
      </section>

      {alone ? <ResolutionCard event={event} market={market} locale={locale} /> : null}

      <section className={styles.card} aria-label={word("uncertain")}>
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>{word("uncertain")}</h2>
        </div>
        <p className={styles.note} style={{ padding: "var(--ry-s3) var(--ry-s4) var(--ry-s4)" }}>
          {word("uncertainText")}
        </p>
      </section>
    </div>
  );
}

export function ResolutionCard({ event, market, locale }: { event: PredictionEvent; market: PredictionMarket; locale: WorkspaceLocale }) {
  const word = wordsFor(locale);
  const venues = [{ venue: market.venue, description: market.description, rules: market.rules }, ...market.matched.map((m) => ({ venue: m.venue, description: m.description, rules: m.rules }))];
  return (
    <section className={styles.card} aria-label={word("resolution")}>
      <div className={styles.cardHead}>
        <h2 className={styles.cardTitle}>{word("resolution")}</h2>
        {market.resolutionDate ? <span className={styles.muted}>{word("resolves")} {dateShort(market.resolutionDate, locale)}</span> : event.endDate ? <span className={styles.muted}>{word("ends")} {dateShort(event.endDate, locale)}</span> : null}
      </div>
      <p className={styles.note} style={{ padding: "var(--ry-s3) var(--ry-s4) 0" }}>
        {word("resolutionNote")}
      </p>
      {venues.map((v, i) => (
        <details key={`${v.venue}:${i}`} className={styles.disclosure}>
          <summary>{venueName(v.venue)}</summary>
          <div className={styles.disclosureBody}>
            {v.description ? <p className={styles.rules}>{v.description}</p> : null}
            {v.rules.primary ? <p className={styles.rules}>{v.rules.primary}</p> : null}
            {v.rules.secondary ? <p className={styles.rules}>{v.rules.secondary}</p> : null}
            {!v.description && !v.rules.primary && !v.rules.secondary ? <p>{word("noRules")}</p> : null}
          </div>
        </details>
      ))}
    </section>
  );
}

export function VenueTable({ prices, market, locale }: { prices: PredictionMarketPrices | null; market: PredictionMarket; locale: WorkspaceLocale }) {
  const word = wordsFor(locale);
  if (!prices) {
    return (
      <p className={styles.muted} style={{ padding: "var(--ry-s3) var(--ry-s4)" }}>
        {word("loading")}
      </p>
    );
  }
  const rows = prices.venues.length > 0 ? prices.venues : [{ venue: market.venue, venueMarketId: market.id, midpoint: prices.midpoint, spread: prices.spread, bestBid: null, bestAsk: null, timestamp: prices.timestamp }];
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>{word("venue")}</th>
            <th>{word("liveMid")}</th>
            <th>{word("bestBid")}</th>
            <th>{word("bestAsk")}</th>
            <th>{word("spread")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((v) => (
            <tr key={v.venueMarketId}>
              <th scope="row">{venueName(v.venue)}</th>
              <td>{pct(v.midpoint, 1)}</td>
              <td>{pct(v.bestBid, 1)}</td>
              <td>{pct(v.bestAsk, 1)}</td>
              <td>{v.spread == null ? "—" : `${(v.spread * 100).toFixed(1)} pp`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ListOrState({ loading, failed, empty, emptyText, locale, children }: { loading: boolean; failed: boolean; empty: boolean; emptyText: string; locale: WorkspaceLocale; children: React.ReactNode }) {
  const word = wordsFor(locale);
  if (loading) {
    return (
      <div className={styles.skeleton} aria-busy="true">
        <span className={styles.bone} />
        <span className={styles.bone} />
      </div>
    );
  }
  if (failed) {
    return (
      <p className={styles.muted} style={{ padding: "var(--ry-s3) var(--ry-s4)" }}>
        {word("unavailable")}
      </p>
    );
  }
  if (empty) {
    return (
      <p className={styles.muted} style={{ padding: "var(--ry-s3) var(--ry-s4)" }}>
        {emptyText}
      </p>
    );
  }
  return <div className={styles.list}>{children}</div>;
}
