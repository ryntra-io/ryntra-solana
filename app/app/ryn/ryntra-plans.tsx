"use client";

import { NotePencil } from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useState } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import { usdText } from "@/lib/agent/provenance";
import type { AssistantPlan, AssistantPlanFinding, AssistantPlansResponse } from "@/lib/api/v1/contract";

import { tradePlanWordsFor, type TradePlanWord } from "./trade-plan-words";
import styles from "./trade-plan.module.css";

/**
 * The plans Ryntra composed with the person (AI-11), as «Плани» and «Боти» read them (AI-20). A small module of its
 * own: «Боти» lists them without carrying the composer and the plan's page in its bundle.
 */

const HEADERS = { "content-type": "application/json", "X-Ryntra-API": "1" } as const;
type W = (key: TradePlanWord) => string;
const fill = (text: string, values: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ""));

/**
 * The proven wallet's plans with Ryntra and what composing one costs, read once `active` turns true — a tab first
 * shown, a wallet proven — so a person who never looks costs no read. A new wallet is a new read: the caller keys the
 * component by its address.
 */
export function useAssistantPlans(active: boolean, locale: WorkspaceLocale): Readonly<{ read: AssistantPlansResponse | null; failed: boolean }> {
  const lang = locale === "uk" ? "uk" : "en";
  const [read, setRead] = useState<AssistantPlansResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!active || read !== null) return undefined;
    let live = true;
    void fetch(`/api/v1/assistant/plans?locale=${lang}`, { headers: HEADERS, credentials: "same-origin" })
      .then((response) => (response.ok ? (response.json() as Promise<AssistantPlansResponse>) : Promise.reject(new Error(String(response.status)))))
      .then((body) => live && setRead(body))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [active, read, lang]);

  return { read, failed };
}

/** A plan composed with Ryntra that is not yet the person's own: no Trading Plan behind it, so «Боти» has no card for it. */
export const waitsForWord = (plan: AssistantPlan): boolean => plan.tradingPlan === null && (plan.state === "draft" || plan.state === "checked");

/** A plan the person approved: their Trading Plan is a card in «Боти»; its critic and «План проти реальності» stay on Ryntra's page. */
export const approvedWithRyntra = (plan: AssistantPlan): boolean => plan.tradingPlan !== null && plan.state !== "cancelled";

/** The approved plans named on «Боти»'s one line: the first few, the rest counted. */
const APPROVED_SHOWN = 5;

export function StatePill({ state, w }: { state: AssistantPlan["state"]; w: W }) {
  return (
    <span className={styles.state} data-state={state}>
      {w(`state_${state}` as TradePlanWord)}
    </span>
  );
}

export function criticCounts(findings: readonly AssistantPlanFinding[], w: W): string {
  const count = (severity: AssistantPlanFinding["severity"]) => findings.filter((row) => row.severity === severity).length;
  return fill(w("criticCount"), { major: count("major"), minor: count("minor"), note: count("note") });
}

/**
 * AI-20 (UX-704): «Боти» is the one home of a trade plan. A plan the person approved is their own plan there already,
 * and one quiet line beside the plans opens its critic and «План проти реальності» on Ryntra's page; the ones Ryntra
 * composed that still wait for the person's word are rows above the person's own. Nothing is drawn when there are none,
 * or when they cannot be read — the plans' own block says the rest.
 */
export function RyntraPlansInBots({ locale, active }: { locale: WorkspaceLocale; active: boolean }) {
  const w = tradePlanWordsFor(locale);
  const { read } = useAssistantPlans(active, locale);
  const waiting = read ? read.plans.filter(waitsForWord) : [];
  const approved = read ? read.plans.filter(approvedWithRyntra) : [];
  if (waiting.length === 0 && approved.length === 0) return null;
  return (
    <section className={styles.group} aria-labelledby={waiting.length > 0 ? "bots-plans-ryntra" : undefined} aria-label={waiting.length > 0 ? undefined : w("withRyntra")} data-ryntra-plans="">
      {waiting.length > 0 ? (
        <>
          <h3 id="bots-plans-ryntra" className={styles.groupTitle}>
            {w("waitingTitle")}
          </h3>
          <ul className={styles.list} data-ryntra-plans-waiting="">
            {waiting.map((plan) => (
              <li key={plan.id}>
                <Link className={styles.row} href={`/app/ryn/plans/${plan.id}`} prefetch={false}>
                  <NotePencil size={16} aria-hidden="true" className={styles.rowIcon} />
                  <span className={styles.rowSymbol} translate="no">
                    {plan.symbol}
                  </span>
                  <StatePill state={plan.state} w={w} />
                  <span className={styles.rowMeta}>
                    {usdText(plan.current.body.entry.priceUsd, locale)} → {usdText(plan.current.body.targets[0]!.priceUsd, locale)} · {fill(w("version"), { n: plan.version })} · {criticCounts(plan.current.critic.findings, w)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {approved.length > 0 ? (
        <div className={styles.withRyntra} data-ryntra-plans-approved="">
          <span>{w("withRyntraLine")}</span>{" "}
          {approved.slice(0, APPROVED_SHOWN).map((plan, index) => (
            <span key={plan.id}>
              {index > 0 ? " · " : null}
              <ApprovedLink plan={plan} locale={locale} w={w} />
            </span>
          ))}
          {/* The rest one press away, each its own link — every approved plan keeps its way back to its critic. */}
          {approved.length > APPROVED_SHOWN ? (
            <details className={styles.withRyntraMore}>
              <summary>{fill(w("withRyntraMore"), { n: approved.length - APPROVED_SHOWN })}</summary>
              {approved.slice(APPROVED_SHOWN).map((plan, index) => (
                <span key={plan.id}>
                  {index > 0 ? " · " : null}
                  <ApprovedLink plan={plan} locale={locale} w={w} />
                </span>
              ))}
            </details>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** Two plans on one token differ by their entry; the version says which edition. */
function ApprovedLink({ plan, locale, w }: { plan: AssistantPlan; locale: WorkspaceLocale; w: W }) {
  return (
    <Link href={`/app/ryn/plans/${plan.id}`} prefetch={false} translate="no">
      {plan.symbol} {usdText(plan.current.body.entry.priceUsd, locale)} {fill(w("version"), { n: plan.version })}
    </Link>
  );
}
