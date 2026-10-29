"use client";

import { Hourglass } from "@phosphor-icons/react";
import { useId } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import type { LaunchPresetsResponse } from "@/lib/api/v1/contract";
import { EARLY_ACCESS_TOKEN, earlyAccessProblems, earlyAccessRuleLines, type EarlyAccessMode, type EarlyAccessRules } from "@/lib/core/launch/early-access";

import { toRaw } from "../launch-format";
import { launchWords, type LaunchWordKey } from "../launch-words";
import styles from "../launch.module.css";

/**
 * «Ранній доступ» in «Розширені параметри» (SOL-L5): a launch of its own kind — no curve — whose pool is made and locked
 * first and whose vault buys first. The fields make its rules; the lines are what a buyer will read before depositing.
 * Drawn only where the network offers it (the stand; on mainnet after the operator's bounds and word).
 */

export type EarlyDraft = Readonly<{ mode: EarlyAccessMode; startIn: string; minutes: string; cap: string; perWallet: string; vesting: string; startCap: string }>;
export const EARLY_DRAFT: EarlyDraft = { mode: "FCFS", startIn: "5", minutes: "60", cap: "1000", perWallet: "100", vesting: "24", startCap: "5000" };

const number = (text: string): number => {
  const clean = text.trim().replace(",", ".").replace(/\s/g, "");
  return /^\d+(\.\d+)?$/.test(clean) ? Number(clean) : Number.NaN;
};

/** The rules a draft makes from a moment, USDC amounts raw; null while a number does not read. */
export function earlyRulesOfDraft(draft: EarlyDraft, nowSeconds: number): EarlyAccessRules | null {
  const cap = toRaw(draft.cap, 6);
  const perWallet = draft.mode === "FCFS" ? toRaw(draft.perWallet, 6) : null;
  const startIn = number(draft.startIn);
  const minutes = number(draft.minutes);
  const vesting = number(draft.vesting);
  const startCap = number(draft.startCap);
  if (cap === null || (draft.mode === "FCFS" && perWallet === null) || ![startIn, minutes, vesting, startCap].every(Number.isFinite)) return null;
  const depositStartsAt = nowSeconds + Math.round(startIn * 60);
  return {
    mode: draft.mode,
    depositStartsAt,
    depositEndsAt: depositStartsAt + Math.round(minutes * 60),
    maxCapRaw: cap.toString(),
    individualCapRaw: perWallet === null ? null : perWallet.toString(),
    vestingHours: vesting,
    startMarketCapUsd: startCap,
    supply: EARLY_ACCESS_TOKEN.defaultSupply,
  };
}

/** What stands between the draft and a build; empty — it holds the network's bounds. */
export function earlyProblems(presets: LaunchPresetsResponse, draft: EarlyDraft): readonly string[] | null {
  const bounds = presets.formats?.earlyAccess?.bounds ?? null;
  if (!bounds) return null;
  const now = Math.floor(Date.now() / 1000);
  const rules = earlyRulesOfDraft(draft, now);
  return rules ? earlyAccessProblems(rules, bounds, now) : ["a number does not read"];
}

export function EarlyAccessFields({
  locale,
  presets,
  on,
  onOn,
  draft,
  onDraft,
}: {
  locale: WorkspaceLocale;
  presets: LaunchPresetsResponse;
  on: boolean;
  onOn: (on: boolean) => void;
  draft: EarlyDraft;
  onDraft: (draft: EarlyDraft) => void;
}) {
  const word = launchWords(locale);
  const bounds = presets.formats?.earlyAccess?.bounds ?? null;
  const set = (key: keyof EarlyDraft) => (value: string) => onDraft({ ...draft, [key]: value });
  const rules = on ? earlyRulesOfDraft(draft, Math.floor(Date.now() / 1000)) : null;
  const problems = on ? earlyProblems(presets, draft) : [];
  return (
    <div className={styles.format} data-on={on ? "" : undefined}>
      <label className={styles.lockToggle}>
        <input type="checkbox" checked={on} disabled={!bounds} onChange={(event) => onOn(event.target.checked)} />
        <span className={styles.lockIcon} aria-hidden>
          <Hourglass size={18} />
        </span>
        <span className={styles.lockText}>
          <span className={styles.lockTitle}>{word("earlyTitle")}</span>
          <span className={styles.hint}>{bounds ? word("earlyToggleHint") : word("advancedNotOffered")}</span>
        </span>
      </label>
      {on && bounds ? (
        <>
          <div className={styles.segments} role="radiogroup" aria-label={word("earlyMode")}>
            {bounds.modes.map((mode) => (
              <button key={mode} type="button" role="radio" aria-checked={mode === draft.mode} className={styles.segment} onClick={() => onDraft({ ...draft, mode })}>
                {word(`earlyMode_${mode}` as LaunchWordKey)}
              </button>
            ))}
          </div>
          <div className={styles.formatGrid}>
            <Number_ label={word("earlyStartIn")} value={draft.startIn} onValue={set("startIn")} />
            <Number_ label={word("earlyMinutes")} value={draft.minutes} onValue={set("minutes")} />
            <Number_ label={word("earlyCap")} value={draft.cap} onValue={set("cap")} />
            {draft.mode === "FCFS" ? <Number_ label={word("earlyPerWallet")} value={draft.perWallet} onValue={set("perWallet")} /> : null}
            <Number_ label={word("earlyVesting")} value={draft.vesting} onValue={set("vesting")} />
            <Number_ label={word("earlyStartCap")} value={draft.startCap} onValue={set("startCap")} />
          </div>
          {problems && problems.length ? (
            <p className={styles.problem}>{word("boostProblem", { why: problems.join("; ") })}</p>
          ) : rules ? (
            <div className={styles.formatPreview}>
              <span className={styles.label}>{word("earlyPreview")}</span>
              {earlyAccessRuleLines(rules, locale).map((line) => (
                <span key={line}>{line}</span>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function Number_({ label, value, onValue }: { label: string; value: string; onValue: (value: string) => void }) {
  const id = useId();
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <input id={id} className={`${styles.input} ${styles.mono}`} value={value} onChange={(event) => onValue(event.target.value)} inputMode="decimal" autoComplete="off" />
    </div>
  );
}
