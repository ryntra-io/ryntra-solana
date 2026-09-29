"use client";

import { useMemo, useState } from "react";
import { ClockCounterClockwise, FloppyDisk } from "@phosphor-icons/react";

import {
  INVESTOR_CONTEXT_CURRENCIES,
  INVESTOR_CONTEXT_EXCLUSIONS,
  INVESTOR_CONTEXT_GOALS,
  INVESTOR_CONTEXT_HORIZONS,
  INVESTOR_CONTEXT_LEVELS,
  createInvestorContextVersion,
  missingInvestorContextFields,
  type InvestorContextDraft,
  type InvestorContextVersion,
} from "@/lib/home/investor-context";

import type { ConnectionCenterCopy } from "./copy";
import styles from "./connection-center.module.css";

function initialDraft(history: readonly InvestorContextVersion[]): InvestorContextDraft {
  const current = history.at(-1);
  return current
    ? {
        displayCurrency: current.displayCurrency,
        horizon: current.horizon,
        liquidityNeed: current.liquidityNeed,
        lossCapacity: current.lossCapacity,
        riskTolerance: current.riskTolerance,
        goals: [...current.goals],
        excludedActivities: [...current.excludedActivities],
        notes: current.notes,
      }
    : {
        displayCurrency: "UNDECLARED",
        horizon: "UNDECLARED",
        liquidityNeed: "UNDECLARED",
        lossCapacity: "UNDECLARED",
        riskTolerance: "UNDECLARED",
        goals: ["UNDECLARED"],
        excludedActivities: [],
        notes: "",
      };
}

type SaveState = "IDLE" | "SAVED" | "UNCHANGED" | "INVALID" | "LIMIT" | "UNAVAILABLE";

export function InvestorContextForm({
  history,
  copy,
  onCommit,
}: {
  history: readonly InvestorContextVersion[];
  copy: ConnectionCenterCopy["twin"];
  onCommit: (history: readonly InvestorContextVersion[]) => boolean;
}) {
  const [draft, setDraft] = useState<InvestorContextDraft>(() => initialDraft(history));
  const [saveState, setSaveState] = useState<SaveState>("IDLE");
  const current = history.at(-1) ?? null;
  const missing = current ? missingInvestorContextFields(current) : [];
  const contextState = !current ? copy.statusMissing : missing.length ? copy.statusPartial : copy.statusComplete;

  const goalOptions = useMemo(
    () => INVESTOR_CONTEXT_GOALS.filter((goal) => goal !== "UNDECLARED"),
    [],
  );

  function setField<K extends keyof InvestorContextDraft>(field: K, value: InvestorContextDraft[K]) {
    setSaveState("IDLE");
    setDraft((previous) => ({ ...previous, [field]: value }));
  }

  function toggleGoal(goal: Exclude<(typeof INVESTOR_CONTEXT_GOALS)[number], "UNDECLARED">) {
    const selected = draft.goals.includes(goal);
    const goals = selected
      ? draft.goals.filter((item) => item !== goal && item !== "UNDECLARED")
      : [...draft.goals.filter((item) => item !== "UNDECLARED"), goal];
    setField("goals", goals.length ? goals : ["UNDECLARED"]);
  }

  function toggleExclusion(exclusion: (typeof INVESTOR_CONTEXT_EXCLUSIONS)[number]) {
    const selected = draft.excludedActivities.includes(exclusion);
    setField(
      "excludedActivities",
      selected
        ? draft.excludedActivities.filter((item) => item !== exclusion)
        : [...draft.excludedActivities, exclusion],
    );
  }

  function save() {
    const result = createInvestorContextVersion(history, draft, {
      id: `ictx_${crypto.randomUUID()}`,
      now: new Date().toISOString(),
    });
    if (!result.ok) {
      setSaveState(
        result.error === "UNCHANGED_CONTEXT"
          ? "UNCHANGED"
          : result.error === "CONTEXT_VERSION_LIMIT_REACHED"
            ? "LIMIT"
            : "INVALID",
      );
      return;
    }
    if (!onCommit(result.history)) {
      setSaveState("UNAVAILABLE");
      return;
    }
    setSaveState("SAVED");
  }

  return (
    <div className={styles.contextWorkspace}>
      <div className={styles.contextStatus}>
        <div>
          <p className={styles.contextState}>{contextState}</p>
          <p className={styles.contextMeta}>
            {current ? `${copy.version} ${current.version} · ${copy.declaredBy}` : copy.noHistory}
          </p>
        </div>
        <div className={styles.missingBlock}>
          <span>{copy.missing}</span>
          <strong>{missing.length ? missing.map((field) => copy.fields[field]).join(" · ") : copy.noMissing}</strong>
        </div>
      </div>

      <form
        className={styles.contextForm}
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <h3>{copy.formTitle}</h3>
        <div className={styles.fieldGrid}>
          <label>
            <span>{copy.fields.displayCurrency}</span>
            <select
              value={draft.displayCurrency}
              onChange={(event) => setField("displayCurrency", event.target.value as InvestorContextDraft["displayCurrency"])}
            >
              {INVESTOR_CONTEXT_CURRENCIES.map((value) => <option key={value} value={value}>{copy.options[value]}</option>)}
            </select>
          </label>
          <label>
            <span>{copy.fields.horizon}</span>
            <select
              value={draft.horizon}
              onChange={(event) => setField("horizon", event.target.value as InvestorContextDraft["horizon"])}
            >
              {INVESTOR_CONTEXT_HORIZONS.map((value) => <option key={value} value={value}>{copy.options[value]}</option>)}
            </select>
          </label>
          {(["liquidityNeed", "lossCapacity", "riskTolerance"] as const).map((field) => (
            <label key={field}>
              <span>{copy.fields[field]}</span>
              <select
                value={draft[field]}
                onChange={(event) => setField(field, event.target.value as InvestorContextDraft[typeof field])}
              >
                {INVESTOR_CONTEXT_LEVELS.map((value) => <option key={value} value={value}>{copy.options[value]}</option>)}
              </select>
            </label>
          ))}
        </div>

        <fieldset className={styles.choiceGroup}>
          <legend>{copy.fields.goals}</legend>
          {goalOptions.map((goal) => (
            <label key={goal}>
              <input type="checkbox" checked={draft.goals.includes(goal)} onChange={() => toggleGoal(goal)} />
              <span>{copy.options[goal]}</span>
            </label>
          ))}
        </fieldset>

        <fieldset className={styles.choiceGroup}>
          <legend>{copy.fields.excludedActivities}</legend>
          {INVESTOR_CONTEXT_EXCLUSIONS.map((exclusion) => (
            <label key={exclusion}>
              <input
                type="checkbox"
                checked={draft.excludedActivities.includes(exclusion)}
                onChange={() => toggleExclusion(exclusion)}
              />
              <span>{copy.options[exclusion]}</span>
            </label>
          ))}
        </fieldset>

        <label className={styles.notesField}>
          <span>{copy.fields.notes}</span>
          <textarea
            rows={4}
            maxLength={500}
            value={draft.notes}
            onChange={(event) => setField("notes", event.target.value)}
          />
          <small>{draft.notes.length}/500</small>
        </label>

        <p className={styles.disclaimer}>{copy.disclaimer}</p>
        <button type="submit" className="btn btn-primary btn-sm">
          <FloppyDisk size={16} weight="bold" aria-hidden />
          {copy.save}
        </button>
        {saveState !== "IDLE" ? (
          <p className={styles.formNotice} role="status">
            {saveState === "SAVED"
              ? copy.saved
              : saveState === "UNCHANGED"
                ? copy.unchanged
                : saveState === "LIMIT"
                  ? copy.limit
                  : saveState === "UNAVAILABLE"
                    ? copy.saveUnavailable
                    : copy.invalid}
          </p>
        ) : null}
      </form>

      <details className={styles.history}>
        <summary>
          <ClockCounterClockwise size={17} weight="bold" aria-hidden />
          {copy.history} · {history.length}
        </summary>
        {history.length ? (
          <ol>
            {[...history].reverse().map((version) => (
              <li key={version.id}>
                <strong>{copy.version} {version.version}</strong>
                <span>{version.declaredBy} · <time dateTime={version.createdAt}>{new Date(version.createdAt).toLocaleString()}</time></span>
              </li>
            ))}
          </ol>
        ) : <p>{copy.noHistory}</p>}
      </details>
    </div>
  );
}
