"use client";

import Link from "next/link";
import { useState } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import type { PredictionPlan } from "@/lib/predictions/plan-model";

import { dateShort, pct, usd } from "./format";
import styles from "./predictions.module.css";
import { usePaperAccount } from "./use-paper-account";
import { wordsFor } from "./words";
import { usePredictionsPaths } from "./surface";

/**
 * The wallet's Prediction Plans on My strategies: each on the version it
 * stands on, with what its rules imply and where it is in its life, beside
 * the trading plans and never mixed with them — a prediction plan has no
 * share, no reference price, only an amount that is the whole principal at
 * risk. Activate a draft or cancel from here; the plan itself is edited from
 * the market it is about.
 */
export function PredictionPlansPanel({ locale, account: shared = null }: { locale: WorkspaceLocale; /** The page's own account read, when the page has one. */ account?: ReturnType<typeof usePaperAccount> | null }) {
  const paths = usePredictionsPaths();
  const word = wordsFor(locale);
  const own = usePaperAccount({ skip: shared !== null });
  const account = shared ?? own;
  const [busy, setBusy] = useState<string | null>(null);
  if (account.state.status !== "ready" || !account.state.account) return null;
  const plans = account.state.account.plans;
  if (plans.length === 0) return null;

  const setStatus = async (plan: PredictionPlan, status: "active" | "cancelled") => {
    setBusy(plan.id);
    await fetch(`/api/predictions/plans/${encodeURIComponent(plan.id)}/status`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ version: plan.version, status }),
    }).catch(() => null);
    await account.refresh();
    setBusy(null);
  };

  const statusWord = (status: PredictionPlan["status"]) =>
    status === "active" ? word("planActive") : status === "draft" ? word("planDraft") : status === "executed" ? word("planExecuted") : status === "cancelled" ? word("planCancelled") : word("planExpired");

  return (
    <section className={styles.card} aria-labelledby="prediction-plans-title" style={{ marginTop: "var(--ry-s4)" }}>
      <div className={styles.cardHead}>
        <h2 id="prediction-plans-title" className={styles.cardTitle}>
          {locale === "uk" ? "Плани прогнозів" : "Prediction plans"}
        </h2>
      </div>
      <div className={styles.list}>
        {plans.map((plan) => {
          const rules = plan.current.rules;
          const sizing = plan.current.sizing;
          return (
            <div key={plan.id} className={styles.item}>
              <Link href={paths.event(rules.eventId)} prefetch={false}>
                {rules.question}
              </Link>
              <span className={styles.itemMeta}>
                <span className={styles.stateChip} data-tone={plan.status === "active" ? "good" : plan.status === "executed" ? "good" : plan.status === "draft" ? "wait" : "bad"}>
                  {statusWord(plan.status)}
                </span>
                <span>
                  {word("outcome")} <b>{rules.outcomeLabel}</b>
                </span>
                <span>
                  {word("amountUsd")} <b>{usd(rules.amountUsd, 0)}</b>
                </span>
                <span>
                  {word("entryProbability")} <b>{pct(rules.entryProbability, 1)}</b>
                </span>
                {rules.maxProbability != null ? (
                  <span>
                    {word("maxProbability")} <b>{pct(rules.maxProbability, 1)}</b>
                  </span>
                ) : null}
                <span>
                  {word("payoutIfRight")} <b>{usd(sizing.payoutIfRightUsd)}</b>
                </span>
                <span>
                  {word("maxLoss")} <b>{usd(sizing.maxLossUsd)}</b>
                </span>
                {rules.resolutionDeadline ? (
                  <span>
                    {word("deadline")} <b>{dateShort(rules.resolutionDeadline, locale)}</b>
                  </span>
                ) : null}
                <span>v{plan.version}</span>
              </span>
              <span style={{ fontSize: "var(--ry-fs-label)", color: "var(--ry-text-muted)" }}>{rules.thesis}</span>
              {plan.status === "draft" || plan.status === "active" ? (
                <span className={styles.actions}>
                  {plan.status === "draft" ? (
                    <button type="button" className="rw-btn rw-btn--primary" disabled={busy === plan.id} onClick={() => void setStatus(plan, "active")}>
                      {locale === "uk" ? "Активувати" : "Activate"}
                    </button>
                  ) : null}
                  <button type="button" className="rw-btn" disabled={busy === plan.id} onClick={() => void setStatus(plan, "cancelled")}>
                    {word("cancel")}
                  </button>
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
