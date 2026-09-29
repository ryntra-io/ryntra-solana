"use client";

import type { WorkspaceLocale } from "@/app/shell/locale";
import type { RuleBudget } from "@/lib/api/v1/contract";
import { usdWord } from "@/lib/autoinvest/words";

import { budgetView } from "./autoinvest-model";
import styles from "./autoinvest.module.css";
import { investWords } from "./invest-words";

/**
 * The month's budget as its own line (canon v5.3 В29; `RYN-NAV-V5-001`,
 * session 2) — in the «Автоінвест» block on Home and in Portfolio, and in a
 * rule's sheet: «Бюджет не задано · Задати», or «Бюджет місяця $10 з $50 ·
 * Змінити» over the month's bar; spent — «Бюджет вичерпано · Правила стоять
 * до 1-го числа». One press opens the budget's own sheet, where the sum reads
 * «Не більше на місяць». A rule's sum never stands in this line: it is each
 * purchase, the budget is the month's ceiling for all rules.
 */
export function BudgetRow({ budget, locale, variant, onEdit }: Readonly<{ budget: RuleBudget | null; locale: WorkspaceLocale; variant: "block" | "sheet"; onEdit: () => void }>) {
  const word = investWords(locale);
  const lang = locale === "uk" ? "uk" : "en";
  const view = budgetView(budget);
  if (!view) return null;

  if (view.kind === "unset") {
    return (
      <div className={styles.budget} data-variant={variant} data-state="unset" data-budget-row>
        <div className={styles.budgetHead}>
          <p className={styles.budgetLine}>{word("budgetNotSet")}</p>
          <button type="button" className={styles.textButton} aria-label={word("setBudget")} onClick={onEdit}>
            {word("setShort")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.budget} data-variant={variant} data-state={view.exhausted ? "spent" : "capped"} data-budget-row>
      <div className={styles.budgetHead}>
        <p className={styles.budgetLine} translate="no">
          <span>{word("monthBudget")}</span> <b>{`${usdWord(view.countedUsd, lang)} ${word("of")} ${usdWord(view.capUsd, lang)}`}</b>
        </p>
        <button type="button" className={styles.textButton} aria-label={word("changeBudget")} onClick={onEdit}>
          {word("changeShort")}
        </button>
      </div>
      <div className={styles.bar} role="progressbar" aria-label={word("monthBudget")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={view.percent}>
        <span style={{ width: `${view.percent}%` }} />
      </div>
      {view.exhausted ? <p className={styles.budgetHeld}>{`${word("budgetSpent")} · ${word("rulesStand")}`}</p> : null}
    </div>
  );
}
