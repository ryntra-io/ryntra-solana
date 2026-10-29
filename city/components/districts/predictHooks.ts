'use client';

import { useEffect, useMemo, useState } from 'react';
import { practiceBook, realBook, summaryOf, type Line, type Past, type Summary } from '@/city/lib/districts/predict/positions';
import { orderLines, useReal } from '@/city/lib/districts/predict/real-store';
import { pageMarket, priceOf, usePredict } from '@/city/lib/districts/predict/store';
import { useWallet } from '@/city/lib/trade/wallet';

/** The clock the window's words follow: whether a read has grown old, how long until a close. */
export function useNow(everyMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}

/** The market the page prices now, kept as one object while its reads stand. */
export function usePageMarket() {
  const page = usePredict((st) => st.page);
  const detail = usePredict((st) => st.detail);
  const lists = usePredict((st) => st.lists);
  return useMemo(() => pageMarket({ page, detail, lists }), [page, detail, lists]);
}

export type Positions = Readonly<{ open: readonly Line[]; past: readonly Past[]; summary: Summary }>;

/**
 * Your positions in the mode the window is in: practice holdings priced by the freshest read, or the real account's
 * positions with the orders still on their way — the same list on the page of positions, beside the markets, on a
 * card and on a market's page.
 */
export function usePositions(): Positions {
  const mode = usePredict((st) => st.mode);
  const book = usePredict((st) => st.book);
  const detail = usePredict((st) => st.detail);
  const lists = usePredict((st) => st.lists);
  const quotes = usePredict((st) => st.quotes);
  const address = useWallet((st) => st.connection?.address ?? null);
  const live = useReal((st) => (address && st.owner === address && st.live?.linked ? st.live : null));
  const recent = useReal((st) => (address && st.owner === address ? st.recent : null));
  return useMemo(() => {
    const read =
      mode === 'real'
        ? realBook(live, orderLines({ recent: recent ?? [], live }), new Set((recent ?? []).map((o) => o.quoteId)))
        : practiceBook(book, (h) => priceOf({ detail, lists, quotes }, h.eventId, h.marketId, h.outcomeId)?.p ?? null);
    return { ...read, summary: summaryOf(read.open) };
  }, [mode, book, detail, lists, quotes, live, recent]);
}
