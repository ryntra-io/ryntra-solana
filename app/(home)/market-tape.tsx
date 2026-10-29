"use client";

import "@ryntra/core/chart/compact.css";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChartCaption, Sparkline } from "@ryntra/core/chart/compact";
import type { PublicLocale } from "@/lib/site/locale";
import { TAPE_PARTIAL_TTL_MS, TAPE_TTL_MS, tapeStatus, tapeTone, type TapeRead, type TapeRow } from "@/lib/spot/tape";
import { landingCopy } from "./landing-copy";
import styles from "./market-tape.module.css";

/**
 * The market tape — Ryntra's own, between the hero and the orbit.
 *
 * Eight markets that trade on Solana — SOL, Bitcoin and Ether as Solana tokens, Jupiter, and Apple, NVIDIA, Tesla
 * and the S&P 500 fund as xStocks — each with its price in dollars, its change over a day, and a day of hourly
 * closes drawn by the core's sparkline (`@ryntra/core/chart/compact`). The prices are Jupiter's, the lines
 * GeckoTerminal's: one line under the tape names them with the age of the numbers (`ChartCaption`).
 *
 * Lazy: the read waits for the page to finish loading and for the tape to come near the screen, then repeats while
 * the page is open. Until then the slot keeps the tape's height, so nothing below moves when it arrives. The tape
 * runs slowly from right to left and stops under a pointer, on focus, and for anyone who asked for less motion; its
 * frame, words and figures are the landing's own ink and font (`market-tape.module.css`).
 */

/** The tape's read: one route, kept by the server and at the edge (`app/api/spot/tape`). */
export const TAPE_ROUTE = "/api/spot/tape";

function formatPrice(value: number, locale: PublicLocale): string {
  const digits = value >= 1 ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : { maximumSignificantDigits: 4 };
  return value.toLocaleString(locale === "uk" ? "uk-UA" : "en-US", digits);
}

function formatChange(value: number, locale: PublicLocale): string {
  const text = Math.abs(value).toLocaleString(locale === "uk" ? "uk-UA" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${text}%`;
}

function TapeItem({ row, read, locale, hidden }: { row: TapeRow; read: TapeRead; locale: PublicLocale; hidden?: boolean }) {
  const copy = landingCopy(locale).tape;
  const status = useMemo(() => tapeStatus(read), [read]);
  const tone = tapeTone(row.change24hPct);
  /* next/image resizes the catalogue's picture once (a 1.5 MB logo behind a 20 px circle); a host that will not answer leaves the circle. */
  const [broken, setBroken] = useState(false);
  return (
    <li className={styles.item} aria-hidden={hidden || undefined} data-tape-item={row.symbol}>
      {row.icon && !broken ? <Image className={styles.icon} src={row.icon} alt="" width={20} height={20} loading="lazy" onError={() => setBroken(true)} /> : <span className={styles.icon} aria-hidden />}
      <b className={styles.symbol} translate="no">
        {row.symbol}
      </b>
      {row.price !== null ? (
        <span className={styles.price}>
          {formatPrice(row.price, locale)} <small>USD</small>
        </span>
      ) : null}
      {row.change24hPct !== null ? (
        <span className={styles.change} data-tone={tone}>
          {formatChange(row.change24hPct, locale)}
        </span>
      ) : null}
      {row.points.length > 1 ? (
        <Sparkline
          className={styles.spark}
          points={row.points}
          status={status}
          tone={tone}
          caption="none"
          lang={locale === "uk" ? "uk" : "en"}
          label={`${row.symbol} ${copy.day}`}
        />
      ) : null}
    </li>
  );
}

export function MarketTape({ locale }: { locale: PublicLocale }) {
  const slot = useRef<HTMLDivElement | null>(null);
  const [read, setRead] = useState<TapeRead | null>(null);

  useEffect(() => {
    const host = slot.current;
    if (!host) return;
    let cancelled = false;
    let timer: number | undefined;
    let cancelIdle: (() => void) | null = null;
    let onVisible: (() => void) | null = null;

    /* Reads soon after a failure or while a line is still to come — a few times — then when the read is due. */
    let soon = 0;
    const load = async () => {
      if (document.hidden) {
        /* Nobody is looking: the next read waits for the page to come back. */
        onVisible = () => { onVisible = null; void load(); };
        document.addEventListener("visibilitychange", onVisible, { once: true });
        return;
      }
      let whole = false;
      try {
        const response = await fetch(TAPE_ROUTE, { signal: AbortSignal.timeout(25_000) });
        if (response.ok && !cancelled) {
          const body = (await response.json()) as TapeRead;
          if (Array.isArray(body.rows)) setRead(body);
          whole = body.complete === true;
        }
      } catch {
        /* The tape keeps the last read it had — or its empty height. */
      }
      soon = whole ? 0 : soon + 1;
      const next = !whole && soon <= 6 ? TAPE_PARTIAL_TTL_MS : TAPE_TTL_MS;
      if (!cancelled) timer = window.setTimeout(() => void load(), next);
    };

    /* After the page's own load, in an idle moment — never in the first screen's way. */
    const whenIdle = () => {
      const run = () => { cancelIdle = null; void load(); };
      if (typeof window.requestIdleCallback === "function") {
        const handle = window.requestIdleCallback(run, { timeout: 2000 });
        cancelIdle = () => window.cancelIdleCallback(handle);
      } else {
        const handle = window.setTimeout(run, 200);
        cancelIdle = () => window.clearTimeout(handle);
      }
    };
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      if (document.readyState === "complete") whenIdle();
      else window.addEventListener("load", whenIdle, { once: true });
    }, { rootMargin: "400px 0px" });
    observer.observe(host);

    return () => {
      cancelled = true;
      observer.disconnect();
      window.removeEventListener("load", whenIdle);
      cancelIdle?.();
      window.clearTimeout(timer);
      if (onVisible) document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const rows = read?.rows.filter((row) => row.price !== null) ?? [];
  const status = useMemo(() => (read ? tapeStatus(read) : null), [read]);
  return (
    <section className={styles.tape} aria-label={landingCopy(locale).tape.label}>
      <div ref={slot} className={styles.slot} data-tape={read ? "ready" : "waiting"}>
        {read && rows.length > 0 ? (
          <>
            <div className={styles.frame} tabIndex={0} role="group" aria-label={landingCopy(locale).tape.label}>
              {/* The run is the list twice: the second copy is the first one's tail, hidden from a screen reader. */}
              <div className={styles.track}>
                <ul className={styles.run}>
                  {rows.map((row) => <TapeItem key={row.mint} row={row} read={read} locale={locale} />)}
                </ul>
                <ul className={styles.run} aria-hidden>
                  {rows.map((row) => <TapeItem key={row.mint} row={row} read={read} locale={locale} hidden />)}
                </ul>
              </div>
            </div>
            <ChartCaption className={styles.caption} status={status} lang={locale === "uk" ? "uk" : "en"} size="short" />
          </>
        ) : null}
      </div>
    </section>
  );
}
