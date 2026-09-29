"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { ArrowCounterClockwise, Pause, Play } from "@phosphor-icons/react";

import { SCAN_STEP_MS } from "./motion";
import type { RavenScannerCopy } from "./raven-copy";

/**
 * Scanner — a demonstration of the method, built so it cannot be mistaken for
 * the tool.
 *
 * The capability is unreleased, so three things are true of this block by
 * construction: its badge comes from the capability registry rather than from
 * copy, nothing here fetches anything, and every value is a fixed sample that
 * the block labels as one. What it demonstrates is the part that actually
 * matters — the seven checks report *separately*, and the unknowns stay visible
 * instead of being averaged into a score.
 *
 * The sweep fills the checks one at a time because arriving all at once is
 * exactly the behaviour being argued against. Under reduced motion it fills
 * instantly with identical content: the demonstration is the separation of
 * evidence, not the animation of it.
 *
 * "Safe" appears nowhere in the verdict vocabulary, and no combination of
 * checks produces it. The strongest thing the scanner says is that everything
 * it checked returned — which is a statement about coverage, not about outcome.
 */

/** Sample instruments. The first three are supported routes; BTC is read-only. */
const ASSETS = ["TSLA", "AAPL", "AMD", "BTC"] as const;
type Asset = (typeof ASSETS)[number];

type CheckState = "ok" | "warn" | "none";
type Verdict = "ready" | "review" | "blocked";

/**
 * Fixed sample results, in the check order the copy declares.
 *
 * Values are technical tokens (counts, percentages, durations) and stay
 * untranslated; the localised half is the check label, the state word and the
 * brief. Keeping them here rather than in the dictionary means a translator
 * cannot accidentally change what the sample says.
 */
const SAMPLE: Record<Asset, ReadonlyArray<{ v: string; s: CheckState }>> = {
  TSLA: [
    { v: "3/3 matched", s: "ok" },
    { v: "Open", s: "ok" },
    { v: "Supports sample size", s: "ok" },
    { v: "0.18%", s: "ok" },
    { v: "12s", s: "ok" },
    { v: "USDG route", s: "ok" },
    { v: "None", s: "ok" },
  ],
  AAPL: [
    { v: "3/3 matched", s: "ok" },
    { v: "Open", s: "ok" },
    { v: "Thin for sample size", s: "warn" },
    { v: "0.62%", s: "warn" },
    { v: "24s", s: "ok" },
    { v: "USDG route", s: "ok" },
    { v: "1 unresolved", s: "warn" },
  ],
  AMD: [
    { v: "3/3 matched", s: "ok" },
    { v: "Closed", s: "warn" },
    { v: "Thin for sample size", s: "warn" },
    { v: "0.94%", s: "warn" },
    { v: "41s", s: "warn" },
    { v: "USDG route", s: "ok" },
    { v: "2 unresolved", s: "warn" },
  ],
  BTC: [
    { v: "2/2 matched", s: "ok" },
    { v: "24/7", s: "ok" },
    { v: "Supports sample size", s: "ok" },
    { v: "0.05%", s: "ok" },
    { v: "8s", s: "ok" },
    { v: "Read-only", s: "none" },
    { v: "1 unresolved", s: "warn" },
  ],
};

/**
 * The verdict is derived, not authored: any unknown or warning downgrades it.
 * A closed session with a stale oracle is the one combination that blocks,
 * because the quote is then priced against a reference that is not moving.
 */
function verdictOf(asset: Asset): Verdict {
  const rows = SAMPLE[asset];
  const [, session, , , oracle] = rows;
  if (session.s === "warn" && oracle.s === "warn") return "blocked";
  return rows.some((row) => row.s !== "ok") ? "review" : "ready";
}

export function RavenScanner({
  copy,
  maturityLabel,
  maturityKey,
}: {
  /** Resolved on the server so the three-locale dictionary stays out of the bundle. */
  copy: RavenScannerCopy;
  maturityLabel: string;
  maturityKey: string;
}) {
  const sectionRef = useRef<HTMLElement | null>(null);

  const [asset, setAsset] = useState<Asset>("TSLA");
  /** How many checks have reported. 0 = nothing run yet, 7 = complete. */
  const [step, setStep] = useState(0);
  const [running, setRunning] = useState(false);
  /**
   * `null` until the media query has been read.
   *
   * Defaulting to `true` looked safer and was wrong: the "fill instantly"
   * branch fired on the first client render and left the panel complete before
   * the real preference arrived, so a visitor who wanted motion got a scanner
   * that had already finished. Unknown is its own state, and nothing acts on it.
   */
  const [reduced, setReduced] = useState<boolean | null>(null);
  const [seen, setSeen] = useState(false);

  const total = copy.checks.length;
  const complete = step >= total;

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  // The sweep is worth running only while someone can see it.
  useEffect(() => {
    const node = sectionRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => setSeen(entry.isIntersecting), {
      rootMargin: "80px",
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Reduced motion gets the finished state rather than a stripped-down one:
  // stopping the animation must never cost the reader any content.
  useEffect(() => {
    if (reduced !== true) return;
    setStep(total);
    setRunning(false);
  }, [reduced, total, asset]);

  // First arrival starts the sweep once, so the block demonstrates itself
  // without demanding a click — but only when motion is welcome.
  useEffect(() => {
    if (!seen || reduced !== false) return;
    setRunning((wasRunning) => (step === 0 ? true : wasRunning));
  }, [seen, reduced, step]);

  // Visibility gates the *automatic* start only. Once someone has pressed Run
  // the sweep is theirs, and pausing it because they scrolled a little too far
  // would be the component overriding an explicit instruction.
  useEffect(() => {
    if (!running || complete) return;
    const id = window.setInterval(() => setStep((current) => current + 1), SCAN_STEP_MS);
    return () => window.clearInterval(id);
  }, [running, complete]);

  useEffect(() => {
    if (complete) setRunning(false);
  }, [complete]);

  function selectAsset(next: Asset) {
    setAsset(next);
    setStep(reduced === true ? total : 0);
    setRunning(reduced === false);
  }

  function toggleRun() {
    if (complete) {
      setStep(0);
      setRunning(true);
      return;
    }
    setRunning((was) => !was);
  }

  const verdict: Verdict | "idle" = complete ? verdictOf(asset) : "idle";
  const runLabel = complete ? copy.controls.rerun : running ? copy.controls.pause : step === 0 ? copy.controls.run : copy.controls.resume;

  return (
    <section className="rv-section rv-scanner" id="scanner" ref={sectionRef}>
      <div className="rv-section-inner">
        <header className="rv-section-head rv-reveal">
          <span className="rv-eyebrow mono">{copy.eyebrow}</span>
          <h2 className="rv-h2">
            {copy.title}
            <span className="rv-maturity mono" data-maturity={maturityKey}>
              {maturityLabel}
            </span>
          </h2>
          <p className="rv-section-lead">{copy.lead}</p>
        </header>

        <div className="rv-scanner-grid rv-reveal">
          <div className="rv-scanner-figure">
            <Image
              src="/brand/ryn-scanner.webp"
              alt=""
              width={672}
              height={1309}
              className="rv-raven-scanner"
              sizes="(max-width: 900px) 50vw, 30vw"
            />
          </div>

          {/* The instrument the pointing hand is aimed at. */}
          <div className="rv-scan" data-running={running ? "true" : undefined}>
            <div className="rv-scan-top">
              <span className="rv-sample mono">{copy.sampleTag}</span>
            </div>

            <div className="rv-scan-assets" role="group" aria-label={copy.eyebrow}>
              {ASSETS.map((option) => (
                <button
                  key={option}
                  type="button"
                  className="rv-scan-asset mono"
                  data-active={option === asset ? "true" : undefined}
                  aria-pressed={option === asset}
                  onClick={() => selectAsset(option)}
                  translate="no"
                >
                  {option}
                </button>
              ))}
            </div>

            <div className="rv-scan-head mono" aria-hidden>
              <span>{copy.columns.check}</span>
              <span>{copy.columns.result}</span>
              <span>{copy.columns.state}</span>
            </div>

            {/* The rows are output, not controls: they add no focus stops. */}
            <ol className="rv-scan-rows">
              {copy.checks.map((check, index) => {
                const reported = index < step;
                const result = SAMPLE[asset][index];
                return (
                  <li
                    key={check.key}
                    data-reported={reported ? "true" : undefined}
                    data-state={reported ? result.s : "idle"}
                  >
                    <span className="rv-scan-i mono" aria-hidden>
                      {index + 1}
                    </span>
                    <span className="rv-scan-label">{check.label}</span>
                    <span className="rv-scan-value mono">
                      {reported ? result.v : "—"}
                    </span>
                    <span className="rv-scan-state mono">
                      {reported ? copy.states[result.s] : copy.states.idle}
                    </span>
                  </li>
                );
              })}
            </ol>

            {/* Coverage, scaled rather than resized: animating width lays out
                every frame, and this bar moves seven times per run. */}
            <div className="rv-scan-meter">
              <span className="rv-scan-meter-label mono">{copy.coverage}</span>
              <span className="rv-scan-track" aria-hidden>
                {/* Scaled, not resized: animating width would lay out on every
                    one of the seven steps. The factor is written straight to
                    `transform` rather than through a custom property, because an
                    unregistered `var()` inside `transform` does not resolve —
                    the bar silently sat at scaleX(0) while the value was set. */}
                <span
                  className="rv-scan-fill"
                  style={{ transform: `scaleX(${step / total})` }}
                  data-verdict={verdict}
                />
              </span>
              <span className="rv-scan-count mono" translate="no">
                {step}/{total}
              </span>
            </div>

            <div className="rv-scan-controls">
              <button type="button" className="rv-scan-btn" onClick={toggleRun}>
                {complete ? (
                  <ArrowCounterClockwise size={13} weight="bold" aria-hidden />
                ) : running ? (
                  <Pause size={13} weight="fill" aria-hidden />
                ) : (
                  <Play size={13} weight="fill" aria-hidden />
                )}
                {runLabel}
              </button>
              <button
                type="button"
                className="rv-scan-btn rv-scan-btn-ghost"
                onClick={() => {
                  setStep(0);
                  setRunning(false);
                }}
                disabled={step === 0}
              >
                {copy.controls.reset}
              </button>
            </div>

            {/* The brief. Idle until the run finishes, because a verdict shown
                over partial evidence is the failure this block argues against. */}
            <div className="rv-scan-brief" data-verdict={verdict}>
              <div className="rv-scan-brief-head">
                <span className="mono">{copy.report.title}</span>
                <span className="rv-scan-verdict mono" data-verdict={verdict}>
                  {verdict === "idle" ? copy.verdicts.idle : copy.verdicts[verdict]}
                </span>
              </div>
              <p>{complete ? copy.report.briefs[asset] : copy.report.empty}</p>
            </div>

            <p className="rv-scan-legend">{copy.legend}</p>
          </div>
        </div>

        <ol className="rv-steps rv-reveal">
          {copy.steps.map((step, i) => (
            <li key={step.h}>
              <span className="rv-step-index mono">{String(i + 1).padStart(2, "0")}</span>
              <b>{step.h}</b>
              <span className="rv-step-body">{step.p}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
