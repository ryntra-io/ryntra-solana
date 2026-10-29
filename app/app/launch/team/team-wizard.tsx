"use client";

import { CheckCircle, Warning } from "@phosphor-icons/react";
import { Block, Button, Page } from "@ryntra/core/ui";
import { Fragment, useCallback, useEffect, useId, useMemo, useState, type ReactNode } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import { ensureWalletActs } from "@/lib/account/wallet-proof-store.client";
import { useWalletProof } from "@/app/solana/workspace/wallet-proof";
import type { TeamLaunchPlanResponse, TeamLaunchStepResponse } from "@/lib/api/v1/contract";
import { BUDGET_SOURCES, type BudgetSource } from "@/lib/core/launch/budget";
import { FEE_SHARE_MAX_RECIPIENTS, FEE_SHARE_MIN_BPS } from "@/lib/core/launch/fee-shares";
import {
  ALLOCATION_CATEGORIES,
  ALLOCATION_CATEGORY_NAMES,
  ALLOCATION_TOTAL_PCT,
  EMPTY_TEAM_LAUNCH_DRAFT,
  TEAM_LAUNCH_STEPS,
  allocationProblems,
  teamLaunchProgress,
  teamLaunchReview,
  teamLaunchStepProblems,
  type AllocationCategory,
  type AllocationRow,
  type TeamLaunchDraft,
  type TeamLaunchProblem,
  type TeamLaunchStepKey,
} from "@/lib/core/launch/team-launch";
import { LAUNCH_PRESET_IDS, LAUNCH_PRESETS, type LaunchPresetId } from "@/lib/core/venues/meteora-dbc/presets";
import { isTeamId } from "@/lib/core/team/roles";

import { coreLang } from "../launch-blocks";
import launch from "../launch.module.css";
import styles from "./team.module.css";
import { TEAM_LAUNCH_WORDS, teamLaunchWords, type TeamLaunchWordKey } from "./team-words";

/**
 * «Запуск командою» (MOS-2) — the eight steps of spec §7.3 in one column down the middle: `01 Проєкт → 02 Токен →
 * 03 Розподіл → 04 Крива → 05 Ліквідність → 06 Права → 07 Автоматика ринку → 08 Симуляція, комісії, підпис`.
 *
 * The whole draft is one object held here, so back and forward never lose what was typed, and a step already passed
 * opens again with a press. Every step says which TEAM-1 rights it needs and what the connected wallet holds of them;
 * recording a step writes one EXE-2 action and the page shows its `actionId`.
 *
 * Nothing is signed from this page. Step 08 counts the simulation, lays out every fee as its own row, shows the
 * market's budget, the Constitution's fields with their enforcement grades and the chronicle the market will write —
 * and ends there: the launch itself is a proposal on the team's treasury, and it opens with the owner's own canary.
 */

const API_HEADERS = { "content-type": "application/json", "X-Ryntra-API": "1", "X-Ryntra-API-Version": "1.77.0" } as const;
const DRAFT_KEY = "ryntra.team-launch.draft";

type Failure = Readonly<{ step: TeamLaunchStepKey; message: string }>;
type Recorded = Readonly<{ actionId: string; replay: boolean }>;

async function post(path: string, body: unknown): Promise<{ ok: true; data: TeamLaunchStepResponse } | { ok: false; message: string }> {
  try {
    const response = await fetch(path, { method: "POST", headers: API_HEADERS, body: JSON.stringify(body) });
    const read = (await response.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
    if (!response.ok) return { ok: false, message: read?.error?.message || read?.error?.code || "UNAVAILABLE" };
    return { ok: true, data: read as unknown as TeamLaunchStepResponse };
  } catch {
    return { ok: false, message: "UNAVAILABLE" };
  }
}

const text = (value: unknown, fallback: string): string => (typeof value === "string" ? value : fallback);
const whole = (value: unknown, fallback: number): number => (typeof value === "number" && Number.isSafeInteger(value) ? value : fallback);
const kept = (value: unknown): "kept" | "revoked" => (value === "kept" ? "kept" : "revoked");

/**
 * The draft kept across a reload of the page: the team's own typing, never anything of a wallet or a key. What comes
 * back is whatever the browser holds — an older shape, a half-written entry, another tab's — so every field is rebuilt
 * from the empty draft rather than spread over it: nothing here can hand the wizard a `supply` that is not a number.
 */
function readKeptDraft(): TeamLaunchDraft | null {
  let raw: unknown;
  try {
    const stored = window.sessionStorage.getItem(DRAFT_KEY);
    if (!stored) return null;
    raw = JSON.parse(stored);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const held = raw as Record<string, unknown>;
  const part = (key: string): Record<string, unknown> => {
    const value = held[key];
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  };
  const empty = EMPTY_TEAM_LAUNCH_DRAFT;
  const project = part("project");
  const token = part("token");
  const authorities = typeof token.authorities === "object" && token.authorities !== null ? (token.authorities as Record<string, unknown>) : {};
  const curve = part("curve");
  const liquidity = part("liquidity");
  const rights = part("rights");
  const automation = part("automation");
  const rows = Array.isArray(held.allocation) ? (held.allocation as unknown[]) : [];
  const preset = LAUNCH_PRESET_IDS.includes(curve.preset as LaunchPresetId) ? (curve.preset as LaunchPresetId) : empty.curve.preset;
  return {
    teamId: text(held.teamId, "").slice(0, 24),
    project: { name: text(project.name, ""), summary: text(project.summary, ""), website: text(project.website, ""), x: text(project.x, "") },
    token: {
      name: text(token.name, ""),
      symbol: text(token.symbol, ""),
      decimals: whole(token.decimals, empty.token.decimals),
      supply: whole(token.supply, empty.token.supply),
      authorities: { mint: kept(authorities.mint), freeze: kept(authorities.freeze), update: kept(authorities.update) },
    },
    allocation: rows
      .filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null && ALLOCATION_CATEGORIES.includes((row as Record<string, unknown>).category as AllocationCategory))
      .map((row) => ({
        category: row.category as AllocationCategory,
        pct: whole(row.pct, 0),
        recipient: typeof row.recipient === "string" && row.recipient.length > 0 ? row.recipient : null,
        cliffDays: whole(row.cliffDays, 0),
        unlockDays: whole(row.unlockDays, 0),
      })),
    curve: { preset, firstBuyQuoteRaw: /^(0|[1-9][0-9]{0,39})$/.test(text(curve.firstBuyQuoteRaw, "")) ? text(curve.firstBuyQuoteRaw, "0") : "0", firstBuyLockDays: whole(curve.firstBuyLockDays, 0) },
    liquidity: { lpLockedForEver: true, budgetSources: (Array.isArray(liquidity.budgetSources) ? (liquidity.budgetSources as unknown[]) : []).filter((source): source is BudgetSource => BUDGET_SOURCES.includes(source as BudgetSource)) },
    rights: {
      treasury: typeof rights.treasury === "string" && rights.treasury.length > 0 ? rights.treasury : null,
      feeShares: (Array.isArray(rights.feeShares) ? (rights.feeShares as unknown[]) : [])
        .filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null)
        .slice(0, FEE_SHARE_MAX_RECIPIENTS - 1)
        .map((row) => ({ address: text(row.address, ""), bps: whole(row.bps, FEE_SHARE_MIN_BPS) })),
      rulesChangeable: false,
    },
    automation: {
      ladder: automation.ladder === true,
      deployedBpsMax: whole(automation.deployedBpsMax, empty.automation.deployedBpsMax),
      pauseOnDropBps: whole(automation.pauseOnDropBps, empty.automation.pauseOnDropBps),
      stopByHand: automation.stopByHand !== false,
    },
  };
}

export function TeamLaunchWizard({ locale, plan, cluster, presets }: { locale: WorkspaceLocale; plan: TeamLaunchPlanResponse; cluster: "devnet" | "mainnet"; presets: readonly LaunchPresetId[] }) {
  const word = teamLaunchWords(locale);
  const lang = coreLang(locale);
  const proof = useWalletProof();
  const [draft, setDraft] = useState<TeamLaunchDraft>(EMPTY_TEAM_LAUNCH_DRAFT);
  const [at, setAt] = useState(1);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [recorded, setRecorded] = useState<Readonly<Partial<Record<TeamLaunchStepKey, Recorded>>>>({});
  /* The plan again once a wallet is proven: a canary answers «open» only to a wallet it can name, and a team named
     brings each step's own decision. Until then the page's own plan stands. */
  const [live, setLive] = useState<TeamLaunchPlanResponse | null>(null);

  /* What was typed survives a reload: the wizard is eight steps long, and nobody types it twice. */
  useEffect(() => {
    const held = readKeptDraft();
    if (held) setDraft(held);
  }, []);
  useEffect(() => {
    try {
      window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      /* A browser that keeps nothing still draws the wizard; only a reload costs the typing. */
    }
  }, [draft]);

  const team = isTeamId(draft.teamId) ? draft.teamId : null;
  useEffect(() => {
    if (!proof.address) {
      setLive(null);
      return;
    }
    let alive = true;
    void (async () => {
      const response = await fetch(`/api/v1/launch/team/plan${team ? `?team=${team}` : ""}`, { headers: API_HEADERS }).catch(() => null);
      const body = response?.ok ? ((await response.json().catch(() => null)) as TeamLaunchPlanResponse | null) : null;
      if (alive && body) setLive(body);
    })();
    return () => {
      alive = false;
    };
  }, [team, proof.address]);

  const step = TEAM_LAUNCH_STEPS.find((entry) => entry.n === at) ?? TEAM_LAUNCH_STEPS[0]!;
  const progress = useMemo(() => teamLaunchProgress(draft), [draft]);
  const peopleServed = live?.peopleServed ?? plan.peopleServed;
  const problems = useMemo(() => teamLaunchStepProblems(step.key, draft), [step.key, draft]);
  const open = live?.open ?? plan.open;
  const decisions = live?.steps.find((entry) => entry.key === step.key)?.decisions ?? null;

  const go = useCallback((n: number) => {
    setFailure(null);
    setAt(Math.min(Math.max(n, 1), TEAM_LAUNCH_STEPS.length));
    document.getElementById("team-launch-step")?.focus({ preventScroll: true });
  }, []);

  /* One step: recorded in the journal when Team Launch is open here, and always counted by the same rules. */
  const commit = useCallback(async () => {
    if (problems.length > 0) return;
    if (!open) {
      go(at + 1);
      return;
    }
    setBusy(true);
    setFailure(null);
    /* A wallet proven only by its link to the account signs before it writes (decision 62): asked here, not refused
       with the server's `UNAUTHORIZED` eight times over. */
    if (!(await ensureWalletActs())) {
      setBusy(false);
      return;
    }
    const answer = await post("/api/v1/launch/team/step", { step: step.key, draft });
    setBusy(false);
    if (!answer.ok) {
      setFailure({ step: step.key, message: answer.message });
      return;
    }
    setRecorded((current) => ({ ...current, [step.key]: { actionId: answer.data.actionId, replay: answer.data.replay } }));
    if (step.key !== "review") go(at + 1);
  }, [problems, open, step.key, draft, at, go]);

  const edit = <K extends keyof TeamLaunchDraft>(key: K) => (value: TeamLaunchDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));

  return (
    <Page kind="action" className={launch.corePage} title={word("title")} help={word("lede")} lang={lang}>
      <div className={styles.column}>
        {open ? null : (
          <Block title={word("closedTitle")} titleAs="h2" lang={lang}>
            <p className={launch.hint}>{word("closedBody")}</p>
          </Block>
        )}

        <StepBar locale={locale} at={at} done={progress.done} onStep={go} disabled={busy} />

        <section id="team-launch-step" tabIndex={-1} className={launch.form} aria-label={`${word("stepOf", { n: step.n })} ${step.name[locale]}`} aria-busy={busy}>
          {step.key === "project" ? <ProjectStep locale={locale} draft={draft} onDraft={setDraft} /> : null}
          {step.key === "token" ? <TokenStep locale={locale} draft={draft} onDraft={setDraft} /> : null}
          {step.key === "allocation" ? <AllocationStep locale={locale} draft={draft} onAllocation={edit("allocation")} peopleServed={peopleServed} /> : null}
          {step.key === "curve" ? <CurveStep locale={locale} draft={draft} onDraft={setDraft} cluster={cluster} presets={presets} /> : null}
          {step.key === "liquidity" ? <LiquidityStep locale={locale} draft={draft} onDraft={setDraft} /> : null}
          {step.key === "rights" ? <RightsStep locale={locale} draft={draft} onDraft={setDraft} /> : null}
          {step.key === "automation" ? <AutomationStep locale={locale} draft={draft} onDraft={setDraft} bounds={plan.bounds} peopleServed={peopleServed} /> : null}
          {step.key === "review" ? <ReviewStep locale={locale} draft={draft} peopleServed={peopleServed} /> : null}

          <Block title={word("rights", { rights: step.permissions.join(" · ") })} titleAs="h2" lang={lang}>
            {decisions === null ? (
              <p className={styles.rightsLine}>{word("teamHint")}</p>
            ) : (
              <ul className={styles.facts}>
                {decisions.map((decision) => (
                  <li key={decision.permission} className={styles.fact}>
                    <span className={styles.factLabel}>{decision.permission}</span>
                    <span className={styles.factValue}>{decision.allowed ? (decision.requires === "MULTISIG" ? word("rightMultisig") : word("rightAllowed")) : word("rightRefused")}</span>
                  </li>
                ))}
              </ul>
            )}
            {decisions?.some((decision) => !decision.allowed && decision.refusal === "NO_TREASURY") ? <p className={styles.rightsLine}>{word("waitsTreasury")}</p> : null}
            {recorded[step.key] ? <p className={styles.actionNote}>{word(recorded[step.key]!.replay ? "recordedAgain" : "recorded", { id: recorded[step.key]!.actionId })}</p> : null}
            {failure?.step === step.key ? (
              <p className={launch.problem} role="alert">
                <Warning size={16} weight="fill" aria-hidden /> {word("failure", { message: failure.message })}
              </p>
            ) : null}
          </Block>

          {problems.length > 0 ? (
            <ul className={styles.facts} aria-label={word("fixFirst")}>
              {problems.map((problem) => (
                <li key={problem} className={launch.problem}>
                  <Warning size={16} weight="fill" aria-hidden /> {problemWord(locale, problem)}
                </li>
              ))}
            </ul>
          ) : null}

          <div className={launch.stepActions}>
            {at > 1 ? (
              <Button variant="ghost" onClick={() => go(at - 1)} disabled={busy} lang={lang}>
                {word("back")}
              </Button>
            ) : null}
            <Button variant="primary" icon={step.key === "review" ? undefined : "chevron-right"} onClick={commit} loading={busy} disabled={busy || problems.length > 0} lang={lang}>
              {open ? word("commit") : word("next")}
            </Button>
          </div>
        </section>
      </div>
    </Page>
  );
}

/** What a refusal of a step means, in a person's words; a code without one of its own says what the step says. */
function problemWord(locale: WorkspaceLocale, problem: TeamLaunchProblem): string {
  const word = teamLaunchWords(locale);
  const key = `p${problem}` as TeamLaunchWordKey;
  return key in TEAM_LAUNCH_WORDS ? word(key) : word("pSTEPS_BEFORE");
}

/** The eight steps in a row: a step passed opens again with a press; a step ahead opens through the one before it. */
function StepBar({ locale, at, done, onStep, disabled }: { locale: WorkspaceLocale; at: number; done: ReadonlySet<TeamLaunchStepKey>; onStep: (n: number) => void; disabled: boolean }) {
  const word = teamLaunchWords(locale);
  return (
    <ol className={`${launch.wizardSteps} ${styles.steps}`} aria-label={word("stepsLabel")}>
      {TEAM_LAUNCH_STEPS.map((step) => {
        const state = step.n < at ? "done" : step.n === at ? "active" : "next";
        /* A step passed opens again; the next one only once every step up to this one holds, so nothing is reviewed
           over a step nobody filled. */
        const reachable = step.n < at || (step.n === at + 1 && TEAM_LAUNCH_STEPS.every((entry) => entry.n > at || done.has(entry.key)));
        return (
          <li key={step.key} className={launch.wizardStep} data-state={state}>
            <button type="button" className={launch.wizardButton} aria-current={step.n === at ? "step" : undefined} disabled={disabled || step.n === at || !reachable} onClick={() => onStep(step.n)}>
              <span className={launch.wizardIndex} aria-hidden>
                {state === "done" && done.has(step.key) ? <CheckCircle size={18} weight="fill" /> : step.n}
              </span>
              <span className={launch.wizardLabel}>
                <span className={launch.visuallyHidden}>{word("stepOf", { n: step.n })} </span>
                {step.name[locale]}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/* --------------------------------------------------------------- the fields */

function Field({ label, hint, children }: { label: string; hint?: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className={launch.field}>
      <span className={launch.labelRow}>
        <label htmlFor={id} className={launch.label}>
          {label}
        </label>
      </span>
      {children(id)}
      {hint ? <p className={launch.hint}>{hint}</p> : null}
    </div>
  );
}

type StepProps = { locale: WorkspaceLocale; draft: TeamLaunchDraft; onDraft: (next: TeamLaunchDraft) => void };

/* 01 Проєкт */
function ProjectStep({ locale, draft, onDraft }: StepProps) {
  const word = teamLaunchWords(locale);
  const lang = coreLang(locale);
  const set = (key: keyof TeamLaunchDraft["project"]) => (value: string) => onDraft({ ...draft, project: { ...draft.project, [key]: value } });
  return (
    <>
      <Block title={word("teamTitle")} titleAs="h2" lang={lang}>
        <Field label={word("teamId")} hint={word("teamHint")}>
          {(id) => <input id={id} className={`${launch.input} ${launch.mono}`} value={draft.teamId} onChange={(event) => onDraft({ ...draft, teamId: event.target.value.trim().toLowerCase() })} autoComplete="off" maxLength={24} spellCheck={false} />}
        </Field>
      </Block>
      <Block title={word("projectTitle")} titleAs="h2" lang={lang}>
        <Field label={word("projectName")}>{(id) => <input id={id} className={launch.input} value={draft.project.name} onChange={(event) => set("name")(event.target.value)} autoComplete="off" maxLength={64} />}</Field>
        <Field label={word("projectSummary")} hint={word("projectSummaryHint")}>
          {(id) => <textarea id={id} className={`${launch.input} ${launch.textarea}`} value={draft.project.summary} onChange={(event) => set("summary")(event.target.value)} rows={3} maxLength={600} />}
        </Field>
        <Field label={word("projectWebsite")}>{(id) => <input id={id} className={launch.input} value={draft.project.website} onChange={(event) => set("website")(event.target.value)} inputMode="url" autoComplete="off" placeholder="https://" maxLength={200} />}</Field>
        <Field label={word("projectX")}>{(id) => <input id={id} className={launch.input} value={draft.project.x} onChange={(event) => set("x")(event.target.value)} autoComplete="off" placeholder="@" maxLength={16} />}</Field>
      </Block>
    </>
  );
}

/* 02 Токен */
function TokenStep({ locale, draft, onDraft }: StepProps) {
  const word = teamLaunchWords(locale);
  const lang = coreLang(locale);
  const token = draft.token;
  const authority = (key: keyof TeamLaunchDraft["token"]["authorities"]) => (kept: boolean) => onDraft({ ...draft, token: { ...token, authorities: { ...token.authorities, [key]: kept ? "kept" : "revoked" } } });
  const AUTHORITIES: readonly (readonly [keyof TeamLaunchDraft["token"]["authorities"], TeamLaunchWordKey])[] = [
    ["mint", "authorityMint"],
    ["freeze", "authorityFreeze"],
    ["update", "authorityUpdate"],
  ];
  return (
    <Block title={word("tokenTitle")} titleAs="h2" lang={lang}>
      <Field label={word("tokenName")}>{(id) => <input id={id} className={launch.input} value={token.name} onChange={(event) => onDraft({ ...draft, token: { ...token, name: event.target.value } })} autoComplete="off" maxLength={32} />}</Field>
      <Field label={word("tokenSymbol")}>
        {(id) => <input id={id} className={`${launch.input} ${launch.mono}`} value={token.symbol} onChange={(event) => onDraft({ ...draft, token: { ...token, symbol: event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") } })} autoComplete="off" maxLength={10} />}
      </Field>
      <Field label={word("tokenDecimals")}>
        {(id) => <input id={id} className={`${launch.input} ${launch.mono}`} value={String(token.decimals)} onChange={(event) => onDraft({ ...draft, token: { ...token, decimals: wholeOf(event.target.value, token.decimals) } })} inputMode="numeric" autoComplete="off" maxLength={1} />}
      </Field>
      <Field label={word("tokenSupply")} hint={word("tokenSupplyHint")}>
        {(id) => <input id={id} className={`${launch.input} ${launch.mono}`} value={String(token.supply)} onChange={(event) => onDraft({ ...draft, token: { ...token, supply: wholeOf(event.target.value, token.supply) } })} inputMode="numeric" autoComplete="off" maxLength={13} />}
      </Field>
      <fieldset className={launch.section}>
        <legend className={launch.label}>{word("authorities")}</legend>
        <div className={styles.choice}>
          {AUTHORITIES.map(([key, label]) => (
            <label key={key} className={styles.check}>
              <input type="checkbox" checked={token.authorities[key] === "kept"} onChange={(event) => authority(key)(event.target.checked)} />
              {word(label)} — {word(token.authorities[key] === "kept" ? "kept" : "revoked")}
            </label>
          ))}
        </div>
      </fieldset>
    </Block>
  );
}

/** Whole base units as typed: digits only, and no leading zero — `"0500000"` is not a number the chain would take. */
function rawOf(text: string): string {
  const digits = text.replace(/[^0-9]/g, "").replace(/^0+(?=\d)/, "");
  return digits.length === 0 ? "0" : digits.slice(0, 40);
}

/** A whole number as typed, or what it was: a field of digits never becomes `NaN`. */
function wholeOf(text: string, fallback: number): number {
  const clean = text.replace(/[^0-9]/g, "");
  if (clean.length === 0) return 0;
  const value = Number(clean);
  return Number.isSafeInteger(value) ? value : fallback;
}

/* 03 Розподіл */
function AllocationStep({ locale, draft, onAllocation, peopleServed }: { locale: WorkspaceLocale; draft: TeamLaunchDraft; onAllocation: (rows: readonly AllocationRow[]) => void; peopleServed: boolean }) {
  const word = teamLaunchWords(locale);
  const lang = coreLang(locale);
  const rows = draft.allocation;
  const sum = rows.reduce((total, row) => total + (Number.isInteger(row.pct) ? row.pct : 0), 0);
  const free = ALLOCATION_CATEGORIES.filter((category) => !rows.some((row) => row.category === category));
  const problems = allocationProblems(rows);
  const change = (index: number, over: Partial<AllocationRow>) => onAllocation(rows.map((row, at) => (at === index ? { ...row, ...over } : row)));
  const review = useMemo(() => teamLaunchReview(draft, { peopleServed }), [draft, peopleServed]);
  return (
    <Block title={word("allocationTitle")} titleAs="h2" lang={lang}>
      <p className={launch.hint}>{word("allocationHint")}</p>
      {rows.map((row, index) => (
        <div key={row.category} className={styles.allocationRow}>
          <span className={launch.label}>{ALLOCATION_CATEGORY_NAMES[row.category][locale]}</span>
          <input aria-label={`${ALLOCATION_CATEGORY_NAMES[row.category][locale]} ${word("allocationPct")}`} className={`${launch.input} ${launch.mono}`} value={String(row.pct)} onChange={(event) => change(index, { pct: wholeOf(event.target.value, row.pct) })} inputMode="numeric" maxLength={3} />
          <input aria-label={word("allocationRecipient")} className={`${launch.input} ${launch.mono}`} value={row.recipient ?? ""} onChange={(event) => change(index, { recipient: event.target.value.trim() || null })} placeholder={word("allocationRecipient")} autoComplete="off" spellCheck={false} maxLength={44} />
          <input aria-label={word("allocationCliff")} className={`${launch.input} ${launch.mono}`} value={String(row.cliffDays)} onChange={(event) => change(index, { cliffDays: wholeOf(event.target.value, row.cliffDays) })} inputMode="numeric" maxLength={5} />
          <input aria-label={word("allocationUnlock")} className={`${launch.input} ${launch.mono}`} value={String(row.unlockDays)} onChange={(event) => change(index, { unlockDays: wholeOf(event.target.value, row.unlockDays) })} inputMode="numeric" maxLength={5} />
          <Button variant="ghost" onClick={() => onAllocation(rows.filter((_, at) => at !== index))} lang={lang}>
            {word("allocationRemove")}
          </Button>
        </div>
      ))}
      <div className={styles.choice}>
        {free.map((category) => (
          <Button key={category} variant="secondary" onClick={() => onAllocation([...rows, { category, pct: Math.max(ALLOCATION_TOTAL_PCT - sum, 0), recipient: null, cliffDays: 0, unlockDays: 0 }])} lang={lang}>
            {ALLOCATION_CATEGORY_NAMES[category][locale]}
          </Button>
        ))}
      </div>
      <p className={styles.rowTotal}>
        <span>{word("allocationSum", { sum })}</span>
        <span className={styles.factValue}>
          {word("circulating")}: {review.simulation.circulatingRaw.toString(10)} · {word("locked")}: {review.simulation.lockedRaw.toString(10)}
        </span>
      </p>
      {problems.length > 0 ? (
        <p className={launch.problem}>
          <Warning size={16} weight="fill" aria-hidden /> {word("allocationProblem")}
        </p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">{word("allocationTitle")}</th>
              <th scope="col" className={styles.numeric}>
                {word("allocationPct")}
              </th>
              <th scope="col" className={styles.numeric}>
                {word("allocationUnits")}
              </th>
            </tr>
          </thead>
          <tbody>
            {review.simulation.allocation.map((unit) => (
              <tr key={unit.category}>
                <th scope="row">{ALLOCATION_CATEGORY_NAMES[unit.category as AllocationCategory][locale]}</th>
                <td className={styles.numeric}>{unit.pct}</td>
                <td className={styles.numeric}>{unit.unitsRaw.toString(10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Block>
  );
}

/* 04 Крива */
function CurveStep({ locale, draft, onDraft, cluster, presets }: StepProps & { cluster: "devnet" | "mainnet"; presets: readonly LaunchPresetId[] }) {
  const word = teamLaunchWords(locale);
  const lang = coreLang(locale);
  const preset = LAUNCH_PRESETS[draft.curve.preset] ?? LAUNCH_PRESETS.classic;
  /* The presets this deployment serves, as the page read them: «Розширений» is its own form, not a choice here, and a
     preset with no config here is not offered at all. */
  const offered = presets;
  return (
    <Block title={word("curveTitle")} titleAs="h2" lang={lang}>
      <fieldset className={launch.section}>
        <legend className={launch.label}>{word("curvePreset")}</legend>
        <div className={styles.choice}>
          {offered.map((id) => (
            <label key={id} className={styles.check}>
              <input type="radio" name="team-launch-preset" checked={draft.curve.preset === id} onChange={() => onDraft({ ...draft, curve: { ...draft.curve, preset: id as LaunchPresetId } })} />
              {LAUNCH_PRESETS[id].name[locale]}
            </label>
          ))}
        </div>
      </fieldset>
      <ul className={styles.facts}>
        <li className={styles.fact}>
          <span className={styles.factLabel}>{word("curveFacts", { start: preset.curve.startMarketCapUsd.toLocaleString(locale), graduation: preset.curve.graduationMarketCapUsd.toLocaleString(locale) })}</span>
        </li>
        {preset.curve.graduationQuote ? (
          <li className={styles.fact}>
            <span className={styles.factLabel}>{word("curveThreshold", { quote: preset.curve.graduationQuote.toLocaleString(locale) })}</span>
          </li>
        ) : null}
        <li className={styles.fact}>
          <span className={styles.factLabel}>{word("sniperFee", { start: `${preset.sniperFee.startBps / 100} %`, end: `${preset.sniperFee.endBps / 100} %`, seconds: preset.sniperFee.seconds })}</span>
        </li>
        <li className={styles.fact}>
          <span className={styles.factLabel}>{cluster === "devnet" ? "devnet" : "mainnet"}</span>
          <span className={styles.factValue}>{preset.pair}</span>
        </li>
      </ul>
      <Field label={word("firstBuy")} hint={word("firstBuyHint")}>
        {(id) => <input id={id} className={`${launch.input} ${launch.mono}`} value={draft.curve.firstBuyQuoteRaw} onChange={(event) => onDraft({ ...draft, curve: { ...draft.curve, firstBuyQuoteRaw: rawOf(event.target.value) } })} inputMode="numeric" autoComplete="off" maxLength={40} />}
      </Field>
      <Field label={word("firstBuyLock")}>
        {(id) => <input id={id} className={`${launch.input} ${launch.mono}`} value={String(draft.curve.firstBuyLockDays)} onChange={(event) => onDraft({ ...draft, curve: { ...draft.curve, firstBuyLockDays: wholeOf(event.target.value, draft.curve.firstBuyLockDays) } })} inputMode="numeric" autoComplete="off" maxLength={5} />}
      </Field>
    </Block>
  );
}

/* 05 Ліквідність */
function LiquidityStep({ locale, draft, onDraft }: StepProps) {
  const word = teamLaunchWords(locale);
  const lang = coreLang(locale);
  const SOURCE_WORD: Readonly<Record<BudgetSource, TeamLaunchWordKey>> = { migration: "budgetSourceMigration", surplus: "budgetSourceSurplus", curve: "budgetSourceCurve", lp: "budgetSourceLp" };
  const toggle = (source: BudgetSource, on: boolean) =>
    onDraft({ ...draft, liquidity: { ...draft.liquidity, budgetSources: on ? [...draft.liquidity.budgetSources, source] : draft.liquidity.budgetSources.filter((entry) => entry !== source) } });
  return (
    <Block title={word("liquidityTitle")} titleAs="h2" lang={lang}>
      <p className={launch.hint}>{word("lpLocked")}</p>
      <fieldset className={launch.section}>
        <legend className={launch.label}>{word("budgetSources")}</legend>
        <div className={styles.choice}>
          {BUDGET_SOURCES.map((source) => (
            <label key={source} className={styles.check}>
              <input type="checkbox" checked={draft.liquidity.budgetSources.includes(source)} onChange={(event) => toggle(source, event.target.checked)} />
              {word(SOURCE_WORD[source])}
            </label>
          ))}
        </div>
        <p className={launch.hint}>{word("budgetHint")}</p>
      </fieldset>
    </Block>
  );
}

/* 06 Права */
function RightsStep({ locale, draft, onDraft }: StepProps) {
  const word = teamLaunchWords(locale);
  const lang = coreLang(locale);
  const shares = draft.rights.feeShares;
  const change = (index: number, over: Partial<{ address: string; bps: number }>) => onDraft({ ...draft, rights: { ...draft.rights, feeShares: shares.map((row, at) => (at === index ? { ...row, ...over } : row)) } });
  return (
    <Block title={word("rightsTitle")} titleAs="h2" lang={lang}>
      <Field label={word("treasury")} hint={word("treasuryHint")}>
        {(id) => <input id={id} className={`${launch.input} ${launch.mono}`} value={draft.rights.treasury ?? ""} onChange={(event) => onDraft({ ...draft, rights: { ...draft.rights, treasury: event.target.value.trim() || null } })} autoComplete="off" spellCheck={false} maxLength={44} />}
      </Field>
      <fieldset className={launch.section}>
        <legend className={launch.label}>{word("feeSharesTitle")}</legend>
        <p className={launch.hint}>{word("feeSharesHint")}</p>
        {shares.map((row, index) => (
          <div key={index} className={styles.allocationRow}>
            <input aria-label={word("shareAddress")} className={`${launch.input} ${launch.mono}`} value={row.address} onChange={(event) => change(index, { address: event.target.value.trim() })} placeholder={word("shareAddress")} autoComplete="off" spellCheck={false} maxLength={44} />
            <input aria-label={word("shareBps")} className={`${launch.input} ${launch.mono}`} value={String(row.bps)} onChange={(event) => change(index, { bps: wholeOf(event.target.value, row.bps) })} inputMode="numeric" maxLength={5} />
            <Button variant="ghost" onClick={() => onDraft({ ...draft, rights: { ...draft.rights, feeShares: shares.filter((_, at) => at !== index) } })} lang={lang}>
              {word("allocationRemove")}
            </Button>
          </div>
        ))}
        {shares.length < FEE_SHARE_MAX_RECIPIENTS - 1 ? (
          <Button variant="secondary" onClick={() => onDraft({ ...draft, rights: { ...draft.rights, feeShares: [...shares, { address: "", bps: FEE_SHARE_MIN_BPS }] } })} lang={lang}>
            {word("allocationAdd")}
          </Button>
        ) : null}
      </fieldset>
      <p className={launch.hint}>{word("rulesFixed")}</p>
    </Block>
  );
}

/* 07 Автоматика ринку */
function AutomationStep({ locale, draft, onDraft, bounds, peopleServed }: StepProps & { bounds: TeamLaunchPlanResponse["bounds"]; peopleServed: boolean }) {
  const word = teamLaunchWords(locale);
  const lang = coreLang(locale);
  const review = useMemo(() => teamLaunchReview(draft, { peopleServed }), [draft, peopleServed]);
  const BY: Readonly<Record<"team" | "venue" | "executor", TeamLaunchWordKey>> = { team: "byTeam", venue: "byVenue", executor: "byExecutor" };
  return (
    <>
      <Block title={word("automationTitle")} titleAs="h2" lang={lang}>
        <label className={styles.check}>
          <input type="checkbox" checked={draft.automation.ladder} onChange={(event) => onDraft({ ...draft, automation: { ...draft.automation, ladder: event.target.checked } })} />
          {word("ladder")}
        </label>
        <p className={launch.hint}>{word("ladderHint")}</p>
        {review.budget.fundable ? null : <p className={launch.problem}>{word("ladderNotFunded")}</p>}
        <Field label={word("deployedMax")}>
          {(id) => (
            <input
              id={id}
              className={`${launch.input} ${launch.mono}`}
              value={String(draft.automation.deployedBpsMax)}
              onChange={(event) => onDraft({ ...draft, automation: { ...draft.automation, deployedBpsMax: Math.min(wholeOf(event.target.value, draft.automation.deployedBpsMax), bounds.deployedBpsMax) } })}
              inputMode="numeric"
              maxLength={5}
            />
          )}
        </Field>
        <Field label={word("pauseDrop")}>
          {(id) => (
            <input
              id={id}
              className={`${launch.input} ${launch.mono}`}
              value={String(draft.automation.pauseOnDropBps)}
              onChange={(event) => onDraft({ ...draft, automation: { ...draft.automation, pauseOnDropBps: Math.min(wholeOf(event.target.value, draft.automation.pauseOnDropBps), bounds.pauseOnDropBps) } })}
              inputMode="numeric"
              maxLength={5}
            />
          )}
        </Field>
        <label className={styles.check}>
          <input type="checkbox" checked={draft.automation.stopByHand} onChange={(event) => onDraft({ ...draft, automation: { ...draft.automation, stopByHand: event.target.checked } })} />
          {word("stopByHand")}
        </label>
      </Block>
      <Block title={word("chronicleTitle")} titleAs="h2" lang={lang}>
        <p className={launch.hint}>{word("chronicleHint")}</p>
        <table className={styles.table}>
          <tbody>
            {review.chronicle.map((row) => (
              <tr key={row.key}>
                <th scope="row">{row.name[locale]}</th>
                <td>{word(BY[row.by])}</td>
                <td className={`${styles.grade} ${row.enforcement === "NOT_IMPLEMENTED" ? styles.gradeNone : ""}`}>{enforcementWord(locale, row.enforcement)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Block>
    </>
  );
}

function enforcementWord(locale: WorkspaceLocale, enforcement: string): string {
  const word = teamLaunchWords(locale);
  if (enforcement === "ONCHAIN_RULE") return word("enforcementOnchain");
  if (enforcement === "SERVER_POLICY") return word("enforcementServer");
  if (enforcement === "INFORMATIONAL") return word("enforcementInformational");
  return word("enforcementNone");
}

/* 08 Симуляція, комісії, підпис */
function ReviewStep({ locale, draft, peopleServed }: { locale: WorkspaceLocale; draft: TeamLaunchDraft; peopleServed: boolean }) {
  const word = teamLaunchWords(locale);
  const lang = coreLang(locale);
  const review = useMemo(() => teamLaunchReview(draft, { peopleServed }), [draft, peopleServed]);
  const WHEN: Readonly<Record<"curve" | "graduation" | "pool", TeamLaunchWordKey>> = { curve: "feeWhenCurve", graduation: "feeWhenGraduation", pool: "feeWhenPool" };
  const OF: Readonly<Record<"fee" | "raised" | "liquidity", TeamLaunchWordKey>> = { fee: "feeOfFee", raised: "feeOfRaised", liquidity: "feeOfLiquidity" };
  return (
    <>
      <Block title={word("simulationTitle")} titleAs="h2" lang={lang}>
        <ul className={styles.facts}>
          <Fact label={word("tokenSupply")} value={review.simulation.supplyRaw.toString(10)} />
          <Fact label={word("circulating")} value={review.simulation.circulatingRaw.toString(10)} />
          <Fact label={word("locked")} value={review.simulation.lockedRaw.toString(10)} />
          <Fact label={word("dilution")} value={`${review.simulation.dilutionBps / 100} %`} />
          <Fact label={word("firstBuy")} value={review.simulation.firstBuyQuoteRaw.toString(10)} />
          <Fact label={word("curvePreset")} value={LAUNCH_PRESETS[review.simulation.preset].name[locale]} />
        </ul>
      </Block>

      <Block title={word("feesTitle")} titleAs="h2" lang={lang}>
        <p className={launch.hint}>{word("feesHint")}</p>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">{word("feesTitle")}</th>
              <th scope="col" className={styles.numeric}>
                %
              </th>
              <th scope="col">{word("feeOfFee")}</th>
            </tr>
          </thead>
          <tbody>
            {(["curve", "graduation", "pool"] as const).map((when) => (
              <Fragment key={when}>
                <tr>
                  <th scope="colgroup" colSpan={3} className={styles.group}>
                    {word(WHEN[when])}
                  </th>
                </tr>
                {review.fees
                  .filter((row) => row.when === when)
                  .map((row) => (
                    <tr key={row.key}>
                      <th scope="row">{row.name[locale]}</th>
                      <td className={styles.numeric}>{row.bps / 100} %</td>
                      <td>{word(OF[row.of])}</td>
                    </tr>
                  ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </Block>

      <Block title={word("budgetTitle")} titleAs="h2" lang={lang}>
        <ul className={styles.facts}>
          <Fact label={word("ladder")} value={review.budget.ladder ? "✓" : "—"} />
          <Fact label={word("deployedMax")} value={`${review.budget.deployedBpsMax / 100} %`} />
          <Fact label={word("pauseDrop")} value={`${review.budget.pauseOnDropBps / 100} %`} />
          <Fact label={word("budgetSources")} value={review.budget.sources.join(" · ") || "—"} />
          {review.budget.fundable ? null : <Fact label={word("ladder")} value={word("ladderNotFunded")} />}
        </ul>
        <p className={launch.hint}>
          <strong>{word("noPriceTitle")}.</strong> {word("noPriceBody")}
        </p>
      </Block>

      <Block title={word("constitutionTitle")} titleAs="h2" lang={lang}>
        <p className={launch.hint}>{word("constitutionHint")}</p>
        <table className={styles.table}>
          <tbody>
            {review.constitution.map((row) => (
              <tr key={`${row.section}.${row.key}`}>
                <th scope="row">
                  {row.section} · {row.key}
                </th>
                <td className={styles.factValue}>{row.value ?? word("unknown")}</td>
                <td className={`${styles.grade} ${row.enforcement === "NOT_IMPLEMENTED" ? styles.gradeNone : ""}`}>{enforcementWord(locale, row.enforcement)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Block>

      <Block title={word("signTitle")} titleAs="h2" lang={lang}>
        <p className={launch.hint}>{word("signClosed")}</p>
      </Block>
    </>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <li className={styles.fact}>
      <span className={styles.factLabel}>{label}</span>
      <span className={styles.factValue}>{value}</span>
    </li>
  );
}
