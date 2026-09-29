"use client";

import { useEffect, useState } from "react";
import type { HomeCopy } from "./content";
import {
  changeTone,
  countByCategory,
  expireFeedStatus,
  formatChange,
  formatPrice,
  markRefreshing,
  observedAtFromHeaders,
  selectStripMarkets,
  type RawMarket,
  type StripMarket,
} from "./live-market";

type StripState = {
  rows: readonly StripMarket[];
  status: "loading" | "live" | "stale" | "unavailable";
  observedAt: number | null;
};

/**
 * Venue market snapshots for the ticker. There is no offline stand-in:
 * a price is either observed from the venue or it is not shown.
 */
function useLiveMarkets(): StripState {
  const [state, setState] = useState<StripState>({
    rows: [],
    status: "loading",
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
        const response = await fetch("/api/arcus?kind=markets", {
          signal: AbortSignal.timeout(9_000),
        });
        if (response.ok) {
          const body = (await response.json()) as { markets?: RawMarket[] };
          const rows = selectStripMarkets(body.markets);
          if (rows.length >= 8) {
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
                    : { rows, status, observedAt }
                ));
              }
            }
          }
        }
      } catch {
        // Falls through to retry, then to a stale or unavailable state.
      }

      if (settled || !alive || sequence !== requestSequence) return;
      if (attempt < 2) {
        retry = window.setTimeout(() => void load(attempt + 1, sequence), 4_000);
        return;
      }
      setState((current) => {
        if (!current.rows.length) return { rows: [], status: "unavailable", observedAt: null };
        const status = expireFeedStatus("stale", current.observedAt, Date.now());
        return status === "unavailable"
          ? { rows: [], status: "unavailable", observedAt: null }
          : { ...current, status: "stale" };
      });
    };

    const expire = () => {
      const now = Date.now();
      setState((current) => {
        const status = expireFeedStatus(current.status, current.observedAt, now);
        if (status === "unavailable") {
          return { rows: [], status: "unavailable", observedAt: null };
        }
        return status === current.status ? current : { ...current, status: status as StripState["status"] };
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

function Ticker({ rows }: { rows: readonly StripMarket[] }) {
  return (
    <>
      {rows.map((row) => {
        const change = formatChange(row.change);
        return (
          <li className="lp3-tick" key={row.symbol}>
            <b lang="en" dir="ltr" translate="no">{row.symbol}</b>
            <span className="lp3-tick-price mono" dir="ltr" translate="no">{formatPrice(row.price)}</span>
            {change ? (
              <span className={`lp3-tick-chg mono lp3-chg-${changeTone(row.change)}`} dir="ltr" translate="no">
                {change}
              </span>
            ) : null}
          </li>
        );
      })}
    </>
  );
}

/**
 * A two-second market snapshot: every observed market scrolls slowly in mono.
 * Colour appears only on a real 24h move, and the
 * head states plainly that reading a market is not the same as trading it.
 */
export function MarketsStrip({ copy, routeConfirmed }: { copy: HomeCopy; routeConfirmed: boolean }) {
  const { rows, status } = useLiveMarkets();
  const [paused, setPaused] = useState(false);
  const counts = countByCategory(rows);
  const equities = counts.EQUITIES + counts.INDICES;
  const statusLabel = status === "loading"
    ? copy.stripTitleLoading
    : status === "stale"
      ? copy.stripStale
      : status === "unavailable"
        ? copy.stripUnavailable
        : null;
  const visibleTitle = rows.length
    ? status === "stale" ? copy.stripStale : copy.stripTitle
    : statusLabel;

  return (
    <section className="lp3-strip" aria-label={visibleTitle ?? copy.stripTitle}>
      <div className="container lp3-strip-head">
        <span className="lp-eyebrow lp3-strip-label">
          {rows.length ? (
            <>
              <b className="lp3-strip-count mono" translate="no">{rows.length}</b>
              {visibleTitle}
            </>
          ) : (
            statusLabel
          )}
        </span>
        {rows.length ? (
          <div className="lp3-strip-meta">
            <p className="lp3-strip-note">
              {copy.stripBreakdown
                .replace("{crypto}", String(counts.CRYPTO))
                .replace("{equities}", String(equities))
                .replace("{commodities}", String(counts.COMMODITIES))}
            </p>
            <button
              type="button"
              className="lp3-strip-toggle"
              aria-controls="ryntra-market-ticker"
              aria-pressed={paused}
              onClick={() => setPaused((current) => !current)}
            >
              {paused ? copy.stripResume : copy.stripPause}
            </button>
          </div>
        ) : null}
      </div>

      {rows.length ? (
        <>
          <div id="ryntra-market-ticker" className={`lp3-rail${paused ? " is-paused" : ""}`}>
            <ul className="lp3-track" role="list">
              <Ticker rows={rows} />
            </ul>
            <ul className="lp3-track" role="list" aria-hidden="true">
              <Ticker rows={rows} />
            </ul>
          </div>
          <p className="container lp3-strip-fine">{routeConfirmed ? copy.stripFine : copy.stripFineDegraded}</p>
        </>
      ) : (
        <p className="container lp3-strip-empty" aria-live="polite">{statusLabel}</p>
      )}
    </section>
  );
}
