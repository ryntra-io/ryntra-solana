"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUpRight } from "@phosphor-icons/react";
import { HeroChart } from "./hero-chart";
import { TokenOrbit } from "./token-orbit";
import { HERO_PARALLAX } from "./motion";
import type { HomeCopy } from "./content";
import {
  SAMPLE_HERO_SERIES,
  changeTone,
  expireFeedStatus,
  formatChange,
  formatPrice,
  markRefreshing,
  observedAtFromHeaders,
  seriesChange,
  toHeroSeries,
  type HeroPoint,
  type RawSpotCandle,
} from "./live-market";

/** The token market drawn in the hero — one of the three supported swap routes. */
const HERO_MARKET = "TSLA";
const HERO_TIMEFRAME = "1h";
/** Sample size of the illustrated ticket, in USDG. */
const TICKET_PAY = 500;

/**
 * Deterministic anchors for the risk snapshot. The panel is labelled a sample;
 * motion only drifts around these numbers and stops under reduced motion.
 */
const SAMPLE = { fresh: 18, vsOracle: 0.84 } as const;

type SeriesState = { points: readonly HeroPoint[]; status: "sample" | "live" | "stale"; observedAt: number | null };

/**
 * Live spot candles for the hero market. Fail-closed: until real data arrives —
 * and forever, if the venue is unreachable — the chart keeps the deterministic
 * sample series and the card keeps the "sample" label instead of claiming live.
 */
function useHeroSeries(): SeriesState {
  const [state, setState] = useState<SeriesState>({
    points: SAMPLE_HERO_SERIES,
    status: "sample",
    observedAt: null,
  });

  useEffect(() => {
    let alive = true;
    let retry: number | undefined;
    let requestSequence = 0;

    const load = async (attempt = 0, sequence = requestSequence) => {
      if (attempt === 0) {
        sequence = ++requestSequence;
        window.clearTimeout(retry);
        setState((current) => ({ ...current, status: markRefreshing(current.status) }));
      }

      let settled = false;
      try {
        const response = await fetch(
          "/api/arcus?kind=spot-candles&market=" + HERO_MARKET + "&tf=" + HERO_TIMEFRAME,
          { signal: AbortSignal.timeout(9_000) },
        );
        if (response.ok) {
          const body = (await response.json()) as { candles?: RawSpotCandle[] };
          const points = toHeroSeries(body.candles);
          if (points.length >= 24) {
            const receivedAt = Date.now();
            const observedAt = observedAtFromHeaders(
              response.headers.get("age"),
              response.headers.get("date"),
              receivedAt,
            );
            const status = expireFeedStatus("live", observedAt, receivedAt);
            if (status === "live" || status === "stale") {
              settled = true;
              if (alive && sequence === requestSequence) {
                setState((current) => (
                  current.observedAt !== null && current.observedAt > observedAt
                    ? current
                    : { points, status, observedAt }
                ));
              }
            }
          }
        }
      } catch {
        // The labelled sample stays on screen; the page never invents a price.
      }

      if (settled || !alive || sequence !== requestSequence) return;
      if (attempt < 2) {
        retry = window.setTimeout(() => void load(attempt + 1, sequence), 4_000);
        return;
      }
      setState((current) => {
        if (current.status === "sample") return current;
        const status = expireFeedStatus("stale", current.observedAt, Date.now());
        return status === "unavailable"
          ? { points: SAMPLE_HERO_SERIES, status: "sample", observedAt: null }
          : { ...current, status: "stale" };
      });
    };

    const expire = () => {
      const now = Date.now();
      setState((current) => {
        const status = expireFeedStatus(current.status, current.observedAt, now);
        if (status === "unavailable") {
          return { points: SAMPLE_HERO_SERIES, status: "sample", observedAt: null };
        }
        if (status !== "live" && status !== "stale") return current;
        return status === current.status ? current : { ...current, status };
      });
    };

    const refreshVisible = () => {
      if (document.visibilityState !== "visible") return;
      expire();
      void load();
    };

    void load();
    const pollTimer = window.setInterval(() => void load(), 60_000);
    const expiryTimer = window.setInterval(expire, 15_000);
    window.addEventListener("focus", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);

    return () => {
      alive = false;
      requestSequence += 1;
      window.clearInterval(pollTimer);
      window.clearInterval(expiryTimer);
      window.clearTimeout(retry);
      window.removeEventListener("focus", refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, []);

  return state;
}

function RiskPanel({ copy }: { copy: HomeCopy["panel"] }) {
  return (
    <div className="lp2-panel">
      <div className="lp2-panel-head">
        <span className="lp2-panel-title">{copy.title}</span>
        <span className="lp2-chip">{copy.caution}</span>
      </div>
      <div className="lp2-asset-row">
        <span className="lp2-asset">
          <span lang="en" dir="ltr" translate="no">{copy.asset}</span> <span>· {copy.assetTag}</span>
        </span>
        <span className="lp2-sample mono">{copy.sample}</span>
      </div>
      <p className="lp2-panel-note">{copy.note}</p>
      <dl className="lp2-metrics">
        <div>
          <dt>{copy.marketK}</dt>
          <dd className="lp2-amber">{copy.marketV}</dd>
        </div>
        <div>
          <dt>{copy.liqK}</dt>
          <dd className="lp2-green">{copy.liqV}</dd>
        </div>
        <div>
          <dt>{copy.oracleK}</dt>
          <dd className="mono" translate="no">{SAMPLE.fresh}{copy.freshSuffix}</dd>
        </div>
        <div>
          <dt>{copy.vsK}</dt>
          <dd className="lp2-amber mono" translate="no">+{SAMPLE.vsOracle.toFixed(2)}%</dd>
        </div>
      </dl>
      <p className="lp2-panel-foot">{copy.lock}</p>
    </div>
  );
}

function SwapTicket({
  copy,
  stage,
  price,
  routeConfirmed,
}: {
  copy: HomeCopy["panel"];
  stage: HomeCopy["stage"];
  price: number;
  routeConfirmed: boolean;
}) {
  const receive = price > 0 ? (TICKET_PAY / price).toFixed(3) : "—";

  return (
    <div className="lp3-ticket">
      <div className="lp3-ticket-head">
        <span className="lp3-ticket-title">{stage.ticketTitle}</span>
        <span className="lp2-sample mono">{stage.illustration}</span>
      </div>
      <div className="lp3-ticket-leg">
        <span>{stage.pay}</span>
        <b className="mono" dir="ltr" translate="no">{TICKET_PAY.toFixed(2)} USDG</b>
      </div>
      <span className="lp3-ticket-arrow" aria-hidden>
        <ArrowDown size={13} weight="bold" />
      </span>
      <div className="lp3-ticket-leg">
        <span>{stage.get}</span>
        <b className="mono" dir="ltr" translate="no">≈ {receive} {copy.asset}</b>
      </div>
      {routeConfirmed ? (
        <Link href="/robinhood/workspace/swap" className="btn lp2-sign btn-sm">
          {copy.sign}
          <ArrowUpRight size={14} weight="bold" aria-hidden />
        </Link>
      ) : (
        <button type="button" className="btn lp2-sign lp2-sign-disabled btn-sm" disabled>
          {stage.routeUnavailable}
        </button>
      )}
      <p className="lp3-ticket-note">
        {routeConfirmed ? stage.ticketNote : stage.ticketNoteDegraded}
      </p>
    </div>
  );
}

/**
 * The living hero: a real market plane, the risk snapshot floating above it and
 * the swap ticket in front. Layers drift on their own timing and separate on
 * pointer movement to give the composition depth; all of it collapses to a
 * static stack under prefers-reduced-motion or a coarse pointer.
 */
export function HeroStage({ copy, routeConfirmed }: { copy: HomeCopy; routeConfirmed: boolean }) {
  const { points, status } = useHeroSeries();
  // Starts true so the first rendered frame is still: motion is opt-in once the
  // preference is known, never a flash the user has to sit through.
  const [reducedMotion, setReducedMotion] = useState(true);
  // One switch for the whole hero. The ring is decoration, but the drifting risk
  // panel and ticket carry information, so a visitor who wants motion to stop
  // should not have to find a separate control for each.
  const [heroPaused, setHeroPaused] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReducedMotion(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);
  const live = status === "live";
  const stageRef = useRef<HTMLDivElement>(null);
  const planeRef = useRef<HTMLDivElement>(null);
  const riskRef = useRef<HTMLDivElement>(null);
  const ticketRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    if (!window.matchMedia("(pointer: fine)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    // Pause must stop pointer parallax too. CSS `animation-play-state` only
    // reaches keyframes; this effect writes transforms directly, so pausing it
    // means detaching the listeners and clearing what was already written —
    // otherwise a paused stage still moves whenever the pointer does.
    if (heroPaused) {
      for (const ref of [planeRef, riskRef, ticketRef]) {
        if (ref.current) ref.current.style.transform = "";
      }
      return;
    }

    let frame = 0;
    let nx = 0;
    let ny = 0;

    const render = () => {
      frame = 0;
      if (planeRef.current) {
        planeRef.current.style.transform = `rotateY(${(nx * HERO_PARALLAX.planeYawDeg).toFixed(2)}deg) rotateX(${(-ny * HERO_PARALLAX.planePitchDeg).toFixed(2)}deg)`;
      }
      if (riskRef.current) {
        riskRef.current.style.transform = `translate3d(${(nx * -HERO_PARALLAX.riskX).toFixed(1)}px, ${(ny * -HERO_PARALLAX.riskY).toFixed(1)}px, 0)`;
      }
      if (ticketRef.current) {
        ticketRef.current.style.transform = `translate3d(${(nx * -HERO_PARALLAX.ticketX).toFixed(1)}px, ${(ny * -HERO_PARALLAX.ticketY).toFixed(1)}px, 0)`;
      }
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(render);
    };
    const onMove = (event: MouseEvent) => {
      const rect = stage.getBoundingClientRect();
      nx = (event.clientX - rect.left) / rect.width - 0.5;
      ny = (event.clientY - rect.top) / rect.height - 0.5;
      schedule();
    };
    const onLeave = () => {
      nx = 0;
      ny = 0;
      schedule();
    };

    stage.addEventListener("mousemove", onMove);
    stage.addEventListener("mouseleave", onLeave);
    return () => {
      stage.removeEventListener("mousemove", onMove);
      stage.removeEventListener("mouseleave", onLeave);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [heroPaused]);

  const last = points.length ? points[points.length - 1].value : 0;
  const change = seriesChange(points);
  const tone = changeTone(change);
  const changeText = formatChange(change);

  return (
    <div className="lp3-stage" ref={stageRef} data-paused={heroPaused ? "true" : undefined}>
      <span className="lp3-glow lp3-glow-a" aria-hidden />
      <span className="lp3-glow lp3-glow-b" aria-hidden />
      <TokenOrbit
        swapLabel={copy.orbitSwap}
        readLabel={copy.orbitRead}
        pauseLabel={copy.orbitPause}
        resumeLabel={copy.orbitResume}
        reduced={reducedMotion}
        paused={heroPaused}
        onTogglePaused={() => setHeroPaused((value) => !value)}
      />

      <div className="lp3-plane" ref={planeRef}>
        <div className="lp3-chart-card">
          {/* Provenance lives in the header: the floating cards overlap the
              card's lower half, so the live/sample marker can never sit there. */}
          <div className="lp3-chart-head">
            <div className="lp3-chart-id">
              <span className="lp3-chart-sym">
                <b lang="en" dir="ltr" translate="no">{copy.panel.asset}</b>
                {live ? (
                  <span className="lp3-live">{copy.stage.live}</span>
                ) : status === "stale" ? (
                  <span className="lp3-stale mono">{copy.stage.stale}</span>
                ) : (
                  <span className="lp2-sample mono lp3-static-tag">{copy.stage.sampleTag}</span>
                )}
              </span>
              <span className="lp3-source">
                {copy.stage.assetName} · {status === "sample" ? copy.stage.sourceSample : copy.stage.source}
              </span>
            </div>
            <div className="lp3-chart-price">
              <b className="mono" dir="ltr" translate="no">${formatPrice(last)}</b>
              {changeText ? (
                <span className={`lp3-chg lp3-chg-${tone}`} dir="ltr" translate="no">
                  {changeText} <i>{copy.stage.changeLabel}</i>
                </span>
              ) : null}
            </div>
          </div>

          <HeroChart points={points} />
        </div>
      </div>

      <div className="lp3-float lp3-float-risk">
        <div className="lp3-layer" ref={riskRef}>
          <RiskPanel copy={copy.panel} />
        </div>
      </div>

      <div className="lp3-float lp3-float-ticket">
        <div className="lp3-layer" ref={ticketRef}>
          <SwapTicket copy={copy.panel} stage={copy.stage} price={last} routeConfirmed={routeConfirmed} />
        </div>
      </div>
    </div>
  );
}
