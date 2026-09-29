"use client";

import { X } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import { parseDecimalInput } from "@/lib/plans/decimal-input";
import type { PredictionEvent, PredictionMarket } from "@/lib/predictions/model";
import { computePredictionSizing, type PredictionMonitorCondition, type PredictionPlan } from "@/lib/predictions/plan-model";

import { pct, usd } from "../format";
import styles from "../predictions.module.css";
import { wordsFor } from "../words";

/**
 * The Prediction Plan in three steps (`RYN-PREDICTIONS-001` item 13): *Why*
 * (the thesis and the outcome), *Risk / Money* (the amount — the whole of it
 * at risk — the entry probability the market shows now, an optional bound
 * the Review refuses above), *Conditions* (the invalidation, the resolution
 * deadline, the monitoring conditions on the common system, the references
 * behind *More rules*). What the rules imply is computed the one way the
 * server computes it and shown before the plan is saved.
 */

type Step = 0 | 1 | 2;
type ApiFailure = { error?: { code?: string; message?: string; issues?: { path: string; message: string }[] } };

const METRICS = ["probability", "volume24h", "resolution", "signal", "plan"] as const;

export function PlanBuilder({
  event,
  market,
  outcomeId,
  locale,
  onClose,
  onSaved,
}: {
  event: PredictionEvent;
  market: PredictionMarket;
  outcomeId: string;
  locale: WorkspaceLocale;
  onClose: () => void;
  onSaved: (plan: PredictionPlan) => void;
}) {
  const word = wordsFor(locale);
  const outcome = market.outcomes.find((o) => o.id === outcomeId) ?? market.outcomes[0];
  const [step, setStep] = useState<Step>(0);
  const [thesis, setThesis] = useState("");
  const [whyNow, setWhyNow] = useState("");
  const [chosenOutcome, setChosenOutcome] = useState(outcome?.id ?? "");
  const [amount, setAmount] = useState("10");
  const [entry, setEntry] = useState(outcome?.probability != null ? (outcome.probability * 100).toFixed(1) : "");
  const [maxProb, setMaxProb] = useState("");
  const [invalidation, setInvalidation] = useState("");
  const [invalidationBelow, setInvalidationBelow] = useState("");
  const [deadline, setDeadline] = useState(event.endDate ? event.endDate.slice(0, 10) : "");
  const [monitoring, setMonitoring] = useState<PredictionMonitorCondition[]>([{ metric: "probability", direction: "above", threshold: null, note: null }]);
  const [references, setReferences] = useState("");
  const [assumptions, setAssumptions] = useState("");
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<readonly { path: string; message: string }[]>([]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const selected = market.outcomes.find((o) => o.id === chosenOutcome) ?? outcome;
  const amountUsd = parseDecimalInput(amount);
  const entryProbability = fromPercent(entry);
  const maxProbability = fromPercent(maxProb);
  const invalidationProbability = fromPercent(invalidationBelow);
  const sizing = useMemo(() => (amountUsd && entryProbability ? computePredictionSizing({ amountUsd, entryProbability }) : null), [amountUsd, entryProbability]);

  const rules = () => ({
    thesis: thesis.trim(),
    whyNow: whyNow.trim() || null,
    eventId: event.id,
    eventTitle: event.title,
    venueMarketId: market.id,
    question: market.question,
    outcomeId: selected?.id ?? "",
    outcomeLabel: selected?.label ?? "",
    amountUsd: amountUsd ?? 0,
    entryProbability: entryProbability ?? 0,
    maxProbability,
    invalidation: { text: invalidation.trim(), probabilityBelow: invalidationProbability },
    resolutionDeadline: deadline ? new Date(`${deadline}T23:59:59.000Z`).toISOString() : null,
    monitoring: monitoring.filter((c) => c.metric === "signal" || c.metric === "plan" || c.threshold !== null).map((c) => ({ ...c, threshold: c.metric === "probability" && c.threshold !== null ? c.threshold / 100 : c.threshold })),
    references: references.split(/\s+/).map((s) => s.trim()).filter((s) => /^https?:\/\//.test(s)).slice(0, 10),
    assumptions: assumptions.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 10),
  });

  const save = async (activate: boolean) => {
    setBusy(true);
    setError(null);
    setIssues([]);
    try {
      const response = await fetch("/api/predictions/plans", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ rules: rules(), activate }),
      });
      const body = (await response.json()) as { plan: PredictionPlan } & ApiFailure;
      if (!response.ok) {
        setError(body.error?.message ?? word("unavailable"));
        setIssues(body.error?.issues ?? []);
        if (body.error?.issues?.some((i) => /thesis|outcome/.test(i.path))) setStep(0);
        else if (body.error?.issues?.some((i) => /amount|entry|maxProbability/.test(i.path))) setStep(1);
        else if (body.error?.issues?.length) setStep(2);
        return;
      }
      onSaved(body.plan);
    } catch {
      setError(word("unavailable"));
    } finally {
      setBusy(false);
    }
  };

  const issueFor = (path: string) => issues.find((i) => i.path === path || i.path.startsWith(`${path}.`))?.message ?? null;
  const stepOk = [thesis.trim().length > 0 && Boolean(selected), amountUsd != null && amountUsd > 0 && entryProbability != null, invalidation.trim().length > 0] as const;

  return (
    <div className={styles.overlay} role="presentation" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={styles.sheet} role="dialog" aria-modal="true" aria-labelledby="pred-plan-title">
        <div className={styles.sheetHead}>
          <h2 id="pred-plan-title">{word("planTitle")}</h2>
          <button type="button" className={styles.iconButton} aria-label={word("close")} onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <ol className={styles.steps} aria-label={word("planTitle")}>
          {([word("planWhy"), word("planMoney"), word("planConditions")] as const).map((label, index) => (
            <li key={label}>
              <button type="button" className={styles.step} aria-current={step === index ? "step" : undefined} onClick={() => setStep(index as Step)}>
                <i>{index + 1}</i>
                {label}
              </button>
            </li>
          ))}
        </ol>
        <div className={styles.cardBody}>
          <p className={styles.muted}>{market.question}</p>
          {step === 0 ? (
            <>
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor="plan-thesis">
                  {word("thesis")}
                </label>
                <textarea id="plan-thesis" className={styles.textarea} value={thesis} placeholder={word("thesisPlaceholder")} aria-invalid={Boolean(issueFor("thesis"))} onChange={(e) => setThesis(e.target.value)} maxLength={2000} />
                {issueFor("thesis") ? <p className={styles.error}>{issueFor("thesis")}</p> : null}
              </div>
              <div className={styles.field}>
                <span className={styles.fieldLabel}>{word("outcome")}</span>
                <div className={styles.outcomeButtons} role="group" aria-label={word("outcome")}>
                  {market.outcomes.map((o) => (
                    <button key={o.id} type="button" className={styles.outcomeButton} aria-pressed={o.id === selected?.id} onClick={() => { setChosenOutcome(o.id); if (o.probability != null) setEntry((o.probability * 100).toFixed(1)); }}>
                      <span>{o.label}</span>
                      <b>{pct(o.probability)}</b>
                    </button>
                  ))}
                </div>
              </div>
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor="plan-whynow">
                  {word("whyNow")}
                </label>
                <input id="plan-whynow" className={styles.input} style={{ fontFamily: "var(--ry-font-sans)" }} value={whyNow} onChange={(e) => setWhyNow(e.target.value)} maxLength={500} />
              </div>
            </>
          ) : null}
          {step === 1 ? (
            <>
              <div className={styles.formGrid}>
                <div className={styles.field}>
                  <label className={styles.fieldLabel} htmlFor="plan-amount">
                    {word("amountUsd")}
                  </label>
                  <input id="plan-amount" className={styles.input} inputMode="decimal" value={amount} aria-invalid={Boolean(issueFor("amountUsd"))} onChange={(e) => setAmount(e.target.value)} />
                  <p className={styles.hint}>{word("maxLossNote")}</p>
                </div>
                <div className={styles.field}>
                  <label className={styles.fieldLabel} htmlFor="plan-entry">
                    {word("entryProbability")} %
                  </label>
                  <input id="plan-entry" className={styles.input} inputMode="decimal" value={entry} aria-invalid={Boolean(issueFor("entryProbability"))} onChange={(e) => setEntry(e.target.value)} />
                  <p className={styles.hint}>{word("entryProbabilityNote")}</p>
                </div>
                <div className={styles.field}>
                  <label className={styles.fieldLabel} htmlFor="plan-max">
                    {word("maxProbability")} %
                  </label>
                  <input id="plan-max" className={styles.input} inputMode="decimal" value={maxProb} placeholder="—" aria-invalid={Boolean(issueFor("maxProbability"))} onChange={(e) => setMaxProb(e.target.value)} />
                  <p className={styles.hint}>{word("maxProbabilityNote")}</p>
                  {issueFor("maxProbability") ? <p className={styles.error}>{issueFor("maxProbability")}</p> : null}
                </div>
              </div>
              {sizing ? (
                <div>
                  <h3 className={styles.sectionTitle}>{word("sizing")}</h3>
                  <dl className={styles.kv}>
                    <dt>{word("sharesAtEntry")}</dt>
                    <dd>{sizing.sharesAtEntry.toFixed(2)}</dd>
                    <dt>{word("maxLoss")}</dt>
                    <dd data-tone="neg">{usd(sizing.maxLossUsd)}</dd>
                    <dt>{word("payoutIfRight")}</dt>
                    <dd data-tone="pos">{usd(sizing.payoutIfRightUsd)}</dd>
                    <dt>{word("returnIfRight")}</dt>
                    <dd>{sizing.returnIfRightPct.toFixed(0)}%</dd>
                    <dt>{word("breakEven")}</dt>
                    <dd>{pct(sizing.breakEvenProbability, 1)}</dd>
                  </dl>
                </div>
              ) : null}
            </>
          ) : null}
          {step === 2 ? (
            <>
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor="plan-inv">
                  {word("invalidation")}
                </label>
                <textarea id="plan-inv" className={styles.textarea} value={invalidation} placeholder={word("invalidationPlaceholder")} aria-invalid={Boolean(issueFor("invalidation"))} onChange={(e) => setInvalidation(e.target.value)} maxLength={500} />
                {issueFor("invalidation") ? <p className={styles.error}>{issueFor("invalidation")}</p> : null}
              </div>
              <div className={styles.formGrid}>
                <div className={styles.field}>
                  <label className={styles.fieldLabel} htmlFor="plan-inv-p">
                    {word("invalidationProbability")} %
                  </label>
                  <input id="plan-inv-p" className={styles.input} inputMode="decimal" value={invalidationBelow} placeholder="—" onChange={(e) => setInvalidationBelow(e.target.value)} />
                </div>
                <div className={styles.field}>
                  <label className={styles.fieldLabel} htmlFor="plan-deadline">
                    {word("deadline")}
                  </label>
                  <input id="plan-deadline" className={styles.input} type="date" value={deadline} aria-invalid={Boolean(issueFor("resolutionDeadline"))} onChange={(e) => setDeadline(e.target.value)} />
                  {issueFor("resolutionDeadline") ? <p className={styles.error}>{issueFor("resolutionDeadline")}</p> : null}
                </div>
              </div>
              <div className={styles.field}>
                <span className={styles.fieldLabel}>{word("monitoring")}</span>
                <p className={styles.hint}>{word("monitoringNote")}</p>
                {monitoring.map((c, index) => (
                  <div key={index} className={styles.conditionRow}>
                    <select className={styles.selectInput} value={c.metric} aria-label={word("monitoring")} onChange={(e) => setMonitoring(monitoring.map((m, i) => (i === index ? { ...m, metric: e.target.value as PredictionMonitorCondition["metric"], direction: e.target.value === "probability" ? "above" : "any" } : m)))}>
                      {METRICS.map((m) => (
                        <option key={m} value={m}>
                          {metricWord(m, locale)}
                        </option>
                      ))}
                    </select>
                    {c.metric === "probability" ? (
                      <select className={styles.selectInput} value={c.direction} aria-label={word("probability")} onChange={(e) => setMonitoring(monitoring.map((m, i) => (i === index ? { ...m, direction: e.target.value as PredictionMonitorCondition["direction"] } : m)))}>
                        <option value="above">{locale === "uk" ? "вище" : "above"}</option>
                        <option value="below">{locale === "uk" ? "нижче" : "below"}</option>
                      </select>
                    ) : (
                      <span />
                    )}
                    {c.metric === "probability" || c.metric === "volume24h" || c.metric === "resolution" ? (
                      <input className={styles.input} inputMode="decimal" placeholder={c.metric === "probability" ? "%" : c.metric === "volume24h" ? "%" : "h"} value={c.threshold ?? ""} aria-label={metricWord(c.metric, locale)} onChange={(e) => setMonitoring(monitoring.map((m, i) => (i === index ? { ...m, threshold: parseDecimalInput(e.target.value) } : m)))} />
                    ) : (
                      <span />
                    )}
                    <button type="button" className="rw-btn" onClick={() => setMonitoring(monitoring.filter((_, i) => i !== index))}>
                      ×
                    </button>
                  </div>
                ))}
                {monitoring.length < 8 ? (
                  <button type="button" className={styles.chip} onClick={() => setMonitoring([...monitoring, { metric: "resolution", direction: "any", threshold: 24, note: null }])}>
                    + {word("monitoring")}
                  </button>
                ) : null}
              </div>
              <details className={styles.disclosure} open={more} onToggle={(e) => setMore((e.target as HTMLDetailsElement).open)}>
                <summary>{word("moreRules")}</summary>
                <div className={styles.disclosureBody}>
                  <div className={styles.field}>
                    <label className={styles.fieldLabel} htmlFor="plan-refs">
                      {word("references")}
                    </label>
                    <textarea id="plan-refs" className={styles.textarea} value={references} placeholder="https://…" onChange={(e) => setReferences(e.target.value)} />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.fieldLabel} htmlFor="plan-assumptions">
                      {word("assumptions")}
                    </label>
                    <textarea id="plan-assumptions" className={styles.textarea} value={assumptions} onChange={(e) => setAssumptions(e.target.value)} />
                  </div>
                </div>
              </details>
            </>
          ) : null}
          {error ? <p className={styles.error}>{error}</p> : null}
          <div className={styles.formActions}>
            <button type="button" className="rw-btn" disabled={step === 0} onClick={() => setStep((step - 1) as Step)}>
              {word("back")}
            </button>
            {step < 2 ? (
              <button type="button" className="rw-btn rw-btn--primary" disabled={!stepOk[step]} onClick={() => setStep((step + 1) as Step)}>
                {word("next")}
              </button>
            ) : (
              <span className={styles.actions}>
                <button type="button" className="rw-btn" disabled={busy || !stepOk.every(Boolean)} onClick={() => void save(false)}>
                  {word("savePlan")}
                </button>
                <button type="button" className="rw-btn rw-btn--primary" disabled={busy || !stepOk.every(Boolean)} onClick={() => void save(true)}>
                  {word("saveAndActivate")}
                </button>
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function fromPercent(text: string): number | null {
  const value = parseDecimalInput(text);
  if (value == null) return null;
  const p = value / 100;
  return p > 0 && p < 1 ? Math.round(p * 1e4) / 1e4 : null;
}

export function metricWord(metric: PredictionMonitorCondition["metric"], locale: WorkspaceLocale): string {
  const en: Record<PredictionMonitorCondition["metric"], string> = { probability: "Probability crosses", volume24h: "24h volume moves by", resolution: "Hours before resolution", signal: "Generated signals change", plan: "A plan condition no longer holds" };
  const uk: Record<PredictionMonitorCondition["metric"], string> = { probability: "Імовірність перетинає", volume24h: "Обсяг за 24 год змінюється на", resolution: "Годин до резолюції", signal: "Змінюються згенеровані сигнали", plan: "Умова плану більше не виконується" };
  return (locale === "uk" ? uk : en)[metric];
}
