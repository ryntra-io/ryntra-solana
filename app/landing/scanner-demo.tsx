"use client";

import { useEffect, useState } from "react";

import type { HomeCopy } from "./content";
import { SWEEP_INTERVAL_MS } from "./motion";

type Row = HomeCopy["scannerRows"][number];

/**
 * Scanner method demonstration (RYN-LAND-002).
 *
 * The scanner capability is not released, so this block must never behave like
 * a working tool. Three rules follow from that and are enforced here rather
 * than left to copy discipline:
 *
 *  1. Values are fixed props, never fetched. Nothing here can be mistaken for
 *     live market data, and the block cannot break when an upstream feed does.
 *  2. Rows are not interactive. A visitor cannot "run a scan" and land in
 *     emptiness — the sweep is presentation, and keyboard users are given the
 *     same static content rather than a control that leads nowhere.
 *  3. The verdict vocabulary stays ready / review / not-ready. It never reads
 *     "safe", because a readiness report is not a safety guarantee.
 */
export function ScannerDemo({ copy, reduced }: { copy: HomeCopy; reduced: boolean }) {
  const rows = copy.scannerRows;
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    // Reduced motion keeps the first row selected: the content stays complete,
    // only the sweep stops.
    if (reduced || paused || rows.length < 2) return;
    const timer = window.setInterval(() => {
      setActive((current) => (current + 1) % rows.length);
    }, SWEEP_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [reduced, paused, rows.length]);

  const current: Row = rows[Math.min(active, rows.length - 1)];

  return (
    <div className="lp4-scan">
      {/* The only focus stop this demonstration adds, and it is deliberate: a
          moving element needs a stop control. It sits outside the table, so the
          rows stay non-interactive and nothing leads into emptiness. Hidden
          under reduced motion, where there is no motion to pause. */}
      {reduced ? null : (
        <button
          type="button"
          className="lp4-scan-toggle"
          onClick={() => setPaused((value) => !value)}
          aria-pressed={paused}
        >
          {paused ? copy.scannerResume : copy.scannerPause}
        </button>
      )}
      <div className="lp4-scan-table" role="table" aria-label={copy.scannerBriefTitle}>
        <div className="lp4-scan-head" role="row">
          <span role="columnheader">{copy.scannerCols.asset}</span>
          <span role="columnheader">{copy.scannerCols.kind}</span>
          <span role="columnheader">{copy.scannerCols.verdict}</span>
        </div>
        {rows.map((row, index) => (
          <div
            className="lp4-scan-row"
            role="row"
            key={row.asset}
            data-active={index === active ? "true" : undefined}
            data-verdict={row.verdict}
          >
            <span role="cell" className="lp4-scan-asset">{row.asset}</span>
            <span role="cell" className="lp4-scan-kind">{row.kind}</span>
            <span role="cell" className="lp4-scan-verdict mono">{copy.scannerVerdicts[row.verdict]}</span>
          </div>
        ))}
      </div>

      {/* With motion, one brief follows the sweep. Without motion the sweep never
          advances, so a single brief would hide the metrics and reasoning for
          every other row — reduced motion must cost the animation, not the
          content. All briefs render instead. */}
      {reduced ? (
        <div className="lp4-brief-stack">
          {rows.map((row) => (
            <Brief key={row.asset} copy={copy} row={row} reduced />
          ))}
        </div>
      ) : (
        <Brief copy={copy} row={current} reduced={false} />
      )}
    </div>
  );
}

function Brief({ copy, row, reduced }: { copy: HomeCopy; row: Row; reduced: boolean }) {
  return (
    <aside className="lp4-brief" aria-live="off">
      <span className="lp4-brief-kicker">{copy.scannerBriefTitle}</span>
      <strong className="lp4-brief-asset">{row.asset}</strong>
      <Meter label={copy.scannerMetrics.liquidity} value={row.liquidity} reduced={reduced} />
      <Meter label={copy.scannerMetrics.concentration} value={row.concentration} reduced={reduced} inverted />
      <Meter label={copy.scannerMetrics.freshness} value={row.freshness} reduced={reduced} />
      <p className="lp4-brief-reason">{row.reason}</p>
      <span className="lp4-brief-verdict" data-verdict={row.verdict}>
        {copy.scannerVerdicts[row.verdict]}
      </span>
    </aside>
  );
}

/**
 * A single signal bar. `inverted` marks metrics where a high number is the
 * problem (concentration), so the fill never implies "more is better".
 */
function Meter({
  label,
  value,
  reduced,
  inverted = false,
}: {
  label: string;
  value: number;
  reduced: boolean;
  inverted?: boolean;
}) {
  const healthy = inverted ? value < 50 : value >= 60;
  return (
    <div className="lp4-meter">
      <span className="lp4-meter-label">
        {label}
        <b className="mono">{value}</b>
      </span>
      <span className="lp4-meter-track">
        <span
          className="lp4-meter-fill"
          data-healthy={healthy ? "true" : "false"}
          style={
            {
              // Transform-only: the bar is full width and scaled to its value, so
              // the animation never triggers layout.
              "--fill": Math.max(0.04, Math.min(1, value / 100)),
              transitionDuration: reduced ? "0ms" : undefined,
            } as React.CSSProperties
          }
        />
      </span>
    </div>
  );
}
