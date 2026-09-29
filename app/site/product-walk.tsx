"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight } from "@phosphor-icons/react";

import { StatePill } from "./parts";
import type { WalkStep } from "./truth-view";

import "./walk.css";

/**
 * The product walkthrough — Understand → Plan → Check risk → Authorize →
 * Review.
 *
 * This is what a visitor sees first, and it replaced an execution receipt in
 * that position. A receipt is the strongest thing Ryntra owns and the worst
 * possible opening: it answers a question the visitor has not asked yet. The
 * walkthrough answers the first one instead — what would I actually do here.
 *
 * Four constraints hold it honest.
 *
 *   1. **It does not autoplay.** A panel that keeps moving while it is being
 *      read is hostile, and a self-advancing product tour is a slideshow
 *      pretending to be an interface. It moves when a person moves it, by
 *      pointer or by keyboard.
 *   2. **Each step carries its own maturity**, resolved from the capability
 *      registry. The five states do not agree — three are live on a scoped
 *      route, two are paper — and that disagreement is the point. One green
 *      badge over five steps is how a paper feature gets sold as a shipped one.
 *   3. **Nothing here is invented.** The facts name fields and their state
 *      vocabulary; there is no price, balance, fill, hash, address or provider
 *      response on this surface, because a fabricated number is indistinguishable
 *      from a real one at a glance and canon §22.7 forbids exactly that.
 *   4. **The frame says what it is.** The complete loop is not shipped as a
 *      single workflow, so the label reads `Sample walkthrough` rather than
 *      implying a live session.
 *
 * Every card stays mounted in one grid cell, so the stage is as tall as its
 * tallest step and switching steps cannot shift the page under a reader's
 * thumb. Depth is transform and opacity only.
 */
export function ProductWalk({ steps }: { steps: readonly WalkStep[] }) {
  const [index, setIndex] = useState(0);
  const [enhanced, setEnhanced] = useState(false);
  const [input, setInput] = useState<"idle" | "keyboard" | "pointer">("idle");
  const tabsRef = useRef<(HTMLButtonElement | null)[]>([]);

  /* The server-rendered fallback is a linear five-card explanation. Only after
     hydration do the cards become one interactive stack. A blocked script
     therefore removes enhancement, never information. */
  useEffect(() => setEnhanced(true), []);

  if (!steps.length) return null;

  const active = steps[Math.min(index, steps.length - 1)];

  function focusStep(next: number) {
    const bounded = (next + steps.length) % steps.length;
    setInput("keyboard");
    setIndex(bounded);
    tabsRef.current[bounded]?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, position: number) {
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        event.preventDefault();
        focusStep(position + 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault();
        focusStep(position - 1);
        break;
      case "Home":
        event.preventDefault();
        focusStep(0);
        break;
      case "End":
        event.preventDefault();
        focusStep(steps.length - 1);
        break;
      default:
        break;
    }
  }

  /** Where a card sits in the stack relative to the one being read. */
  function position(at: number): "active" | "prev" | "next" | "far" {
    if (at === index) return "active";
    if (at === index - 1) return "prev";
    if (at === index + 1) return "next";
    return "far";
  }

  return (
    <figure
      className="rx-walk"
      data-rx-cursor="EXPLORE"
      data-enhanced={enhanced ? "true" : undefined}
      data-input={enhanced ? input : undefined}
    >
      <figcaption className="rx-walk-bar">
        <span className="rx-walk-dot" aria-hidden />
        <span className="rx-walk-title">How a decision goes through Ryntra</span>
        <span className="rx-walk-label">Sample walkthrough</span>
      </figcaption>

      <div className="rx-walk-steps" role="tablist" aria-label="Product walkthrough steps">
        {steps.map((step, at) => (
          <button
            key={step.id}
            type="button"
            role="tab"
            id={`rx-walk-tab-${step.id}`}
            aria-selected={at === index}
            aria-controls={`rx-walk-panel-${step.id}`}
            tabIndex={at === index ? 0 : -1}
            ref={(node) => {
              tabsRef.current[at] = node;
            }}
            className="rx-walk-step"
            onClick={(event) => {
              setInput(event.detail === 0 ? "keyboard" : "pointer");
              setIndex(at);
            }}
            onKeyDown={(event) => onKeyDown(event, at)}
          >
            <span className="rx-walk-step-n">{step.n}</span>
            <span className="rx-walk-step-name">{step.name}</span>
          </button>
        ))}
      </div>

      <div className="rx-walk-stage">
        {steps.map((step, at) => {
          const pos = position(at);
          const isActive = pos === "active";
          return (
            <article
              key={step.id}
              className="rx-walk-card"
              data-pos={pos}
              role="tabpanel"
              id={`rx-walk-panel-${step.id}`}
              aria-labelledby={`rx-walk-tab-${step.id}`}
              /* Only the step being read is exposed. The cards behind it carry
                 no focusable content, so hiding them from assistive technology
                 costs nothing and stops the same five steps being announced
                 five times over. */
              aria-hidden={enhanced && !isActive ? true : undefined}
            >
              <div className="rx-walk-card-top">
                {/* Level two, not three. This sits directly under the page's
                    `h1` and before the first `Section`, so an `h3` here skipped
                    a level for anyone navigating by headings. */}
                <h2 className="rx-walk-card-name">
                  <span aria-hidden>{step.n} — </span>
                  {step.name}
                </h2>
                <StatePill label={step.stateLabel} tone={step.tone} />
              </div>

              <p className="rx-walk-lead">{step.lead}</p>

              <ul className="rx-walk-facts">
                {step.facts.map((fact) => (
                  <li className="rx-walk-fact" key={fact.text} data-kind={fact.kind}>
                    <span className="rx-walk-kind">{fact.kind}</span>
                    <span>{fact.text}</span>
                  </li>
                ))}
              </ul>

              <p className="rx-walk-scope">
                <span>{step.scope}</span>
                {step.limitation}
              </p>
            </article>
          );
        })}
      </div>

      <div className="rx-walk-foot">
        <span className="rx-walk-count">
          Step {index + 1} of {steps.length}
        </span>
        <button
          type="button"
          className="rx-walk-next"
          onClick={(event) => {
            setInput(event.detail === 0 ? "keyboard" : "pointer");
            setIndex((current) => (current + 1) % steps.length);
          }}
        >
          {index === steps.length - 1 ? "Start again" : `Next: ${steps[index + 1].name}`}
          <ArrowRight size={13} weight="bold" aria-hidden />
        </button>
      </div>

      <p className="rx-walk-note">
        Field names and their states, not a live session. Nothing here is a price, a balance or a
        transaction. The full sequence is not shipped as one flow — each step above states how far it
        actually is. <span className="rx-walk-active-note">{active.name} is the step shown.</span>
      </p>
    </figure>
  );
}
