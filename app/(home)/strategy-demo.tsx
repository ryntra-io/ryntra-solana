"use client";

import { useReducer, useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import {
  ArrowClockwise, ArrowLeft, ArrowRight, CaretDown, CaretRight, ChartLineUp, Eye,
  Flag, Lightbulb, MagnifyingGlass, Scales, Shield, SlidersHorizontal, Warning,
} from "@phosphor-icons/react";
import type { PublicLocale } from "@/lib/site/locale";
import { HOMEPAGE_COPY } from "@/lib/site/homepage-copy";
import { DEMO_COPY, EXAMPLE } from "./strategy-demo-copy";
import {
  DECISION_STAGE, DEMO_STAGES, INITIAL_DEMO, MONITOR_STAGE, RESULTS_STAGE,
  canAdvance, demoTransition, isDemoWatching, needsReview, type DemoEvent, type DemoState,
} from "./strategy-demo-state";
import styles from "./landing.module.css";

const icons = [Lightbulb, MagnifyingGlass, Scales, Shield, SlidersHorizontal, Flag, Eye, ChartLineUp];

type Row = Readonly<{ label: string; value: string }>;

/**
 * One worked strategy, shown before it is explained.
 *
 * The card at the top carries the state — budget, entry limit, current
 * estimate, and what that combination means right now. The eight stages below
 * are how it got there, for a reader who wants it; nobody has to walk them to
 * see the point.
 *
 * All of it is local: no request, no wallet, no account, nothing recorded.
 */
export default function StrategyDemo({ locale }: { locale: PublicLocale }) {
  const [state, dispatch] = useReducer(demoTransition, INITIAL_DEMO);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const c = DEMO_COPY[locale];
  const h = HOMEPAGE_COPY[locale];
  const step = c.steps[state.stage];
  const review = needsReview(state);
  const watching = isDemoWatching(state);
  const estimate = state.priceChanged ? EXAMPLE.estimateOutside : EXAMPLE.estimateWithin;

  const select = (stage: number) => dispatch({ type: "select", stage });
  /* These actions replace the panel under the reader's hands, so focus moves to
     the destination stage's own heading button rather than falling to the body. */
  const transitionToStage = (event: DemoEvent, stage: number) => {
    dispatch(event);
    buttons.current[stage]?.focus();
  };
  const onKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = DEMO_STAGES - 1;
    const next = event.key === "ArrowRight" || event.key === "ArrowDown" ? (index + 1) % DEMO_STAGES
      : event.key === "ArrowLeft" || event.key === "ArrowUp" ? (index + last) % DEMO_STAGES
      : event.key === "Home" ? 0 : event.key === "End" ? last : null;
    if (next === null) return;
    event.preventDefault();
    select(next);
    buttons.current[next]?.focus();
  };

  const rows = (items: readonly Row[]) => (
    <dl className={styles.demoRows}>
      {items.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}
    </dl>
  );

  const planState = (s: DemoState): { text: string; tone: "ok" | "attention" | "neutral" } => {
    if (needsReview(s)) return { text: h.planOutside, tone: "attention" };
    if (s.choice === "reject") return { text: h.planRejected, tone: "neutral" };
    if (isDemoWatching(s)) return { text: h.planWatching, tone: "ok" };
    if (s.stage >= DECISION_STAGE) return { text: h.planUndecided, tone: "neutral" };
    return { text: h.planWithin, tone: "ok" };
  };

  const stageContent = (): ReactNode => {
    if (review) return <>
      <div className={styles.reviewMessage} role="status">
        <Warning size={30} aria-hidden />
        <p>{c.reviewBody}</p>
      </div>
      <div className={styles.decisionActions}>
        <button type="button" className={styles.primaryAction} onClick={() => transitionToStage({ type: "review" }, DECISION_STAGE)}>{c.review}</button>
        <button type="button" className={styles.plainButton} onClick={() => transitionToStage({ type: "choose", choice: "reject" }, RESULTS_STAGE)}>{c.reject}</button>
      </div>
    </>;

    switch (state.stage) {
      case 0: return <>
        <p className={styles.demoQuote}>{c.ideaQuote}</p>
        <p className={styles.demoBody}>{c.ideaBody}</p>
        {rows(c.ideaRows)}
      </>;
      case 1: return <><p className={styles.demoBody}>{c.researchBody}</p>{rows(c.researchRows)}</>;
      case 2: return <><p className={styles.demoQuote}>{c.criticQuote}</p><p className={styles.demoBody}>{c.criticBody}</p></>;
      case 3: return <>
        <p className={styles.demoBody}>{c.riskHeading}</p>
        <ul className={styles.riskRows}>
          {c.riskRows.map((row) => <li key={row.label}>
            <span className={styles.riskKey}>{row.label}</span>
            <span className={styles.riskValue} data-tone={row.tone}>{row.value}</span>
          </li>)}
        </ul>
      </>;
      case 4: return <>
        <p className={styles.demoBody}>{c.strategyBody}</p>
        {rows([
          { label: h.planMaxEntry, value: `${EXAMPLE.maxEntry} USDC / SOL` },
          { label: h.planInvalidation, value: `${EXAMPLE.invalidation} USDC / SOL` },
          { label: c.strategyBudget, value: `${state.budget} USDC` },
        ])}
        <div className={styles.budgetChoices} role="group" aria-label={c.strategyBudget}>
          {([15, 25] as const).map((budget) => <button type="button" key={budget}
            aria-pressed={state.budget === budget} className={styles.secondaryButton}
            onClick={() => dispatch({ type: "set_budget", budget })}>{budget} USDC</button>)}
        </div>
      </>;
      case DECISION_STAGE: return <>
        <p className={styles.demoBody}>{c.decisionBody}</p>
        <div className={styles.decisionActions}>
          <button type="button" className={styles.primaryAction} onClick={() => transitionToStage({ type: "choose", choice: "watch" }, MONITOR_STAGE)}>{c.watch}</button>
          <button type="button" className={styles.secondaryButton} onClick={() => transitionToStage({ type: "edit" }, 4)}>{c.edit}</button>
          <button type="button" className={styles.plainButton} onClick={() => transitionToStage({ type: "choose", choice: "reject" }, RESULTS_STAGE)}>{c.reject}</button>
        </div>
        <p className={styles.demoHint}>{c.decisionHint}</p>
      </>;
      case MONITOR_STAGE: return <>
        <p className={styles.demoBody}>{watching ? c.monitorWatching : c.monitorPending}</p>
        {rows(c.monitorRows(state.version, estimate, watching))}
      </>;
      /* Results reports the decision that was actually made. Watching is not a
         trade: there is no actual entry and no execution cost, because nothing
         was executed. The stage is reachable by direct click, so the
         no-decision case is a real state and says so. */
      default:
        if (state.choice === "reject") return <p className={styles.demoBody}>{c.resultRejected}</p>;
        if (state.choice !== "watch") return <>
          <p className={styles.demoBody}>{c.resultUndecided}</p>
          <div className={styles.decisionActions}>
            <button type="button" className={styles.secondaryButton} onClick={() => transitionToStage({ type: "select", stage: DECISION_STAGE }, DECISION_STAGE)}>{c.steps[DECISION_STAGE].title}</button>
          </div>
        </>;
        /* Watching splits again: a condition that broke is a result, a
           condition that held is simply not finished yet. */
        return <>
          <p className={styles.demoQuote}>{state.priceChanged ? c.resultStoppedTitle : c.resultWaitingTitle}</p>
          <p className={styles.demoBody}>{state.priceChanged ? c.resultStoppedBody : c.resultWaitingBody}</p>
          {rows(state.priceChanged ? c.resultStoppedRows(state.budget) : c.resultWaitingRows(state.budget))}
          {state.priceChanged ? <p className={styles.demoHint}>{c.resultHint}</p> : null}
        </>;
    }
  };

  const current = planState(state);

  return (
    <section id="strategy-workflow" className={styles.workflow} aria-labelledby="workflow-title">
      <span id="ryn-example" className={styles.anchorAlias} aria-hidden />
      <div className={styles.workflowHeading}>
        <div>
          <h2 id="workflow-title">{h.demoTitle}</h2>
          <p className={styles.sectionLead}>{h.demoLead}</p>
        </div>
        <p className={styles.demoStatus}>{h.demoCaption}</p>
      </div>

      {/* The state first. A reader who stops here still learns what the product
          does with a plan when the market moves away from it. */}
      <div className={styles.planCard}>
        <div className={styles.planCardHead}>
          <h3>{h.planTitle}</h3>
          <span>{c.version} {state.version}</span>
        </div>
        <dl className={styles.planCardRows}>
          <div><dt>{h.planAsset}</dt><dd>{h.planAssetValue}</dd></div>
          <div><dt>{h.planBudget}</dt><dd>{state.budget} USDC</dd></div>
          <div><dt>{h.planMaxEntry}</dt><dd>{EXAMPLE.maxEntry} USDC / SOL</dd></div>
          <div><dt>{h.planEstimate}</dt><dd data-estimate={estimate > EXAMPLE.maxEntry ? "over" : "under"}>{estimate} USDC / SOL</dd></div>
        </dl>
        <p className={styles.planCardState} data-tone={current.tone} role="status">{current.text}</p>
      </div>

      <div className={styles.deck} role="group" aria-label={c.choose}>
        <div className={styles.rail}>
          {c.steps.map((item, i) => {
            const active = state.stage === i;
            const Icon = icons[i];
            return <h3 key={item.title} className={styles.stage} data-active={active}
              style={{ "--stage-distance": Math.abs(i - state.stage), order: i * 2 } as CSSProperties}>
              <button id={"strategy-stage-" + i} ref={(el) => { buttons.current[i] = el; }} type="button"
                aria-expanded={active} aria-controls="strategy-panel"
                className={styles.stageButton} onClick={() => select(i)} onKeyDown={(e) => onKey(e, i)}>
                <span className={styles.stageNumber} aria-hidden>{String(i + 1).padStart(2, "0")}</span>
                <span className={styles.stageName}>{item.title}</span>
                <Icon size={22} className={styles.stageIcon} aria-hidden />
                <span className={styles.stageShort}>{item.short}</span>
                <span className={styles.mobileCaret} aria-hidden>{active ? <CaretDown size={18} /> : <CaretRight size={18} />}</span>
              </button>
            </h3>;
          })}
        </div>

        <div id="strategy-panel" role="region" aria-labelledby={"strategy-stage-" + state.stage}
          className={styles.demoPanel} data-review={review}
          style={{ order: state.stage * 2 + 1 } as CSSProperties}>
          <div className={styles.panelHead}>
            <strong>{review ? c.reviewTitle : step.title}</strong>
          </div>
          <div className={styles.panelMain}>{stageContent()}</div>
        </div>
      </div>

      <p className={styles.stageAnnouncement} role="status">{step.title} · {c.stageOf} {state.stage + 1} / {DEMO_STAGES}</p>

      <div className={styles.demoControls}>
        <div className={styles.sequentialControls}>
          <button type="button" className={styles.secondaryButton} disabled={state.stage === 0}
            onClick={() => transitionToStage({ type: "back" }, Math.max(0, state.stage - 1))}>
            <ArrowLeft size={18} aria-hidden />{c.back}
          </button>
          <button type="button" className={styles.secondaryButton} disabled={!canAdvance(state)}
            onClick={() => transitionToStage({ type: "next" }, Math.min(RESULTS_STAGE, state.stage + 1))}>
            {c.next}<ArrowRight size={18} aria-hidden />
          </button>
        </div>
        <div className={styles.extraControls}>
          <button type="button" className={styles.plainButton} onClick={() => transitionToStage({ type: "reset" }, 0)}>
            <ArrowClockwise size={20} aria-hidden />{c.reset}
          </button>
          <button type="button" className={styles.plainButton} onClick={() => transitionToStage({ type: "change_condition" }, MONITOR_STAGE)}>
            <SlidersHorizontal size={20} aria-hidden />{c.change}
          </button>
        </div>
      </div>
    </section>
  );
}
