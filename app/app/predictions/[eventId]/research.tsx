"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import type { PredictionEvent, PredictionMarket, PredictionMarketPrices, PredictionNews, PredictionRelatedMarket, PredictionRipple, PredictionSignals } from "@/lib/predictions/model";

import { dateShort, pct } from "../format";
import styles from "../predictions.module.css";
import { venueName, wordsFor } from "../words";
import { PredictionChartCard } from "./prediction-chart";

/**
 * Research (`RYN-PREDICTIONS-001` item 15) — a Ryntra composition over
 * everything the provider gives: *What the market says* (each venue's live
 * price), *What changed* (the chart with its day and week), *Related
 * markets*, *Signals* (generated, the model named, advisory), *Ripple*,
 * *News*, *Resolution* (each venue's own words and where they differ), and
 * *What is uncertain*. Every part answers on its own; a part the provider
 * does not have is a sentence, never a broken page.
 */

type Part<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; code: string }>;
type ResearchAnswer = Readonly<{ signals: Part<PredictionSignals | null>; expand: Part<PredictionRipple>; hedge: Part<PredictionRipple>; news: Part<PredictionNews>; related: Part<readonly PredictionRelatedMarket[]>; readAt: string }>;

export function useResearch(marketId: string, question: string): Readonly<{ status: "loading" | "ready" | "failed"; data: ResearchAnswer | null }> {
  const [state, setState] = useState<{ status: "loading" | "ready" | "failed"; data: ResearchAnswer | null }>({ status: "loading", data: null });
  useEffect(() => {
    let live = true;
    setState({ status: "loading", data: null });
    void fetch(`/api/predictions/markets/${encodeURIComponent(marketId)}/research?text=${encodeURIComponent(question.slice(0, 300))}`, { headers: { accept: "application/json" }, cache: "no-store" })
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
  }, [marketId, question]);
  return state;
}

export function ResearchPanel({ event, market, outcomeId, outcomeLabel, prices, locale, theme }: { event: PredictionEvent; market: PredictionMarket; outcomeId: string; outcomeLabel: string; prices: PredictionMarketPrices | null; locale: WorkspaceLocale; theme: "dark" | "light" }) {
  const word = wordsFor(locale);
  const research = useResearch(market.id, market.question);
  const data = research.data;
  return (
    <div className={styles.stack}>
      <section className={styles.card} aria-label={word("whatMarketSays")}>
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>{word("whatMarketSays")}</h2>
        </div>
        <VenueTable prices={prices} market={market} locale={locale} />
      </section>

      <PredictionChartCard outcomeId={outcomeId} outcomeLabel={outcomeLabel} locale={locale} theme={theme} />

      <section className={styles.card} aria-label={word("related")}>
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>{word("related")}</h2>
        </div>
        <ListOrState loading={research.status === "loading"} failed={research.status === "failed"} empty={data?.related.ok ? data.related.value.length === 0 : true} emptyText={word("noRelated")} locale={locale}>
          {data?.related.ok
            ? data.related.value.map((r) => (
                <div key={`${r.venueMarketId}:${r.score}`} className={styles.item}>
                  {r.venueEventId ? (
                    <Link href={`/app/predictions/${encodeURIComponent(r.venueEventId)}`} prefetch={false}>
                      {r.marketQuestion}
                    </Link>
                  ) : (
                    <span style={{ fontWeight: 600 }}>{r.marketQuestion}</span>
                  )}
                  <span className={styles.itemMeta}>
                    <span>{r.eventTitle}</span>
                    <span>{venueName(r.venue)}</span>
                    <span>{(r.score * 100).toFixed(0)}%</span>
                    {r.matchedSignal ? <span>“{r.matchedSignal}”</span> : null}
                  </span>
                </div>
              ))
            : null}
        </ListOrState>
      </section>

      <section className={styles.card} aria-label={word("signals")}>
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>{word("signals")}</h2>
          {data?.signals.ok && data.signals.value ? <span className={styles.muted}>{data.signals.value.sourceModel} · v{String(data.signals.value.promptVersion)} · {dateShort(data.signals.value.createdAt, locale)}</span> : null}
        </div>
        <p className={styles.note} style={{ padding: "var(--ry-s3) var(--ry-s4) 0" }}>
          {word("signalsNote")}
        </p>
        <ListOrState loading={research.status === "loading"} failed={research.status === "failed"} empty={data?.signals.ok ? !data.signals.value || data.signals.value.signals.length === 0 : true} emptyText={word("noSignals")} locale={locale}>
          {data?.signals.ok && data.signals.value
            ? data.signals.value.signals.map((s) => (
                <div key={s.id} className={styles.item}>
                  <span>{s.text}</span>
                  <span className={styles.itemMeta}>
                    <span className={styles.signalSide} data-side={s.side.toLowerCase()}>
                      {s.side}
                    </span>
                    <span>{s.direction.replace(/_/g, " ")}</span>
                    <span>{s.domain}</span>
                  </span>
                </div>
              ))
            : null}
        </ListOrState>
      </section>

      <section className={styles.card} aria-label={word("ripple")}>
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>{word("ripple")}</h2>
        </div>
        <p className={styles.note} style={{ padding: "var(--ry-s3) var(--ry-s4) 0" }}>
          {word("rippleNote")}
        </p>
        {(["expand", "hedge"] as const).map((mode) => {
          const part = data?.[mode];
          return (
            <div key={mode}>
              <h3 className={styles.sectionTitle} style={{ padding: "var(--ry-s3) var(--ry-s4) 0" }}>
                {mode === "expand" ? word("expand") : word("hedge")}
              </h3>
              <ListOrState loading={research.status === "loading"} failed={research.status === "failed"} empty={part?.ok ? part.value.items.length === 0 : true} emptyText={word("noRipple")} locale={locale}>
                {part?.ok
                  ? part.value.items.map((r) => (
                      <div key={`${r.eventId}:${r.action}`} className={styles.item}>
                        <Link href={`/app/predictions/${encodeURIComponent(r.eventId)}`} prefetch={false}>
                          {r.title}
                        </Link>
                        <span className={styles.itemMeta}>
                          <span>{r.action}</span>
                          <span>{(r.score * 100).toFixed(0)}%</span>
                          <span>{r.reason}</span>
                        </span>
                      </div>
                    ))
                  : null}
              </ListOrState>
            </div>
          );
        })}
      </section>

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

      <ResolutionCard event={event} market={market} locale={locale} />

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
      {event.settlement ? (
        <div className={styles.cardBody}>
          <h3 className={styles.sectionTitle}>{word("settlementShared")}</h3>
          <p className={styles.rules}>{event.settlement.sharedSummary}</p>
          {event.settlement.differences.length > 0 ? (
            <>
              <h3 className={styles.sectionTitle}>{word("settlementDifferences")}</h3>
              {event.settlement.differences.map((d) => (
                <div key={`${d.type}:${d.title}`} className={styles.field}>
                  <b style={{ fontSize: "var(--ry-fs-label)" }}>{d.title}</b>
                  {d.summary ? <p className={styles.rules}>{d.summary}</p> : null}
                  <dl className={styles.kv}>
                    {Object.entries(d.perVenue).map(([venue, text]) => (
                      <div key={venue} style={{ display: "contents" }}>
                        <dt>{venueName(venue)}</dt>
                        <dd data-prose="true" style={{ textAlign: "left" }}>
                          {text}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </>
          ) : null}
        </div>
      ) : null}
      {venues.map((v) => (
        <details key={v.venue} className={styles.disclosure}>
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
