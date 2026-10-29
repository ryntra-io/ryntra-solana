"use client";

import { Button } from "@ryntra/core/ui";
import { useState, type ReactNode } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import type { AllowanceBuildRequest, AllowanceRow } from "@/lib/solana/allowances/contract";
import { PERIOD_IDS, TERMS_S, USDC, formatRaw, isAddress, limitIssues, parseAmount, type PeriodId } from "@/lib/solana/allowances/model";

import { lang, money } from "./allowances-flow";
import { allowanceWords, issueWord } from "./allowances-words";
import styles from "./allowances.module.css";

function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: string; error?: string | null; children: ReactNode; htmlFor: string }) {
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? <p className={styles.fieldError}>{error}</p> : hint ? <p className={styles.hint}>{hint}</p> : null}
    </div>
  );
}

function FormActions({ locale, onCancel, busy, disabled }: { locale: WorkspaceLocale; onCancel: () => void; busy: boolean; disabled?: boolean }) {
  const word = allowanceWords(locale);
  return (
    <div className={styles.formActions}>
      <Button variant="ghost" type="button" onClick={onCancel} lang={lang(locale)}>
        {word("cancel")}
      </Button>
      <Button variant="primary" type="submit" loading={busy} disabled={disabled} lang={lang(locale)}>
        {word("review")}
      </Button>
    </div>
  );
}

/**
 * A fixed or a recurring limit: who may take, how much, how often and until when. The terms are a short list — every
 * limit built here ends; what a person types is checked by the same rules the server checks again.
 */
export function LimitForm({ kind, wallet, locale, busy, onSubmit, onCancel }: { kind: "fixed" | "recurring"; wallet: string; locale: WorkspaceLocale; busy: boolean; onSubmit: (request: AllowanceBuildRequest) => void; onCancel: () => void }) {
  const word = allowanceWords(locale);
  const terms = TERMS_S[kind];
  const [delegatee, setDelegatee] = useState("");
  const [amount, setAmount] = useState("");
  const [period, setPeriod] = useState<PeriodId>("month");
  const [term, setTerm] = useState<number>(kind === "fixed" ? terms[1] : terms[0]);
  const [touched, setTouched] = useState(false);
  const amountRaw = parseAmount(amount, USDC.decimals);
  const issues = limitIssues({ kind, wallet, delegatee: delegatee.trim(), amountRaw, termSeconds: term, period: kind === "recurring" ? period : null });
  const issueOf = (...codes: string[]) => {
    const found = touched ? issues.find((issue) => codes.includes(issue.code)) : undefined;
    return found ? issueWord(locale, found.code) : null;
  };
  const id = `limit-${kind}`;
  return (
    <form
      className={styles.form}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setTouched(true);
        if (issues.length || amountRaw === null) return;
        onSubmit(
          kind === "fixed"
            ? { kind, wallet, delegatee: delegatee.trim(), amountRaw: amountRaw.toString(), termSeconds: term }
            : { kind, wallet, delegatee: delegatee.trim(), amountRaw: amountRaw.toString(), period, termSeconds: term },
        );
      }}
    >
      <p className={styles.hint}>{kind === "fixed" ? word("fixedLine") : word("recurringLine")}</p>
      <Field label={word("delegatee")} htmlFor={`${id}-who`} hint={word("delegateeHint")} error={issueOf("DELEGATEE_ADDRESS", "DELEGATEE_IS_SELF")}>
        <input id={`${id}-who`} className={`${styles.input} ${styles.mono}`} value={delegatee} onChange={(event) => setDelegatee(event.target.value)} spellCheck={false} autoComplete="off" />
      </Field>
      <div className={styles.grid3}>
        <Field label={kind === "fixed" ? word("amount") : word("perPeriod")} htmlFor={`${id}-amount`} error={issueOf("AMOUNT")}>
          <input id={`${id}-amount`} className={styles.input} inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0" autoComplete="off" />
        </Field>
        {kind === "recurring" ? (
          <Field label={word("period")} htmlFor={`${id}-period`} error={issueOf("PERIOD", "PERIOD_LONGER_THAN_TERM")}>
            <select id={`${id}-period`} className={styles.input} value={period} onChange={(event) => setPeriod(event.target.value as PeriodId)}>
              {PERIOD_IDS.map((choice) => (
                <option key={choice} value={choice}>
                  {word(`period_${choice}`)}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        <Field label={word("term")} htmlFor={`${id}-term`} error={issueOf("TERM_RANGE")}>
          <select id={`${id}-term`} className={styles.input} value={term} onChange={(event) => setTerm(Number(event.target.value))}>
            {terms.map((seconds) => (
              <option key={seconds} value={seconds}>
                {word("term_d", { n: seconds / 86_400 })}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <FormActions locale={locale} onCancel={onCancel} busy={busy} />
    </form>
  );
}

/** A merchant's plan by its address; its terms come from the chain into the Review, not from what the page is told. */
export function SubscribeForm({ wallet, locale, busy, onSubmit, onCancel }: { wallet: string; locale: WorkspaceLocale; busy: boolean; onSubmit: (request: AllowanceBuildRequest) => void; onCancel: () => void }) {
  const word = allowanceWords(locale);
  const [plan, setPlan] = useState("");
  const [touched, setTouched] = useState(false);
  const valid = isAddress(plan.trim());
  return (
    <form
      className={styles.form}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setTouched(true);
        if (valid) onSubmit({ kind: "subscribe", wallet, plan: plan.trim() });
      }}
    >
      <p className={styles.hint}>{word("subscribeLine")}</p>
      <Field label={word("planAddress")} htmlFor="subscribe-plan" error={touched && !valid ? issueWord(locale, "PLAN_ADDRESS") : null}>
        <input id="subscribe-plan" className={`${styles.input} ${styles.mono}`} value={plan} onChange={(event) => setPlan(event.target.value)} spellCheck={false} autoComplete="off" />
      </Field>
      <FormActions locale={locale} onCancel={onCancel} busy={busy} />
    </form>
  );
}

/** The delegatee's side: take from a USDC limit given to this wallet, to this wallet by default. */
export function SpendForm({ wallet, row, locale, busy, onSubmit, onCancel }: { wallet: string; row: AllowanceRow; locale: WorkspaceLocale; busy: boolean; onSubmit: (request: AllowanceBuildRequest) => void; onCancel: () => void }) {
  const word = allowanceWords(locale);
  const [amount, setAmount] = useState("");
  const [to, setTo] = useState(wallet);
  const [touched, setTouched] = useState(false);
  const amountRaw = parseAmount(amount, USDC.decimals);
  const available = row.availableRaw ? BigInt(row.availableRaw) : 0n;
  const amountOk = amountRaw !== null && amountRaw > 0n;
  const toOk = isAddress(to.trim());
  const id = `spend-${row.address}`;
  return (
    <form
      className={styles.form}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setTouched(true);
        if (amountOk && toOk && amountRaw !== null) onSubmit({ kind: "spend", wallet, delegation: row.address, amountRaw: amountRaw.toString(), to: to.trim() });
      }}
    >
      <div className={styles.grid2}>
        <Field label={word("amount")} htmlFor={`${id}-amount`} hint={`${word("available")}: ${money(available, locale)}`} error={touched && !amountOk ? issueWord(locale, "AMOUNT") : null}>
          <div className={styles.amountRow}>
            <input id={`${id}-amount`} className={styles.input} inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0" autoComplete="off" />
            <button type="button" className={styles.linkButton} onClick={() => setAmount(formatRaw(available, USDC.decimals))}>
              Max
            </button>
          </div>
        </Field>
        <Field label={word("to")} htmlFor={`${id}-to`} hint={word("toHint")} error={touched && !toOk ? issueWord(locale, "RECIPIENT_ADDRESS") : null}>
          <input id={`${id}-to`} className={`${styles.input} ${styles.mono}`} value={to} onChange={(event) => setTo(event.target.value)} spellCheck={false} autoComplete="off" />
        </Field>
      </div>
      <FormActions locale={locale} onCancel={onCancel} busy={busy} />
    </form>
  );
}
