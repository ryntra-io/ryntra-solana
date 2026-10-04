"use client";

import { CheckCircle, Question, XCircle } from "@phosphor-icons/react";
import Link from "next/link";

import type { WorkspaceLocale } from "@/app/shell/locale";
import type { PlanCheck, PlanResult } from "@/lib/api/v1/contract";

import { conditionSentence } from "@/app/solana/workspace/evidence/evidence-words";

import { fmtUnits, fmtUsd, fmtWhen, planWordsFor } from "./plan-words";
import styles from "./plans.module.css";

/**
 * Plan · Before signing · Actual for one execution.
 *
 * Three columns of the same four figures: the entry per share, the spend,
 * the shares, the modelled loss to the invalidation — the version the
 * execution was bound to, the Strategy block that stood before the
 * signature, the History row the chain settled. Every figure is in the
 * units of its own moment (the multiplier the Review stored, the version's
 * own rules). The verdict is about the entry only and says so; nothing here
 * claims an exit, a profit or a stop.
 */

function Outcome({ check }: { check: PlanCheck }) {
  if (check.outcome === "pass") return <CheckCircle size={14} weight="fill" aria-hidden="true" />;
  if (check.outcome === "fail") return <XCircle size={14} weight="fill" aria-hidden="true" />;
  return <Question size={14} weight="fill" aria-hidden="true" />;
}

const CHECK_WORDS: Readonly<Record<string, Readonly<{ en: string; uk: string }>>> = {
  budget: { en: "Budget", uk: "Бюджет" },
  spend: { en: "Spendable", uk: "Дозволена сума" },
  entryPrice: { en: "Entry bound", uk: "Межа входу" },
  invalidation: { en: "Above invalidation", uk: "Вище інвалідації" },
  risk: { en: "Planned risk", uk: "Плановий ризик" },
  size: { en: "Sized spend", uk: "Плановий обсяг" },
};

export function PlanResultCard({ result, locale, compact = false }: { result: PlanResult; locale: WorkspaceLocale; compact?: boolean }) {
  const word = planWordsFor(locale, result.asset.unitBasis ?? "share");
  const before = result.beforeSigning;
  const actual = result.actual;
  const underlying = result.asset.underlying.symbol;
  const verdict = result.verdict === "followed" ? word("followed") : result.verdict === "deviated" ? word("deviated") : word("unsettled");
  const short = `${actual.signature.slice(0, 6)}…${actual.signature.slice(-4)}`;

  const rows: readonly Readonly<{ label: string; plan: string; before: string; actual: string }>[] = [
    {
      label: word("entryPerShare"),
      plan: fmtUsd(result.plan.entryPerShareUsd, locale),
      before: before?.quote.perShareUsd != null ? fmtUsd(before.quote.perShareUsd, locale) : "—",
      actual: actual.perShareUsd != null ? fmtUsd(actual.perShareUsd, locale) : "—",
    },
    {
      label: word("spend"),
      plan: fmtUsd(result.plan.sizedNotionalUsd, locale),
      before: before ? fmtUsd(before.quote.usd, locale) : "—",
      actual: actual.usd != null ? fmtUsd(actual.usd, locale) : "—",
    },
    {
      label: `${word("shares")} · ${underlying}`,
      plan: fmtUnits(result.plan.sizedUnits, locale),
      before: before ? fmtUnits(Number(before.quote.amount), locale) : "—",
      actual: actual.amount != null ? fmtUnits(Number(actual.amount), locale) : "—",
    },
    {
      label: word("modelledLoss"),
      plan: fmtUsd(result.plan.plannedRiskUsd, locale),
      before: before?.quote.modelledLossUsd != null ? fmtUsd(before.quote.modelledLossUsd, locale) : "—",
      actual: actual.modelledLossUsd != null ? fmtUsd(actual.modelledLossUsd, locale) : "—",
    },
  ];

  return (
    <article className={styles.result} data-verdict={result.verdict}>
      <header className={styles.resultHead}>
        <Link href={`/app/strategies/plans/${result.planId}`} prefetch={false} className={styles.resultTitle}>
          <span translate="no">{result.asset.symbol}</span> · {word("builderTitle").toLowerCase()} v{result.version}
        </Link>
        <span className={styles.resultVerdict} data-verdict={result.verdict}>
          {result.verdict === "followed" ? <CheckCircle size={14} weight="fill" aria-hidden="true" /> : result.verdict === "deviated" ? <XCircle size={14} weight="fill" aria-hidden="true" /> : <Question size={14} weight="fill" aria-hidden="true" />}
          {verdict}
        </span>
      </header>
      <table className={styles.resultTable}>
        <thead>
          <tr>
            <th scope="col" aria-label={word("planVsActual")} />
            <th scope="col">{word("colPlan")}</th>
            <th scope="col">{word("colBefore")}</th>
            <th scope="col">{word("colActual")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              <td translate="no">{row.plan}</td>
              <td translate="no">{row.before}</td>
              <td translate="no">{row.actual}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {/* What the Review knew about the market before the signature (1.5.0): each condition as judged then, its figure while retention lasts, the source named. */}
      {!compact && before?.evidence && before.evidence.conditions.length > 0 ? (
        <ul className={styles.resultChecks} aria-label={word("evidenceConditions")}>
          {before.evidence.conditions.map((condition, index) => {
            const check = before.checks.filter((entry) => entry.id === "evidence")[index];
            return (
              <li key={`evidence-${index}`} data-outcome={condition.outcome} title={check ? `${check.expected}${check.actual ? ` · ${check.actual}` : ""}` : undefined}>
                <Outcome check={{ id: "evidence", outcome: condition.outcome, required: condition.mode === "required", expected: "", actual: null }} />
                {conditionSentence(condition, locale)} · {condition.outcome === "pass" ? word("evidenceMet") : condition.outcome === "fail" ? word("evidenceNotMet") : word("evidenceUnknownNow")}
                {check?.actual ? <span translate="no"> · {check.actual}</span> : null}
              </li>
            );
          })}
          {/* Every source the Review read, each with its own line (1.6.0: two providers may stand behind one version). */}
          {(before.evidence.sources ?? [{ provider: before.evidence.provider, attribution: before.evidence.attribution }]).map((source) => (
            <li key={source.provider} data-outcome="pass" data-attribution="true">
              <a href={source.attribution.href} target="_blank" rel="noreferrer noopener">
                {source.attribution.text}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      <footer className={styles.resultFoot}>
        <span>
          <time dateTime={actual.settledAt}>{fmtWhen(actual.settledAt, locale)}</time>
          {actual.feeUsd != null ? <> · {word("fee").toLowerCase()} {fmtUsd(actual.feeUsd, locale)}</> : null}
          {" · "}
          <a href={`https://solscan.io/tx/${actual.signature}`} target="_blank" rel="noreferrer noopener" translate="no">
            {short}
          </a>
        </span>
        {!compact && result.checks.length > 0 ? (
          <ul className={styles.resultChecks} aria-label={word("withinChecks")}>
            {result.checks.map((check) => (
              <li key={check.id} data-outcome={check.outcome} title={`${check.expected}${check.actual ? ` · ${check.actual}` : ""}`}>
                <Outcome check={check} />
                {CHECK_WORDS[check.id]?.[locale] ?? check.id}
              </li>
            ))}
          </ul>
        ) : null}
      </footer>
    </article>
  );
}
