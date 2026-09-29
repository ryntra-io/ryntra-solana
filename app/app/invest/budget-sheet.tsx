"use client";

import { X } from "@phosphor-icons/react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import company from "@/app/app/stocks/[ticker]/company.module.css";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { useWalletProof } from "@/app/solana/workspace/wallet-proof";
import type { RuleBudget } from "@/lib/api/v1/contract";
import { BUDGET_PRESETS_USD } from "@/lib/autoinvest/limits";
import { usdWord } from "@/lib/autoinvest/words";

import { browserTimeZone, budgetOfInput, monthUse } from "./autoinvest-model";
import { dollars, parseDollars } from "./company-model";
import { investWords, numberLocale } from "./invest-words";
import type { BudgetWrite } from "./use-rules";

/**
 * «Бюджет місяця» — the person's own ceiling for every rule in a calendar
 * month (canon v5.1 §4.1, В19; `RYN-INVEST-SIMPLE-001`, session 4), a sheet
 * like the purchase's: from the bottom of a phone, in the middle of a wide
 * screen. A sum in dollars under «Не більше на місяць» — typed, or $50 ·
 * $100 · $200 · $500 — what the month has taken so far, one line on what the
 * ceiling does, «Зберегти»; and «Прибрати бюджет» when there is one. It opens
 * from the budget's own line on Home, in Portfolio and in a rule's sheet
 * (canon v5.3 В29). Only the person sets it; saving asks
 * the wallet's proof — a signed message, never a transaction — when the page
 * has none.
 */

type Props = Readonly<{
  open: boolean;
  budget: RuleBudget | null;
  locale: WorkspaceLocale;
  onClose: () => void;
  onSave: (request: Readonly<{ capUsd: number; timeZone: string; locale: "en" | "uk" }>) => Promise<BudgetWrite>;
  onClear: () => Promise<BudgetWrite>;
}>;

export function BudgetSheet(props: Props) {
  const { open, onClose } = props;
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  useEffect(() => {
    /* The page does not scroll under an open sheet. */
    if (!open) return undefined;
    const root = document.documentElement;
    const before = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = before;
    };
  }, [open]);

  const requestClose = useCallback(() => {
    if (!busy) onClose();
  }, [busy, onClose]);

  return (
    <dialog
      ref={dialog}
      className={company.sheet}
      aria-labelledby={titleId}
      data-sheet-kind="budget"
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      onClose={() => {
        if (open) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      {open ? <BudgetFlow {...props} titleId={titleId} onBusy={setBusy} onClose={requestClose} /> : null}
    </dialog>
  );
}

function BudgetFlow({ budget, locale, titleId, onBusy, onClose, onSave, onClear }: Props & { titleId: string; onBusy: (busy: boolean) => void }) {
  const word = investWords(locale);
  const numbers = numberLocale(locale);
  const lang = locale === "uk" ? "uk" : "en";
  const proof = useWalletProof();
  const [text, setText] = useState(() => String(budget?.capUsd ?? BUDGET_PRESETS_USD[1]));
  const [step, setStep] = useState<"idle" | "proving" | "saving" | "clearing">("idle");
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    onBusy(step !== "idle");
  }, [step, onBusy]);
  useEffect(() => () => onBusy(false), [onBusy]);

  const cap = budgetOfInput(parseDollars(text, lang));
  const use = budget ? monthUse(budget) : null;

  const proven = async (): Promise<boolean> => {
    if (proof.state.status === "proven") return true;
    setStep("proving");
    const ok = await proof.prove();
    setStep("idle");
    if (ok !== true) setFailure(word("walletDeclined"));
    return ok === true;
  };

  const save = async () => {
    setFailure(null);
    if (cap === null || !(await proven())) return;
    setStep("saving");
    const result = await onSave({ capUsd: cap, timeZone: budget?.capUsd !== null && budget?.timeZone ? budget.timeZone : browserTimeZone(), locale: lang });
    setStep("idle");
    if (!result.ok) {
      setFailure(word("budgetFailed"));
      return;
    }
    onClose();
  };

  const clear = async () => {
    setFailure(null);
    if (!(await proven())) return;
    setStep("clearing");
    const result = await onClear();
    setStep("idle");
    if (!result.ok) {
      setFailure(word("budgetFailed"));
      return;
    }
    onClose();
  };

  return (
    <div className={company.sheetBody} data-sheet="budget">
      <div className={`${company.sheetHead} ${company.sheetHeadPlain}`}>
        <span className={company.grab} aria-hidden="true" />
        <h2 id={titleId} className={company.sheetTitle}>
          {word("monthBudget")}
        </h2>
        <button type="button" className={company.sheetClose} onClick={onClose} disabled={step !== "idle"} aria-label={word("close")}>
          <X size={18} weight="bold" aria-hidden="true" />
        </button>
      </div>

      {/* The budget's sum is the month's ceiling for all rules — never one purchase (canon v5.3 В29). */}
      <p className={company.amountLabel} aria-hidden="true">
        {word("atMostPerMonth")}
      </p>
      <label className={company.amount}>
        <span className={company.srOnly}>{word("atMostPerMonth")}</span>
        <span className={company.amountSign} aria-hidden="true">
          $
        </span>
        <input
          className={company.amountInput}
          value={text}
          onChange={(event) => setText(event.target.value)}
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          disabled={step !== "idle"}
          aria-describedby={`${titleId}-line`}
        />
      </label>
      <div className={company.presets} role="group" aria-label={word("quickAmounts")}>
        {BUDGET_PRESETS_USD.map((preset) => (
          <button key={preset} type="button" className={company.preset} aria-pressed={cap === preset} disabled={step !== "idle"} onClick={() => setText(String(preset))}>
            {dollars(preset, numbers)}
          </button>
        ))}
      </div>

      {use ? (
        <p className={company.estimate} translate="no">
          {budget?.capUsd !== null && budget?.capUsd !== undefined
            ? `${word("thisMonth")} ${usdWord(use.countedUsd, lang)} ${word("of")} ${usdWord(budget.capUsd, lang)}`
            : `${word("thisMonth")} ${usdWord(use.countedUsd, lang)} · ${word("noBudgetYet")}`}
        </p>
      ) : null}
      <p id={`${titleId}-line`} className={company.rulePromise}>
        {word("budgetLine")}
      </p>
      <p className={company.ruleNote}>{word("budgetCounts")}</p>
      {failure ? <p className={company.sheetError}>{failure}</p> : null}

      <div className={company.sheetActions}>
        <button type="button" className="rw-btn rw-btn--primary" disabled={cap === null || step !== "idle"} onClick={() => void save()}>
          {step === "proving" ? word("confirming") : step === "saving" ? word("saving") : word("save")}
        </button>
        {budget?.capUsd !== null && budget?.capUsd !== undefined ? (
          <button type="button" className={company.quietButton} disabled={step !== "idle"} onClick={() => void clear()}>
            {word("removeBudget")}
          </button>
        ) : null}
      </div>
    </div>
  );
}
