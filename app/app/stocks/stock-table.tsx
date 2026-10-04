"use client";

import { CaretDown, CaretUp } from "@phosphor-icons/react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Help } from "@/app/shell/help";
import type { HelpTopicId } from "@/app/shell/help-topics";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { MarketIcon } from "@/app/solana/workspace/spot/market-list";
import { formatPercent, formatUsdCompact, formatUsdPrice, toneOf } from "@/app/solana/workspace/spot/spot-format";

import { clockOf, ISSUER_SHORT, periodTone, periodWord, referenceWord, sortRows, wordsFor, type SlimStockRow, type StockSortKey } from "./stock-model";
import styles from "./stocks.module.css";

/**
 * The one table of the stock surface — Discover and the screener draw the
 * same rows the same way. A row is the stock: its icon, ticker, company and
 * issuer; then the venue's price and day; the issuer's reference with its
 * state; the deviation on the list basis; the session; the day's volume and
 * the pool's liquidity. A figure the source did not state is a quiet dash;
 * a state that needs a word carries it beside the figure, never a sentence.
 * Every header sorts; the sort lives in the table and resets with its rows.
 */

/* The `?` beside a header names the term once, for every row under it. */
const COLUMNS: readonly { key: StockSortKey; word: "colStock" | "colPrice" | "col24h" | "colReference" | "colDeviation" | "colSession" | "colVolume" | "colLiquidity"; className: string; help?: HelpTopicId }[] = [
  { key: "symbol", word: "colStock", className: styles.cStock },
  { key: "price", word: "colPrice", className: styles.cPrice },
  { key: "change24h", word: "col24h", className: styles.cChange },
  { key: "reference", word: "colReference", className: styles.cReference, help: "referencePrice" },
  { key: "deviation", word: "colDeviation", className: styles.cDeviation, help: "deviation" },
  { key: "session", word: "colSession", className: styles.cSession, help: "session" },
  { key: "volume", word: "colVolume", className: styles.cVolume, help: "volume" },
  { key: "liquidity", word: "colLiquidity", className: styles.cLiquidity, help: "liquidity" },
];

const DEFAULT_DIRECTION: Readonly<Record<StockSortKey, "asc" | "desc">> = {
  symbol: "asc",
  price: "desc",
  change24h: "desc",
  reference: "desc",
  deviation: "desc",
  session: "desc",
  volume: "desc",
  liquidity: "desc",
};

export function StockTable({
  rows,
  locale,
  sort: initialSort = null,
  emptyWord,
}: {
  rows: readonly SlimStockRow[];
  locale: WorkspaceLocale;
  /** The order the rows arrive in is kept until a header is pressed; a key here marks that header as the order. */
  sort?: StockSortKey | null;
  emptyWord: string;
}) {
  const word = wordsFor(locale);
  const numberLocale = locale === "uk" ? "uk-UA" : "en-US";
  const [sort, setSort] = useState<{ key: StockSortKey; direction: "asc" | "desc" } | null>(null);
  const shown = useMemo(() => (sort ? sortRows(rows, sort.key, sort.direction) : rows), [rows, sort]);
  const marked = sort?.key ?? initialSort;

  const press = (key: StockSortKey) => {
    setSort((current) => (current?.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: DEFAULT_DIRECTION[key] }));
  };

  if (rows.length === 0) {
    return (
      <p className={styles.empty} role="status">
        {emptyWord}
      </p>
    );
  }

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            {COLUMNS.map((column) => {
              const active = marked === column.key;
              const direction = sort?.key === column.key ? sort.direction : active ? DEFAULT_DIRECTION[column.key] : null;
              return (
                <th key={column.key} scope="col" className={column.className} aria-sort={direction ? (direction === "asc" ? "ascending" : "descending") : "none"}>
                  <span className={styles.headCell}>
                    <button type="button" className={styles.sortButton} data-active={active ? "true" : "false"} onClick={() => press(column.key)}>
                      <span>{word(column.word)}</span>
                      {direction === "asc" ? <CaretUp size={11} weight="bold" aria-hidden="true" /> : direction === "desc" ? <CaretDown size={11} weight="bold" aria-hidden="true" /> : null}
                    </button>
                    {column.help ? <Help topic={column.help} locale={locale} /> : null}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {shown.map((row) => (
            <StockTableRow key={row.mint} row={row} locale={locale} numberLocale={numberLocale} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** When the issuer's mark behind a pre-IPO row's figure was read: «оцінка емітента · 14:05 UTC». */
function markTitle(row: SlimStockRow, locale: WorkspaceLocale): string {
  const clock = clockOf(row.markAt, locale);
  return `${wordsFor(locale)("issuerMark")}${clock ? ` · ${clock} UTC` : ""}`;
}

function StockTableRow({ row, locale, numberLocale }: { row: SlimStockRow; locale: WorkspaceLocale; numberLocale: string }) {
  const word = wordsFor(locale);
  const href = `/app/stocks/${encodeURIComponent(row.symbol)}`;
  const changeTone = toneOf(row.change24h);
  const deviationTone = toneOf(row.deviation);
  const tone = periodTone(row.period);
  const referenceClock = clockOf(row.referenceAt, locale);
  const referenceTitle = row.reference === null ? undefined : `${referenceWord(row.referenceState, locale)}${referenceClock ? ` · ${referenceClock} UTC` : ""}`;
  const noPool = row.liquidity === null || row.liquidity < 1;
  const preIpo = row.kind === "pre-ipo";
  return (
    <tr className={styles.row}>
      <th scope="row" className={styles.cStock}>
        <Link className={styles.stock} href={href} prefetch={false}>
          <MarketIcon mint={row.mint} icon={row.icon} symbol={row.symbol} size={28} className={styles.icon} />
          <span className={styles.names}>
            <span className={styles.symbol} translate="no">
              {row.symbol}
              {preIpo ? <span className={styles.flag} data-kind="preipo">{word("preIpoFlag")}</span> : null}
              {row.halted ? <span className={styles.flag}>{word("halted")}</span> : null}
              {!row.tradable ? <span className={styles.flag}>{word("notOffered")}</span> : null}
            </span>
            <span className={styles.name}>
              <span className={styles.company}>{row.name}</span>
              <span className={styles.issuer}> · {ISSUER_SHORT[row.issuer]}</span>
            </span>
          </span>
        </Link>
      </th>
      <td className={`${styles.cPrice} ${styles.num}`} translate="no">
        {formatUsdPrice(row.price, numberLocale)}
      </td>
      <td className={`${styles.cChange} ${styles.num}`} data-tone={changeTone} translate="no">
        {formatPercent(row.change24h, numberLocale)}
      </td>
      {/* A pre-IPO row has no exchange reference; the issuer's own mark is drawn in its place and named as exactly that. */}
      <td className={`${styles.cReference} ${styles.num}`} translate="no" title={preIpo ? word("issuerMark") : referenceTitle}>
        {row.reference === null ? (
          preIpo && row.mark !== null ? (
            <>
              {formatUsdPrice(row.mark, numberLocale)}
              <span className={styles.state}>{word("issuerMarkShort")}</span>
            </>
          ) : (
            <span className={styles.dash}>—</span>
          )
        ) : (
          <>
            {formatUsdPrice(row.reference, numberLocale)}
            {row.referenceState !== "current" ? <span className={styles.state} data-state={row.referenceState}>{referenceWord(row.referenceState, locale)}</span> : null}
          </>
        )}
      </td>
      {/* A pre-IPO row has no deviation from a market reference; the column carries its one figure instead — the token against the issuer's own valuation, named as exactly that, with no tone of good or bad. */}
      {preIpo && row.deviation === null && row.markPremium !== null ? (
        <td className={`${styles.cDeviation} ${styles.num}`} data-tone="flat" translate="no" title={markTitle(row, locale)} data-premium>
          {formatPercent(row.markPremium, numberLocale)}
          <span className={styles.state}>{word("premiumToMark")}</span>
        </td>
      ) : (
        <td className={`${styles.cDeviation} ${styles.num}`} data-tone={row.deviation === null ? "flat" : deviationTone} translate="no">
          {row.deviation === null ? <span className={styles.dash}>—</span> : formatPercent(row.deviation, numberLocale)}
        </td>
      )}
      <td className={styles.cSession}>
        {tone === null ? (
          <span className={styles.dash}>—</span>
        ) : (
          <span className={styles.session} data-tone={tone}>
            <span className={styles.dot} aria-hidden="true" />
            {periodWord(row.period, locale)}
          </span>
        )}
      </td>
      <td className={`${styles.cVolume} ${styles.num}`} translate="no">
        {formatUsdCompact(row.volume, numberLocale)}
      </td>
      <td className={`${styles.cLiquidity} ${styles.num}`} translate="no">
        {noPool ? <span className={styles.stateQuiet}>{word("noPool")}</span> : formatUsdCompact(row.liquidity, numberLocale)}
      </td>
    </tr>
  );
}
