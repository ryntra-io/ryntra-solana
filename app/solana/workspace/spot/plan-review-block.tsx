"use client";

import { CheckCircle, Question, XCircle } from "@phosphor-icons/react";
import Link from "next/link";

import type { PlanCheck, PlanCheckId, PlanReview, TradingPlan } from "@/lib/api/v1/contract";
import { evidenceMetric } from "@/lib/evidence/metrics";

import { useSolanaI18n } from "../i18n/provider.tsx";
import { formatUsdMoney } from "./spot-format.ts";
import styles from "./spot.module.css";

/**
 * The plan on the ticket — `RYN-STRATEGY-PLAN-001` stage B, canon §10.1.
 *
 * Two pieces. **The plan chip** says which plan and version the order is
 * made under, with the version's own size, and lets the person leave the
 * plan explicitly — a refused planned order never turns into a plain one by
 * itself. **The Strategy block** is the server's own judgement of the plan
 * on the exact order: the verdict, every check that failed or could not be
 * judged in full, and the rest folded under one line. Ready signs; attention
 * names what the person decides; blocked came back as a refusal and no
 * bytes exist for it — the block is drawn from the refusal so the person
 * sees why, and — when it is the money that failed — the amount that fits
 * the plan at this price is one press. A refusal on another rule (the
 * slippage, the reference, the version) is not mended by a smaller amount,
 * so the press is not offered there.
 *
 * The evidence checks name their source: a rule on what the market did is
 * *Evidence condition*, a rule on how the token is built is *Due diligence*
 * (RYN-DDXYZ-RISK-001) — and under the checks one line per source says when
 * it was read, how far behind it may be, and whose data it is.
 */

const CHECK_WORDS: Readonly<Record<PlanCheckId, string>> = {
  status: "Plan is active",
  asset: "Exact representation",
  side: "Side",
  version: "Plan version",
  validity: "Entry still valid",
  budget: "Within the budget",
  spend: "Within what the plan may spend",
  entryPrice: "Entry price bound",
  invalidation: "Above the invalidation",
  risk: "Planned risk",
  size: "Sized spend",
  reference: "Reference",
  deviation: "Deviation from the reference",
  slippage: "Slippage bound",
  quoteAge: "Quote age",
  liquidity: "Pool liquidity",
  units: "Units known",
  evidence: "Evidence condition",
  /* 1.9.0: exit checks are judged on Results, after an exit has settled; a Review before an entry never carries one, and the words exist so a check id is never shown raw. */
  exitTarget: "Exit target",
  exitInvalidation: "Exit against the invalidation",
  exitTime: "Time exit",
};

/** The checks a different amount can mend; the fit amount is offered only when one of them failed. */
const MONEY_CHECKS: ReadonlySet<PlanCheckId> = new Set<PlanCheckId>(["budget", "spend", "risk", "size"]);

function Outcome({ check }: { check: PlanCheck }) {
  if (check.outcome === "pass") return <CheckCircle size={16} weight="fill" aria-hidden="true" />;
  if (check.outcome === "fail") return <XCircle size={16} weight="fill" aria-hidden="true" />;
  return <Question size={16} weight="fill" aria-hidden="true" />;
}

function CheckRow({ check, text, label }: { check: PlanCheck; text: (english: string) => string; label?: string }) {
  return (
    <li className={styles.planCheck} data-outcome={check.outcome} data-required={check.required ? "true" : "false"}>
      <Outcome check={check} />
      <span className={styles.planCheckLabel}>
        {label ?? text(CHECK_WORDS[check.id])}
        {!check.required ? <em> · {text("advisory")}</em> : null}
      </span>
      <span className={styles.planCheckFigure} translate="no">
        {check.actual ?? text("unknown")}
        {check.outcome !== "pass" || check.id === "evidence" ? <small>{check.expected}</small> : null}
      </span>
    </li>
  );
}

/** `17:16 UTC` — the clock a read line says. */
function clock(iso: string): string {
  return `${iso.slice(11, 16)} UTC`;
}

/**
 * The refusal in one sentence, with the figures and the next action (the
 * Owner's directive of 2026-09-22): the first required check that failed or
 * could not be judged, said as *the price now is $974.10 / token, but your
 * plan pays at most $900.00 / token — wait for the price, or raise the bound
 * in a new version of the plan*, never as a bare row. The figures are the
 * block's own `actual` and `expected` strings, so the sentence never says
 * what the server did not. Null when nothing required is open.
 */
export function planRefusalSentence(review: PlanReview, text: (english: string) => string): string | null {
  const open = review.checks.find((check) => check.required && check.outcome !== "pass");
  if (!open) return null;
  const actual = open.actual ?? text("unknown");
  const expected = open.expected;
  if (open.outcome === "unknown") {
    return `${text(CHECK_WORDS[open.id])}: ${text("could not be judged right now")} (${actual}; ${text("the plan expects")} ${expected}). ${text("A required check that cannot be judged does not sign — try again in a moment.")}`;
  }
  switch (open.id) {
    case "entryPrice":
      return `${text("The price now is")} ${actual}, ${text("but your plan pays")} ${expected}. ${text("Wait for the price, or raise the bound in a new version of the plan.")}`;
    case "risk":
      return `${text("The modelled loss at this price is")} ${actual} — ${text("more than the planned risk")} (${expected}). ${text("Use the amount that fits the plan, or change the plan.")}`;
    case "budget":
    case "spend":
      return `${text("This amount")} (${actual}) ${text("is above what the plan may spend")} (${expected}). ${text("Lower the amount.")}`;
    case "invalidation":
      return `${text("The price now is")} ${actual}, ${text("at or below the plan's invalidation")} (${expected}). ${text("At this price the thesis is already wrong; the plan does not buy here.")}`;
    case "status":
      return `${text("The plan is")} ${actual}. ${text("Only an active plan is traded under.")}`;
    case "version":
      return `${text("The plan moved to a newer version.")} ${text("Open it again and review on the current one.")}`;
    case "validity":
      return `${text("The plan's entry validity is over")} (${expected}). ${text("Extend it in a new version, or let the plan rest.")}`;
    case "asset":
    case "side":
      return `${text("This order is not the plan's")}: ${actual}, ${text("the plan expects")} ${expected}.`;
    case "reference":
      return `${text("The reference is")} ${actual}; ${text("the plan requires")} ${expected}. ${text("Wait for a current reference, or change the rule in a new version.")}`;
    case "deviation":
      return `${text("The price deviates")} ${actual} ${text("from the reference")}; ${text("the plan allows")} ${expected}.`;
    default:
      return `${text(CHECK_WORDS[open.id])}: ${actual} — ${text("the plan expects")} ${expected}.`;
  }
}

export function PlanReviewBlock({
  review,
  plan,
  onUseFit,
}: {
  review: PlanReview;
  plan: TradingPlan | null;
  /** Called with the USD amount that fits the plan at this price; absent when the block cannot offer one. */
  onUseFit?: (usd: number) => void;
}) {
  const { text, locale } = useSolanaI18n();
  /* Each evidence check is the condition of the same index in the block; its source decides its label. */
  const evidenceIndexOf = new Map<PlanCheck, number>();
  review.checks.filter((check) => check.id === "evidence").forEach((check, index) => evidenceIndexOf.set(check, index));
  const labelOf = (check: PlanCheck): string | undefined => {
    if (check.id !== "evidence") return undefined;
    const condition = review.evidence?.conditions[evidenceIndexOf.get(check) ?? -1];
    return condition && evidenceMetric(condition.metric)?.provider === "ddxyz" ? text("Due diligence") : undefined;
  };
  const open = review.checks.filter((check) => check.outcome !== "pass");
  const passed = review.checks.length - open.length;
  /* One line per source the Review read: when, how far behind it may be, whose data. */
  const sources = review.evidence ? (review.evidence.sources ?? [{ provider: review.evidence.provider, attribution: review.evidence.attribution }]) : [];
  const readOf = (provider: string) => review.evidence?.reads.find((read) => (read.provider ?? review.evidence?.provider) === provider) ?? null;
  const verdict = review.verdict === "ready" ? text("Within the plan") : review.verdict === "attention" ? text("Within the plan · your call") : text("Outside the plan");
  const reason = planRefusalSentence(review, text);
  const symbol = plan?.asset.symbol ?? "";
  const fit = review.quote.fitUsd;
  const moneyFailed = open.some((check) => check.outcome === "fail" && MONEY_CHECKS.has(check.id));
  const showFit = review.verdict === "blocked" && moneyFailed && fit !== null && fit > 0 && onUseFit && Math.abs(fit - review.quote.usd) > 0.01;
  return (
    <section className={styles.planBlock} data-verdict={review.verdict} aria-label={text("Strategy")}>
      <div className={styles.planBlockHead}>
        <b>
          {text("Strategy")} · <span translate="no">{symbol} v{review.version}</span>
        </b>
        <span className={styles.planVerdict} data-verdict={review.verdict}>
          {verdict}
        </span>
      </div>
      {/* The refusal said once, plainly, before any row: the figures and the next action. */}
      {review.verdict === "blocked" && reason ? <p className={styles.planReason} role="status">{reason}</p> : null}
      {review.quote.modelledLossUsd !== null ? (
        <p className={styles.planModel}>
          {text("Modelled loss to the invalidation at this price")}: <b translate="no">{formatUsdMoney(review.quote.modelledLossUsd, locale)}</b>
          {plan ? <> · {text("planned")} <b translate="no">{formatUsdMoney(plan.current.rules.risk.plannedRiskUsd, locale)}</b></> : null}
        </p>
      ) : null}
      {open.length > 0 ? (
        <ul className={styles.planChecks}>
          {open.map((check, index) => (
            <CheckRow key={`${check.id}:${index}`} check={check} text={text} label={labelOf(check)} />
          ))}
        </ul>
      ) : null}
      {passed > 0 ? (
        <details className={styles.planPassed}>
          <summary>
            <CheckCircle size={14} weight="fill" aria-hidden="true" /> {passed} {text("checks passed")}
          </summary>
          <ul className={styles.planChecks}>
            {review.checks
              .filter((check) => check.outcome === "pass")
              .map((check, index) => (
                <CheckRow key={`${check.id}:${index}`} check={check} text={text} label={labelOf(check)} />
              ))}
          </ul>
        </details>
      ) : null}
      {sources.length > 0 ? (
        <ul className={styles.planSources} aria-label={text("Evidence sources")}>
          {sources.map((source) => {
            const read = readOf(source.provider);
            const when = read?.observedAt ?? read?.fetchedAt ?? null;
            const lag = read?.providerLagSeconds ? Math.round(read.providerLagSeconds / 60) : 0;
            return (
              <li key={source.provider} translate="no">
                <span>{source.provider === "ddxyz" ? text("Due diligence") : text("Onchain activity")}</span>
                {when ? ` · ${read?.observedAt ? text("analysed") : text("asked")} ${clock(when)}` : ` · ${text("no observation")}`}
                {lag > 0 ? ` · ${text("the source may be up to")} ${lag} ${text("min behind")}` : ""}
                {read && read.state !== "FRESH" ? ` · ${read.state === "STALE" ? text("stale") : read.state === "UNKNOWN" ? text("no data") : text("not available")}` : ""}
                {" · "}
                <a href={source.attribution.href} target="_blank" rel="noreferrer noopener">
                  {source.attribution.text}
                </a>
              </li>
            );
          })}
        </ul>
      ) : null}
      {showFit ? (
        <button type="button" className={styles.secondary} onClick={() => onUseFit(fit)}>
          {text("Use the amount that fits the plan")} · <span translate="no">{formatUsdMoney(fit, locale)}</span>
        </button>
      ) : null}
    </section>
  );
}

/** The plan the ticket is under: asset · version · the version's sized spend; the × leaves the plan on purpose. */
export function PlanChip({
  plan,
  state,
  onLeave,
}: {
  plan: TradingPlan | null;
  state: "loading" | "ready" | "unproven" | "notFound" | "wrongMarket" | "inactive";
  onLeave: () => void;
}) {
  const { text, locale } = useSolanaI18n();
  const line = (() => {
    if (state === "loading") return text("Reading the plan…");
    if (state === "unproven") return text("Confirm your wallet to trade under the plan.");
    if (state === "notFound") return text("No such plan for this wallet.");
    if (!plan) return text("Reading the plan…");
    if (state === "wrongMarket") return text("This market is not the plan's asset.");
    if (state === "inactive") return text("Only an active plan is traded under.");
    return `${text("Sized")} ${formatUsdMoney(plan.current.sizing.notionalUsd, locale)} · ${text("budget")} ${formatUsdMoney(plan.current.rules.capital.budgetUsd, locale)} · ${text("planned risk")} ${formatUsdMoney(plan.current.rules.risk.plannedRiskUsd, locale)}`;
  })();
  return (
    <div className={styles.planChip} data-state={state}>
      <div className={styles.planChipText}>
        <b>
          {text("Under plan")}
          {plan ? (
            <>
              {" · "}
              <Link href={`/app/strategies/plans/${plan.id}`} prefetch={false} translate="no">
                {plan.asset.symbol} v{plan.version}
              </Link>
            </>
          ) : null}
        </b>
        <span>
          {line}
          {state === "wrongMarket" && plan ? (
            <>
              {" "}
              <Link href={`/app/spot?view=stock&mint=${encodeURIComponent(plan.asset.mint)}&plan=${encodeURIComponent(plan.id)}&v=${plan.version}`} prefetch={false}>
                {text("Open")} <span translate="no">{plan.asset.symbol}</span> →
              </Link>
            </>
          ) : null}
        </span>
      </div>
      <button type="button" className={styles.planChipLeave} onClick={onLeave} aria-label={text("Trade without the plan")} title={text("Trade without the plan")}>
        ×
      </button>
    </div>
  );
}
