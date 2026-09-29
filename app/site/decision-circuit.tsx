"use client";

import { useRef, useState } from "react";

import { StatePill } from "./parts";
import type { CircuitStage } from "./truth-view";

/*
 * The frozen chip vocabulary, applied where the label is rendered.
 *
 * "Testnet verified" is the label `STATE_LABEL` gives that state, and the Guard
 * API serves the same vocabulary, so it is not renamed at the source — that is
 * a contract. Brandbook v1.2 says the surface word is TESTNET, so a migrated
 * surface maps it here, at the last moment before it is drawn.
 *
 * It keys on the state, never on the rendered string. The string form of this
 * was `label.replace(/^Testnet verified\b/i, …)`, and the `\b` reached disk as
 * one 0x08 BACKSPACE byte, so the regex asked for a control character no label
 * contains and the chips kept printing the old word through two sessions of
 * looking for it elsewhere. Nothing objected: it parsed, it typechecked, and the
 * bundler printed the byte back as `\b`. Keyed on the state there is no string
 * to mis-escape and no silent pass-through — `scripts/source-hygiene.test.mjs`
 * guards the byte, and this guards the shape. `/docs` keys the same way.
 */
const frozenLabel = (stage: CircuitStage) =>
  stage.state === "testnet_verified" ? "Testnet" : stage.stateLabel;

/**
 * The Decision Circuit.
 *
 * Eight stages, selected one at a time, each answering the same five questions:
 * what enters, what is created, who is accountable, what Ryntra never does, and
 * how mature that stage actually is.
 *
 * The maturity is resolved from the capability registry on the server, which is
 * why this diagram is worth reading: the stages genuinely disagree — some are
 * live on a supported route, some are paper and some are not built. A circuit
 * drawn as eight identical lit nodes would be prettier and would be a lie.
 *
 * Interaction is click and keyboard, never hover — on a phone there is no
 * hover, and a diagram whose content only appears on pointer-over hides its
 * content from everyone using a touchscreen or a keyboard.
 */
export function DecisionCircuit({ stages }: { stages: readonly CircuitStage[] }) {
  const [activeId, setActiveId] = useState(stages[0]?.id ?? "");
  const tabsRef = useRef<(HTMLButtonElement | null)[]>([]);

  const activeIndex = Math.max(0, stages.findIndex((stage) => stage.id === activeId));
  const active = stages[activeIndex];

  function focusStage(next: number) {
    const bounded = (next + stages.length) % stages.length;
    setActiveId(stages[bounded].id);
    tabsRef.current[bounded]?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    switch (event.key) {
      case "ArrowDown":
      case "ArrowRight":
        event.preventDefault();
        focusStage(index + 1);
        break;
      case "ArrowUp":
      case "ArrowLeft":
        event.preventDefault();
        focusStage(index - 1);
        break;
      case "Home":
        event.preventDefault();
        focusStage(0);
        break;
      case "End":
        event.preventDefault();
        focusStage(stages.length - 1);
        break;
      default:
        break;
    }
  }

  if (!active) return null;

  return (
    <div className="rx-circuit">
      <div className="rx-stages" role="tablist" aria-orientation="vertical" aria-label="Decision Circuit stages">
        {stages.map((stage, index) => (
          <button
            key={stage.id}
            type="button"
            role="tab"
            id={`rx-stage-${stage.id}`}
            aria-selected={stage.id === active.id}
            aria-controls="rx-stage-panel"
            tabIndex={stage.id === active.id ? 0 : -1}
            ref={(node) => {
              tabsRef.current[index] = node;
            }}
            className="rx-stage"
            onClick={() => setActiveId(stage.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            <span className="rx-stage-n">{stage.index}</span>
            <span>{stage.name}</span>
            <StatePill label={frozenLabel(stage)} tone={stage.tone} />
          </button>
        ))}
      </div>

      <div
        className="rx-panel"
        role="tabpanel"
        id="rx-stage-panel"
        aria-labelledby={`rx-stage-${active.id}`}
        tabIndex={0}
      >
        <div className="rx-panel-top">
          <h3 className="rx-h3">
            {active.index} — {active.name}
          </h3>
          <StatePill label={frozenLabel(active)} tone={active.tone} />
        </div>

        <p className="rx-mono" style={{ color: "var(--fg-muted)" }}>
          {active.scope}
        </p>

        <dl className="rx-facts">
          <div className="rx-fact">
            <dt>Takes</dt>
            <dd>{active.takes}</dd>
          </div>
          <div className="rx-fact">
            <dt>Creates</dt>
            <dd>{active.makes}</dd>
          </div>
          <div className="rx-fact">
            <dt>Accountable</dt>
            <dd>{active.actor}</dd>
          </div>
          <div className="rx-fact rx-never">
            <dt>Never</dt>
            <dd>{active.never}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
