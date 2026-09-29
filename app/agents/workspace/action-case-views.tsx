"use client";

import Link from "next/link";
import {
  ArrowRight,
  CheckCircle,
  Circle,
  Minus,
  Question,
  Warning,
  X,
} from "@phosphor-icons/react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import { actionCaseVerdict, type ActionCase, type ActionStage } from "@/lib/agent-control/action-case";

import { useActionCases } from "./action-case-store";
import { useAgentI18n } from "./i18n/provider";

/*
 * Two views of one Action Case: the list and the inspector.
 *
 * They read the same object from the same store, which is the whole point of
 * Phase 2B — a tab is a projection of one action, not a dashboard with its own
 * data. Neither of them fetches anything.
 *
 * The tab-local scope is printed, not implied. "Your place is kept" and "the
 * action is recorded" are different promises. Phase 2C's durable
 * authorization replay does not make this tab-local projection a server
 * ledger.
 */

/*
 * Component-authored copy, both locales in one table. The English strings are
 * pinned by regexes in `app/agents/agent-control-surface.test.mjs` and must
 * stay byte-identical. Stage labels, summaries and limitations arrive from the
 * kernel projection in `lib/agent-control` and are not translated here.
 */
type ActionCaseViewsCopy = Readonly<{
  reading: string;
  empty: Readonly<{ title: string; body: string; openLab: string }>;
  list: Readonly<{
    note(count: number): string;
    samplePrefix: string;
    noBudget: string;
    open: string;
    forget: string;
  }>;
  stageState: Readonly<Record<ActionStage["state"], string>>;
  party: Readonly<Record<ActionStage["party"], string>>;
  facts: Readonly<{
    agent: string;
    requester: string;
    action: string;
    source: string;
    syntheticSample: string;
    chain: string;
    counterparty: string;
    venue: string;
    amount: string;
    noAmount: string;
    deliverable: string;
    policy: string;
    blockers: string;
    warnings: string;
    none: string;
    notNamed: string;
    evidence: string;
    evidenceValue(count: number, stale: number): string;
    humanDecision: string;
    demoOnly: string;
    execution: string;
    outcome: string;
    expectedEffects: string;
    intentHash: string;
    evidenceRoot: string;
    policyDigest: string;
    passportHash: string;
    revision: string;
    expires: string;
  }>;
}>;

const COPY = {
  en: {
    reading: "Reading this tab’s actions…",
    empty: {
      title: "No action in this tab yet",
      body: "Nothing is stored on a server, so this list starts empty in every new tab. Compose one in the Lab or load the Golden RWA sample and it appears here, in this browser tab only.",
      openLab: "Open Action Passport Lab",
    },
    list: {
      note: (count) =>
        `action${count === 1 ? "" : "s"} in this browser tab. Not a record: nothing here reached a server, and a new tab starts empty.`,
      samplePrefix: "SAMPLE · ",
      noBudget: "No budget",
      open: "Open",
      forget: "Forget this tab’s actions",
    },
    stageState: {
      done: "done",
      attention: "attention",
      waiting: "waiting",
      blocked: "blocked",
      unavailable: "unavailable",
    },
    party: {
      agent: "Agent",
      ryntra: "Ryntra",
      human: "You",
      wallet: "External wallet",
      rail: "External rail",
      none: "—",
    },
    facts: {
      agent: "Agent",
      requester: "Requester",
      action: "Action",
      source: "Source",
      syntheticSample: " · synthetic sample",
      chain: "Chain",
      counterparty: "Counterparty",
      venue: "Venue",
      amount: "Amount",
      noAmount: "None — this action class carries no budget",
      deliverable: "Deliverable",
      policy: "Policy",
      blockers: "Blockers",
      warnings: "Warnings",
      none: "None",
      notNamed: "Not named",
      evidence: "Evidence",
      evidenceValue: (count, stale) => `${count} item(s)${stale ? `, ${stale} past validity` : ""}`,
      humanDecision: "Human decision",
      demoOnly: " · demo only",
      execution: "Execution",
      outcome: "Outcome",
      expectedEffects: "Expected effects",
      intentHash: "Intent hash",
      evidenceRoot: "Evidence root",
      policyDigest: "Policy digest",
      passportHash: "Passport hash",
      revision: "Revision",
      expires: "Expires",
    },
  },
  uk: {
    reading: "Читаємо дії цієї вкладки…",
    empty: {
      title: "У цій вкладці ще немає дій",
      body: "Нічого не зберігається на сервері, тож у кожній новій вкладці цей список починається порожнім. Складіть дію в Лабораторії або завантажте зразок Golden RWA — і вона зʼявиться тут, лише в цій вкладці браузера.",
      openLab: "Відкрити Лабораторію Action Passport",
    },
    list: {
      note: (count) => {
        const mod10 = count % 10;
        const mod100 = count % 100;
        const word =
          mod10 === 1 && mod100 !== 11
            ? "дія"
            : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
              ? "дії"
              : "дій";
        return `${word} у цій вкладці браузера. Це не запис: нічого звідси не потрапило на сервер, і нова вкладка починається порожньою.`;
      },
      samplePrefix: "ЗРАЗОК · ",
      noBudget: "Без бюджету",
      open: "Відкрити",
      forget: "Забути дії цієї вкладки",
    },
    stageState: {
      done: "виконано",
      attention: "потребує уваги",
      waiting: "очікує",
      blocked: "заблоковано",
      unavailable: "недоступно",
    },
    party: {
      agent: "Агент",
      ryntra: "Ryntra",
      human: "Ви",
      wallet: "Зовнішній гаманець",
      rail: "Зовнішня рейка",
      none: "—",
    },
    facts: {
      agent: "Агент",
      requester: "Запитувач",
      action: "Дія",
      source: "Джерело",
      syntheticSample: " · синтетичний зразок",
      chain: "Ланцюг",
      counterparty: "Контрагент",
      venue: "Майданчик",
      amount: "Сума",
      noAmount: "Немає — цей клас дій не має бюджету",
      deliverable: "Продукт дії",
      policy: "Політика",
      blockers: "Блокери",
      warnings: "Попередження",
      none: "Немає",
      notNamed: "Не вказано",
      evidence: "Докази",
      evidenceValue: (count, stale) => `${count} елемент(и)${stale ? `, ${stale} поза строком чинності` : ""}`,
      humanDecision: "Рішення людини",
      demoOnly: " · лише демо",
      execution: "Виконання",
      outcome: "Результат",
      expectedEffects: "Очікувані ефекти",
      intentHash: "Хеш наміру",
      evidenceRoot: "Корінь доказів",
      policyDigest: "Дайджест політики",
      passportHash: "Хеш паспорта",
      revision: "Ревізія",
      expires: "Чинний до",
    },
  },
} as const satisfies Record<WorkspaceLocale, ActionCaseViewsCopy>;

const VERDICT_TONE: Readonly<Record<string, string>> = {
  ALLOW: "acw-verdict--ok",
  REVIEW: "acw-verdict--warn",
  BLOCK: "acw-verdict--bad",
  UNKNOWN: "acw-verdict--unknown",
};

function VerdictIcon({ verdict }: { readonly verdict: string }) {
  if (verdict === "ALLOW") return <CheckCircle size={15} weight="bold" aria-hidden />;
  if (verdict === "REVIEW") return <Warning size={15} weight="bold" aria-hidden />;
  if (verdict === "BLOCK") return <X size={15} weight="bold" aria-hidden />;
  return <Question size={15} weight="bold" aria-hidden />;
}

function StageIcon({ state }: { readonly state: ActionStage["state"] }) {
  if (state === "done") return <CheckCircle size={16} weight="bold" aria-hidden />;
  if (state === "attention") return <Warning size={16} weight="bold" aria-hidden />;
  if (state === "waiting") return <Circle size={16} weight="bold" aria-hidden />;
  if (state === "blocked") return <X size={16} weight="bold" aria-hidden />;
  return <Minus size={16} weight="bold" aria-hidden />;
}

export function ActionCaseList() {
  const { locale } = useAgentI18n();
  const copy = COPY[locale];
  const { cases, selected, select, ready, clear } = useActionCases();

  if (!ready) return <p className="rw-note">{copy.reading}</p>;

  if (cases.length === 0) {
    return (
      <div className="rw-empty">
        <b>{copy.empty.title}</b>
        <p>{copy.empty.body}</p>
        <Link className="rw-btn" href="/agents/workspace/lab">
          {copy.empty.openLab} <ArrowRight size={14} weight="bold" aria-hidden />
        </Link>
      </div>
    );
  }

  return (
    <div className="acw-cases">
      <p className="acw-cases-note">
        <b>{cases.length}</b> {copy.list.note(cases.length)}
      </p>
      <ul className="acw-case-list">
        {cases.map((item) => {
          const verdict = actionCaseVerdict(item);
          return (
            <li key={item.id}>
              <button
                type="button"
                className={`acw-case-row ${item.id === selected?.id ? "acw-case-row--on" : ""}`}
                aria-current={item.id === selected?.id ? "true" : undefined}
                onClick={() => select(item.id)}
              >
                <span className="acw-case-kind">{item.sample ? copy.list.samplePrefix : ""}{item.actionKind}</span>
                <span className="acw-case-meta">
                  {item.agentName ?? item.agentId} · {item.chainRef}
                </span>
                <span className="acw-case-amount">
                  {item.amount ? `${item.amount} ${item.assetRef}` : copy.list.noBudget}
                </span>
                <span className={`acw-verdict ${VERDICT_TONE[verdict]}`}>
                  <VerdictIcon verdict={verdict} /> {verdict}
                </span>
              </button>
              <Link className="acw-case-open" href={`/agents/workspace/actions/${item.id}`}>
                {copy.list.open} <ArrowRight size={13} weight="bold" aria-hidden />
              </Link>
            </li>
          );
        })}
      </ul>
      <button type="button" className="acw-case-clear" onClick={clear}>
        {copy.list.forget}
      </button>
    </div>
  );
}

/** The eight stages, each with its state, its party and its limitation. */
export function ActionCaseLifecycle({ actionCase }: { readonly actionCase: ActionCase }) {
  const { locale } = useAgentI18n();
  const copy = COPY[locale];
  return (
    <ol className="acw-stages">
      {actionCase.stages.map((stage) => (
        <li
          key={stage.id}
          className={`acw-stage acw-stage--${stage.state} ${
            stage.id === actionCase.currentStageId ? "acw-stage--current" : ""
          }`}
        >
          <span className="acw-stage-head">
            {/* Text and icon, never colour alone. */}
            <span className="acw-stage-mark" aria-hidden="true">
              <StageIcon state={stage.state} />
            </span>
            <span className="acw-stage-name">{stage.label}</span>
            <span className="acw-stage-state">{copy.stageState[stage.state]}</span>
          </span>
          <span className="acw-stage-party">{copy.party[stage.party]}</span>
          <span className="acw-stage-summary">{stage.summary}</span>
          {stage.limitation ? <span className="acw-stage-limit">{stage.limitation}</span> : null}
        </li>
      ))}
    </ol>
  );
}

/** The selected case as a fact table. Every value comes off the artifact. */
export function ActionCaseFacts({ actionCase }: { readonly actionCase: ActionCase }) {
  const { locale } = useAgentI18n();
  const copy = COPY[locale];
  /* The third element marks hash-like values that need the break class — it
     used to be inferred from the English term text, which stops working the
     moment the term is translated. */
  const rows: readonly (readonly [string, string, boolean?])[] = [
    [copy.facts.agent, actionCase.agentName ? `${actionCase.agentName} · ${actionCase.agentId}` : actionCase.agentId],
    [copy.facts.requester, actionCase.requester],
    [copy.facts.action, `${actionCase.actionKind} · ${actionCase.provider}`],
    [copy.facts.source, `${actionCase.sourceKind}${actionCase.sample ? copy.facts.syntheticSample : ""}`],
    [copy.facts.chain, actionCase.chainRef],
    [copy.facts.counterparty, actionCase.counterpartyRef ?? copy.facts.notNamed],
    [copy.facts.venue, actionCase.venueRef ?? copy.facts.notNamed],
    [copy.facts.amount, actionCase.amount ? `${actionCase.amount} ${actionCase.assetRef}` : copy.facts.noAmount],
    [copy.facts.deliverable, actionCase.deliverable],
    [copy.facts.policy, `${actionCase.policyId} v${actionCase.policyVersion} → ${actionCase.decision} (${actionCase.policyStatus})`],
    [copy.facts.blockers, actionCase.blockers.length ? actionCase.blockers.join("; ") : copy.facts.none],
    [copy.facts.warnings, actionCase.warnings.length ? actionCase.warnings.join("; ") : copy.facts.none],
    [copy.facts.evidence, copy.facts.evidenceValue(actionCase.evidenceCount, actionCase.staleEvidence.length)],
    [copy.facts.humanDecision, actionCase.humanDecision + (actionCase.humanDecisionIsDemoOnly ? copy.facts.demoOnly : "")],
    [copy.facts.execution, `${actionCase.executionStatus} · ${actionCase.executionReason}`],
    [copy.facts.outcome, actionCase.outcomeStatus],
    [copy.facts.expectedEffects, actionCase.expectedEffects.join("; ")],
    [copy.facts.intentHash, actionCase.intentHash, true],
    [copy.facts.evidenceRoot, actionCase.evidenceRoot, true],
    [copy.facts.policyDigest, actionCase.policyDigest, true],
    [copy.facts.passportHash, actionCase.passportHash, true],
    [copy.facts.revision, String(actionCase.revision)],
    [copy.facts.expires, actionCase.expiresAt],
  ];

  return (
    <dl className="acw-facts">
      {rows.map(([term, value, wide]) => (
        <div key={term} className="acw-fact">
          <dt>{term}</dt>
          <dd className={wide ? "acw-break" : undefined}>
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
