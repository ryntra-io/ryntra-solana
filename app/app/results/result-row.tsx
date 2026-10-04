"use client";

import { CheckCircle, Question, XCircle } from "@phosphor-icons/react";
import Link from "next/link";

import { Help } from "@/app/shell/help";
import type { WorkspaceLocale } from "@/app/shell/locale";
import type { PlanCheck, PlanNoTradeOutcome, PlanPositionRow, PlanResult } from "@/lib/api/v1/contract";

import { fmtUnits, fmtUsd, fmtWhen, planWordsFor } from "../strategies/plans/plan-words";
import { checkWord, costPartText, costReasonText, legWord, noTradeLabel, noTradeSentence, positionSentence, resultWordsFor, unknownText } from "./results-words";
import styles from "./results.module.css";

/**
 * One row of Results.
 *
 * Three shapes, one look: a position under a plan, one operation against the
 * plan it was made under, and a plan that made no trade. Each opens with the
 * sentence a person actually wants, carries the two or three figures the
 * sentence stands on, and keeps the ledger's own fields behind a disclosure
 * that says what it holds before it is opened.
 *
 * What never happens here: a figure the server did not establish is drawn as
 * an em dash with its reason, never as a zero; an estimate is labelled as
 * modelled and never as paid; and an exit is judged only by the checks the
 * server already judged against the version in force when it settled.
 */

function Outcome({ check }: { check: PlanCheck }) {
  if (check.outcome === "pass") return <CheckCircle size={14} weight="fill" aria-hidden="true" />;
  if (check.outcome === "fail") return <XCircle size={14} weight="fill" aria-hidden="true" />;
  return <Question size={14} weight="fill" aria-hidden="true" />;
}

/** A figure with its label; `null` is an em dash in the muted face, so an unknown never reads as a number. */
function Figure({ label, value, note, tone }: { label: string; value: string | null; note?: string | null; tone?: "pos" | "neg" }) {
  return (
    <div className={styles.figure}>
      <span className={styles.figureLabel}>{label}</span>
      <span className={styles.figureValue} data-state={value === null ? "unknown" : undefined} data-tone={value === null ? undefined : tone}>
        {value ?? "—"}
      </span>
      {note ? <span className={styles.figureNote}>{note}</span> : null}
    </div>
  );
}

/* ------------------------------------------------------------ the position */

export function PositionRow({ row, locale }: { row: PlanPositionRow; locale: WorkspaceLocale }) {
  const word = resultWordsFor(locale);
  const plan = planWordsFor(locale, row.asset.unitBasis ?? "share");
  const symbol = row.asset.underlying.symbol || row.asset.symbol;
  const position = row.position;
  const closed = position.state === "closed";
  const realised = position.realisedUsd;

  return (
    <article className={styles.row}>
      <header className={styles.rowHead}>
        <h3 className={styles.rowTitle}>
          <span className={styles.symbol}>{symbol}</span>
          <span className={styles.chip} data-tone={closed ? "exit" : "entry"}>
            {closed ? word("closedPositions") : word("openPositions")}
          </span>
        </h3>
        <Link className={styles.link} href={`/app/strategies/plans/${row.planId}`} prefetch={false}>
          {word("openPlan")}
        </Link>
      </header>

      <p className={styles.sentence}>{positionSentence(position, symbol, locale)}</p>

      <div className={styles.figures}>
        <Figure label={word("costBasis")} value={position.costBasisUsd === null ? null : fmtUsd(position.costBasisUsd, locale)} />
        <Figure label={word("proceeds")} value={position.proceedsUsd === null ? null : fmtUsd(position.proceedsUsd, locale)} />
        <Figure label={word("feesPaid")} value={position.feesUsd === null ? null : fmtUsd(position.feesUsd, locale)} />
        <Figure
          label={word("realised")}
          value={realised === null ? null : fmtUsd(realised, locale)}
          tone={realised === null ? undefined : realised > 0 ? "pos" : realised < 0 ? "neg" : undefined}
          note={realised === null ? null : word("realisedMethod")}
        />
      </div>

      {position.unknowns.length > 0 ? (
        <p className={styles.note}>
          {word("noRealised")} {position.unknowns.map((id) => unknownText(id, locale)).join("; ")}.
        </p>
      ) : null}

      <details className={styles.disclosure}>
        <summary className={styles.disclosureSummary}>{word("details")}</summary>
        <div className={styles.disclosureBody}>
          <div className={styles.figures}>
            <Figure label={word("bought")} value={`${fmtUnits(Number(position.unitsIn), locale)} ${symbol}`} />
            <Figure label={word("sold")} value={`${fmtUnits(Number(position.unitsOut), locale)} ${symbol}`} />
            <Figure label={word("held")} value={`${fmtUnits(Number(position.unitsHeld), locale)} ${symbol}`} />
            <Figure label={plan("version")} value={`${row.version}`} />
          </div>
        </div>
      </details>
    </article>
  );
}

/* ------------------------------------------------------------ one operation */

export function ResultRow({ result, locale }: { result: PlanResult; locale: WorkspaceLocale }) {
  const word = resultWordsFor(locale);
  const plan = planWordsFor(locale, result.asset.unitBasis ?? "share");
  const actual = result.actual;
  const symbol = result.asset.underlying.symbol || result.asset.symbol;
  const costs = result.costs;
  const exit = result.exit;
  const short = `${actual.signature.slice(0, 6)}…${actual.signature.slice(-4)}`;
  const verdictTone = exit ? (exit.verdict === "deviated" ? "deviated" : exit.verdict === "followed" ? "followed" : undefined) : result.verdict === "deviated" ? "deviated" : result.verdict === "followed" ? "followed" : undefined;
  const verdictWord = exit
    ? exit.verdict === "followed"
      ? word("exitFollowed")
      : exit.verdict === "deviated"
        ? word("exitDeviated")
        : word("exitUnknown")
    : result.verdict === "followed"
      ? plan("followed")
      : result.verdict === "deviated"
        ? plan("deviated")
        : plan("unsettled");

  return (
    <article className={styles.row}>
      <header className={styles.rowHead}>
        <h3 className={styles.rowTitle}>
          <span className={styles.symbol}>{symbol}</span>
          <span className={styles.chip} data-tone={actual.leg ?? undefined}>
            {legWord(result, locale)}
          </span>
          {verdictTone ? (
            <span className={styles.chip} data-tone={verdictTone}>
              {verdictWord}
            </span>
          ) : null}
        </h3>
        <span className={styles.when}>{fmtWhen(actual.settledAt, locale)}</span>
      </header>

      <div className={styles.figures}>
        <Figure label={word("plannedPrice")} value={costs.plannedPerUnitUsd === null ? null : fmtUsd(costs.plannedPerUnitUsd, locale)} />
        <Figure label={word("quotedPrice")} value={costs.quotedPerUnitUsd === null ? null : fmtUsd(costs.quotedPerUnitUsd, locale)} />
        <Figure label={word("filledPrice")} value={costs.filledPerUnitUsd === null ? null : fmtUsd(costs.filledPerUnitUsd, locale)} />
        <Figure
          label={actual.leg === "exit" ? word("proceeds") : word("spendLabel")}
          value={actual.leg === "exit" ? (actual.proceedsUsd === null ? null : fmtUsd(actual.proceedsUsd, locale)) : actual.usd === null ? null : fmtUsd(actual.usd, locale)}
        />
      </div>

      {actual.matchedBy === "asset" ? <p className={styles.note}>{word("matchedByAsset")}</p> : null}

      {exit ? (
        <section className={styles.section} aria-label={word("exitAdherence")}>
          <div className={styles.sectionHead}>
            <h4 className={styles.sectionTitle}>
              {word("exitAdherence")} <Help topic="planVsActual" locale={locale} />
            </h4>
            <span className={styles.when}>
              {word("ruledBy")} {exit.ruledByVersion ?? "—"}
            </span>
          </div>
          <ul className={styles.checks}>
            {exit.checks.map((check) => (
              <li key={check.id} className={styles.check} data-outcome={check.outcome}>
                <span className={styles.checkName}>
                  <Outcome check={check} />
                  {checkWord(check.id, locale)}
                </span>
                <span className={styles.checkFigures}>
                  {check.expected}
                  {check.actual ? ` · ${check.actual}` : ""}
                </span>
              </li>
            ))}
          </ul>
          {exit.notBackdated ? <p className={styles.note}>{word("laterRule")}</p> : null}
        </section>
      ) : null}

      <details className={styles.disclosure}>
        <summary className={styles.disclosureSummary}>{word("difference")}</summary>
        <div className={styles.disclosureBody}>
          <div className={styles.figures}>
            <Figure label={word("marketMove")} value={costs.marketMove.basis === "unknown" ? null : costPartText(costs.marketMove, locale)} note={costReasonText(costs.marketMove.reason, locale)} />
            <Figure label={word("executionPart")} value={costs.execution.basis === "unknown" ? null : costPartText(costs.execution, locale)} note={costReasonText(costs.execution.reason, locale)} />
            <Figure label={word("feePart")} value={costs.fee.basis === "unknown" ? null : costPartText(costs.fee, locale)} note={costReasonText(costs.fee.reason, locale)} />
          </div>
          <div className={styles.figures}>
            <Figure
              label={word("expectedAtReview")}
              value={costs.expected.quotedUsd === null ? null : fmtUsd(costs.expected.quotedUsd, locale)}
              note={word("estimateNote")}
            />
            <Figure label={word("slippageLabel")} value={costs.expected.slippageBps === null ? null : `${(costs.expected.slippageBps / 100).toFixed(2)}%`} />
            <Figure label={word("feeLabel")} value={costs.expected.feeBps === null ? null : `${(costs.expected.feeBps / 100).toFixed(2)}%`} />
            <Figure label={word("priceImpactLabel")} value={costs.expected.priceImpactPct === null ? null : `${costs.expected.priceImpactPct.toFixed(2)}%`} />
          </div>
          {result.checks.length > 0 ? (
            <ul className={styles.checks}>
              {result.checks.map((check) => (
                <li key={check.id} className={styles.check} data-outcome={check.outcome}>
                  <span className={styles.checkName}>
                    <Outcome check={check} />
                    {checkWord(check.id, locale)}
                  </span>
                  <span className={styles.checkFigures}>
                    {check.expected}
                    {check.actual ? ` · ${check.actual}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          <div className={styles.links}>
            <Link className={styles.link} href={`/app/strategies/plans/${result.planId}`} prefetch={false}>
              {word("openPlan")}
            </Link>
            <a className={styles.link} href={`https://solscan.io/tx/${actual.signature}`} target="_blank" rel="noreferrer noopener">
              {word("transaction")} {short}
            </a>
          </div>
        </div>
      </details>
    </article>
  );
}

/* ------------------------------------------------------------ a plan that made no trade */

export function NoTradeRow({ outcome, locale }: { outcome: PlanNoTradeOutcome; locale: WorkspaceLocale }) {
  const word = resultWordsFor(locale);
  const plan = planWordsFor(locale, outcome.asset.unitBasis ?? "share");
  const symbol = outcome.asset.underlying.symbol || outcome.asset.symbol;

  return (
    <article className={styles.row}>
      <header className={styles.rowHead}>
        <h3 className={styles.rowTitle}>
          <span className={styles.symbol}>{symbol}</span>
          <span className={styles.chip}>{noTradeLabel(outcome.reason, locale)}</span>
        </h3>
        <span className={styles.when}>{fmtWhen(outcome.observedAt, locale)}</span>
      </header>

      <p className={styles.sentence}>{noTradeSentence(outcome, locale)}</p>

      {outcome.blockedBy ? (
        <div className={styles.figures}>
          <Figure label={word("theRule")} value={checkWord(outcome.blockedBy, locale)} />
          <Figure label={word("yourBound")} value={outcome.expected} />
          <Figure label={word("whatWasFound")} value={outcome.found} />
          <Figure label={word("reviewsCount")} value={`${outcome.reviews}`} />
        </div>
      ) : null}

      <div className={styles.links}>
        <Link className={styles.link} href={`/app/strategies/plans/${outcome.planId}`} prefetch={false}>
          {word("openPlan")}
        </Link>
        <span className={styles.when}>
          {plan("status")}: {plan(outcome.status)}
        </span>
      </div>
    </article>
  );
}
