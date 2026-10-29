"use client";

import { useEffect, useMemo, useState } from "react";

import type { BookFeed, BookSnapshot } from "@ryntra/core/ui";

import { formatAmount, formatTerminalPrice, priceDecimals } from "../spot/spot-format";

import { pageClock } from "./use-futures-data";
import { perpsWord } from "./perps-words";
import type { ScalpRates } from "./scalp-check";
import { ScalpCheckPanel } from "./scalp-check-panel";

import styles from "./perps.module.css";

type Lang = "en" | "uk";

/** How many levels a side shows; the panel's height cuts what does not fit, the best levels nearest the middle. */
const LEVELS = 20;

/** The book as the page polls it, and how old it is now. */
export function useBookSnapshot(feed: BookFeed | null): Readonly<{ book: BookSnapshot | null; ageMs: number | null }> {
  const [state, setState] = useState<{ book: BookSnapshot | null; ageMs: number | null; at: number }>({ book: null, ageMs: null, at: 0 });
  useEffect(() => {
    const first = feed?.current?.() ?? null;
    setState({ book: first?.data ?? null, ageMs: first?.age_ms ?? null, at: pageClock() });
    if (!feed) return;
    return feed.subscribe((message) => setState({ book: message.data, ageMs: message.age_ms, at: pageClock() }));
  }, [feed]);
  /* A book that stops coming ages on the screen: the clock ticks once a second. */
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => tick((value) => value + 1), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  return { book: state.book, ageMs: state.ageMs === null ? null : state.ageMs + (pageClock() - state.at) };
}

/**
 * The perpetual's order book to trade from (PERP-2): the asks over the bids with the running total and its depth bar,
 * the mark and the spread between them; a price pressed becomes the ticket's limit price. The core's `OrderBook` is a
 * book to read — «a book to trade from is the product's own» — so this one is the terminal's, in the core's tokens.
 *
 * In Pro, Scalp Check stands beside the spread (PERP-7): what one round trip of a typed size costs on these very
 * levels. It is the book's own neighbour on purpose — the numbers it shows are walks of the book drawn right above it.
 */
export function PerpBook({ book, ageMs, maxAgeMs, coin, markUsd, lang, pro = false, rates, onPick }: { book: BookSnapshot | null; ageMs: number | null; maxAgeMs: number; coin: string; markUsd: number | null; lang: Lang; pro?: boolean; rates?: ScalpRates; onPick?: (priceUsd: number) => void }) {
  const intl = lang === "uk" ? "uk-UA" : "en-US";
  const w = (key: Parameters<typeof perpsWord>[1], fill?: Readonly<Record<string, string>>) => perpsWord(lang, key, fill);
  const stale = ageMs === null || ageMs > maxAgeMs;
  const decimals = priceDecimals(markUsd ?? book?.asks[0]?.price ?? null);

  const rows = useMemo(() => {
    const side = (levels: readonly { price: number; size: number }[]) => {
      let total = 0;
      return levels.slice(0, LEVELS).map((level) => {
        total += level.size;
        return { ...level, total };
      });
    };
    const asks = side(book?.asks ?? []);
    const bids = side(book?.bids ?? []);
    const most = Math.max(asks[asks.length - 1]?.total ?? 0, bids[bids.length - 1]?.total ?? 0, 1e-12);
    return { asks, bids, most };
  }, [book]);

  const bestBid = book?.bids[0]?.price ?? null;
  const bestAsk = book?.asks[0]?.price ?? null;
  const spread = bestBid !== null && bestAsk !== null && bestAsk > bestBid ? bestAsk - bestBid : null;
  const spreadShare = spread !== null && bestBid !== null && bestAsk !== null ? (spread / ((bestAsk + bestBid) / 2)) * 100 : null;

  const row = (level: { price: number; size: number; total: number }, side: "ask" | "bid") => {
    const price = formatTerminalPrice(level.price, intl, decimals);
    return (
      <button
        key={`${side}-${level.price}`}
        type="button"
        className={styles.bookRow}
        data-side={side}
        style={{ ["--depth" as string]: `${(level.total / rows.most) * 100}%` }}
        onClick={() => onPick?.(level.price)}
        disabled={!onPick || stale}
        aria-label={`${w("book.pick", { price })} · ${formatAmount(level.size, intl, 4)} ${coin}`}
      >
        <span className={styles.bookPrice}>{price}</span>
        <span>{formatAmount(level.size, intl, 4)}</span>
        <span>{formatAmount(level.total, intl, 4)}</span>
      </button>
    );
  };

  return (
    <div className={styles.book} data-perp-book data-dense data-stale={stale || undefined} lang={lang}>
      <div className={styles.bookHead} aria-hidden="true">
        <span>{w("book.price")}</span>
        <span>{w("book.size", { coin })}</span>
        <span>{w("book.total", { coin })}</span>
      </div>
      {book && (rows.asks.length || rows.bids.length) ? (
        <>
          <div className={styles.bookAsks}>{rows.asks.map((level) => row(level, "ask"))}</div>
          <div className={styles.bookMid} data-perp-book-mid>
            <span className={styles.bookMark}>{formatTerminalPrice(markUsd, intl, decimals)}</span>
            <span className={styles.bookSpread}>
              {stale
                ? w("book.stale")
                : spread === null
                  ? ""
                  : w("book.spread", { x: `${formatTerminalPrice(spread, intl, decimals)} · ${formatAmount(spreadShare, intl, 3)}${lang === "en" ? "%" : " %"}` })}
            </span>
            {pro && rates ? <ScalpCheckPanel book={book} stale={stale} coin={coin} markUsd={markUsd} rates={rates} lang={lang} /> : null}
          </div>
          <div className={styles.bookBids}>{rows.bids.map((level) => row(level, "bid"))}</div>
        </>
      ) : (
        <p className={styles.muted}>{book ? w("book.empty") : stale && ageMs !== null ? w("book.stale") : "…"}</p>
      )}
    </div>
  );
}
