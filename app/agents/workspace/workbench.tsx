"use client";

import {
  ArrowClockwise,
  ArrowSquareOut,
  Check,
  Copy,
  DownloadSimple,
  FileCode,
  LockKey,
  ShieldWarning,
} from "@phosphor-icons/react";
import Link from "next/link";
import type { MouseEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import { WorkspacePageHeader } from "@/app/shell/page-header";
import type { WorkspaceLocale } from "@/app/shell/locale";
import type { AgentActionIntent } from "@/lib/agent-control/contracts";

import { ACTION_PASSPORT_HANDOFF_KEY, loadAgentDemo, runAgentPreflight } from "../agent-control-client";
import { useActionCases } from "./action-case-store";
import { useAgentI18n } from "./i18n/provider";
import type { AgentDemoData } from "../types";

const CHAIN_VALUES = ["eip155:97", "eip155:56"] as const;
type ChainValue = (typeof CHAIN_VALUES)[number];

const LIFECYCLE_STEPS = ["01", "02", "03", "04", "05", "06", "07", "08"] as const;

type WorkbenchCopy = {
  chainOptions: Readonly<Record<ChainValue, string>>;
  lifecycle: readonly [string, string, string, string, string, string, string, string];
  header: { title: string; lead: string; boundariesAria: string };
  chips: { sample: string; notOnchain: string; noSigner: string };
  loading: { badge: string; title: string; body: string };
  failed: { badge: string; title: string; fallback: string; retrying: string; retry: string };
  console: {
    eyebrow: string;
    title: string;
    targetChain: string;
    chainHint: string;
    agent: string;
    action: string;
    provider: string;
    budget: string;
    budgetValue: string;
    normalizedRequest: string;
    runPreflight: string;
    runningPreflight: string;
    recordDecision: string;
    recording: string;
    recordEnabledTitle: string;
    recordDisabledTitle: string;
    actionNote: string;
    staleTitle: string;
    staleBody: string;
    problemTitle: string;
    feedbackTitle: string;
  };
  messages: {
    chainChanged: string;
    recorded: string;
    allowed: string;
    blocked: string;
    preflightFailed: string;
    loadFailed: string;
    copied: string;
    copyFailed: string;
    downloaded: string;
    stageFailed: string;
  };
  passport: {
    eyebrow: string;
    title: string;
    stamp: string;
    stampNote: string;
    intent: string;
    chain: string;
    policyDecision: string;
    humanDecision: string;
    execution: string;
    outcome: string;
    blockersTitle: string;
    intentHash: string;
    evidenceRoot: string;
    integrity: string;
    notFinalized: string;
    outcomeNotObserved: string;
    heldTitle: string;
    heldBody: string;
  };
  artifact: {
    aria: string;
    showJson: string;
    hideJson: string;
    copy: string;
    download: string;
    openVerifier: string;
    verifierNote: string;
  };
  rail: {
    eyebrow: string;
    title: string;
    awaitingPreflight: string;
    notRecorded: string;
    unavailable: string;
    sourcePreview: string;
    heldBack: string;
    resolved: string;
    boundary: string;
    boundaryBody: string;
  };
};

const COPY = {
  en: {
    chainOptions: {
      "eip155:97": "BNB Smart Chain Testnet · chain 97",
      "eip155:56": "BNB Smart Chain · chain 56 (policy-block sample)",
    },
    lifecycle: [
      "Agent request",
      "Strict intent",
      "Evidence",
      "Policy",
      "Human decision",
      "Execution",
      "Outcome",
      "Action Passport",
    ],
    header: {
      title: "Inspect the action boundary.",
      lead: "Change one bounded field, run deterministic preflight, and inspect what the Action Passport can—and cannot—say.",
      boundariesAria: "Workbench boundaries",
    },
    chips: { sample: "SAMPLE", notOnchain: "NOT ONCHAIN", noSigner: "NO SIGNER" },
    loading: {
      badge: "SAMPLE · NOT ONCHAIN",
      title: "Loading the bounded workbench",
      body: "No wallet, session or provider connection is requested.",
    },
    failed: {
      badge: "SAMPLE UNAVAILABLE",
      title: "The source sample could not be opened",
      fallback: "Try the endpoint again later.",
      retrying: "Retrying…",
      retry: "Try again",
    },
    console: {
      eyebrow: "Operator console",
      title: "Agent intent",
      targetChain: "Target chain",
      chainHint: "Chain 97 is policy-allowed. Chain 56 demonstrates a deterministic fail-closed result.",
      agent: "Agent",
      action: "Action",
      provider: "Provider",
      budget: "Budget",
      budgetValue: "NONE · DRAFT ONLY",
      normalizedRequest: "Normalized request",
      runPreflight: "Run deterministic preflight",
      runningPreflight: "Running preflight…",
      recordDecision: "Record demo decision",
      recording: "Recording…",
      recordEnabledTitle: "Record a local demo acknowledgement",
      recordDisabledTitle: "Requires a current ALLOWED_BY_POLICY result",
      actionNote:
        "Policy never authorizes, signs or executes. The violet action records only a local demo acknowledgement bound to the current hashes.",
      staleTitle: "Preflight is stale",
      staleBody: "Run it again before using the result or decision control.",
      problemTitle: "Request failed",
      feedbackTitle: "Current state",
    },
    messages: {
      chainChanged: "Chain changed. Run deterministic preflight to resolve a current policy result.",
      recorded: "Demo decision recorded against the current hashes. No wallet authorization was created.",
      allowed: "Policy allows this sample intent. Human decision and execution remain separate.",
      blocked: "Preflight blocked this sample intent. No decision or execution was recorded.",
      preflightFailed: "The preflight request failed.",
      loadFailed: "The sample could not be loaded.",
      copied: "Action Passport JSON copied. Paste the full object into the verifier to inspect this exact artifact.",
      copyFailed: "Clipboard access was unavailable. Use View Action Passport JSON and copy it manually.",
      downloaded: "Action Passport Preview downloaded as raw JSON.",
      stageFailed:
        "The browser could not stage this Action Passport. Copy or download the JSON and paste it into the verifier.",
    },
    passport: {
      eyebrow: "Ryntra / Action Passport",
      title: "Action Passport preview",
      stamp: "SAMPLE",
      stampNote: "NOT ONCHAIN",
      intent: "Intent",
      chain: "Chain",
      policyDecision: "Policy decision",
      humanDecision: "Human decision",
      execution: "Execution",
      outcome: "Outcome",
      blockersTitle: "Policy blockers",
      intentHash: "Intent hash",
      evidenceRoot: "Evidence root",
      integrity: "Action Passport integrity · SHA-256",
      notFinalized: "NOT FINALIZED",
      outcomeNotObserved: "OUTCOME NOT OBSERVED",
      heldTitle: "Action Passport held back",
      heldBody: "The intent changed. Run preflight before this panel displays a current artifact.",
    },
    artifact: {
      aria: "Action Passport actions",
      showJson: "View Action Passport JSON",
      hideJson: "Hide Action Passport JSON",
      copy: "Copy Action Passport",
      download: "Download Action Passport",
      openVerifier: "Open verifier",
      verifierNote:
        "“Open verifier” stages this exact artifact in browser session storage for a one-time local handoff. Copy or download remains the durable path.",
    },
    rail: {
      eyebrow: "Lifecycle rail",
      title: "Eight facts",
      awaitingPreflight: "AWAITING PREFLIGHT",
      notRecorded: "NOT RECORDED",
      unavailable: "UNAVAILABLE",
      sourcePreview: "SOURCE PREVIEW",
      heldBack: "HELD BACK",
      resolved: "RESOLVED",
      boundary: "SAMPLE · NOT ONCHAIN",
      boundaryBody: "No provider write, signature, transaction or outcome claim.",
    },
  },
  uk: {
    chainOptions: {
      "eip155:97": "BNB Smart Chain Testnet · ланцюг 97",
      "eip155:56": "BNB Smart Chain · ланцюг 56 (зразок блокування політикою)",
    },
    lifecycle: [
      "Запит агента",
      "Строгий намір",
      "Докази",
      "Політика",
      "Рішення людини",
      "Виконання",
      "Результат",
      "Action Passport",
    ],
    header: {
      title: "Дослідіть межу дії.",
      lead: "Змініть одне обмежене поле, запустіть детермінований префлайт і подивіться, що Action Passport може — і чого не може — сказати.",
      boundariesAria: "Межі робочого стенда",
    },
    chips: { sample: "ЗРАЗОК", notOnchain: "НЕ ОНЧЕЙН", noSigner: "БЕЗ ПІДПИСАНТА" },
    loading: {
      badge: "ЗРАЗОК · НЕ ОНЧЕЙН",
      title: "Завантаження обмеженого робочого стенда",
      body: "Гаманець, сесія чи підключення до провайдера не запитуються.",
    },
    failed: {
      badge: "ЗРАЗОК НЕДОСТУПНИЙ",
      title: "Не вдалося відкрити вихідний зразок",
      fallback: "Спробуйте звернутися до кінцевої точки пізніше.",
      retrying: "Повторна спроба…",
      retry: "Спробувати ще раз",
    },
    console: {
      eyebrow: "Консоль оператора",
      title: "Намір агента",
      targetChain: "Цільовий ланцюг",
      chainHint: "Ланцюг 97 дозволений політикою. Ланцюг 56 демонструє детермінований результат fail-closed.",
      agent: "Агент",
      action: "Дія",
      provider: "Провайдер",
      budget: "Бюджет",
      budgetValue: "НЕМАЄ · ЛИШЕ ЧЕРНЕТКА",
      normalizedRequest: "Нормалізований запит",
      runPreflight: "Запустити детермінований префлайт",
      runningPreflight: "Виконується префлайт…",
      recordDecision: "Записати демо-рішення",
      recording: "Записуємо…",
      recordEnabledTitle: "Записати локальне демо-підтвердження",
      recordDisabledTitle: "Потрібен актуальний результат ALLOWED_BY_POLICY",
      actionNote:
        "Політика ніколи не авторизує, не підписує і не виконує. Фіолетова дія записує лише локальне демо-підтвердження, привʼязане до поточних хешів.",
      staleTitle: "Префлайт застарів",
      staleBody: "Запустіть його ще раз, перш ніж користуватися результатом чи елементом рішення.",
      problemTitle: "Запит не виконано",
      feedbackTitle: "Поточний стан",
    },
    messages: {
      chainChanged: "Ланцюг змінено. Запустіть детермінований префлайт, щоб отримати актуальний результат політики.",
      recorded: "Демо-рішення записано щодо поточних хешів. Авторизації гаманцем не створено.",
      allowed: "Політика дозволяє цей зразковий намір. Рішення людини та виконання залишаються окремими.",
      blocked: "Префлайт заблокував цей зразковий намір. Жодного рішення чи виконання не записано.",
      preflightFailed: "Запит префлайту не виконано.",
      loadFailed: "Не вдалося завантажити зразок.",
      copied: "JSON Action Passport скопійовано. Вставте повний обʼєкт у верифікатор, щоб оглянути саме цей артефакт.",
      copyFailed: "Буфер обміну недоступний. Скористайтеся «Показати JSON Action Passport» і скопіюйте вручну.",
      downloaded: "Action Passport Preview завантажено як необроблений JSON.",
      stageFailed:
        "Браузер не зміг підготувати цей Action Passport до передачі. Скопіюйте або завантажте JSON і вставте його у верифікатор.",
    },
    passport: {
      eyebrow: "Ryntra / Action Passport",
      title: "Превʼю Action Passport",
      stamp: "ЗРАЗОК",
      stampNote: "НЕ ОНЧЕЙН",
      intent: "Намір",
      chain: "Ланцюг",
      policyDecision: "Рішення політики",
      humanDecision: "Рішення людини",
      execution: "Виконання",
      outcome: "Результат",
      blockersTitle: "Блокери політики",
      intentHash: "Хеш наміру",
      evidenceRoot: "Корінь доказів",
      integrity: "Цілісність Action Passport · SHA-256",
      notFinalized: "НЕ ФІНАЛІЗОВАНО",
      outcomeNotObserved: "РЕЗУЛЬТАТ НЕ СПОСТЕРЕЖЕНО",
      heldTitle: "Action Passport притримано",
      heldBody: "Намір змінився. Запустіть префлайт, щоб ця панель показала актуальний артефакт.",
    },
    artifact: {
      aria: "Дії з Action Passport",
      showJson: "Показати JSON Action Passport",
      hideJson: "Сховати JSON Action Passport",
      copy: "Скопіювати Action Passport",
      download: "Завантажити Action Passport",
      openVerifier: "Відкрити верифікатор",
      verifierNote:
        "«Відкрити верифікатор» кладе саме цей артефакт у сесійне сховище браузера для одноразової локальної передачі. Надійним способом зберегти артефакт залишається копіювання або завантаження.",
    },
    rail: {
      eyebrow: "Стрічка життєвого циклу",
      title: "Вісім фактів",
      awaitingPreflight: "ОЧІКУЄ НА ПРЕФЛАЙТ",
      notRecorded: "НЕ ЗАПИСАНО",
      unavailable: "НЕДОСТУПНО",
      sourcePreview: "ПРЕВʼЮ ДЖЕРЕЛА",
      heldBack: "ПРИТРИМАНО",
      resolved: "ВИЗНАЧЕНО",
      boundary: "ЗРАЗОК · НЕ ОНЧЕЙН",
      boundaryBody: "Жодного запису в провайдера, підпису, транзакції чи заяви про результат.",
    },
  },
} as const satisfies Record<WorkspaceLocale, WorkbenchCopy>;

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function shortHash(value: string): string {
  return value.length > 28 ? `${value.slice(0, 16)}…${value.slice(-10)}` : value;
}

function changedChain(intent: AgentActionIntent, chainRef: string): AgentActionIntent {
  return {
    ...intent,
    action: { ...intent.action, chainRef },
    revision: intent.revision + 1,
  };
}

export function WorkspaceWorkbench() {
  const { locale, t } = useAgentI18n();
  const copy = COPY[locale];
  const [demo, setDemo] = useState<AgentDemoData | null>(null);
  const [result, setResult] = useState<AgentDemoData | null>(null);
  const [intent, setIntent] = useState<AgentActionIntent | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<"loading" | "preflight" | "recording" | null>("loading");
  const [problem, setProblem] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [showJson, setShowJson] = useState(false);
  const [bootAttempt, setBootAttempt] = useState(0);
  const { remember } = useActionCases();
  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    requestRef.current = controller;
    setProblem(null);
    setBusy("loading");
    loadAgentDemo(controller.signal)
      .then((next) => {
        setDemo(next);
        setIntent(next.preflight.intent);
      })
      .catch((error: unknown) => {
        if (!isAbort(error)) setProblem(error instanceof Error ? error.message : copy.messages.loadFailed);
      })
      .finally(() => {
        if (requestRef.current === controller) setBusy(null);
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the fallback copy must not restart the boot request on a locale switch.
  }, [bootAttempt]);

  const active = dirty ? null : result ?? demo;

  /* Every artifact the Lab produces becomes the workspace's selected Action
     Case, so Actions, the Inspector and Mission Control are reading the same
     one rather than each fetching their own. Projection only — the artifact
     stays the source of truth and nothing is written to a server. */
  const producedId = active?.passport.id ?? null;
  useEffect(() => {
    if (!active) return;
    remember(active.passport);
    // `producedId` rather than `active`: the object identity changes on every
    // render of the parent, and remembering on identity would loop.
  }, [producedId, remember, active]);
  const canRecord =
    active?.preflight.policyResult.status === "PASS" &&
    active.preflight.policyResult.decision === "ALLOWED_BY_POLICY" &&
    active.passport.authorization.status === "NOT_RECORDED" &&
    busy === null;

  const lifecycleStates = useMemo(() => {
    const policyBlocked = active?.preflight.policyResult.status === "BLOCK";
    const decisionRecorded = active?.passport.authorization.status === "RECORDED_DEMO_ONLY";
    return [
      "evidence",
      "evidence",
      "evidence",
      policyBlocked ? "danger" : active ? "evidence" : "muted",
      decisionRecorded ? "evidence" : "caution",
      "danger",
      "caution",
      active ? "evidence" : "muted",
    ] as const;
  }, [active]);

  function replaceChain(chainRef: string) {
    if (!intent || intent.action.chainRef === chainRef) return;
    requestRef.current?.abort();
    setIntent(changedChain(intent, chainRef));
    setResult(null);
    setDirty(true);
    setProblem(null);
    setFeedback(copy.messages.chainChanged);
    setShowJson(false);
    setBusy(null);
  }

  async function evaluate(recordDemoDecision: boolean) {
    if (!intent) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setBusy(recordDemoDecision ? "recording" : "preflight");
    setProblem(null);
    setFeedback(null);
    setShowJson(false);
    try {
      const next = await runAgentPreflight(intent, recordDemoDecision, controller.signal);
      if (requestRef.current !== controller) return;
      setResult(next);
      setIntent(next.preflight.intent);
      setDirty(false);
      setFeedback(
        recordDemoDecision
          ? copy.messages.recorded
          : next.preflight.policyResult.status === "PASS"
            ? copy.messages.allowed
            : copy.messages.blocked,
      );
    } catch (error: unknown) {
      if (!isAbort(error)) setProblem(error instanceof Error ? error.message : copy.messages.preflightFailed);
    } finally {
      if (requestRef.current === controller) setBusy(null);
    }
  }

  async function copyPassport() {
    if (!active) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(active.passport, null, 2));
      setFeedback(copy.messages.copied);
    } catch {
      setProblem(copy.messages.copyFailed);
    }
  }

  function downloadPassport() {
    if (!active) return;
    const blob = new Blob([JSON.stringify(active.passport, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `ryntra-action-passport-preview-${active.passport.id}.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setFeedback(copy.messages.downloaded);
  }

  function stagePassportForVerifier(event: MouseEvent<HTMLAnchorElement>) {
    if (!passport) {
      event.preventDefault();
      return;
    }
    try {
      window.sessionStorage.setItem(ACTION_PASSPORT_HANDOFF_KEY, JSON.stringify(passport));
    } catch {
      event.preventDefault();
      setProblem(copy.messages.stageFailed);
    }
  }

  if (!intent && busy === "loading") {
    return (
      <div className="rx-shell ag-workspace-loading" role="status">
        <span className="ag-status" data-tone="evidence">{copy.loading.badge}</span>
        <h1>{copy.loading.title}</h1>
        <p>{copy.loading.body}</p>
      </div>
    );
  }

  if (!intent) {
    return (
      <div className="rx-shell ag-workspace-loading" role="alert">
        <span className="ag-status" data-tone="danger">{copy.failed.badge}</span>
        <h1>{copy.failed.title}</h1>
        <p>{problem ?? copy.failed.fallback}</p>
        <button
          className="ag-btn ag-btn--ghost"
          type="button"
          onClick={() => setBootAttempt((attempt) => attempt + 1)}
          disabled={busy === "loading"}
        >
          {busy === "loading" ? copy.failed.retrying : copy.failed.retry}
        </button>
      </div>
    );
  }

  const policy = active?.preflight.policyResult;
  const passport = active?.passport;

  return (
    <div className="rx-shell ag-workspace-shell">
      <WorkspacePageHeader
        title={copy.header.title}
        aboutLabel={t("chrome.about")}
        lead={<p>{copy.header.lead}</p>}
        badge={
          <div className="ag-boundary-stack" aria-label={copy.header.boundariesAria}>
            <span className="ag-status" data-tone="evidence">{copy.chips.sample}</span>
            <span className="ag-status" data-tone="caution">{copy.chips.notOnchain}</span>
            <span className="ag-status" data-tone="muted">{copy.chips.noSigner}</span>
          </div>
        }
      />

      <div className="ag-workbench-grid">
        <section className="ag-console" aria-labelledby="operator-console-title">
          <header className="ag-panel-head">
            <div>
              <span>{copy.console.eyebrow}</span>
              <h2 id="operator-console-title">{copy.console.title}</h2>
            </div>
            <code>{intent.schemaVersion}</code>
          </header>

          <div className="ag-console-body">
            <label className="ag-field">
              <span>{copy.console.targetChain}</span>
              <select value={intent.action.chainRef} onChange={(event) => replaceChain(event.target.value)}>
                {CHAIN_VALUES.map((value) => (
                  <option key={value} value={value}>{copy.chainOptions[value]}</option>
                ))}
              </select>
              <small>{copy.console.chainHint}</small>
            </label>

            <dl className="ag-intent-grid">
              <div><dt>{copy.console.agent}</dt><dd>{intent.source.agentName ?? intent.source.agentId}</dd></div>
              <div><dt>{copy.console.action}</dt><dd>{intent.action.kind}</dd></div>
              <div><dt>{copy.console.provider}</dt><dd>{intent.action.provider}</dd></div>
              <div><dt>{copy.console.budget}</dt><dd>{copy.console.budgetValue}</dd></div>
            </dl>

            <div className="ag-request-copy">
              <span>{copy.console.normalizedRequest}</span>
              <p>{intent.requestText}</p>
            </div>

            <div className="ag-console-actions">
              <button className="ag-btn ag-btn--primary" type="button" onClick={() => void evaluate(false)} disabled={busy !== null}>
                <ArrowClockwise size={16} weight="bold" aria-hidden />
                {busy === "preflight" ? copy.console.runningPreflight : copy.console.runPreflight}
              </button>
              <button
                className="ag-btn ag-btn--decision"
                type="button"
                onClick={() => void evaluate(true)}
                disabled={!canRecord}
                title={canRecord ? copy.console.recordEnabledTitle : copy.console.recordDisabledTitle}
              >
                <LockKey size={16} weight="bold" aria-hidden />
                {busy === "recording" ? copy.console.recording : copy.console.recordDecision}
              </button>
            </div>

            <p className="ag-action-note">{copy.console.actionNote}</p>

            {dirty ? (
              <div className="ag-inline-state" data-tone="caution" role="status">
                <ShieldWarning size={18} weight="bold" aria-hidden />
                <div><b>{copy.console.staleTitle}</b><span>{copy.console.staleBody}</span></div>
              </div>
            ) : null}
            {problem ? (
              <div className="ag-inline-state" data-tone="danger" role="alert">
                <ShieldWarning size={18} weight="bold" aria-hidden />
                <div><b>{copy.console.problemTitle}</b><span>{problem}</span></div>
              </div>
            ) : null}
            {feedback ? (
              <div className="ag-inline-state" data-tone="evidence" role="status">
                <Check size={18} weight="bold" aria-hidden />
                <div><b>{copy.console.feedbackTitle}</b><span>{feedback}</span></div>
              </div>
            ) : null}
          </div>
        </section>

        <section className="ag-passport-wrap" aria-labelledby="passport-title">
          {passport ? (
            <article className="ag-passport">
              <header className="ag-passport-head">
                <div>
                  <span>{copy.passport.eyebrow}</span>
                  <h2 id="passport-title">{copy.passport.title}</h2>
                  <code>{passport.id}</code>
                </div>
                <div>
                  <span className="ag-paper-stamp">{copy.passport.stamp}</span>
                  <small>{copy.passport.stampNote}</small>
                </div>
              </header>

              <div className="ag-passport-rule" />

              <dl className="ag-passport-fields">
                <div><dt>{copy.passport.intent}</dt><dd>{passport.intent.action.kind}</dd></div>
                <div><dt>{copy.passport.chain}</dt><dd>{passport.intent.action.chainRef}</dd></div>
                <div><dt>{copy.passport.policyDecision}</dt><dd data-tone={policy?.status === "BLOCK" ? "danger" : "evidence"}>{policy?.decision}</dd></div>
                <div><dt>{copy.passport.humanDecision}</dt><dd data-tone={passport.authorization.status === "RECORDED_DEMO_ONLY" ? "evidence" : "caution"}>{passport.authorization.status}</dd></div>
                <div><dt>{copy.passport.execution}</dt><dd data-tone="danger">{passport.execution.status}</dd></div>
                <div><dt>{copy.passport.outcome}</dt><dd data-tone="caution">{passport.outcome.status}</dd></div>
              </dl>

              {policy?.blockers.length ? (
                <div className="ag-passport-blockers">
                  <b>{copy.passport.blockersTitle}</b>
                  <ul>{policy.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>
                </div>
              ) : null}

              <div className="ag-hash-stack">
                <div><span>{copy.passport.intentHash}</span><code title={passport.intentHash}>{shortHash(passport.intentHash)}</code></div>
                <div><span>{copy.passport.evidenceRoot}</span><code title={passport.evidence.root}>{shortHash(passport.evidence.root)}</code></div>
                <div><span>{copy.passport.integrity}</span><code title={passport.integrity.hash}>{shortHash(passport.integrity.hash)}</code></div>
              </div>

              <div className="ag-finality-strip">
                <span>{copy.passport.notFinalized}</span>
                <span>{copy.passport.outcomeNotObserved}</span>
              </div>

              <footer className="ag-passport-foot">
                <p>{passport.limitations[0]}</p>
                <small>{new Date(passport.createdAt).toLocaleString()}</small>
              </footer>
            </article>
          ) : (
            <div className="ag-passport ag-passport--stale">
              <FileCode size={28} weight="thin" aria-hidden />
              <h2 id="passport-title">{copy.passport.heldTitle}</h2>
              <p>{copy.passport.heldBody}</p>
            </div>
          )}

          <div className="ag-artifact-actions" aria-label={copy.artifact.aria}>
            <button className="ag-btn ag-btn--ghost" type="button" onClick={() => setShowJson((current) => !current)} disabled={!passport}>
              <FileCode size={16} weight="bold" aria-hidden />
              {showJson ? copy.artifact.hideJson : copy.artifact.showJson}
            </button>
            <button className="ag-btn ag-btn--ghost" type="button" onClick={() => void copyPassport()} disabled={!passport}>
              <Copy size={16} weight="bold" aria-hidden />
              {copy.artifact.copy}
            </button>
            <button className="ag-btn ag-btn--ghost" type="button" onClick={downloadPassport} disabled={!passport}>
              <DownloadSimple size={16} weight="bold" aria-hidden />
              {copy.artifact.download}
            </button>
            <Link
              className="ag-btn ag-btn--ghost"
              href="/agents/workspace/verify?handoff=1"
              aria-disabled={!passport}
              tabIndex={passport ? undefined : -1}
              onClick={stagePassportForVerifier}
            >
              <ArrowSquareOut size={16} weight="bold" aria-hidden />
              {copy.artifact.openVerifier}
            </Link>
          </div>

          <p className="ag-verifier-note">{copy.artifact.verifierNote}</p>

          {showJson && passport ? <pre className="ag-json-view">{JSON.stringify(passport, null, 2)}</pre> : null}
        </section>

        <aside className="ag-lifecycle-rail" aria-labelledby="lifecycle-title">
          <header>
            <span>{copy.rail.eyebrow}</span>
            <h2 id="lifecycle-title">{copy.rail.title}</h2>
          </header>
          <ol>
            {LIFECYCLE_STEPS.map((index, position) => (
              <li key={index} data-tone={lifecycleStates[position]}>
                <span>{index}</span>
                <div>
                  <b>{copy.lifecycle[position]}</b>
                  <small>
                    {position === 3
                      ? policy?.decision ?? copy.rail.awaitingPreflight
                      : position === 4
                        ? passport?.authorization.status ?? copy.rail.notRecorded
                        : position === 5
                          ? copy.rail.unavailable
                          : position === 6
                            ? "OUTCOME_NOT_OBSERVED"
                            : position === 7
                              ? passport ? copy.rail.sourcePreview : copy.rail.heldBack
                              : copy.rail.resolved}
                  </small>
                </div>
              </li>
            ))}
          </ol>
          <div className="ag-rail-boundary">
            <ShieldWarning size={18} weight="bold" aria-hidden />
            <p><b>{copy.rail.boundary}</b>{copy.rail.boundaryBody}</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
