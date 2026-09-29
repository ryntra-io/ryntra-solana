"use client";

import { useEffect, useState } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import type { PredictionBook, PredictionEngineState, PredictionEvent, PredictionMarket, PredictionMarketPrices, PredictionVenueBook } from "@/lib/predictions/model";

import { pct, timeShort } from "../format";
import styles from "../predictions.module.css";
import { venueName, wordsFor } from "../words";
import type { LiveState } from "./live";
import { VenueTable } from "./research";

/**
 * Market depth (`RYN-PREDICTIONS-001` items 6 and 19): the aggregated book
 * with each level's venue breakdown, the books by venue, the live trades over
 * the socket (or the REST book every few seconds where the socket is not
 * available here), the venue prices, the provider's arbitrage return where
 * it computes one, the provider's state, and the technical identifiers one
 * disclosure deep. Everything the aggregator's own page shows, in Ryntra's
 * frame.
 */

type BookState = Readonly<{ status: "loading" | "ready" | "failed"; book: PredictionBook | null }>;

export function useRestBook(marketId: string, enabled: boolean, everyMs: number): BookState {
  const [state, setState] = useState<BookState>({ status: "loading", book: null });
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const read = async () => {
      try {
        const r = await fetch(`/api/predictions/markets/${encodeURIComponent(marketId)}/book?depth=12`, { headers: { accept: "application/json" }, cache: "no-store" });
        const body = r.ok ? ((await r.json()) as { book: PredictionBook }) : null;
        if (!live) return;
        setState(body ? { status: "ready", book: body.book } : { status: "failed", book: null });
      } catch {
        if (live) setState((prev) => ({ status: "failed", book: prev.book }));
      }
      if (live) timer = setTimeout(read, everyMs);
    };
    void read();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [marketId, enabled, everyMs]);
  return state;
}

export function DepthPanel({ event, market, outcomeLabel, live, prices, locale, pro }: { event: PredictionEvent; market: PredictionMarket; outcomeLabel: string; live: LiveState; prices: PredictionMarketPrices | null; locale: WorkspaceLocale; pro: boolean }) {
  const word = wordsFor(locale);
  const rest = useRestBook(market.id, true, live.connected ? 20_000 : 5_000);
  const [engine, setEngine] = useState<PredictionEngineState | null>(null);
  useEffect(() => {
    if (!pro) return undefined;
    let alive = true;
    void fetch("/api/predictions/engine", { headers: { accept: "application/json" }, cache: "no-store" })
      .then(async (r) => (r.ok ? ((await r.json()) as { engine: PredictionEngineState }).engine : null))
      .then((e) => {
        if (alive) setEngine(e);
      })
      .catch(() => null);
    return () => {
      alive = false;
    };
  }, [pro]);

  const bids = live.book ? live.book.bids : rest.book?.aggregated.bids ?? [];
  const asks = live.book ? live.book.asks : rest.book?.aggregated.asks ?? [];
  const maxSize = Math.max(1, ...bids.slice(0, 12).map((l) => l.size), ...asks.slice(0, 12).map((l) => l.size));
  const arb = prices?.arbReturn ?? market.arbReturn ?? event.arbReturn;

  return (
    <div className={styles.stack}>
      <section className={styles.card} aria-label={word("aggregatedBook")}>
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>
            {word("aggregatedBook")} · {outcomeLabel}
          </h2>
          <span className={styles.stateChip} data-tone={live.connected ? "good" : live.failed ? undefined : "wait"}>
            {live.connected ? "live" : live.failed ? "rest" : "…"}
          </span>
        </div>
        {!live.connected && live.failed ? (
          <p className={styles.note} style={{ padding: "var(--ry-s3) var(--ry-s4) 0" }}>
            {word("liveOff")}
          </p>
        ) : null}
        {bids.length === 0 && asks.length === 0 ? (
          <p className={styles.muted} style={{ padding: "var(--ry-s3) var(--ry-s4)" }}>
            {rest.status === "loading" && !live.book ? word("loading") : word("bookEmpty")}
          </p>
        ) : (
          <div className={styles.bookGrid}>
            <BookSide side="bid" title={word("bids")} levels={bids.slice(0, 12)} maxSize={maxSize} locale={locale} />
            <BookSide side="ask" title={word("asks")} levels={asks.slice(0, 12)} maxSize={maxSize} locale={locale} />
          </div>
        )}
        <details className={styles.disclosure}>
          <summary>{word("venueBooks")}</summary>
          <div className={styles.disclosureBody}>
            {(rest.book?.venues ?? []).length === 0 ? <p>{word("bookEmpty")}</p> : null}
            {(rest.book?.venues ?? []).map((v: PredictionVenueBook) => (
              <div key={v.venue}>
                <h3 className={styles.sectionTitle}>
                  {venueName(v.venue)}
                  {v.tickSize ? ` · tick ${v.tickSize}` : ""}
                </h3>
                <div className={styles.bookGrid} style={{ padding: "var(--ry-s2) 0 0" }}>
                  <BookSide side="bid" title={word("bids")} levels={v.bids.slice(0, 8)} maxSize={Math.max(1, ...v.bids.slice(0, 8).map((l) => l.size), ...v.asks.slice(0, 8).map((l) => l.size))} locale={locale} plain />
                  <BookSide side="ask" title={word("asks")} levels={v.asks.slice(0, 8)} maxSize={Math.max(1, ...v.bids.slice(0, 8).map((l) => l.size), ...v.asks.slice(0, 8).map((l) => l.size))} locale={locale} plain />
                </div>
              </div>
            ))}
            {rest.book ? (
              <p>
                {word("refreshed")} {timeShort(rest.book.readAt, locale)}
                {rest.book.matched.length ? ` · ${rest.book.matched.map((m) => `${venueName(m.venue)}${m.hasOrderbook ? "" : " (no book)"}`).join(", ")}` : ""}
              </p>
            ) : null}
          </div>
        </details>
      </section>

      <section className={styles.card} aria-label={word("liveTrades")}>
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>{word("liveTrades")}</h2>
          <span className={styles.muted}>{live.trades.length}</span>
        </div>
        {live.trades.length === 0 ? (
          <p className={styles.muted} style={{ padding: "var(--ry-s3) var(--ry-s4)" }}>
            {live.connected ? word("noTrades") : word("liveOff")}
          </p>
        ) : (
          <div className={styles.trades}>
            {live.trades.map((t) => (
              <div key={t.id} className={styles.trade}>
                <small>{new Date(t.timestamp).toISOString().slice(11, 19)}</small>
                <span>{venueName(t.venue)}</span>
                <span className={styles.delta} data-tone={t.side === "buy" ? "pos" : "neg"}>
                  {t.side} {pct(t.price, 1)}
                </span>
                <span>{t.size.toFixed(2)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className={styles.card} aria-label={word("venuePrices")}>
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>{word("venuePrices")}</h2>
        </div>
        <VenueTable prices={prices} market={market} locale={locale} />
        <div className={styles.cardBody}>
          <dl className={styles.kv}>
            <dt>{word("arbitrage")}</dt>
            <dd data-prose={arb == null}>{arb == null ? word("arbNone") : `${(arb * 100).toFixed(2)}%`}</dd>
          </dl>
        </div>
      </section>

      <details className={`${styles.card} ${styles.disclosure}`} style={{ borderTop: "1px solid var(--ry-border)" }} open={pro}>
        <summary>{word("details")}</summary>
        <div className={styles.disclosureBody}>
          <p>{word("providerNote")}</p>
          <p className={styles.mono}>
            event {event.id}
            {event.aggKey ? ` · ${event.aggKey}` : ""} · market {market.id} · {market.venue}
            {market.matched.length ? ` · matched ${market.matched.map((m) => `${m.venue}:${m.id}`).join(", ")}` : ""}
          </p>
          {engine ? (
            <p>
              {word("engine")}: {engine.tradingMode}
              {engine.signals ? ` · signals ${engine.signals.marketsProcessed.toLocaleString("en-US")} / ${engine.signals.marketsTotal.toLocaleString("en-US")} (${engine.signals.coveragePct}%)` : ""}
              {engine.disabledVenues.length ? ` · off: ${engine.disabledVenues.join(", ")}` : ""}
            </p>
          ) : null}
        </div>
      </details>
    </div>
  );
}

function BookSide({ side, title, levels, maxSize, locale, plain = false }: { side: "bid" | "ask"; title: string; levels: readonly { price: number; size: number; venues: Readonly<Record<string, number>> }[]; maxSize: number; locale: WorkspaceLocale; plain?: boolean }) {
  const word = wordsFor(locale);
  return (
    <div className={styles.bookSide}>
      <div className={styles.bookSideTitle}>
        <span>{title}</span>
        <span>{word("size")}</span>
      </div>
      {levels.length === 0 ? <span className={styles.muted}>—</span> : null}
      {levels.map((l) => (
        <div key={`${side}:${l.price}`} className={styles.level} data-side={side} style={{ ["--w" as string]: `${Math.min(100, (l.size / maxSize) * 100)}%` }}>
          <span>{pct(l.price, 1)}</span>
          {!plain && Object.keys(l.venues).length > 0 ? <small>{Object.keys(l.venues).map((v) => venueName(v).slice(0, 4)).join("+")}</small> : <small />}
          <span>{l.size >= 1000 ? `${(l.size / 1000).toFixed(1)}k` : l.size.toFixed(1)}</span>
        </div>
      ))}
    </div>
  );
}
