"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The live book and trades of one outcome over the provider's WebSocket
 * (updates, live trades, the aggregated book preserved). Public data, the app
 * id in the URL, no token: the socket never authenticates here. Where the
 * origin is not approved for the socket (a local stand) or the connection
 * fails, `connected` stays false and the page polls the REST book instead —
 * the person sees which of the two it is.
 *
 * The SDK's client is loaded on demand so the hub's bundle carries none of it.
 */

export type LiveLevel = Readonly<{ price: number; size: number; venues: Readonly<Record<string, number>> }>;
export type LiveBook = Readonly<{ bids: readonly LiveLevel[]; asks: readonly LiveLevel[]; midpoint: number | null; spread: number | null; venues: readonly string[]; timestamp: number; seq: number }>;
export type LiveTrade = Readonly<{ id: string; venue: string; side: "buy" | "sell"; price: number; size: number; timestamp: number }>;

export type LiveState = Readonly<{ connected: boolean; failed: boolean; book: LiveBook | null; trades: readonly LiveTrade[] }>;

const TRADES_KEPT = 40;

type Socket = {
  connect(): void;
  destroy(): void;
  subscribe(outcomeId: string, channel?: "orderbook" | "trades"): () => void;
  getBook(outcomeId: string): { bids: { price: number; size: number; venues?: Record<string, number> }[]; asks: { price: number; size: number; venues?: Record<string, number> }[]; midpoint: number | null; spread: number | null; venues: Record<string, unknown>; timestamp: number; seq: number } | null;
};

export function useLiveOutcome(appId: string, wsUrl: string, outcomeId: string | null): LiveState {
  const [state, setState] = useState<LiveState>({ connected: false, failed: false, book: null, trades: [] });
  const socket = useRef<Socket | null>(null);

  useEffect(() => {
    if (!outcomeId) return undefined;
    let live = true;
    let unsubscribeBook: (() => void) | null = null;
    let unsubscribeTrades: (() => void) | null = null;
    let failTimer: ReturnType<typeof setTimeout> | null = null;
    setState({ connected: false, failed: false, book: null, trades: [] });

    const readBook = (id: string) => {
      const book = socket.current?.getBook(id);
      if (!book) return;
      const level = (l: { price: number; size: number; venues?: Record<string, number> }): LiveLevel => ({ price: l.price, size: l.size, venues: l.venues ?? {} });
      setState((prev) => ({
        ...prev,
        book: { bids: book.bids.map(level), asks: book.asks.map(level), midpoint: book.midpoint, spread: book.spread, venues: Object.keys(book.venues ?? {}), timestamp: book.timestamp, seq: book.seq },
      }));
    };

    void import("@agg-build/sdk")
      .then(({ AggWebSocket }) => {
        if (!live) return;
        const url = new URL(wsUrl);
        url.searchParams.set("appId", appId);
        const ws = new AggWebSocket({
          url: url.toString(),
          callbacks: {
            onConnectionStateChange: (connected: boolean) => {
              if (!live) return;
              setState((prev) => ({ ...prev, connected, failed: prev.failed && !connected }));
              if (connected && failTimer) {
                clearTimeout(failTimer);
                failTimer = null;
              }
            },
            onSnapshot: (id: string) => {
              if (id === outcomeId) readBook(id);
            },
            onDelta: (id: string) => {
              if (id === outcomeId) readBook(id);
            },
            onTrade: (trade: { outcomeId: string; venue: string; side: "buy" | "sell"; price: number; size: number; timestamp: number }) => {
              if (!live || trade.outcomeId !== outcomeId) return;
              setState((prev) => ({
                ...prev,
                trades: [{ id: `${trade.timestamp}:${trade.venue}:${trade.price}:${trade.size}:${prev.trades.length}`, venue: trade.venue, side: trade.side, price: trade.price, size: trade.size, timestamp: trade.timestamp }, ...prev.trades].slice(0, TRADES_KEPT),
              }));
            },
          },
        }) as unknown as Socket;
        socket.current = ws;
        ws.connect();
        unsubscribeBook = ws.subscribe(outcomeId, "orderbook");
        unsubscribeTrades = ws.subscribe(outcomeId, "trades");
        /* Ten seconds without a connection: the page says the live feed is not available here and polls instead. */
        failTimer = setTimeout(() => {
          if (live) setState((prev) => (prev.connected ? prev : { ...prev, failed: true }));
        }, 10_000);
      })
      .catch(() => {
        if (live) setState((prev) => ({ ...prev, failed: true }));
      });

    return () => {
      live = false;
      if (failTimer) clearTimeout(failTimer);
      try {
        unsubscribeBook?.();
        unsubscribeTrades?.();
        socket.current?.destroy();
      } catch {
        /* a socket already gone */
      }
      socket.current = null;
    };
  }, [appId, wsUrl, outcomeId]);

  return state;
}
