import Link from "next/link";
import {
  ArrowRight,
  Broadcast,
  CheckCircle,
  ClockCounterClockwise,
  Database,
  FileText,
  Gavel,
  ListChecks,
  Question,
  Receipt,
  ShieldWarning,
  Signature,
  Timer,
  WarningCircle,
} from "@phosphor-icons/react/dist/ssr";

import { StateChip } from "@/app/app/portfolio/tiles";
import type { ActionStage } from "@/lib/agent-control/action-case";
import type { AdviceCase } from "@/lib/home/advice/advice-case";
import type { HomeActionCase } from "@/lib/home/advice/action-case";
import type { ActivityEvent, ActivityKind } from "@/lib/home/advice/activity";
import type { JournalCycle } from "@/lib/home/advice/journal";
import type { DecisionsProjection } from "@/lib/home/advice/read-model";
import type { ReceiptIndex } from "@/lib/home/advice/receipt";
import type { ActivitySource } from "@/lib/home/advice/activity";
import styles from "./decisions.module.css";

/**
 * The Decisions display layer.
 *
 * Every component reads a field off the projection and renders it. No
 * arithmetic, no re-derivation, no second opinion about what a case means —
 * `lib/home/advice` decided all of that with tests on it.
 *
 * The chrome is the Portfolio surface's, imported rather than copied, so the
 * tone vocabulary, the spacing and the info control stay one system.
 *
 * Three presentation rules carry the chain here:
 *
 *   **A missing link is shown with its reason.** Never a dash, never a blank.
 *
 *   **An unavailable alternative stays on the page.** Hiding what cannot be
 *   done makes the remaining list read as a menu of everything sensible.
 *
 *   **No verdict.** There is no word in this file that tells a reader to buy,
 *   sell, hold or reduce anything, because Ryntra is not permitted to issue
 *   one and a display layer is exactly where that would leak in.
 */

type Tone = "good" | "caution" | "risk" | "unknown" | "quiet";

export const SectionIcons = {
  queue: <ListChecks size={17} weight="bold" aria-hidden />,
  actions: <Signature size={17} weight="bold" aria-hidden />,
  receipts: <Receipt size={17} weight="bold" aria-hidden />,
  activity: <ClockCounterClockwise size={17} weight="bold" aria-hidden />,
  chain: <FileText size={17} weight="bold" aria-hidden />,
  alternatives: <Gavel size={17} weight="bold" aria-hidden />,
  sources: <Database size={17} weight="bold" aria-hidden />,
  evidence: <ShieldWarning size={17} weight="bold" aria-hidden />,
  radar: <Broadcast size={17} weight="bold" aria-hidden />,
  cycle: <Timer size={17} weight="bold" aria-hidden />,
} as const;

export function surfaceTone(state: DecisionsProjection["state"]): Tone {
  if (state === "CALM") return "good";
  if (state === "ATTENTION" || state === "DEGRADED") return "caution";
  return "unknown";
}

export function stageTone(stage: AdviceCase["stage"]): Tone {
  if (stage === "REVIEWED") return "good";
  if (stage === "OUTCOME" || stage === "ACTION" || stage === "DECISION") return "quiet";
  return "unknown";
}

/**
 * What the case is waiting on, rather than which link it last reached.
 *
 * Found by looking: the chip beside `TSLA-USD` read `EVIDENCE`, sitting next to
 * `2 sources disagree` and `1 unknown` — three chips that all looked like
 * findings, one of which was a stage name. A reader scanning a queue needs the
 * open question, and the stage is only a way of answering it.
 */
export function stageLabel(advice: AdviceCase): string {
  if (advice.stage === "REVIEWED") return "Complete";
  if (advice.stage === "OUTCOME") return "Awaiting review";
  if (advice.stage === "ACTION") return "Awaiting outcome";
  if (advice.stage === "DECISION") {
    return advice.disposition.state === "NO_ACTION" ? "Decided: no action" : "Decided";
  }
  if (advice.stage === "EVIDENCE") return "Awaiting decision";
  return "Awaiting evidence";
}

/**
 * A book is a book, never a warning.
 *
 * Found by looking: `LIVE` rendered with an amber warning triangle in three
 * places, so a real fill read as a problem and a paper one read as fine. The
 * label already separates them; the tone was adding a judgement nobody made.
 */
const bookTone: Tone = "quiet";

function shortTime(value: string | null) {
  if (value === null) return null;
  /* Sliced, not reformatted: a locale format on a server render and a different
     one in the browser is a hydration mismatch, and this surface has enough
     real states without an invented one. */
  return value.slice(0, 16).replace("T", " ");
}

/** One queued case: what it is about, what it is waiting on, where to open it. */
export function CaseRow({ advice }: { advice: AdviceCase }) {
  const at = shortTime(advice.trigger.observedAt);
  return (
    <li className={styles.case}>
      <div className={styles.caseBody}>
        <p className={styles.caseTitle}>
          {advice.trigger.subjectLabel}
          <StateChip tone={stageTone(advice.stage)} label={stageLabel(advice)} />
          {advice.evidence.conflicts.length === 0 ? null : (
            <StateChip tone="caution" label={`${advice.evidence.conflicts.length} sources disagree`} />
          )}
          {advice.evidence.unknowns.length === 0 ? null : (
            <StateChip tone="unknown" label={`${advice.evidence.unknowns.length} unknown`} />
          )}
        </p>
        <p className={styles.caseMeta}>
          <span>{advice.trigger.detail}</span>
          {at === null ? null : <time dateTime={advice.trigger.observedAt ?? undefined}>{at}</time>}
        </p>
        <p className={styles.question}>{advice.openQuestion}</p>
      </div>
      <Link className={styles.link} href={`/app/action-cases/${advice.caseId}`}>
        Open <ArrowRight size={13} weight="bold" aria-hidden />
      </Link>
    </li>
  );
}

export function CaseList({ cases, empty }: { cases: readonly AdviceCase[]; empty: string }) {
  if (cases.length === 0) {
    return (
      <p className={styles.empty} data-tone="CALM">
        <CheckCircle size={15} weight="fill" aria-hidden />
        {empty}
      </p>
    );
  }
  return (
    <ul className={styles.cases}>
      {cases.map((advice) => <CaseRow key={advice.caseId} advice={advice} />)}
    </ul>
  );
}

/** One exact action: the book it belongs to, where it stands, and its next step. */
export function ActionList({ actions }: { actions: readonly HomeActionCase[] }) {
  if (actions.length === 0) {
    return (
      <p className={styles.empty}>
        <Question size={15} weight="bold" aria-hidden />
        No exact action is readable for this account. A paper trade or a venue fill becomes one here; nothing is invented in the meantime.
      </p>
    );
  }
  return (
    <ul className={styles.cases}>
      {actions.map((action) => (
        <li key={action.actionRef} className={styles.case}>
          <div className={styles.caseBody}>
            <p className={styles.caseTitle}>
              {action.subjectLabel}
              <StateChip tone={bookTone} label={action.book} />
              <StateChip tone={action.closed ? "good" : "unknown"} label={action.closed ? "Closed" : "Open"} />
            </p>
            <p className={styles.caseMeta}>
              <span>{action.side}</span>
              {action.size === null ? null : <b>{action.size}</b>}
              {action.entryPrice === null ? null : <b>@ {action.entryPrice}</b>}
              <span>{action.venue}</span>
            </p>
            <p className={styles.question}>{action.nextStep}</p>
          </div>
          <Link className={styles.link} href={`/app/action-cases/${action.caseId}`}>
            Open <ArrowRight size={13} weight="bold" aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * The audited chain, drawn as a chain.
 *
 * Eight links in their fixed order. A link is either the fact it carries or the
 * exact reason it is missing, and the second is the point: a chain that stops
 * at the decision, with the sentence saying why, is the honest picture of this
 * release.
 */
export function AdviceChain({ advice, action }: { advice: AdviceCase; action: HomeActionCase | null }) {
  const context = advice.investorContext;
  const links: {
    key: string;
    name: string;
    state: "RECORDED" | "MISSING";
    value: string | null;
    reason: string | null;
  }[] = [
    {
      key: "context",
      name: "Investor context",
      state: context.state === "BOUND" ? "RECORDED" : "MISSING",
      value: context.state === "BOUND" ? `Version ${context.version}` : null,
      reason: context.reason,
    },
    {
      key: "trigger",
      name: "Trigger",
      state: "RECORDED",
      value: advice.trigger.detail,
      reason:
        advice.trigger.ruleId === null
          ? "Started by you rather than by a rule."
          : `Raised by monitor rule ${advice.trigger.ruleId}.`,
    },
    {
      key: "evidence",
      name: "Evidence",
      state: advice.evidence.completeness === "NONE" ? "MISSING" : "RECORDED",
      value:
        advice.evidence.completeness === "NONE"
          ? null
          : `${advice.evidence.items.length} source${advice.evidence.items.length === 1 ? "" : "s"} · ${advice.evidence.completeness}`,
      reason:
        advice.evidence.completeness === "NONE"
          ? "No source answered for this subject on this read."
          : `Bundle ${advice.evidence.bundleId}.`,
    },
    {
      key: "risk",
      name: "Risk calculation",
      state: advice.risk.state === "ATTACHED" ? "RECORDED" : "MISSING",
      value:
        advice.risk.state === "ATTACHED"
          ? `${advice.risk.schemaVersion} / ${advice.risk.formulaVersion}`
          : null,
      reason: advice.risk.state === "ATTACHED" ? advice.risk.inputDigest : advice.risk.reason,
    },
    {
      key: "disposition",
      name: "Human decision",
      state: advice.disposition.state === "PENDING" ? "MISSING" : "RECORDED",
      value:
        advice.disposition.state === "PENDING"
          ? null
          : `${advice.disposition.state} · ${shortTime(advice.disposition.recordedAt)}`,
      reason:
        advice.disposition.state === "PENDING"
          ? advice.disposition.reason
          : `Recorded by ${advice.disposition.source}.`,
    },
    {
      key: "action",
      name: "Exact action",
      state: advice.action === null ? "MISSING" : "RECORDED",
      value: advice.action === null ? null : `${advice.action.kind} · ${advice.action.actionRef}`,
      reason:
        advice.action === null
          ? "No exact action is linked to this case."
          : action === null
            ? null
            /* Named as a stage, not as a state of the position. Rendered from the
               id this line read `Currently at risk.` — a sentence about money
               where a sentence about a lifecycle stage was meant, and exactly
               the accidental claim this repository fails builds over. */
            : `Currently at the ${action.stages.find((stage) => stage.id === action.currentStageId)?.label ?? action.currentStageId} stage.`,
    },
    {
      key: "outcome",
      name: "Observed outcome",
      state: advice.outcome === null ? "MISSING" : "RECORDED",
      value: advice.outcome === null ? null : advice.outcome.effects[0] ?? "Closed.",
      reason:
        advice.outcome === null
          ? "Nothing has been observed, so no receipt exists. A receipt before an authoritative observation would be a claim about something that has not happened."
          : `Observed by ${advice.outcome.observedBy}.`,
    },
    {
      key: "review",
      name: "Journal review",
      state: advice.review.state === "RECORDED" ? "RECORDED" : "MISSING",
      value:
        advice.review.state === "RECORDED"
          ? [
              advice.review.followedPlan === null ? null : advice.review.followedPlan ? "Followed the plan" : "Broke the plan",
              advice.review.mistakeTag,
              advice.review.lesson,
            ]
              .filter((part): part is string => part !== null && part !== "")
              .join(" · ")
          : null,
      reason: advice.review.state === "RECORDED" ? null : advice.review.reason,
    },
  ];

  return (
    <ol className={styles.chain}>
      {links.map((link) => (
        <li key={link.key} className={styles.chainLink} data-state={link.state}>
          <span className={styles.chainMark}>
            {link.state === "RECORDED"
              ? <CheckCircle size={13} weight="fill" aria-hidden />
              : <Question size={13} weight="bold" aria-hidden />}
          </span>
          <span className={styles.chainBody}>
            <span className={styles.chainName}>{link.name}</span>
            {link.value === null
              ? <span className={styles.chainMissing}>Not recorded</span>
              : <span className={styles.chainValue}>{link.value}</span>}
            {link.reason === null ? null : <span className={styles.chainReason}>{link.reason}</span>}
          </span>
          <StateChip tone={link.state === "RECORDED" ? "good" : "unknown"} label={link.state} />
        </li>
      ))}
    </ol>
  );
}

/** The alternatives, unavailable ones included, each with its own reason. */
export function Alternatives({ advice }: { advice: AdviceCase }) {
  return (
    <ul className={styles.alternatives}>
      {advice.alternatives.map((alternative) => (
        <li key={alternative.kind} className={styles.alternative} data-available={String(alternative.available)}>
          <span className={styles.alternativeName}>
            {alternative.label}
            <StateChip tone={alternative.available ? "quiet" : "unknown"} label={alternative.available ? "Open" : "Unavailable"} />
          </span>
          <span className={styles.alternativeWhy}>
            {alternative.available ? alternative.rationale : alternative.unavailableReason}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The eight Agent Control stages of one exact action. */
export function ActionStages({ stages }: { stages: readonly ActionStage[] }) {
  return (
    <ol className={styles.chain}>
      {stages.map((stage) => (
        <li key={stage.id} className={styles.chainLink} data-state={stage.state}>
          <span className={styles.chainMark}>
            {stage.state === "done"
              ? <CheckCircle size={13} weight="fill" aria-hidden />
              : stage.state === "attention"
                ? <WarningCircle size={13} weight="fill" aria-hidden />
                : <Question size={13} weight="bold" aria-hidden />}
          </span>
          <span className={styles.chainBody}>
            <span className={styles.chainName}>
              {stage.label}
              <StateChip tone="quiet" label={stage.party} />
            </span>
            <span className={styles.chainValue}>{stage.summary}</span>
            {stage.limitation === null ? null : <span className={styles.chainReason}>{stage.limitation}</span>}
          </span>
          <StateChip
            tone={stage.state === "done" ? "good" : stage.state === "attention" ? "caution" : "unknown"}
            label={stage.state}
          />
        </li>
      ))}
    </ol>
  );
}

/** The receipt index: one block per book, with no combined figure. */
export function Receipts({ index }: { index: ReceiptIndex }) {
  if (index.books.length === 0) {
    return (
      <>
        <p className={styles.empty}>
          <Question size={15} weight="bold" aria-hidden />
          No receipt exists. A receipt is created by an authoritative observed outcome and by nothing else.
        </p>
        {index.refusals.length === 0 ? null : (
          <ul className={styles.rows}>
            {index.refusals.slice(0, 6).map((refusal) => (
              /* Stacked, not two columns. As a row the reason landed in the
                 `auto` track and sat pinned against the far edge with the
                 subject a screen-width away from it. */
              <li key={refusal.caseId} className={styles.stackedRow}>
                <span className={styles.rowName}>{refusal.subjectLabel}</span>
                <span className={styles.chainReason}>{refusal.reason}</span>
              </li>
            ))}
          </ul>
        )}
      </>
    );
  }
  return (
    <div className={styles.books}>
      {index.books.map((book) => (
        <section key={book.book} className={styles.book}>
          <div className={styles.bookHead}>
            <span className={styles.bookName}>
              {book.label}
              <StateChip tone={bookTone} label={`${book.count}`} />
            </span>
          </div>
          <p className={styles.chainReason}>{book.authority}</p>
          <ul className={styles.rows}>
            {book.receipts.slice(0, 8).map((receipt) => (
              <li key={receipt.receiptId} className={styles.row}>
                <span className={styles.rowName}>
                  {receipt.subjectLabel}
                  <StateChip tone="quiet" label={receipt.kind === "PAPER_SIMULATED_OUTCOME" ? "Simulated" : "Venue fill"} />
                </span>
                <span className={styles.literal}>{receipt.integrity}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

const EVENT_LABEL: Readonly<Record<ActivityKind, string>> = {
  RESEARCH_CHANGE_DETECTED: "Change detected",
  ADVICE_CASE_RAISED: "Case raised",
  DECISION_RECORDED: "Decision recorded",
  ACTION_EXECUTED: "Action executed",
  OUTCOME_OBSERVED: "Outcome observed",
  RECEIPT_ISSUED: "Receipt issued",
  JOURNAL_REVIEW_RECORDED: "Review recorded",
  SOURCE_DEGRADED: "Source degraded",
};

/** The global typed event index, newest first. */
export function Activity({ events, limit = 12 }: { events: readonly ActivityEvent[]; limit?: number }) {
  if (events.length === 0) {
    return (
      <p className={styles.empty} data-tone="CALM">
        <CheckCircle size={15} weight="fill" aria-hidden />
        Nothing has happened on this account that this index can see.
      </p>
    );
  }
  return (
    <ul className={styles.events}>
      {events.slice(0, limit).map((event) => (
        <li key={event.eventId} className={styles.event}>
          <span className={styles.eventIcon}>
            {event.kind === "SOURCE_DEGRADED"
              ? <WarningCircle size={14} weight="fill" aria-hidden />
              : event.kind === "RECEIPT_ISSUED"
                ? <Receipt size={14} weight="bold" aria-hidden />
                : <ClockCounterClockwise size={14} weight="bold" aria-hidden />}
          </span>
          <span className={styles.eventBody}>
            <span className={styles.eventKind}>
              {EVENT_LABEL[event.kind]} · {event.subjectLabel}
            </span>
            <span className={styles.eventText}>{event.summary}</span>
          </span>
          <time className={styles.eventTime} dateTime={event.at}>{shortTime(event.at)}</time>
        </li>
      ))}
    </ul>
  );
}

/** What each source answered, in its own words. */
export function Sources({ sources }: { sources: readonly ActivitySource[] }) {
  if (sources.length === 0) {
    return (
      <p className={styles.empty}>
        <Question size={15} weight="bold" aria-hidden />
        No source was read for this account on this request.
      </p>
    );
  }
  return (
    <ul className={styles.rows}>
      {sources.map((source) => (
        <li key={source.sourceId} className={styles.row}>
          <span className={styles.rowName}>
            {source.label}
            <StateChip tone="quiet" label={source.entitlement} />
          </span>
          <span className={styles.rowName}>
            <StateChip
              tone={source.state === "OK" ? "good" : source.state === "STALE" ? "caution" : "risk"}
              label={source.state}
            />
          </span>
          {source.reason === null ? null : <span className={styles.chainReason}>{source.reason}</span>}
        </li>
      ))}
    </ul>
  );
}

/**
 * What a cycle's state means, said as the thing that is missing.
 *
 * `CLOSED` under a warning triangle read as *the close went wrong*. What is
 * actually missing is the conclusion, so the chip says that.
 */
export function cycleLabel(state: JournalCycle["state"]): string {
  if (state === "REVIEWED") return "Reviewed";
  if (state === "CLOSED") return "Needs review";
  return "Open";
}

/**
 * One journal cycle: the four links as chips, then the two that carry a story.
 *
 * The outcome and the conclusion get a line each because they are what a reader
 * came for; the plan and the decision are chips, because a reader who wants
 * them opens the case. Printing all four as sentences turned a row into a
 * paragraph, which is the thing this workspace does not do.
 *
 * Used by the Journal and by nothing else today, and it lives here rather than
 * inside the page so the decision surfaces keep one implementation of one row.
 */
export function CycleRow({ cycle }: { cycle: JournalCycle }) {
  const conclusion = cycle.links.find((link) => link.id === "CONCLUSION")!;
  const outcome = cycle.links.find((link) => link.id === "OUTCOME")!;
  return (
    <li className={styles.case}>
      <div className={styles.caseBody}>
        <p className={styles.caseTitle}>
          {cycle.subjectLabel}
          <StateChip tone={bookTone} label={cycle.book} />
          <StateChip
            tone={cycle.state === "REVIEWED" ? "good" : cycle.state === "CLOSED" ? "caution" : "unknown"}
            label={cycleLabel(cycle.state)}
          />
        </p>
        <p className={styles.caseMeta}>
          {cycle.links.map((link) => (
            <StateChip
              key={link.id}
              tone={link.state === "RECORDED" ? "good" : "unknown"}
              label={link.label}
            />
          ))}
        </p>
        <p className={styles.chainReason}>
          {outcome.state === "RECORDED" ? outcome.summary : outcome.reason}
        </p>
        <p className={styles.question}>
          {conclusion.state === "RECORDED" ? conclusion.summary : conclusion.reason}
        </p>
      </div>
      <Link className={styles.link} href={`/app/action-cases/${cycle.caseId}`}>
        Open <ArrowRight size={13} weight="bold" aria-hidden />
      </Link>
    </li>
  );
}
