"use client";

import {
  ArrowClockwise,
  Check,
  CheckCircle,
  Circle,
  LockKey,
  Minus,
  Question,
  ShieldWarning,
  Warning,
  Wallet,
  X,
} from "@phosphor-icons/react";
import { useEffect } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import { useShell } from "@/app/shell/shell-state";
import {
  actionCaseVerdict,
  type ActionCase,
  type ActionStageState,
} from "@/lib/agent-control/action-case";
import type { ActionPassportPreview } from "@/lib/agent-control/contracts";

import { useActionCases } from "./action-case-store";
import { ActionCaseFacts, ActionCaseLifecycle } from "./action-case-views";
import { useAgentI18n } from "./i18n/provider";

type GoldenRwaWorkspaceProps = {
  readonly banner: string;
  readonly stale: ActionPassportPreview;
  readonly fresh: ActionPassportPreview;
  readonly reviewed: ActionPassportPreview;
};

type Verdict = ReturnType<typeof actionCaseVerdict>;

type EvidenceFreshness = ActionCase["evidenceItems"][number]["freshness"];

/*
 * Component-authored copy, both locales in one table. The English strings are
 * pinned by `app/agents/agents.test.mjs` and `agent-control-surface.test.mjs`,
 * which regex this source file — they must stay byte-identical. Case narrative
 * text (stage summaries, blockers, limitations, expected effects) arrives from
 * `lib/agent-control/golden-rwa-demo.ts` and is not translated here.
 */
type GoldenRwaCopy = Readonly<{
  stageState: Readonly<Record<ActionStageState, string>>;
  phase: Readonly<{ propose: string; verify: string; authorize: string; execute: string; prove: string }>;
  party: Readonly<{ agent: string; ryntra: string; wallet: string; rail: string }>;
  phasesAria: string;
  request: Readonly<{
    label: string;
    agent: string;
    amountAsset: string;
    counterparty: string;
    mandate: string;
    budget: string;
    network: string;
    noAmount: string;
    notNamed: string;
    noFundedAction: string;
    budgetUsed(amount: string | null, limit: string, asset: string | null): string;
  }>;
  decision: Readonly<{
    title: string;
    reviewBound: string;
    allowReason: string;
    noPositive: string;
    codesAria: string;
    humanStep: string;
    walletResponsibility: string;
    walletBoundary: string;
    expectedReceipt: string;
  }>;
  pro: Readonly<{
    kpisAria: string;
    decision: string;
    revision: string;
    freshEvidence: string;
    currentBoundary: string;
    lifecycleTitle: string;
    lifecycleLabel: string;
    stopsAt: string;
    evidenceTitle: string;
    evidenceLabel: string;
    freshness: Readonly<Record<EvidenceFreshness, string>>;
    observed: string;
    validUntil: string;
    factsTitle: string;
    factsLabel: string;
    limitsTitle: string;
    limitsLabel: string;
  }>;
  demo: Readonly<{
    bannerNote: string;
    checkpointsAria: string;
    step1: string;
    step1Note: string;
    step2: string;
    step2Note: string;
    step3: string;
    step3Note: string;
    wallet: string;
    walletNext: string;
    walletNotReached: string;
    reading: string;
    launchTitle: string;
    launchBody: string;
    loadSample: string;
  }>;
}>;

const COPY = {
  en: {
    stageState: {
      done: "done",
      attention: "attention",
      waiting: "waiting",
      blocked: "blocked",
      unavailable: "unavailable",
    },
    phase: { propose: "Propose", verify: "Verify", authorize: "Authorize", execute: "Execute", prove: "Prove" },
    party: { agent: "Agent", ryntra: "Ryntra", wallet: "External wallet", rail: "External rail" },
    phasesAria: "Five-phase lifecycle summary",
    request: {
      label: "Authorization request",
      agent: "Agent",
      amountAsset: "Amount / asset",
      counterparty: "Counterparty",
      mandate: "Mandate",
      budget: "Budget",
      network: "Action network",
      noAmount: "No amount",
      notNamed: "Not named",
      noFundedAction: "No funded action allowed",
      budgetUsed: (amount, limit, asset) => `${amount} of ${limit} ${asset}`,
    },
    decision: {
      title: "Deterministic decision",
      reviewBound:
        "The sample review is bound to this intent hash, evidence root and policy digest. It is not a wallet authorization.",
      allowReason:
        "All required sample evidence is inside its declared validity window and the action is within the sample mandate budget.",
      noPositive: "No positive decision is available.",
      codesAria: "Policy reason codes",
      humanStep: "Human step",
      walletResponsibility: "Wallet responsibility",
      walletBoundary: "External wallet. Ryntra has no key, creates no signature and moves no funds.",
      expectedReceipt: "Expected Receipt · not created",
    },
    pro: {
      kpisAria: "Selected action summary",
      decision: "Decision",
      revision: "Revision",
      freshEvidence: "Fresh evidence",
      currentBoundary: "Current boundary",
      lifecycleTitle: "One Action Case through eight stages",
      lifecycleLabel: "Canonical detail",
      stopsAt: "Stops at",
      evidenceTitle: "Evidence used by this decision",
      evidenceLabel: "Source and freshness",
      freshness: { FRESH: "FRESH", STALE: "STALE", NON_POSITIVE: "NON_POSITIVE" },
      observed: "Observed",
      validUntil: "valid until",
      factsTitle: "Selected Action Case",
      factsLabel: "Exact bindings",
      limitsTitle: "What remains unavailable",
      limitsLabel: "Non-custodial boundary",
    },
    demo: {
      bannerNote: "Synthetic local artifacts only. No issuer, venue, wallet, chain or rail is called.",
      checkpointsAria: "Golden RWA sample checkpoints",
      step1: "1 · Stale proposal",
      step1Note: "REVIEW · two exact reasons",
      step2: "2 · Corrected action",
      step2Note: "Fresh sample evidence",
      step3: "3 · Local review",
      step3Note: "Exact hashes · demo only",
      wallet: "External wallet",
      walletNext: "Next boundary · no signature exists",
      walletNotReached: "Not reached",
      reading: "Reading this tab’s selected Action Case…",
      launchTitle: "Your current tab selection is preserved",
      launchBody: "Load the Golden RWA sample explicitly; it will become the same selected case in Simple and Pro.",
      loadSample: "Load sample",
    },
  },
  uk: {
    stageState: {
      done: "виконано",
      attention: "потребує уваги",
      waiting: "очікує",
      blocked: "заблоковано",
      unavailable: "недоступно",
    },
    phase: { propose: "Пропозиція", verify: "Перевірка", authorize: "Авторизація", execute: "Виконання", prove: "Доведення" },
    party: { agent: "Агент", ryntra: "Ryntra", wallet: "Зовнішній гаманець", rail: "Зовнішня рейка" },
    phasesAria: "Підсумок життєвого циклу з пʼяти фаз",
    request: {
      label: "Запит на авторизацію",
      agent: "Агент",
      amountAsset: "Сума / актив",
      counterparty: "Контрагент",
      mandate: "Мандат",
      budget: "Бюджет",
      network: "Мережа дії",
      noAmount: "Без суми",
      notNamed: "Не вказано",
      noFundedAction: "Дія з коштами не дозволена",
      budgetUsed: (amount, limit, asset) => `${amount} із ${limit} ${asset}`,
    },
    decision: {
      title: "Детерміноване рішення",
      reviewBound:
        "Зразковий перегляд привʼязано до цього хешу наміру, кореня доказів і дайджесту політики. Це не авторизація гаманцем.",
      allowReason:
        "Усі потрібні зразкові докази — в межах заявленого вікна чинності, а дія — в межах бюджету зразкового мандата.",
      noPositive: "Позитивного рішення немає.",
      codesAria: "Коди причин політики",
      humanStep: "Крок людини",
      walletResponsibility: "Відповідальність гаманця",
      walletBoundary: "Зовнішній гаманець. Ryntra не має ключа, не створює підпис і не рухає кошти.",
      expectedReceipt: "Очікувана Квитанція · не створена",
    },
    pro: {
      kpisAria: "Підсумок вибраної дії",
      decision: "Рішення",
      revision: "Ревізія",
      freshEvidence: "Свіжі докази",
      currentBoundary: "Поточна межа",
      lifecycleTitle: "Один Action Case через вісім стадій",
      lifecycleLabel: "Канонічна деталізація",
      stopsAt: "Зупиняється на",
      evidenceTitle: "Докази, використані цим рішенням",
      evidenceLabel: "Джерело і свіжість",
      freshness: { FRESH: "СВІЖИЙ", STALE: "ЗАСТАРІЛИЙ", NON_POSITIVE: "NON_POSITIVE" },
      observed: "Зафіксовано",
      validUntil: "чинний до",
      factsTitle: "Вибраний Action Case",
      factsLabel: "Точні привʼязки",
      limitsTitle: "Що лишається недоступним",
      limitsLabel: "Некастодіальна межа",
    },
    demo: {
      bannerNote: "Лише синтетичні локальні артефакти. Жоден емітент, майданчик, гаманець, ланцюг чи рейка не викликаються.",
      checkpointsAria: "Контрольні точки зразка Golden RWA",
      step1: "1 · Застаріла пропозиція",
      step1Note: "REVIEW · дві точні причини",
      step2: "2 · Виправлена дія",
      step2Note: "Свіжі зразкові докази",
      step3: "3 · Локальний перегляд",
      step3Note: "Точні хеші · лише демо",
      wallet: "Зовнішній гаманець",
      walletNext: "Наступна межа · підпису не існує",
      walletNotReached: "Не досягнуто",
      reading: "Читаємо вибраний Action Case цієї вкладки…",
      launchTitle: "Поточний вибір цієї вкладки збережено",
      launchBody: "Завантажте зразок Golden RWA явно — він стане тим самим вибраним Action Case у режимах «Простий» і «Профі».",
      loadSample: "Завантажити зразок",
    },
  },
} as const satisfies Record<WorkspaceLocale, GoldenRwaCopy>;

const VERDICT_TONE: Readonly<Record<Verdict, string>> = {
  ALLOW: "acw-verdict--ok",
  REVIEW: "acw-verdict--warn",
  BLOCK: "acw-verdict--bad",
  UNKNOWN: "acw-verdict--unknown",
};

function StageStateIcon({ state }: { readonly state: ActionStageState }) {
  if (state === "done") return <CheckCircle size={17} weight="bold" aria-hidden />;
  if (state === "attention") return <Warning size={17} weight="bold" aria-hidden />;
  if (state === "waiting") return <Circle size={17} weight="bold" aria-hidden />;
  if (state === "blocked") return <X size={17} weight="bold" aria-hidden />;
  return <Minus size={17} weight="bold" aria-hidden />;
}

function VerdictIcon({ verdict }: { readonly verdict: Verdict }) {
  if (verdict === "ALLOW") return <CheckCircle size={16} weight="bold" aria-hidden />;
  if (verdict === "REVIEW") return <Warning size={16} weight="bold" aria-hidden />;
  if (verdict === "BLOCK") return <X size={16} weight="bold" aria-hidden />;
  return <Question size={16} weight="bold" aria-hidden />;
}

function chainLabel(chainRef: string): string {
  return chainRef === "eip155:84532" ? `Base Sepolia · ${chainRef}` : chainRef;
}

function statusFor(actionCase: ActionCase, ids: readonly string[], fallback: ActionStageState) {
  const stages = actionCase.stages.filter((stage) => ids.includes(stage.id));
  return (
    stages.find((stage) => stage.state === "blocked")?.state ??
    stages.find((stage) => stage.state === "attention")?.state ??
    stages.find((stage) => stage.state === "waiting")?.state ??
    stages.find((stage) => stage.state === "unavailable")?.state ??
    (stages.length && stages.every((stage) => stage.state === "done") ? "done" : fallback)
  );
}

function FivePhaseLifecycle({ actionCase }: { readonly actionCase: ActionCase }) {
  const { locale } = useAgentI18n();
  const copy = COPY[locale];
  const authorization = actionCase.stages.find((stage) => stage.id === "authorization");
  const phases: readonly {
    id: string;
    label: string;
    party: string;
    state: ActionStageState;
  }[] = [
    { id: "propose", label: copy.phase.propose, party: copy.party.agent, state: statusFor(actionCase, ["intent"], "waiting") },
    {
      id: "verify",
      label: copy.phase.verify,
      party: copy.party.ryntra,
      state: statusFor(actionCase, ["evidence", "policy", "risk"], "waiting"),
    },
    {
      id: "authorize",
      label: copy.phase.authorize,
      party: copy.party.wallet,
      state: authorization?.state ?? "unavailable",
    },
    { id: "execute", label: copy.phase.execute, party: copy.party.rail, state: "unavailable" },
    { id: "prove", label: copy.phase.prove, party: copy.party.ryntra, state: "unavailable" },
  ];

  return (
    <ol className="acw-rwa-phases" aria-label={copy.phasesAria}>
      {phases.map((phase) => (
        <li key={phase.id} data-state={phase.state}>
          <span><StageStateIcon state={phase.state} /></span>
          <b>{phase.label}</b>
          <small>{copy.stageState[phase.state]} · {phase.party}</small>
        </li>
      ))}
    </ol>
  );
}

function VerdictBadge({ verdict }: { readonly verdict: Verdict }) {
  return (
    <span className={`acw-rwa-verdict acw-verdict ${VERDICT_TONE[verdict]}`}>
      <VerdictIcon verdict={verdict} />
      {verdict}
    </span>
  );
}

function SimpleActionCase({ actionCase }: { readonly actionCase: ActionCase }) {
  const { locale } = useAgentI18n();
  const copy = COPY[locale];
  const verdict = actionCaseVerdict(actionCase);
  const nonPositive = actionCase.evidenceItems.find((item) => item.reason);
  const reason = nonPositive?.reason ?? (
    actionCase.humanDecision === "RECORDED_DEMO_ONLY"
      ? copy.decision.reviewBound
      : verdict === "ALLOW"
        ? copy.decision.allowReason
        : actionCase.blockers[0] ?? copy.decision.noPositive
  );

  const facts: readonly (readonly [string, string])[] = [
    [copy.request.agent, actionCase.agentName ?? actionCase.agentId],
    [copy.request.amountAsset, actionCase.amount ? `${actionCase.amount} ${actionCase.assetRef}` : copy.request.noAmount],
    [copy.request.counterparty, actionCase.counterpartyRef ?? copy.request.notNamed],
    [copy.request.mandate, `${actionCase.policyId} v${actionCase.policyVersion}`],
    [
      copy.request.budget,
      actionCase.budgetLimitAmount
        ? copy.request.budgetUsed(actionCase.amount, actionCase.budgetLimitAmount, actionCase.budgetLimitAssetRef)
        : copy.request.noFundedAction,
    ],
    [copy.request.network, chainLabel(actionCase.chainRef)],
  ];

  return (
    <div className="acw-rwa-simple">
      <section className="acw-rwa-request" aria-labelledby="rwa-request-title">
        <h2 id="rwa-request-title">{actionCase.requestText}</h2>
        <span className="acw-rwa-label">{copy.request.label}</span>
        <dl>
          {facts.map(([term, value]) => (
            <div key={term}>
              <dt>{term}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="acw-rwa-decision" aria-labelledby="rwa-decision-title">
        <header>
          <h2 id="rwa-decision-title">{copy.decision.title}</h2>
          <VerdictBadge verdict={verdict} />
        </header>
        <p className="acw-rwa-reason">{reason}</p>
        {actionCase.policyReasonCodes.length ? (
          <div className="acw-rwa-codes" aria-label={copy.decision.codesAria}>
            {actionCase.policyReasonCodes.map((code) => <code key={code}>{code}</code>)}
          </div>
        ) : null}
        <dl className="acw-rwa-next">
          <div>
            <dt>{copy.decision.humanStep}</dt>
            <dd>{actionCase.nextStep}</dd>
          </div>
          <div>
            <dt>{copy.decision.walletResponsibility}</dt>
            <dd>{copy.decision.walletBoundary}</dd>
          </div>
          <div>
            <dt>{copy.decision.expectedReceipt}</dt>
            <dd>{actionCase.expectedEffects.join(" ")}</dd>
          </div>
        </dl>
      </section>

      <FivePhaseLifecycle actionCase={actionCase} />
    </div>
  );
}

function ProActionCase({ actionCase }: { readonly actionCase: ActionCase }) {
  const { locale } = useAgentI18n();
  const copy = COPY[locale];
  const verdict = actionCaseVerdict(actionCase);
  const freshCount = actionCase.evidenceItems.filter((item) => item.freshness === "FRESH").length;

  return (
    <div className="acw-rwa-pro">
      <section className="acw-rwa-kpis" aria-label={copy.pro.kpisAria}>
        <div><span>{copy.pro.decision}</span><VerdictBadge verdict={verdict} /></div>
        <div><span>{copy.pro.revision}</span><b>{actionCase.revision}</b></div>
        <div><span>{copy.pro.freshEvidence}</span><b>{freshCount} / {actionCase.evidenceCount}</b></div>
        <div><span>{copy.pro.currentBoundary}</span><b>{actionCase.currentStageId}</b></div>
      </section>

      <section className="acw-rwa-section" aria-labelledby="rwa-lifecycle-title">
        <header>
          <div>
            <h2 id="rwa-lifecycle-title">{copy.pro.lifecycleTitle}</h2>
            <span className="acw-rwa-label">{copy.pro.lifecycleLabel}</span>
          </div>
          <span className="acw-rwa-boundary">{copy.pro.stopsAt} {actionCase.currentStageId}</span>
        </header>
        <ActionCaseLifecycle actionCase={actionCase} />
      </section>

      <div className="acw-rwa-pro-grid">
        <section className="acw-rwa-section" aria-labelledby="rwa-evidence-title">
          <header>
            <div>
              <h2 id="rwa-evidence-title">{copy.pro.evidenceTitle}</h2>
              <span className="acw-rwa-label">{copy.pro.evidenceLabel}</span>
            </div>
          </header>
          <ul className="acw-rwa-evidence">
            {actionCase.evidenceItems.map((item) => (
              <li key={item.id}>
                <div>
                  <b>{item.provider}</b>
                  <span className="acw-break">{item.sourceRef}</span>
                </div>
                <span className="acw-rwa-evidence-state" data-state={item.freshness}>
                  {item.freshness === "FRESH"
                    ? <CheckCircle size={15} weight="bold" aria-hidden />
                    : <Warning size={15} weight="bold" aria-hidden />}
                  {copy.pro.freshness[item.freshness]}
                </span>
                <small>{copy.pro.observed} {item.observedAt} · {copy.pro.validUntil} {item.validUntil}</small>
                {item.reason ? <p>{item.reason}</p> : null}
              </li>
            ))}
          </ul>
        </section>

        <section className="acw-rwa-section" aria-labelledby="rwa-facts-title">
          <header>
            <div>
              <h2 id="rwa-facts-title">{copy.pro.factsTitle}</h2>
              <span className="acw-rwa-label">{copy.pro.factsLabel}</span>
            </div>
          </header>
          <ActionCaseFacts actionCase={actionCase} />
        </section>
      </div>

      <section className="acw-rwa-section acw-rwa-limitations" aria-labelledby="rwa-limits-title">
        <header>
          <div>
            <h2 id="rwa-limits-title">{copy.pro.limitsTitle}</h2>
            <span className="acw-rwa-label">{copy.pro.limitsLabel}</span>
          </div>
        </header>
        <ul>
          {actionCase.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}
        </ul>
      </section>
    </div>
  );
}

export function GoldenRwaWorkspace({ banner, stale, fresh, reviewed }: GoldenRwaWorkspaceProps) {
  const { locale } = useAgentI18n();
  const copy = COPY[locale];
  const { prefs } = useShell();
  const { cases, selected, remember, ready } = useActionCases();
  const demoIds = [stale.id, fresh.id];
  const selectedDemo = selected && demoIds.includes(selected.id) ? selected : null;

  /* A new tab starts on the first honest checkpoint. Existing tab-local work is
     never overwritten; in that case the operator explicitly loads the sample. */
  useEffect(() => {
    if (!ready || cases.length > 0) return;
    remember(stale);
  }, [cases.length, ready, remember, stale]);

  const step = !selectedDemo
    ? 0
    : selectedDemo.id === stale.id
      ? 1
      : selectedDemo.passportHash === reviewed.passportHash
        ? 3
        : 2;

  return (
    <div className="acw-rwa-demo">
      <div className="acw-rwa-banner" role="status">
        <ShieldWarning size={18} weight="bold" aria-hidden />
        <div>
          <b>{banner}</b>
          <span>{copy.demo.bannerNote}</span>
        </div>
      </div>

      <div className="acw-rwa-controls" role="group" aria-label={copy.demo.checkpointsAria}>
        <button type="button" aria-pressed={step === 1} onClick={() => remember(stale)}>
          <ShieldWarning size={16} weight="bold" aria-hidden />
          <span><b>{copy.demo.step1}</b><small>{copy.demo.step1Note}</small></span>
        </button>
        <button type="button" aria-pressed={step === 2} onClick={() => remember(fresh)}>
          <ArrowClockwise size={16} weight="bold" aria-hidden />
          <span><b>{copy.demo.step2}</b><small>{copy.demo.step2Note}</small></span>
        </button>
        <button
          type="button"
          aria-pressed={step === 3}
          disabled={step < 2}
          onClick={() => remember(reviewed)}
        >
          <LockKey size={16} weight="bold" aria-hidden />
          <span><b>{copy.demo.step3}</b><small>{copy.demo.step3Note}</small></span>
        </button>
        <div className="acw-rwa-wallet">
          <Wallet size={17} weight="bold" aria-hidden />
          <span><b>{copy.demo.wallet}</b><small>{step === 3 ? copy.demo.walletNext : copy.demo.walletNotReached}</small></span>
        </div>
      </div>

      {!ready ? (
        <p className="rw-note">{copy.demo.reading}</p>
      ) : !selectedDemo ? (
        <div className="acw-rwa-launch">
          <Check size={22} weight="bold" aria-hidden />
          <div>
            <h2>{copy.demo.launchTitle}</h2>
            <p>{copy.demo.launchBody}</p>
          </div>
          <button type="button" onClick={() => remember(stale)}>{copy.demo.loadSample}</button>
        </div>
      ) : prefs.mode === "pro" ? (
        <ProActionCase actionCase={selectedDemo} />
      ) : (
        <SimpleActionCase actionCase={selectedDemo} />
      )}
    </div>
  );
}
