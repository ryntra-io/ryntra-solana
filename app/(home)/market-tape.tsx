"use client";

import { useEffect, useRef } from "react";
import { watchResolvedTheme } from "@/app/app/theme";
import type { PublicLocale } from "@/lib/site/locale";
import { landingCopy } from "./landing-copy";
import styles from "./market-tape.module.css";

/**
 * The market tape — TradingView's Ticker Tape between the hero and the orbit.
 *
 * TradingView licenses Advanced Charts to Ryntra free of charge on two
 * conditions (2026-10-09): its logo stays on the chart's canvas, and its
 * Ticker widget stands on the home page with its logo and its link under it.
 * This is the second condition. The widget is TradingView's own web
 * component: it draws its logo and its «by TradingView» link itself, in a
 * closed shadow root, and nothing here hides, clips, masks or covers either —
 * the slot has no overflow of its own and no mask.
 *
 * The prices are TradingView's, live from the exchange the symbol names: the
 * four Solana-side assets in US dollars on one exchange, then three companies
 * and the S&P 500 fund — what trades on Spot as a token, here as the market
 * it follows. Ryntra adds no figure of its own.
 *
 * Lazy: the script is TradingView's and comes from its host, so it waits for
 * the page to finish loading and for the tape to come near the screen, then
 * loads once. Until then the slot keeps the tape's height, so nothing below
 * moves when it arrives. The tape follows the page's theme — dark on the
 * landing's dark ground, light on the light one — on a transparent ground,
 * one compact line with a small chart per symbol, its frame, words and
 * figures in the landing's own ink and font (`market-tape.module.css`).
 */

/** TradingView's script host — the only third-party origin the landing's policy adds (`next.config.ts`). */
export const TAPE_SCRIPT = "https://widgets.tradingview-widget.com/w/en/tv-ticker-tape.js";

/** Exchange-prefixed symbols, as TradingView's symbol search names them (checked 2026-10-09). */
export const TAPE_SYMBOLS = [
  "BITSTAMP:SOLUSD",
  "BITSTAMP:BTCUSD",
  "BITSTAMP:ETHUSD",
  "BITSTAMP:JUPUSD",
  "NASDAQ:AAPL",
  "NASDAQ:NVDA",
  "NASDAQ:TSLA",
  "AMEX:SPY",
] as const;

export function MarketTape({ locale }: { locale: PublicLocale }) {
  const slot = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = slot.current;
    if (!host) return;
    let cancelled = false;
    let stopTheme: (() => void) | null = null;
    let cancelIdle: (() => void) | null = null;

    const mount = () => {
      if (cancelled || host.firstElementChild) return;
      if (!document.querySelector(`script[src="${TAPE_SCRIPT}"]`)) {
        const script = document.createElement("script");
        script.type = "module";
        script.src = TAPE_SCRIPT;
        document.head.appendChild(script);
      }
      const tape = document.createElement("tv-ticker-tape");
      tape.setAttribute("symbols", TAPE_SYMBOLS.join(","));
      tape.setAttribute("direction", "horizontal");
      tape.setAttribute("item-size", "compact");
      tape.setAttribute("transparent", "");
      stopTheme = watchResolvedTheme((theme) => tape.setAttribute("theme", theme));
      host.appendChild(tape);
    };

    /* After the page's own load, in an idle moment — never in the first screen's way. */
    const whenIdle = () => {
      const run = () => { cancelIdle = null; mount(); };
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
      stopTheme?.();
    };
  }, []);

  return (
    <section className={styles.tape} aria-label={landingCopy(locale).tape.label}>
      <div ref={slot} className={styles.slot} />
    </section>
  );
}
