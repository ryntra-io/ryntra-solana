"use client";

import { useEffect, useId, useRef, useState } from "react";

import {
  AC_PHASES,
  AC_SCENARIOS,
  AC_ZONES,
  acAmountLabel,
  acDecide,
  type AcDecision,
  type AcScenario,
} from "./agent-control-scenarios";
import type { AgentControlPublicModel } from "@/lib/product/agent-control-view";
import styles from "./landing.module.css";

/*
 * One economic action, at two depths.
 *
 * The console owns the scenario, the amount, the counterparty and the depth, so
 * SIMPLE and PRO are two readings of the *same* action rather than two demos.
 * Switching depth cannot reset the scenario, because there is nothing to reset:
 * the state never lived in either panel.
 *
 * Every verdict comes from `acDecide`, a pure function with its own tests. The
 * page contains no rule of its own, which is what lets it claim to be showing a
 * deterministic policy engine.
 */

const DECISION_TONE: Readonly<Record<AcDecision, string>> = {
  ALLOW: styles.toneOk,
  REVIEW: styles.toneWarn,
  BLOCK: styles.toneBad,
};

/** Text, not colour. A status a screen reader cannot hear is not a status. */
const DECISION_MARK: Readonly<Record<AcDecision, string>> = {
  ALLOW: "✓",
  REVIEW: "!",
  BLOCK: "✕",
};

const PRO_TABS = ["Actions", "Policies", "Providers", "Evidence"] as const;
type ProTab = (typeof PRO_TABS)[number];

export function AgentControlConsole({
  model,
  full = false,
}: {
  readonly model: AgentControlPublicModel;
  readonly full?: boolean;
}) {
  const [scenarioId, setScenarioId] = useState(AC_SCENARIOS[0].id);
  const scenario = AC_SCENARIOS.find((item) => item.id === scenarioId) ?? AC_SCENARIOS[0];

  const [amount, setAmount] = useState(scenario.amount);
  const [counterpartyKnown, setCounterpartyKnown] = useState(true);
  const [pro, setPro] = useState(false);
  const [tab, setTab] = useState<ProTab>("Actions");
  const [why, setWhy] = useState(false);

  const panelId = useId();
  const simpleTabId = `${panelId}-simple`;
  const proTabId = `${panelId}-pro`;

  const outcome = acDecide(scenario, amount, counterpartyKnown);

  /* A scenario carries its own scale — cents for a paid read, hundreds for a
     tokenized security — so the amount follows the scenario rather than being
     carried across and landing somewhere meaningless. */
  function pickScenario(next: AcScenario) {
    setScenarioId(next.id);
    setAmount(next.amount);
    setWhy(false);
  }

  return (
    <div className={styles.acConsole}>
      <div className={styles.acControls}>
        <div className={styles.acChips} role="group" aria-label="Economic action">
          {AC_SCENARIOS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`${styles.acChip} ${item.id === scenario.id ? styles.acChipOn : ""}`}
              aria-pressed={item.id === scenario.id}
              onClick={() => pickScenario(item)}
            >
              {item.chip}
            </button>
          ))}
        </div>

        <div className={styles.acControlRow}>
          <AmountControl scenario={scenario} amount={amount} onChange={setAmount} />
          <button
            type="button"
            className={styles.acToggle}
            aria-pressed={!counterpartyKnown}
            onClick={() => setCounterpartyKnown((value) => !value)}
          >
            <span className={styles.acToggleLabel}>COUNTERPARTY</span>
            <span className={styles.acToggleValue}>{counterpartyKnown ? "Known" : "New"}</span>
          </button>
          <DepthTabs
            pro={pro}
            onChange={setPro}
            panelId={panelId}
            simpleTabId={simpleTabId}
            proTabId={proTabId}
          />
        </div>
      </div>

      <div
        id={panelId}
        role="tabpanel"
        aria-labelledby={pro ? proTabId : simpleTabId}
        tabIndex={0}
        className={styles.acPanel}
      >
        {pro ? (
          <ProPanel
            scenario={scenario}
            amount={amount}
            counterpartyKnown={counterpartyKnown}
            tab={tab}
            onTab={setTab}
            onPick={pickScenario}
            model={model}
            full={full}
          />
        ) : (
          <SimplePanel
            scenario={scenario}
            amount={amount}
            outcome={outcome}
            why={why}
            onWhy={() => setWhy((value) => !value)}
            whyId={`${panelId}-why`}
          />
        )}
      </div>

      <Lifecycle decision={outcome.decision} reached={outcome.reachedPhase} />
    </div>
  );
}

/**
 * SIMPLE | PRO as a real tablist.
 *
 * It was a `role="group"` of `aria-pressed` buttons, which announces two
 * unrelated toggles rather than one choice between two views. Arrow keys move
 * between the tabs because that is what a tablist promises.
 */
function DepthTabs({
  pro,
  onChange,
  panelId,
  simpleTabId,
  proTabId,
}: {
  readonly pro: boolean;
  readonly onChange: (pro: boolean) => void;
  readonly panelId: string;
  readonly simpleTabId: string;
  readonly proTabId: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next = !pro;
    onChange(next);
    const target = listRef.current?.querySelector<HTMLButtonElement>(
      `#${CSS.escape(next ? proTabId : simpleTabId)}`,
    );
    target?.focus();
  }

  return (
    <div
      ref={listRef}
      className={styles.segment}
      role="tablist"
      aria-label="Agent Control depth"
      onKeyDown={onKeyDown}
    >
      <button
        id={simpleTabId}
        type="button"
        role="tab"
        aria-selected={!pro}
        aria-controls={panelId}
        tabIndex={pro ? -1 : 0}
        className={`${styles.segmentBtn} ${pro ? "" : styles.segmentBtnOn}`}
        onClick={() => onChange(false)}
      >
        SIMPLE
      </button>
      <button
        id={proTabId}
        type="button"
        role="tab"
        aria-selected={pro}
        aria-controls={panelId}
        tabIndex={pro ? 0 : -1}
        className={`${styles.segmentBtn} ${pro ? styles.segmentBtnOn : ""}`}
        onClick={() => onChange(true)}
      >
        PRO
      </button>
    </div>
  );
}

function AmountControl({
  scenario,
  amount,
  onChange,
}: {
  readonly scenario: AcScenario;
  readonly amount: number;
  readonly onChange: (amount: number) => void;
}) {
  const step = scenario.step;
  const label = acAmountLabel(scenario, amount);
  return (
    <div className={styles.acAmount} role="group" aria-label="Amount">
      <span className={styles.acToggleLabel}>AMOUNT</span>
      <button
        type="button"
        className={styles.acStep}
        onClick={() => onChange(Math.max(step, Number((amount - step).toFixed(2))))}
        aria-label={`Decrease amount by ${acAmountLabel(scenario, step)}`}
      >
        −
      </button>
      <output className={styles.acAmountValue}>{label}</output>
      <button
        type="button"
        className={styles.acStep}
        onClick={() => onChange(Number((amount + step).toFixed(2)))}
        aria-label={`Increase amount by ${acAmountLabel(scenario, step)}`}
      >
        +
      </button>
    </div>
  );
}

function SimplePanel({
  scenario,
  amount,
  outcome,
  why,
  onWhy,
  whyId,
}: {
  readonly scenario: AcScenario;
  readonly amount: number;
  readonly outcome: ReturnType<typeof acDecide>;
  readonly why: boolean;
  readonly onWhy: () => void;
  readonly whyId: string;
}) {
  const facts: readonly (readonly [string, string])[] = [
    ["Agent", scenario.agent],
    ["Amount", `${acAmountLabel(scenario, amount)} ${scenario.asset}`],
    ["Counterparty", scenario.counterparty],
    ["Mandate", scenario.mandate],
    ["Remaining today", acAmountLabel(scenario, scenario.budgetRemaining)],
    ["Network", scenario.network],
  ];

  return (
    <div className={styles.acSimple}>
      <div className={styles.acAsk}>
        <p className={styles.eyebrow}>AUTHORIZATION REQUEST</p>
        <p className={styles.authAsk}>
          {scenario.agent} wants to {scenario.ask(acAmountLabel(scenario, amount))}
        </p>
        <dl className={styles.acFacts}>
          {facts.map(([term, value]) => (
            <div key={term} className={styles.acFactRow}>
              <dt className={styles.agentRowLabel}>{term}</dt>
              <dd className={styles.agentRowValue}>{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className={styles.acVerdict}>
        <div className={styles.acVerdictHead}>
          <span className={styles.microLabel}>RYNTRA DECISION</span>
          <span className={`${styles.acDecision} ${DECISION_TONE[outcome.decision]}`}>
            <span aria-hidden="true">{DECISION_MARK[outcome.decision]}</span>
            {outcome.decision}
          </span>
        </div>

        <p className={styles.acReason}>{outcome.reasons[0].text}</p>

        <button
          type="button"
          className={styles.acWhy}
          aria-expanded={why}
          aria-controls={whyId}
          onClick={onWhy}
        >
          {why ? "Hide the rules that decided" : "Why?"}
        </button>

        {why ? (
          <ul id={whyId} className={styles.acWhyList}>
            {outcome.reasons.map((reason) => (
              <li key={reason.code} className={styles.acWhyRow}>
                <code className={styles.acCode}>{reason.code}</code>
                <span>{reason.text}</span>
              </li>
            ))}
          </ul>
        ) : null}

        <dl className={styles.acNext}>
          <div className={styles.acFactRow}>
            <dt className={styles.agentRowLabel}>Human step</dt>
            <dd className={styles.agentRowValue}>{outcome.humanStep}</dd>
          </div>
          <div className={styles.acFactRow}>
            <dt className={styles.agentRowLabel}>Wallet</dt>
            <dd className={styles.agentRowValue}>
              An external wallet signs. Ryntra holds no key and moves no funds.
            </dd>
          </div>
          <div className={styles.acFactRow}>
            <dt className={styles.agentRowLabel}>Expected receipt</dt>
            <dd className={styles.agentRowValue}>{scenario.expectedReceipt}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

function ProPanel({
  scenario,
  amount,
  counterpartyKnown,
  tab,
  onTab,
  onPick,
  model,
  full,
}: {
  readonly scenario: AcScenario;
  readonly amount: number;
  readonly counterpartyKnown: boolean;
  readonly tab: ProTab;
  readonly onTab: (tab: ProTab) => void;
  readonly onPick: (scenario: AcScenario) => void;
  readonly model: AgentControlPublicModel;
  readonly full: boolean;
}) {
  const rows = AC_SCENARIOS.map((item) => ({
    scenario: item,
    outcome: acDecide(item, item.id === scenario.id ? amount : item.amount, counterpartyKnown),
  }));

  const pending = rows.filter((row) => row.outcome.decision === "REVIEW").length;
  const blocked = rows.filter((row) => row.outcome.decision === "BLOCK").length;

  /* Four, not six. A fifth number on a landing costs more attention than it
     returns, and the canon caps the row at four for exactly that reason. */
  const kpis: readonly (readonly [string, string, string])[] = [
    ["ACTIVE ACTIONS", String(rows.length), styles.toneNeutral],
    ["PENDING APPROVALS", String(pending), pending ? styles.toneWarn : styles.toneNeutral],
    ["BLOCKED", String(blocked), blocked ? styles.toneBad : styles.toneNeutral],
    ["UNRESOLVED RECEIPTS", "1", styles.toneUnknown],
  ];

  return (
    <div className={styles.acPro}>
      <div className={styles.kpiStrip}>
        {kpis.map(([label, value, tone]) => (
          <div key={label} className={styles.kpiCell}>
            <div className={styles.microLabelSm}>{label}</div>
            <div className={`${styles.kpiValue} ${tone}`}>{value}</div>
          </div>
        ))}
      </div>

      <div className={styles.acTabs} role="tablist" aria-label="Mission Control section">
        {PRO_TABS.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={tab === name}
            className={`${styles.tab} ${tab === name ? styles.tabOn : ""}`}
            onClick={() => onTab(name)}
          >
            {name}
          </button>
        ))}
      </div>

      {tab === "Actions" ? (
        <div className={styles.acSplit}>
          <div className={styles.ledger}>
            <div className={styles.ledgerHead}>
              <span>ACTION</span>
              <span>COUNTERPARTY</span>
              <span>AMOUNT</span>
              <span>GOVERNOR</span>
            </div>
            {rows.map((row) => (
              <button
                key={row.scenario.id}
                type="button"
                /* A row that shows a selection has to be able to make one.
                   Selecting here and selecting from the chips are the same
                   action, so the inspector, SIMPLE and the lifecycle all follow
                   from one click. */
                className={`${styles.ledgerRow} ${styles.acLedgerRow} ${
                  row.scenario.id === scenario.id ? styles.acLedgerRowOn : ""
                }`}
                aria-current={row.scenario.id === scenario.id ? "true" : undefined}
                onClick={() => onPick(row.scenario)}
              >
                <span className={styles.cellText}>{row.scenario.chip}</span>
                <span className={styles.cellMono}>{row.scenario.counterparty}</span>
                <span className={styles.cellAmount}>
                  {acAmountLabel(
                    row.scenario,
                    row.scenario.id === scenario.id ? amount : row.scenario.amount,
                  )}
                </span>
                <span className={`${styles.cellGovernor} ${DECISION_TONE[row.outcome.decision]}`}>
                  <span aria-hidden="true">{DECISION_MARK[row.outcome.decision]}</span>{" "}
                  {row.outcome.decision}
                </span>
              </button>
            ))}
          </div>

          <Inspector scenario={scenario} amount={amount} counterpartyKnown={counterpartyKnown} />
        </div>
      ) : null}

      {tab === "Policies" ? (
        <div className={styles.acList}>
          {AC_SCENARIOS.map((item) => (
            <div key={item.id} className={styles.acListRow}>
              <span className={styles.acListName}>{item.chip}</span>
              <span className={styles.cellMono}>{item.mandate}</span>
              <span className={styles.acListMeta}>
                per-action {acAmountLabel(item, item.perAction)} · allows {item.mandateAllows.join(", ")}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {tab === "Providers" ? (
        <div className={styles.acList}>
          {model.networks.map((network) => (
            <div key={network.name} className={styles.acListRow}>
              <span className={styles.acListName}>{network.name}</span>
              <span className={styles.acAxes}>
                <span className={styles.acAxis}>{network.environment}</span>
                <span className={styles.acAxis}>{network.enforcement}</span>
              </span>
              <span className={styles.acListMeta}>{network.note}</span>
            </div>
          ))}
        </div>
      ) : null}

      {tab === "Evidence" ? (
        <div className={styles.acList}>
          {(full ? model.cards : model.cards.slice(0, 4)).map((card) => (
            <div key={card.id} className={styles.acListRow}>
              <span className={styles.acListName}>{card.label}</span>
              <span className={styles.acAxes}>
                <span className={styles.acAxis}>{card.axes.verification}</span>
                <span className={styles.acAxis}>{card.axes.environment}</span>
                <span className={styles.acAxis}>{card.axes.enforcement}</span>
              </span>
              <span className={styles.acListMeta}>{card.limitation}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The selected action, opened all the way down.
 *
 * The order is the lifecycle's, not a convenient one: a reader who follows it
 * top to bottom has walked intent → evidence → policy → human → execution →
 * outcome, which is the product.
 */
function Inspector({
  scenario,
  amount,
  counterpartyKnown,
}: {
  readonly scenario: AcScenario;
  readonly amount: number;
  readonly counterpartyKnown: boolean;
}) {
  const outcome = acDecide(scenario, amount, counterpartyKnown);
  const money = acAmountLabel(scenario, amount);

  const rows: readonly (readonly [string, string])[] = [
    ["Original intent", `${scenario.agent}: ${scenario.ask(money)}`],
    ["Normalized action", `${scenario.actionClass} · ${scenario.asset} · ${scenario.network}`],
    ["Mandate and budget", `${scenario.mandate} · ${acAmountLabel(scenario, scenario.budgetRemaining)} left today`],
    ["Evidence freshness", scenario.referenceStale ? "Reference price stale" : "Sources within policy window"],
    ["Policy result", `${outcome.decision} · ${outcome.reasons.map((reason) => reason.code).join(", ")}`],
    ["Human decision", outcome.humanStep],
    ["Authorized bytes", outcome.decision === "BLOCK" ? "Nothing authorized" : "Bound to one exact action digest"],
    ["Wallet authorization", "External wallet or provider; Ryntra never signs"],
    ["Execution", outcome.reachedPhase >= 3 ? "External rail settles" : "Not reached"],
    ["Expected vs actual", outcome.reachedPhase >= 4 ? scenario.expectedReceipt : "Not reached"],
  ];

  return (
    <div className={styles.acInspector}>
      <div className={styles.paneHead}>
        <span className={styles.microLabel}>SELECTED ACTION</span>
        <span className={`${styles.microLabel} ${DECISION_TONE[outcome.decision]}`}>{outcome.decision}</span>
      </div>
      <dl className={styles.acInspectorList}>
        {rows.map(([term, value]) => (
          <div key={term} className={styles.acFactRow}>
            <dt className={styles.agentRowLabel}>{term}</dt>
            <dd className={styles.agentRowValue}>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * The five phases, each tagged with who is holding the action.
 *
 * Phases past the one the verdict reaches are drawn as not-reached rather than
 * dimmed decoration: a blocked action that still shows a lit `Execute` would be
 * telling the reader the opposite of what the engine just decided.
 *
 * The walk runs once per verdict and stops. A permanent loop would be motion
 * that means nothing, and it stops entirely under `prefers-reduced-motion`.
 */
function Lifecycle({ decision, reached }: { readonly decision: AcDecision; readonly reached: number }) {
  const [step, setStep] = useState(reached);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setStep(reached);
      return;
    }
    setStep(0);
    let current = 0;
    const timer = window.setInterval(() => {
      current += 1;
      setStep(current);
      if (current >= reached) window.clearInterval(timer);
    }, 220);
    return () => window.clearInterval(timer);
  }, [decision, reached]);

  return (
    <div className={styles.acLifecycle}>
      <div className={styles.flowHead}>
        <span className={styles.microLabel}>ONE ECONOMIC ACTION THROUGH THE SYSTEM</span>
        <span className={`${styles.microLabelSm} ${DECISION_TONE[decision]}`}>
          {decision === "ALLOW" ? "COMPLETES" : decision === "REVIEW" ? "STOPS AT AUTHORIZE" : "STOPS AT VERIFY"}
        </span>
      </div>

      <ol className={styles.acPhases}>
        {AC_PHASES.map((phase, index) => {
          const state = index > reached ? "off" : index <= step ? "on" : "idle";
          return (
            <li
              key={phase.key}
              className={`${styles.acPhase} ${state === "on" ? styles.acPhaseOn : ""} ${
                state === "off" ? styles.acPhaseOff : ""
              }`}
            >
              <span className={styles.acPhaseZone}>{AC_ZONES[phase.zone]}</span>
              <span className={styles.acPhaseName}>
                <span className={styles.flowNum}>{String(index + 1).padStart(2, "0")}</span>
                {phase.name}
              </span>
              <span className={styles.acPhaseDetail}>
                {index > reached ? "Not reached" : phase.detail}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
