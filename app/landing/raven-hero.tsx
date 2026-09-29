"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, ArrowRight } from "@phosphor-icons/react/dist/ssr";

import type { RavenHeroCopy } from "./raven-copy";

/**
 * Raven hero.
 *
 * The character is a cut-out render rather than WebGL. A 100 KB WebP with an
 * alpha channel reads as 3D and costs nothing at runtime, where a Three.js
 * scene would add several hundred kilobytes and a frame budget to the page —
 * the same reasoning ChainGPT Labs used for their scroll-driven character.
 *
 * The four cards are drawn in markup, not baked into the render. That is what
 * lets the scanner card cycle through instruments and the risk card light up
 * only when the sample it is showing genuinely warrants review. It is also why
 * the character can point at a card that did not exist when the render was made.
 *
 * Every moving part here answers to one `paused` flag. CSS animation-play-state
 * covers the keyframes; the card cycle is a JavaScript interval and would keep
 * running behind a "paused" label unless it reads the same state — which is the
 * exact defect the previous hero shipped with.
 */

/**
 * Instruments the scan card walks through. Samples, and labelled as such.
 *
 * Symbols are written the way the rest of the product writes them — TSLA, not
 * TSLAx. The venue quotes tokenized equities under the plain ticker, and an
 * invented suffix would be a second thing for a reader to mistrust.
 */
const SCAN_CYCLE = [
  { symbol: "TSLA", venue: "Robinhood Chain", readiness: "PASS", tone: "mint" },
  { symbol: "AAPL", venue: "Robinhood Chain", readiness: "REVIEW", tone: "amber" },
  { symbol: "GOOGL", venue: "Robinhood Chain", readiness: "PASS", tone: "mint" },
  { symbol: "AMD", venue: "Robinhood Chain", readiness: "REVIEW", tone: "amber" },
] as const;

/**
 * The orbit. These are instruments, not decoration — three coloured spheres
 * said nothing about what the product looks at, which is exactly the objection
 * they earned. Each chip carries a real symbol from the feed, and the swap
 * routes are marked because those are the only three where money moves.
 */
const ORBIT = [
  { symbol: "TSLA", kind: "equity", route: true },
  { symbol: "BTC", kind: "crypto", route: false },
  { symbol: "AAPL", kind: "equity", route: true },
  { symbol: "GLD", kind: "commodity", route: false },
  { symbol: "USDG", kind: "stable", route: true },
  { symbol: "ETH", kind: "crypto", route: false },
  { symbol: "AMD", kind: "equity", route: true },
  { symbol: "SPY", kind: "index", route: false },
] as const;

const CYCLE_MS = 3200;

export function RavenHero({
  copy,
  routeConfirmed,
  betaHref,
  onPrimary,
}: {
  /** Resolved on the server so the three-locale dictionary stays out of the bundle. */
  copy: RavenHeroCopy;
  routeConfirmed: boolean;
  betaHref: string;
  onPrimary: () => void;
}) {
  const [paused, setPaused] = useState(false);
  const [step, setStep] = useState(0);
  const stageRef = useRef<HTMLElement | null>(null);
  const [onScreen, setOnScreen] = useState(true);

  // Off-screen work is wasted work: a hero that keeps cycling after the reader
  // has scrolled past still costs a re-render every few seconds.
  useEffect(() => {
    const node = stageRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setOnScreen(entry.isIntersecting),
      { rootMargin: "120px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (paused || !onScreen) return;
    if (typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => setStep((s) => (s + 1) % SCAN_CYCLE.length), CYCLE_MS);
    return () => window.clearInterval(id);
  }, [paused, onScreen]);

  const scan = SCAN_CYCLE[step];

  return (
    <section
      className="rv-hero"
      id="top"
      ref={stageRef}
      data-paused={paused ? "true" : undefined}
    >
      <div className="rv-hero-glow" aria-hidden />

      <div className="rv-hero-inner">
        <div className="rv-hero-copy">
          <span className="rv-eyebrow mono">{copy.eyebrow}</span>

          <h1 className="rv-headline">
            <span>{copy.headline[0]}</span>
            <span>{copy.headline[1]}</span>
          </h1>

          <p className="rv-lead">{routeConfirmed ? copy.lead : copy.leadDegraded}</p>

          <div className="rv-cta-row">
            <a href={betaHref} className="rv-btn rv-btn-primary" onClick={onPrimary}>
              {copy.primary}
              <ArrowUpRight size={17} weight="bold" aria-hidden />
            </a>
            <a href="#loop" className="rv-btn rv-btn-ghost">
              {copy.secondary}
              <ArrowRight size={17} weight="bold" aria-hidden />
            </a>
          </div>

          {/* The legend is the point: these are the states the product is
              willing to show, including the ones that admit it has nothing. */}
          <div className="rv-states">
            <span className="rv-chip rv-chip-live">{copy.states.live}</span>
            <span className="rv-chip rv-chip-stale">{copy.states.stale}</span>
            <span className="rv-chip rv-chip-none">{copy.states.unavailable}</span>
            <span className="rv-states-note mono">{copy.statesNote}</span>
          </div>
        </div>

        <div className="rv-hero-figure">
          <Image
            src="/brand/ryn-hero.webp"
            alt=""
            width={651}
            height={1295}
            priority
            className="rv-raven"
            sizes="(max-width: 900px) 60vw, 40vw"
          />
          {/* Ticker orbit. The ring spins; each chip counter-spins by the same
              amount so the symbols stay upright and readable rather than
              tumbling with the ring. */}
          <div className="rv-orbit-plane" aria-hidden>
            <div className="rv-orbit-ring">
            {ORBIT.map((item, i) => (
              <span
                key={item.symbol}
                className="rv-orbit-slot"
                style={{ ["--i" as string]: i, ["--n" as string]: ORBIT.length }}
              >
                <span
                  className="rv-orbit-chip mono"
                  data-kind={item.kind}
                  data-route={item.route ? "true" : undefined}
                >
                  {item.symbol}
                </span>
              </span>
            ))}
            </div>
          </div>
        </div>
      </div>

      <div className="rv-cards">
        <article className="rv-card rv-card-scan">
          <header>
            <span className="rv-card-label mono">{copy.cards.scan.label}</span>
            <span className="rv-chip rv-chip-live">{copy.states.live}</span>
          </header>
          <p className="rv-card-title">{scan.symbol}</p>
          <p className="rv-card-meta mono">{scan.venue}</p>
          <div className="rv-spark" aria-hidden>
            <svg viewBox="0 0 120 34" preserveAspectRatio="none">
              <polyline
                points="0,26 15,22 30,25 45,14 60,18 75,9 90,13 105,6 120,10"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <footer>
            <span className="mono">{copy.cards.scan.readiness}</span>
            <span className={`rv-verdict rv-verdict-${scan.tone}`}>{scan.readiness}</span>
          </footer>
        </article>

        <article className="rv-card rv-card-risk">
          <header>
            <span className="rv-card-label mono">{copy.cards.risk.label}</span>
          </header>
          <p className="rv-card-body">{copy.cards.risk.title}</p>
          <footer className="rv-card-tags">
            <span className="mono">{copy.cards.risk.sources}</span>
            <span className="mono">{copy.cards.risk.readiness}</span>
          </footer>
        </article>

        <article className="rv-card rv-card-receipt">
          <header>
            <span className="rv-card-label mono">{copy.cards.receipt.label}</span>
          </header>
          <p className="rv-hash mono">0x1d88…4b0c</p>
          <footer className="rv-card-tags">
            <span className="mono">{copy.cards.receipt.mode}</span>
            <span className="mono">{copy.cards.receipt.signer}</span>
          </footer>
        </article>

        <article className="rv-card rv-card-guarantees">
          <header>
            <span className="rv-card-label mono">{copy.cards.guarantees.label}</span>
          </header>
          <ul className="rv-guarantees mono">
            {copy.cards.guarantees.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>
      </div>

      {/* One control, every moving layer. */}
      <button
        type="button"
        className="rv-pause"
        aria-pressed={paused}
        onClick={() => setPaused((v) => !v)}
      >
        {paused ? "▶" : "❚❚"}
      </button>

      <div className="rv-rail" aria-hidden>
        <div className="rv-rail-track">
          {[...copy.rail, ...copy.rail].map((item, i) => (
            <span key={`${item}-${i}`} className="mono">
              {item}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
