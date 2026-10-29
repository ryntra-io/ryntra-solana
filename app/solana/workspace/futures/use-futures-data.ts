"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import type { BookFeed, BookMessage } from "@ryntra/core/ui";

import { COLD_FEED, MARKETS_MAX_AGE_MS, feedStep, type FeedState } from "../../../../lib/phoenix/feed-lifecycle.ts";
import type { FuturesFundingHistory, FuturesOrdersHistory, FuturesTrades } from "@/lib/phoenix/history";
import type { TicketMargin } from "@/lib/phoenix/margin";
import type { FuturesAccount, FuturesBook, FuturesCandles, FuturesFunding, FuturesMarkets, FuturesTimeframe } from "@/lib/phoenix/market-data";

import { CANDLES_POLL_MS } from "./futures-chart-source.ts";

/**
 * The reads of «Ф'ючерси» (B7): Ryntra's own `/api/solana/futures/*`, each on its own clock, while the page is in
 * sight — a hidden tab reads nothing and catches up when it comes back. One read at a time per address; a 429 waits
 * as long as the answer asks. A read that fails keeps the last good one on screen and says so; nothing here ever sends
 * or signs.
 *
 * How old an answer is never comes from the visitor's wall clock against the server's (a laptop is often seconds off):
 * our server reads Phoenix the moment it answers, so an answer is as old as it waited in the edge's cache — its `Age`
 * header — and from its arrival on the page's own monotonic clock counts on.
 */

export const MARKETS_POLL_MS = 5_000;
export const BOOK_POLL_MS = 2_000;
export const ACCOUNT_POLL_MS = 10_000;
/** A book older than this is greyed by the core's `OrderBook`: a few polls and the edge's second or two. */
export const BOOK_MAX_AGE_MS = 8_000;
/** A read that has not answered in this long is a failed read: the poll goes on rather than wait for ever (the server's own deadline is 8 s). */
export const READ_TIMEOUT_MS = 15_000;
/** The longest a 429 makes the page wait before it asks again. */
const MAX_BACKOFF_MS = 60_000;

/** An answer's age at the edge, when it reached the page (its monotonic clock), and the address it answered. */
export type Arrival = Readonly<{ ageMs: number; receivedAt: number; url?: string }>;

export type Polled<T> = Readonly<{ value: T | null; failed: boolean; loading: boolean }>;

/** The page's own clock: monotonic, so a corrected wall clock never makes data younger or older. */
export const pageClock = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

/** How long an answer waited in the edge's cache, from its `Age` header (seconds); 0 when it came from the server. */
export function ageOf(headers: Pick<Headers, "get">): number {
  const age = Number(headers.get("age"));
  return Number.isFinite(age) && age > 0 ? age * 1000 : 0;
}

/** How long a 429 asks to wait, from its `Retry-After` (seconds), within a minute; the poll's own pace otherwise. */
export function retryAfterOf(headers: Pick<Headers, "get">, every: number): number {
  const seconds = Number(headers.get("retry-after"));
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(MAX_BACKOFF_MS, Math.max(every, seconds * 1000)) : Math.min(MAX_BACKOFF_MS, every * 4);
}

/**
 * Reads `url` now and every `every` ms while the page is visible; a new `url` starts over. Null `url` reads nothing.
 * `keep: false` hands each answer to `onValue` only and does not render the page again for it (the book, many times
 * a minute).
 */
export function usePolled<T>(
  url: string | null,
  every: number,
  onValue?: (value: T, arrival: Arrival) => void,
  onFail?: () => void,
  keep = true,
): Polled<T> {
  const [state, setState] = useState<Polled<T>>({ value: null, failed: false, loading: url !== null });
  const handlers = useRef({ onValue, onFail });
  handlers.current = { onValue, onFail };
  useEffect(() => {
    if (url === null) {
      setState({ value: null, failed: false, loading: false });
      return;
    }
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let reading = false;
    let controller: AbortController | null = null;
    setState({ value: null, failed: false, loading: true });
    const schedule = (delay: number) => {
      if (live && timer === null) timer = setTimeout(read, delay);
    };
    async function read() {
      timer = null;
      if (!live || reading || document.visibilityState === "hidden") return;
      reading = true;
      controller = new AbortController();
      const own = controller;
      let timedOut = false;
      const deadline = setTimeout(() => {
        timedOut = true;
        own.abort();
      }, READ_TIMEOUT_MS);
      let delay = every;
      try {
        const response = await fetch(url as string, { signal: controller.signal, headers: { accept: "application/json" } });
        if (response.status === 429) delay = retryAfterOf(response.headers, every);
        if (!response.ok) throw new Error(String(response.status));
        const value = (await response.json()) as T;
        if (!live) return;
        handlers.current.onValue?.(value, { ageMs: ageOf(response.headers), receivedAt: pageClock(), url: url as string });
        setState((before) => (keep ? { value, failed: false, loading: false } : before.failed || before.loading ? { value: null, failed: false, loading: false } : before));
      } catch (error) {
        if (!live || (!timedOut && error instanceof DOMException && error.name === "AbortError")) return;
        handlers.current.onFail?.();
        setState((before) => (before.failed && !before.loading ? before : { value: before.value, failed: true, loading: false }));
      } finally {
        clearTimeout(deadline);
        reading = false;
      }
      schedule(delay);
    }
    const onVisible = () => {
      if (document.visibilityState === "visible" && !reading && timer === null) void read();
    };
    void read();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [url, every, keep]);
  return state;
}

/** How often the page asks the feed whether it went quiet. */
const FEED_TICK_MS = 1_000;

/**
 * The markets and their life (PERP-4, `feed-lifecycle.ts`): each read is a snapshot, a read that failed or silence past
 * `MARKETS_MAX_AGE_MS` makes them stale — the head and the ticket say «Дані не оновлюються» with the time of the last
 * update and close new risk — and only the next good read brings them back.
 */
export function useFuturesMarkets(): Polled<FuturesMarkets> & Readonly<{ feed: FeedState }> {
  const [feed, step] = useReducer(feedStep, COLD_FEED);
  const onValue = useCallback((_: FuturesMarkets, arrival: Arrival) => step({ kind: "snapshot", at: arrival.receivedAt, wall: Date.now(), ageMs: arrival.ageMs }), []);
  const onFail = useCallback(() => step({ kind: "fail" }), []);
  const polled = usePolled<FuturesMarkets>("/api/solana/futures/markets", MARKETS_POLL_MS, onValue, onFail);
  useEffect(() => {
    const timer = setInterval(() => step({ kind: "tick", now: pageClock(), maxAgeMs: MARKETS_MAX_AGE_MS }), FEED_TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return { ...polled, feed };
}

/** How often the market's funding rate is read: Phoenix states a new one once a period, the edge keeps it thirty seconds. */
export const FUNDING_POLL_MS = 30_000;

/** The market's funding rate now (`/api/solana/futures/funding`); null value — none read yet, or Phoenix has none recent. */
export function useFuturesFunding(symbol: string | null): Polled<FuturesFunding> {
  return usePolled<FuturesFunding>(symbol ? `/api/solana/futures/funding?symbol=${encodeURIComponent(symbol)}` : null, FUNDING_POLL_MS);
}

/** The ticket's question to the SDK's margin calculator (`/api/solana/futures/ticket`); null — nothing to ask. */
export type TicketQuestion = Readonly<{
  wallet: string;
  symbol: string;
  side: "long" | "short";
  type: "market" | "limit";
  leverage: number;
  slippageBps: number;
  feeBps: number;
  sizeLots: string | null;
  limitTicks: string | null;
  reduceOnly: boolean;
  fillTicks: string | null;
}>;

export type TicketFigures = TicketMargin & Readonly<{ observedAt: number }>;

/** How long the ticket waits after the last keystroke before it asks; and how often it asks again while it stands. */
const TICKET_SETTLE_MS = 300;
const TICKET_REFRESH_MS = 10_000;

export function ticketUrl(question: TicketQuestion): string {
  const query = new URLSearchParams({
    wallet: question.wallet,
    symbol: question.symbol,
    side: question.side,
    type: question.type,
    leverage: String(Math.max(1, Math.floor(question.leverage))),
    slippageBps: String(question.slippageBps),
    feeBps: String(Math.max(0, Math.min(100, question.feeBps))),
  });
  if (question.sizeLots) query.set("size", question.sizeLots);
  if (question.limitTicks) query.set("price", question.limitTicks);
  if (question.reduceOnly) query.set("reduceOnly", "1");
  if (question.fillTicks) query.set("fill", question.fillTicks);
  return `/api/solana/futures/ticket?${query.toString()}`;
}

/**
 * The ticket's figures by Phoenix's SDK (PERP-4): asked once the typing settles and again every ten seconds while the
 * question stands. `figures` answers the question asked now only — an answer to an older one is never shown as this
 * one's; `failed` — the last ask got no answer.
 */
/** A ticket's question without its size: the most's own key. */
export function maxKeyOf(url: string): string {
  const parsed = new URL(url, "http://ryntra");
  parsed.searchParams.delete("size");
  parsed.searchParams.delete("fill");
  return `${parsed.pathname}?${parsed.searchParams.toString()}`;
}

export function useTicketMargin(question: TicketQuestion | null): Readonly<{ figures: TicketFigures | null; figuresAt: number | null; maxLots: string | null; account: TicketFigures["account"]; loading: boolean; failed: boolean }> {
  const url = question ? ticketUrl(question) : null;
  /* The most does not depend on the size typed: it stands while only the size changes. */
  const maxKey = url === null ? null : maxKeyOf(url);
  const [settled, setSettled] = useState<string | null>(url);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(url), TICKET_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [url]);
  /* `at` — when the answer left the server, on this page's monotonic clock (its arrival less its age at the edge): never the server's wall clock against the visitor's. */
  const [answer, setAnswer] = useState<Readonly<{ url: string; maxKey: string | null; figures: TicketFigures; at: number }> | null>(null);
  /* The answer is stored under the address it answered, never the one asked since. */
  const read = usePolled<TicketFigures>(settled, TICKET_REFRESH_MS, (figures, arrival) => {
    if (arrival.url) setAnswer({ url: arrival.url, maxKey: maxKeyOf(arrival.url), figures, at: arrival.receivedAt - arrival.ageMs });
  });
  const current = answer !== null && answer.url === url ? answer.figures : null;
  const sameAccount = answer !== null && question !== null && answer.figures.symbol.toLowerCase() === question.symbol.toLowerCase() && new URL(answer.url, "http://ryntra").searchParams.get("wallet") === question.wallet;
  return {
    figures: current,
    figuresAt: current === null ? null : answer!.at,
    maxLots: answer !== null && answer.maxKey === maxKey ? answer.figures.maxLots : null,
    account: sameAccount ? answer.figures.account : null,
    loading: url !== null && current === null && !read.failed,
    failed: read.failed && url === settled,
  };
}

/**
 * How often a wallet's own history is read (PERP-5): a fill, a cancel or a funding settlement is not a price — half a
 * minute is often enough, and the tab that is hidden reads nothing.
 */
export const HISTORY_POLL_MS = 30_000;

const historyUrl = (kind: "trades" | "orders" | "funding", wallet: string | null, symbol: string | null): string | null =>
  wallet ? `/api/solana/futures/history?wallet=${encodeURIComponent(wallet)}&kind=${kind}${symbol ? `&symbol=${encodeURIComponent(symbol)}` : ""}` : null;

/** The wallet's fills on Phoenix — one market's, or every market's when `symbol` is null. */
export function useFuturesTrades(wallet: string | null, symbol: string | null): Polled<FuturesTrades> {
  return usePolled<FuturesTrades>(historyUrl("trades", wallet, symbol), HISTORY_POLL_MS);
}

/** The wallet's orders and what became of each. */
export function useFuturesOrderHistory(wallet: string | null, symbol: string | null): Polled<FuturesOrdersHistory> {
  return usePolled<FuturesOrdersHistory>(historyUrl("orders", wallet, symbol), HISTORY_POLL_MS);
}

/** The wallet's funding settlements, with the time of each. */
export function useFuturesFundingHistory(wallet: string | null, symbol: string | null): Polled<FuturesFundingHistory> {
  return usePolled<FuturesFundingHistory>(historyUrl("funding", wallet, symbol), HISTORY_POLL_MS);
}

/** `every`: Home and Portfolio read the account for its collateral alone, at a slower pace than «Ф'ючерси». */
export function useFuturesAccount(wallet: string | null, every: number = ACCOUNT_POLL_MS): Polled<FuturesAccount> {
  return usePolled<FuturesAccount>(wallet ? `/api/solana/futures/account?wallet=${encodeURIComponent(wallet)}` : null, every);
}

export function useFuturesCandles(symbol: string | null, timeframe: FuturesTimeframe, onValue: (value: FuturesCandles, arrival: Arrival) => void, onFail: () => void): Polled<FuturesCandles> {
  const url = symbol ? `/api/solana/futures/candles?symbol=${encodeURIComponent(symbol)}&tf=${timeframe}` : null;
  return usePolled<FuturesCandles>(url, CANDLES_POLL_MS, onValue, onFail, false);
}

/**
 * The book as the core's `OrderBook` reads it: a feed whose messages carry the answer's age, so the canvas greys a
 * book that stopped coming. One feed per market. `clock` is the page's monotonic clock (a test passes one that stands).
 */
export class PolledBookFeed implements BookFeed {
  #message: BookMessage | null = null;
  #receivedAt = 0;
  readonly #clock: () => number;
  readonly #listeners = new Set<(message: BookMessage) => void>();

  constructor(clock: () => number = pageClock) {
    this.#clock = clock;
  }

  put(book: FuturesBook, arrival: Arrival): void {
    const age = Math.max(0, arrival.ageMs);
    this.#message = {
      channel: `phoenix.book.${book.symbol}`,
      at: book.observedAt,
      age_ms: age,
      data: { bids: book.bids, asks: book.asks },
      status: {
        state: "delayed",
        market: "open",
        source: { id: "phoenix", label: "Phoenix", rights: "display", attribution: null },
        at: book.observedAt,
        gateway_at: book.observedAt + age,
        age_ms: age,
        delay_ms: BOOK_POLL_MS,
        derived: false,
      },
    };
    this.#receivedAt = arrival.receivedAt;
    for (const listener of this.#listeners) listener(this.#message);
  }

  subscribe(listener: (message: BookMessage) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  current(): BookMessage | null {
    if (!this.#message) return null;
    return { ...this.#message, age_ms: this.#message.age_ms + Math.max(0, this.#clock() - this.#receivedAt) };
  }
}

/** The market's book: a feed for the core's `OrderBook`, fed by a read every two seconds that renders nothing itself. */
export function useFuturesBook(symbol: string | null): Readonly<{ feed: PolledBookFeed | null; failed: boolean }> {
  const [feed, setFeed] = useState<PolledBookFeed | null>(null);
  useEffect(() => setFeed(symbol ? new PolledBookFeed() : null), [symbol]);
  const read = usePolled<FuturesBook>(
    symbol && feed ? `/api/solana/futures/book?symbol=${encodeURIComponent(symbol)}` : null,
    BOOK_POLL_MS,
    (book, arrival) => {
      if (book.symbol === symbol) feed?.put(book, arrival);
    },
    undefined,
    false,
  );
  return { feed, failed: read.failed };
}
