"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { yearRange } from "@/app/app/invest/company-facts-model";
import { anchorPoints, formatUnits, rangePoints, unitsPhrase } from "@/app/app/invest/company-model";
import { investWords, numberLocale } from "@/app/app/invest/invest-words";
import { WarnSheet, WatchLine } from "@/app/app/invest/position-watch";
import type { SaleAsset } from "@/app/app/invest/sale-model";
import { usePositions } from "@/app/app/invest/use-positions";
import { useWalletData } from "@/app/app/wallet-data";
import { shownRaw } from "@/app/app/wallet-view-model";
import type { WorkspaceLocale } from "@/app/shell/locale";
import type { PositionWatchView } from "@/lib/api/v1/contract";
import { openSolanaConnection } from "@/app/solana/workspace/connection-trigger.client";
import { formatUsdMoney, formatUsdPrice } from "@/app/solana/workspace/spot/spot-format";
import { useSpotCandles } from "@/app/solana/workspace/spot/use-spot-data";

import company from "./company.module.css";
import { SellSheet } from "./sell-sheet";

/**
 * The two facts of the company page that are read in the browser: the price
 * over the year — the same daily closes the chart's year draws, anchored to
 * the page's price, with the low, the high and where the price stands between
 * them — and the reader's own position, when the connected wallet holds the
 * token.
 */

/** «30.03.2026» — short enough to sit under a figure on a phone. */
function day(at: number, numbers: string): string {
  return new Intl.DateTimeFormat(numbers, { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(at));
}

export function YearRange({ mint, price, locale }: { mint: string; price: number | null; locale: WorkspaceLocale }) {
  const word = investWords(locale);
  const numbers = numberLocale(locale);
  const candles = useSpotCandles(mint, "1d");
  const range = useMemo(() => {
    if (!candles.value) return null;
    const now = Date.now();
    return yearRange(anchorPoints(rangePoints(candles.value.candles, "1y", now), price), price, now);
  }, [candles.value, price]);

  if (!range) {
    if (candles.status === "loading") return <div className={company.yearBone} aria-hidden="true" />;
    return null;
  }
  const young = range.since > Date.now() - 330 * 86_400_000;
  const position = range.position === null ? null : Math.min(1, Math.max(0, range.position));
  return (
    <div className={company.year} data-year-range>
      <div className={company.yearHead}>
        <span className={company.statLabel}>{word("yearRange")}</span>
        {young ? <span className={company.yearSince}>{`${word("since")} ${day(range.since, numbers)}`}</span> : null}
      </div>
      <div className={company.yearTrack} role="img" aria-label={`${word("yearLow")} ${formatUsdPrice(range.low, numbers)}, ${word("yearHigh")} ${formatUsdPrice(range.high, numbers)}`}>
        {position === null ? null : (
          <>
            <span className={company.yearFill} style={{ width: `${position * 100}%` }} />
            <span className={company.yearMark} style={{ left: `${position * 100}%` }} />
          </>
        )}
      </div>
      <div className={company.yearEnds}>
        <span>
          <span className={company.yearValue} translate="no">
            {formatUsdPrice(range.low, numbers)}
          </span>
          <span className={company.yearWhen}>{`${word("yearLow")} · ${day(range.lowAt, numbers)}`}</span>
        </span>
        <span data-end="high">
          <span className={company.yearValue} translate="no">
            {formatUsdPrice(range.high, numbers)}
          </span>
          <span className={company.yearWhen}>{`${word("yearHigh")} · ${day(range.highAt, numbers)}`}</span>
        </span>
      </div>
    </div>
  );
}

/**
 * The reader's own position in the company, from the connected wallet: its
 * value and how much of the company it is — and, beside it, «Продати», quiet:
 * the page's one orange action stays «Купити». The sale opens its own sheet
 * on the purchase's path. A page whose issuer event already offers the holder
 * a sale passes no `sale`, so the holder never sees two. Nothing without a
 * holding.
 *
 * Under it, Нагляд over the position: the state the server judged and its one
 * action — «Відкрити продаж» opens the sale here, «Увімкнути „Ryntra
 * попередить“» its sheet — and a warning's link (`?sell=1`) arrives with the
 * sale open; Home's «Налаштувати» for a position with no loss limit
 * (`?watch=1`), with the sheet open.
 */
export function YourPosition({ mint, name, price, unit, locale, sale = null }: { mint: string; name: string; price: number | null; unit: "share" | "token"; locale: WorkspaceLocale; sale?: SaleAsset | null }) {
  const word = investWords(locale);
  const numbers = numberLocale(locale);
  const { holdings } = useWalletData();
  const [selling, setSelling] = useState(false);
  const [warning, setWarning] = useState<PositionWatchView | null>(null);
  const positions = usePositions();
  const watch = positions.of(mint);
  const { phase: positionsPhase, reload: reloadPositions } = positions;
  /* One way to connect: the header's own panel; the sheet steps aside first, or the panel would sit under it. */
  const connectFirst = useCallback(() => {
    setSelling(false);
    window.requestAnimationFrame(() => openSolanaConnection());
  }, []);
  /* A closed sale re-reads Нагляд: a position sold, or sold in part, says so at once. */
  const closeSale = useCallback(() => {
    setSelling(false);
    reloadPositions();
  }, [reloadPositions]);
  const position = (() => {
    if (holdings.status !== "ready") return null;
    const row = holdings.data.find((entry) => entry.mint === mint);
    if (!row || !/^\d+$/.test(row.amountRaw) || BigInt(row.amountRaw) <= 0n) return null;
    const amount = Number(shownRaw(row)) / 10 ** row.decimals;
    if (!Number.isFinite(amount) || amount <= 0) return null;
    return { amount, value: typeof price === "number" && Number.isFinite(price) ? amount * price : null };
  })();
  const canSell = sale?.sellable === true;
  const held = position !== null;
  /* «Дія»: the watch's «Відкрити продаж» is the block's one sale — the quiet «Продати» steps aside for it; «Пауза емітента»: nothing can be sold now, «Деталі» says why. */
  const saleInLine = canSell && (watch?.action === "open-sale" || watch?.state === "issuer-paused");
  /* A warning's link lands with the sale open (`?sell=1`, «Відкрити продаж»): once, when the position is read and the sale is this block's — an issuer's event keeps its own. */
  useEffect(() => {
    if (!held || !canSell) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("sell") !== "1") return;
    params.delete("sell");
    const rest = params.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${rest ? `?${rest}` : ""}${window.location.hash}`);
    setSelling(true);
  }, [held, canSell]);
  /* Home's «Налаштувати» lands with «Ryntra попередить» open (`?watch=1`): once, when Нагляд has read the position and its one action is that sheet — without a channel the line itself says «Підключи Telegram». */
  useEffect(() => {
    if (!held || !watch) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("watch") !== "1") return;
    params.delete("watch");
    const rest = params.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${rest ? `?${rest}` : ""}${window.location.hash}`);
    if (watch.action === "warn") setWarning(watch);
  }, [held, watch]);
  /* A position bought since the page read Нагляд is read again — at most every half minute. */
  useEffect(() => {
    if (held && positionsPhase === "ready" && !watch) reloadPositions(30_000);
  }, [held, positionsPhase, watch, reloadPositions]);
  /* The sale's sheet outlives the block while it is open: a settled sale re-reads the wallet, and the receipt stays on screen while the position is read again — or is gone, all of it sold. */
  if (!position && !(canSell && selling)) return null;
  return (
    <>
      {position ? (
        <div className={company.position} data-position>
          <div className={company.positionText}>
            <span className={company.statLabel}>{word("yourPosition")}</span>
            <span className={company.positionValue} translate="no">
              {position.value !== null ? formatUsdMoney(position.value, numbers) : formatUnits(position.amount, numbers)}
            </span>
            <span className={company.positionUnits}>{unitsPhrase(position.amount, unit, name, locale === "uk" ? "uk" : "en", numbers)}</span>
          </div>
          {canSell && !saleInLine ? (
            <button type="button" className={`rw-btn ${company.sell}`} aria-haspopup="dialog" data-sell-open={selling ? "true" : undefined} onClick={() => setSelling(true)}>
              {word("sell")}
            </button>
          ) : null}
        </div>
      ) : null}
      {position && watch ? (
        <WatchLine
          view={watch}
          locale={locale}
          place="page"
          onSale={canSell ? () => setSelling(true) : undefined}
          onWarn={() => setWarning(watch)}
        />
      ) : null}
      {canSell && sale ? <SellSheet open={selling} asset={sale} locale={locale} onClose={closeSale} onConnect={connectFirst} /> : null}
      <WarnSheet view={warning} locale={locale} onClose={() => setWarning(null)} />
    </>
  );
}
