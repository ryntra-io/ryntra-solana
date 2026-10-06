import { Suspense } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import type { ScreenerRow, ScreenerTab } from "@/lib/markets/screener";
import { listScreenerCoins } from "@/lib/spot/markets.server";
import { readStockUniverse } from "@/lib/stocks/universe.server";

import { MarketsScreener, ScreenerSkeleton } from "./markets-screener";
import { marketsWords } from "./markets-words";
import { stockScreenerRow } from "./screener-rows";
import styles from "./screener.module.css";

/** The most traded coins of each kind carried to the browser; the table shows them fifty at a time. */
const COINS_CARRIED = { crypto: 150, meme: 150 } as const;

/**
 * «Ринки»: one screener for everything Ryntra trades — the
 * stock universe's listed stocks and private companies and the venue's crypto
 * and memes — in one table with tabs, sorted the way the person chooses. The
 * head is sent at once; the table streams in behind a skeleton of its shape.
 */
export function MarketsPlace({ locale, tab }: { locale: WorkspaceLocale; tab: ScreenerTab }) {
  const word = marketsWords(locale);
  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <h1 className={styles.title}>{word("title")}</h1>
        <p className={styles.lead}>{word("lead")}</p>
      </header>
      <Suspense fallback={<ScreenerSkeleton />}>
        <ScreenerData locale={locale} tab={tab} />
      </Suspense>
    </div>
  );
}

async function ScreenerData({ locale, tab }: { locale: WorkspaceLocale; tab: ScreenerTab }) {
  const [stocks, coins] = await Promise.all([readStockUniverse(), listScreenerCoins(COINS_CARRIED)]);
  const rows: ScreenerRow[] = [...(coins.ok ? coins.rows : []), ...(stocks.ok ? stocks.universe.rows.map(stockScreenerRow) : [])];
  return (
    <MarketsScreener
      rows={rows}
      locale={locale}
      initialTab={tab}
      down={{ coins: !coins.ok, stocks: !stocks.ok }}
      coinsAt={coins.ok ? { at: coins.observedAt, stale: coins.stale } : null}
    />
  );
}
