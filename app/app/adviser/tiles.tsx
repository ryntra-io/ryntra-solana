import Link from "next/link";
import {
  Broadcast,
  ChatCircleText,
  Database,
  FileText,
  GitBranch,
  ListChecks,
  Question,
  ShieldWarning,
  Sigma,
  Signpost,
} from "@phosphor-icons/react/dist/ssr";

import { StateChip } from "@/app/app/portfolio/tiles";
import type { RynAnswer, RynQuestion, RynSection, RynStepKind } from "@/lib/home/workbench/answer";
import type { RynOperationState } from "@/lib/home/workbench/operations";
import type { WorkbenchProjection } from "@/lib/home/workbench/read-model";
import styles from "@/app/app/home-surface.module.css";

/**
 * The workbench's display layer.
 *
 * Every component reads a field off the compiled answer and renders it. No
 * arithmetic, no re-derivation, no second opinion about what a fact means —
 * `lib/home/workbench` decided all of that with tests on it.
 *
 * Three presentation rules carry the canon here:
 *
 *   **A section that is empty still renders**, with its reason. That is the
 *   whole point of a fixed structure, and a display layer that hides the empty
 *   ones would undo it in one line of JSX.
 *
 *   **Disagreeing readings sit side by side.** A reader comparing two numbers
 *   should not have to move their eyes across the page to do it.
 *
 *   **No verdict.** There is no word in this file that tells a reader what to
 *   do with a position, because Ryntra is not permitted to issue one and a
 *   display layer is exactly where that would leak in.
 */

type Tone = "good" | "caution" | "risk" | "unknown" | "quiet";

export const SectionIcons = {
  questions: <ChatCircleText size={17} weight="bold" aria-hidden />,
  answer: <FileText size={17} weight="bold" aria-hidden />,
  facts: <Database size={17} weight="bold" aria-hidden />,
  conflicts: <ShieldWarning size={17} weight="bold" aria-hidden />,
  scenarios: <GitBranch size={17} weight="bold" aria-hidden />,
  result: <Sigma size={17} weight="bold" aria-hidden />,
  step: <Signpost size={17} weight="bold" aria-hidden />,
  operations: <ListChecks size={17} weight="bold" aria-hidden />,
  versions: <Broadcast size={17} weight="bold" aria-hidden />,
} as const;

export function surfaceTone(state: WorkbenchProjection["state"]): Tone {
  if (state === "CALM") return "good";
  if (state === "ATTENTION" || state === "DEGRADED") return "caution";
  return "unknown";
}

/** Sliced rather than formatted: a locale render on the server and a different
 *  one in the browser is a hydration mismatch. */
function shortTime(value: string | null) {
  if (value === null || value.length < 16) return null;
  return value.slice(0, 16).replace("T", " ") + " UTC";
}

export function QuestionList({
  questions,
  selectedId,
  empty,
}: {
  questions: readonly RynQuestion[];
  selectedId: string | null;
  empty: string;
}) {
  if (questions.length === 0) return <p className={styles.empty}>{empty}</p>;
  return (
    <ul className={styles.questions}>
      {questions.map((question) => (
        <li key={question.questionId}>
          <Link
            className={styles.question}
            href={"/app/adviser?q=" + encodeURIComponent(question.questionId)}
            data-selected={question.questionId === selectedId ? "true" : "false"}
          >
            <span className={styles.questionBody}>
              <span className={styles.questionPrompt}>{question.prompt}</span>
              <span className={styles.questionMeta}>
                <b>{question.subjectLabel}</b>
              </span>
            </span>
            <StateChip tone="quiet" label={question.operation} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * Short names for the structure map, because the section titles are sentences.
 *
 * Found by looking: eight full titles wrapped to two lines and made the map
 * taller than the answer it introduces.
 */
const SECTION_SHORT: Readonly<Record<RynSection["id"], string>> = {
  PLAIN_ANSWER: "Answer",
  FACTS: "Facts",
  CONFLICTS_AND_UNKNOWNS: "Gaps",
  SCENARIOS: "Scenarios",
  RELEVANCE: "Touches",
  DETERMINISTIC_RESULT: "Result",
  NEXT_STEP: "Step",
  VERSIONS: "Versions",
};

/**
 * Which parts of the fixed structure this answer reached, at a glance.
 *
 * **Never tone-coded good.** Found by looking: a green tick sat on
 * `DISAGREEMENTS AND GAPS`, which is a pass mark on a problem — the Research
 * surface learned the mirror image of this when an empty Watchlist rendered a
 * tick beside a limitation. Present is neutral here; only absence is marked,
 * and its reason is one section below.
 */
export function Structure({ sections }: { sections: readonly RynSection[] }) {
  return (
    <ul className={styles.structure}>
      {sections.map((section) => (
        <li key={section.id} className={styles.structureItem}>
          <StateChip
            tone={section.state === "PRESENT" ? "quiet" : "unknown"}
            label={SECTION_SHORT[section.id]}
          />
        </li>
      ))}
    </ul>
  );
}

export function Facts({ answer }: { answer: RynAnswer }) {
  const section = answer.sections.find((entry) => entry.id === "FACTS");
  if (answer.facts.length === 0) {
    return <p className={styles.empty}>{section?.reason}</p>;
  }
  return (
    <ul className={styles.rows}>
      {answer.facts.map((fact) => (
        <li key={fact.key} className={`${styles.row} ${styles.stackedRow}`}>
          <span className={styles.rowBody}>
            <span className={styles.rowName}>{fact.statement}</span>
            <span className={styles.rowMeta}>
              <b>{fact.sourceLabel}</b>
              {shortTime(fact.observedAt) === null ? null : <time dateTime={fact.observedAt}>{shortTime(fact.observedAt)}</time>}
              <StateChip tone={fact.freshness === "CURRENT" ? "good" : "unknown"} label={fact.freshness} />
              <span>{fact.entitlement}</span>
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function Disagreements({ answer }: { answer: RynAnswer }) {
  const section = answer.sections.find((entry) => entry.id === "CONFLICTS_AND_UNKNOWNS");
  if (answer.conflicts.length === 0 && answer.unknowns.length === 0) {
    return <p className={styles.empty}>{section?.reason}</p>;
  }
  return (
    <ul className={styles.rows}>
      {answer.conflicts.map((conflict) => (
        <li key={conflict.conflictId} className={styles.conflict}>
          <span className={styles.rowName}>{conflict.subject}</span>
          <span className={styles.conflictRows}>
            {conflict.readings.map((reading) => (
              <span key={reading.sourceId + reading.value} className={styles.conflictRow}>
                <span className={styles.factKey}>{reading.label}</span>
                <span className={styles.conflictValue}>{reading.value}</span>
                {shortTime(reading.observedAt) === null ? null : (
                  <time className={styles.rowReason} dateTime={reading.observedAt}>{shortTime(reading.observedAt)}</time>
                )}
              </span>
            ))}
          </span>
          <span className={styles.rowReason}>{conflict.reason}</span>
        </li>
      ))}
      {answer.unknowns.map((unknown) => (
        <li key={unknown.unknownId} className={`${styles.row} ${styles.stackedRow}`}>
          <span className={styles.rowBody}>
            <span className={styles.rowName}>{unknown.missingFact}</span>
            <span className={styles.rowMeta}>
              <StateChip tone="unknown" label={unknown.blocking ? "Blocking" : "Noted"} />
            </span>
            <span className={styles.rowReason}>{unknown.why}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function Scenarios({ answer }: { answer: RynAnswer }) {
  const section = answer.sections.find((entry) => entry.id === "SCENARIOS");
  if (answer.scenarios.length === 0) {
    return <p className={styles.empty}>{section?.reason}</p>;
  }
  return (
    <ul className={styles.rows}>
      {answer.scenarios.map((scenario) => (
        <li key={scenario.scenarioId} className={`${styles.row} ${styles.stackedRow}`}>
          <span className={styles.rowBody}>
            <span className={styles.rowName}>{scenario.label}</span>
            <span className={styles.rowReason}>{scenario.assumption}</span>
            <span className={styles.rowReason}>{scenario.effect}</span>
            <span className={styles.rowMeta}>
              <StateChip tone="quiet" label={scenario.basis} />
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function Relevance({ answer }: { answer: RynAnswer }) {
  const { relevance } = answer;
  const entries = [...relevance.positions, ...relevance.plans];
  if (entries.length === 0) {
    return <p className={styles.empty}>{relevance.reason ?? "Nothing you hold and no plan you recorded touches this subject."}</p>;
  }
  return (
    <ul className={styles.rows}>
      {entries.map((entry) => (
        <li key={entry} className={styles.row}>
          <span className={styles.rowBody}>
            <span className={styles.rowName}>{entry}</span>
          </span>
          <StateChip tone={relevance.state === "RELEVANT" ? "good" : "unknown"} label={relevance.state} />
        </li>
      ))}
    </ul>
  );
}

export function Result({ answer }: { answer: RynAnswer }) {
  if (answer.result.state === "INSUFFICIENT") {
    return (
      <div className={`${styles.row} ${styles.stackedRow}`}>
        {/* A div, not a span: it holds a list, and a span may not. */}
        <div className={styles.rowBody}>
          <span className={styles.rowName}>
            <StateChip tone="unknown" label="Not enough data" />
          </span>
          <span className={styles.rowReason}>{answer.result.reason}</span>
          <ul className={styles.note}>
            {answer.result.missing.map((missing) => (
              <li key={missing.key}>{missing.label}</li>
            ))}
          </ul>
        </div>
      </div>
    );
  }
  return (
    <div className={`${styles.row} ${styles.stackedRow}`}>
      <span className={styles.rowBody}>
        <span className={styles.rowName}>{answer.result.statement}</span>
        <span className={styles.rowMeta}>
          <b>{answer.result.value}</b>
          <span>{answer.result.basis}</span>
          <span>formula {answer.result.formulaVersion}</span>
          <b>{answer.result.inputDigest}</b>
        </span>
      </span>
    </div>
  );
}

/**
 * What a next step asks of the reader, rather than its enum.
 *
 * Found by looking: the chip beside "Open the change on the Radar" read
 * `REVIEW_EVIDENCE` — the exact raw-enum defect the decision surfaces found in
 * the wave before this one.
 */
const STEP_LABEL: Readonly<Record<RynStepKind, string>> = {
  REVIEW_EVIDENCE: "Review the evidence",
  OPEN_SUBJECT: "Open the subject",
  COMPARE_SOURCES: "Compare the sources",
  RECORD_DECISION: "Record a decision",
  ADJUST_MONITORING: "Adjust monitoring",
  OPEN_STRATEGY: "Open the strategy",
};

export function NextStep({ answer }: { answer: RynAnswer }) {
  if (answer.nextStep.state === "NONE") {
    return <p className={styles.empty}>{answer.nextStep.reason}</p>;
  }
  return (
    <div className={styles.actions}>
      <Link className={styles.link} href={answer.nextStep.href}>
        {answer.nextStep.label}
      </Link>
      <StateChip tone="quiet" label={STEP_LABEL[answer.nextStep.kind]} />
      <StateChip tone="quiet" label="Yours to take" />
    </div>
  );
}

export function Operations({ operations }: { operations: readonly RynOperationState[] }) {
  return (
    <ul className={styles.rows}>
      {operations.map((operation) => (
        <li key={operation.operation} className={`${styles.row} ${styles.stackedRow}`}>
          <span className={styles.rowBody}>
            {/* No inline link here. It measured 19px tall, and the section
                already carries one full-size Strategy Lab destination — two
                targets for one place, one of which a thumb could not hit. */}
            <span className={styles.rowName}>{operation.label}</span>
            <span className={styles.rowMeta}>
              <StateChip tone={operation.modelCalled ? "quiet" : "good"} label={operation.modelCalled ? "Model" : "Deterministic"} />
              <StateChip tone="quiet" label={"Authority " + operation.aiAuthority} />
              {operation.href === null ? null : <StateChip tone="quiet" label="Served by the Strategy Lab" />}
            </span>
            <span className={styles.rowReason}>{operation.reason}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function Versions({ answer }: { answer: RynAnswer }) {
  return (
    <div className={styles.facts}>
      {answer.versions.sources.map((source) => (
        <div key={source.sourceId} className={styles.fact}>
          <span className={styles.factKey}>{source.label}</span>
          <span className={styles.factValue}>{source.version}</span>
        </div>
      ))}
      <div className={styles.fact}>
        <span className={styles.factKey}>Model</span>
        {/* Not the enum: `NOT_CALLED` is the value, "Not called" is the fact. */}
        <span className={styles.factValue}>
          {answer.versions.model.state === "NOT_CALLED" ? "Not called" : answer.versions.model.state}
        </span>
      </div>
      <div className={styles.fact}>
        <span className={styles.factKey}>Advice authority</span>
        <span className={styles.factValue}>{answer.versions.policy.adviceAuthority}</span>
      </div>
      <div className={styles.fact}>
        <span className={styles.factKey}>Risk formula</span>
        <span className={styles.factValue}>{answer.versions.policy.riskFormulaVersion}</span>
      </div>
      <div className={styles.fact}>
        <span className={styles.factKey}>Answer</span>
        <span className={styles.factValue}>{answer.answerId}</span>
      </div>
    </div>
  );
}

export function NoAnswer({ reason }: { reason: string }) {
  return (
    <p className={styles.empty}>
      <Question size={15} weight="bold" aria-hidden /> {reason}
    </p>
  );
}
