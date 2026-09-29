"use client";

import { useId, useState } from "react";
import { ArrowUUpLeft } from "@phosphor-icons/react";

import type { RavenLoopCopy } from "./raven-copy";

/**
 * The decision loop — five stages of one decision, drawn as a circuit.
 *
 * The claim is not "there are five steps"; every product has steps. It is that
 * the last one feeds the first, and that a single decision keeps one evidence
 * trail from plan to review.
 *
 * Two honesty constraints shape the whole block:
 *
 *  - Each stage inherits its badge from the capability registry. Three stages
 *    work today and two do not, and the diagram shows exactly that. A page that
 *    drew a complete circuit would be claiming `complete-decision-loop`, which
 *    the registry marks `planned`.
 *  - The signing stage is the anchor rather than the finale. Everything before
 *    it produces evidence; it is the only stage that produces an action, and
 *    the only one Ryntra structurally cannot perform on someone's behalf.
 *
 * The stages are tabs because a reader wants one at a time and the detail is
 * long enough that five open at once becomes a wall. The rail stays visible
 * either way, so the shape of the loop never depends on which tab is selected.
 */

/** Registry maturities that mean the stage is reachable in the product today. */
const WORKING = new Set(["live", "beta"]);

export function RavenLoop({
  copy,
  maturityById,
  maturityLabels,
}: {
  /** Resolved on the server so the three-locale dictionary stays out of the bundle. */
  copy: RavenLoopCopy;
  /** capabilityId → registry maturity, resolved by the caller. */
  maturityById: Readonly<Record<string, string | undefined>>;
  /** maturity key → its localised public label. */
  maturityLabels: Readonly<Record<string, string>>;
}) {
  const baseId = useId();
  const [active, setActive] = useState(3); // the signing stage, by default

  const stages = copy.stages.map((stage) => {
    const maturity = maturityById[stage.capabilityId] ?? "unverified";
    return {
      ...stage,
      maturity,
      label2: maturityLabels[maturity] ?? maturityLabels.unverified ?? maturity,
      working: WORKING.has(maturity),
    };
  });

  const working = stages.filter((stage) => stage.working).length;
  const current = stages[active];

  return (
    <section className="rv-section rv-loop" id="loop">
      <div className="rv-section-inner">
        <header className="rv-section-head rv-reveal">
          <span className="rv-eyebrow mono">{copy.eyebrow}</span>
          <h2 className="rv-h2">{copy.title}</h2>
          <p className="rv-section-lead">{copy.lead}</p>
        </header>

        <div className="rv-cyc rv-reveal">
          {/* The rail. A travelling pulse gives the circuit a direction without
              asking anyone to read the numbers first. */}
          <div className="rv-cyc-rail" aria-hidden>
            <span className="rv-cyc-pulse" />
          </div>

          <div className="rv-cyc-stages" role="tablist" aria-label={copy.stagesLabel}>
            {stages.map((stage, index) => (
              <button
                key={stage.key}
                type="button"
                role="tab"
                id={`${baseId}-tab-${stage.key}`}
                aria-selected={index === active}
                aria-controls={`${baseId}-panel`}
                tabIndex={index === active ? 0 : -1}
                className="rv-cyc-stage"
                data-active={index === active ? "true" : undefined}
                data-anchor={stage.key === "sign" ? "true" : undefined}
                data-working={stage.working ? "true" : "false"}
                onClick={() => setActive(index)}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
                  event.preventDefault();
                  const next =
                    event.key === "ArrowRight"
                      ? (index + 1) % stages.length
                      : (index - 1 + stages.length) % stages.length;
                  setActive(next);
                  document.getElementById(`${baseId}-tab-${stages[next].key}`)?.focus();
                }}
              >
                <span className="rv-cyc-node" aria-hidden>
                  <span className="rv-cyc-dot" />
                </span>
                <span className="rv-cyc-n mono" aria-hidden>
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="rv-cyc-label">{stage.label}</span>
                <span className="rv-maturity mono" data-maturity={stage.maturity}>
                  {stage.label2}
                </span>
              </button>
            ))}
          </div>

          <div
            className="rv-cyc-panel"
            id={`${baseId}-panel`}
            role="tabpanel"
            aria-labelledby={`${baseId}-tab-${current.key}`}
            tabIndex={0}
            data-anchor={current.key === "sign" ? "true" : undefined}
          >
            <p className="rv-cyc-body">{current.body}</p>
            <p className="rv-cyc-output">
              <span className="mono">{copy.outputLabel}</span>
              {current.output}
            </p>
          </div>
        </div>

        {/* The anchor claim, stated once and away from the tabs so it does not
            read as a property of whichever stage happens to be selected. */}
        <div className="rv-cyc-anchor rv-reveal">
          <b>{copy.anchor.label}</b>
          <p>{copy.anchor.body}</p>
          {/* The counter carries its unit: "2/5" alone reads as progress, when
              what it actually reports is how many stages are live today. */}
          <p className="rv-cyc-count mono">
            <b translate="no">
              {working}/{stages.length}
            </b>{" "}
            {copy.countLabel}
          </p>
        </div>

        {/* The return arc — the part that makes a row of stages a circuit. */}
        <div className="rv-loop-close rv-reveal">
          <span className="rv-loop-close-label mono">
            <ArrowUUpLeft size={15} weight="bold" aria-hidden />
            {copy.closing.label}
          </span>
          <p>{copy.closing.body}</p>
        </div>
      </div>
    </section>
  );
}
