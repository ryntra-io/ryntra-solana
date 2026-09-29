"use client";

import {
  ArrowRight,
  CheckCircle,
  Gauge,
  ListChecks,
  LockKey,
  ShieldCheck,
  ShieldWarning,
  Wallet,
  Warning,
} from "@phosphor-icons/react";
import { useEffect, useMemo } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import { buildActionCase, type ActionCase } from "@/lib/agent-control/action-case";
import type { ActionPassportPreview } from "@/lib/agent-control/contracts";
import {
  buildGoldenRwaOwnerControl,
  OwnerControlError,
} from "@/lib/agent-control/owner-control";

import { useActionCases } from "../action-case-store";
import { useAgentI18n } from "../i18n/provider";

type OwnerControlCopy = {
  mismatchTitle: string;
  mismatchBody: string;
  loadSample: string;
  banner: string;
  bannerNote: string;
  stripLabel: string;
  ownerDefault: string;
  ownerDefaultNote: string;
  mandate: string;
  mandateState: (version: number) => string;
  mandateNote: string;
  availableToday: string;
  availableNote: string;
  queueState: string;
  queueNote: string;
  authorityTitle: string;
  authorityLead: string;
  ownerPolicyStep: string;
  ownerPolicyStepNote: string;
  boundedMandateStep: string;
  boundedMandateState: string;
  boundedMandateNote: string;
  authorizationStep: string;
  authorizationState: string;
  authorizationNote: string;
  reasonExecution: { pre: string; post: string };
  reasonBypass: { pre: string; state: string; post: string };
  reasonAuthority: { mid: string; state: string; post: string };
  ownerPolicyTitle: string;
  policyMeta: (policyId: string, version: number) => string;
  immutable: string;
  dtOwner: string;
  dtAgentSubject: string;
  dtActionClass: string;
  dtNetwork: string;
  dtPerAction: string;
  dtDaily: string;
  dtCounterparty: string;
  dtValidUntil: string;
  budgetTitle: string;
  budgetLead: string;
  reconciled: string;
  budgetTrackLabel: string;
  legendReserved: string;
  legendCommitted: string;
  legendSettled: string;
  budgetRuleTail: string;
  evidenceTitle: string;
  evidenceLead: string;
  closedClasses: (count: number) => string;
};

const COPY = {
  en: {
    mismatchTitle: "The selected Action Case has no owner-control context",
    mismatchBody:
      "This studio has one fixed Golden RWA sample policy. It is not rebuilt around a different proposal, because a policy derived from the action it judges cannot prove scope.",
    loadSample: "Load the sample case",
    banner: "INTERACTIVE DEMO · SAMPLE DATA · NO FUNDS MOVE",
    bannerNote:
      "Read-only projection. No authenticated owner record, wallet permission, provider policy or transaction is created here.",
    stripLabel: "Owner control summary",
    ownerDefault: "Owner default",
    ownerDefaultNote: "Exact human authorization",
    mandate: "Mandate",
    mandateState: (version: number) => `ACTIVE · v${version}`,
    mandateNote: "Immutable sample version",
    availableToday: "Available today",
    availableNote: "Reserved and committed already removed",
    queueState: "Queue state",
    queueNote: "Stops before the external wallet",
    authorityTitle: "Where authority actually stops",
    authorityLead: "A decision is not a signature. A mandate name is not a technical grant.",
    ownerPolicyStep: "Owner policy",
    ownerPolicyStepNote: "Current sample rule",
    boundedMandateStep: "Bounded mandate",
    boundedMandateState: "BOUNDED_MANDATE · UNAVAILABLE",
    boundedMandateNote: "No revocable technical authority",
    authorizationStep: "Authorization",
    authorizationState: "EXTERNAL WALLET",
    authorizationNote: "Ryntra has no key",
    reasonExecution: { pre: "The execution path is ", post: "." },
    reasonBypass: { pre: "The external direct-call bypass is ", state: "OPEN", post: "." },
    reasonAuthority: { mid: " is ", state: "not present", post: "." },
    ownerPolicyTitle: "Owner policy",
    policyMeta: (policyId: string, version: number) => `${policyId} · version ${version}`,
    immutable: "IMMUTABLE",
    dtOwner: "Owner",
    dtAgentSubject: "Agent subject",
    dtActionClass: "Action class",
    dtNetwork: "Network",
    dtPerAction: "Per action",
    dtDaily: "Daily",
    dtCounterparty: "Counterparty",
    dtValidUntil: "Valid until",
    budgetTitle: "Budget ledger",
    budgetLead: "One asset, one active period, pessimistic reservation.",
    reconciled: "RECONCILED",
    budgetTrackLabel: "Sample budget allocation",
    legendReserved: "RESERVED · pending",
    legendCommitted: "COMMITTED · escrowed",
    legendSettled: "SETTLED · this period",
    budgetRuleTail: "RELEASED value returns to available; unresolved recovery does not.",
    evidenceTitle: "Action class → required evidence",
    evidenceLead: "The class is a control input. It changes the evidence contract before review.",
    closedClasses: (count: number) => `${count} CLOSED CLASSES`,
  },
  uk: {
    mismatchTitle: "У вибраного Action Case немає контексту контролю власника",
    mismatchBody:
      "У цій студії одна фіксована зразкова політика Golden RWA. Її не перебудовують під іншу пропозицію: політика, виведена з дії, яку вона сама оцінює, не може довести межі повноважень.",
    loadSample: "Завантажити зразковий кейс",
    banner: "ІНТЕРАКТИВНЕ ДЕМО · ЗРАЗКОВІ ДАНІ · КОШТИ НЕ РУХАЮТЬСЯ",
    bannerNote:
      "Проєкція лише для читання. Тут не створюється автентифікований запис власника, дозвіл гаманця, політика провайдера чи транзакція.",
    stripLabel: "Підсумок контролю власника",
    ownerDefault: "Типово для власника",
    ownerDefaultNote: "Точна авторизація людиною",
    mandate: "Мандат",
    mandateState: (version: number) => `АКТИВНИЙ · v${version}`,
    mandateNote: "Незмінна зразкова версія",
    availableToday: "Доступно сьогодні",
    availableNote: "Резерв і зобовʼязання вже вираховано",
    queueState: "Стан черги",
    queueNote: "Зупиняється перед зовнішнім гаманцем",
    authorityTitle: "Де насправді закінчуються повноваження",
    authorityLead: "Рішення — не підпис. Назва мандата — не технічний грант.",
    ownerPolicyStep: "Політика власника",
    ownerPolicyStepNote: "Чинне зразкове правило",
    boundedMandateStep: "Обмежений мандат",
    boundedMandateState: "BOUNDED_MANDATE · НЕДОСТУПНО",
    boundedMandateNote: "Немає відкличних технічних повноважень",
    authorizationStep: "Авторизація",
    authorizationState: "ЗОВНІШНІЙ ГАМАНЕЦЬ",
    authorizationNote: "Ryntra не має ключа",
    reasonExecution: { pre: "Шлях виконання — ", post: "." },
    reasonBypass: { pre: "Зовнішній обхід прямим викликом — ", state: "ВІДКРИТИЙ", post: "." },
    reasonAuthority: { mid: " — ", state: "відсутній", post: "." },
    ownerPolicyTitle: "Політика власника",
    policyMeta: (policyId: string, version: number) => `${policyId} · версія ${version}`,
    immutable: "НЕЗМІННА",
    dtOwner: "Власник",
    dtAgentSubject: "Субʼєкт-агент",
    dtActionClass: "Клас дії",
    dtNetwork: "Мережа",
    dtPerAction: "На дію",
    dtDaily: "На день",
    dtCounterparty: "Контрагент",
    dtValidUntil: "Дійсний до",
    budgetTitle: "Бюджетний реєстр",
    budgetLead: "Один актив, один активний період, песимістичне резервування.",
    reconciled: "ЗВІРЕНО",
    budgetTrackLabel: "Зразковий розподіл бюджету",
    legendReserved: "RESERVED · очікує",
    legendCommitted: "COMMITTED · в ескроу",
    legendSettled: "SETTLED · цей період",
    budgetRuleTail: "Вартість RELEASED повертається в доступне; неврегульоване відшкодування — ні.",
    evidenceTitle: "Клас дії → потрібні докази",
    evidenceLead: "Клас — це керівний вхід. Він змінює контракт доказів ще до перегляду.",
    closedClasses: (count: number) => `ЗАКРИТИХ КЛАСІВ: ${count}`,
  },
} as const satisfies Record<WorkspaceLocale, OwnerControlCopy>;

function sampleControl(actionCase: ActionCase) {
  try {
    return buildGoldenRwaOwnerControl(actionCase);
  } catch (error) {
    if (error instanceof OwnerControlError && error.reasonCode === "GOLDEN_RWA_ACTION_REQUIRED") {
      return null;
    }
    throw error;
  }
}

function money(value: string, asset: string): string {
  return `${value} ${asset}`;
}

export function OwnerControlView({ sample }: { readonly sample: ActionPassportPreview }) {
  const { locale } = useAgentI18n();
  const copy = COPY[locale];
  const { cases, selected, remember, ready } = useActionCases();
  const fallback = useMemo(() => buildActionCase(sample), [sample]);

  /* Preserve a person's existing tab. Seed the shared Action Case only when the
     tab is genuinely empty, exactly as Mission Control does. */
  useEffect(() => {
    if (!ready || cases.length > 0) return;
    remember(sample);
  }, [cases.length, ready, remember, sample]);

  const active = selected ?? fallback;
  const control = sampleControl(active);

  if (!control) {
    return (
      <section className="acw-oc-empty" aria-labelledby="owner-control-mismatch-title">
        <Warning size={22} weight="bold" aria-hidden />
        <div>
          <h2 id="owner-control-mismatch-title">{copy.mismatchTitle}</h2>
          <p>{copy.mismatchBody}</p>
        </div>
        <button type="button" onClick={() => remember(sample)}>
          {copy.loadSample} <ArrowRight size={16} weight="bold" aria-hidden />
        </button>
      </section>
    );
  }

  const { policy, mandate, queue, profiles } = control;
  const asset = queue.budget.assetRef;

  return (
    <div className="acw-oc">
      <div className="acw-oc-banner" role="status">
        <ShieldWarning size={19} weight="bold" aria-hidden />
        <div>
          <b>{copy.banner}</b>
          <span>{copy.bannerNote}</span>
        </div>
      </div>

      <section className="acw-oc-strip" aria-label={copy.stripLabel}>
        <div>
          <ShieldCheck size={18} weight="bold" aria-hidden />
          <span>{copy.ownerDefault}</span>
          <b>PER_ACTION</b>
          <small>{copy.ownerDefaultNote}</small>
        </div>
        <div>
          <ListChecks size={18} weight="bold" aria-hidden />
          <span>{copy.mandate}</span>
          <b>{copy.mandateState(mandate.version)}</b>
          <small>{copy.mandateNote}</small>
        </div>
        <div>
          <Gauge size={18} weight="bold" aria-hidden />
          <span>{copy.availableToday}</span>
          <b>{money(queue.budget.available, asset)}</b>
          <small>{copy.availableNote}</small>
        </div>
        <div>
          <Warning size={18} weight="bold" aria-hidden />
          <span>{copy.queueState}</span>
          <b>{queue.queueState}</b>
          <small>{copy.queueNote}</small>
        </div>
      </section>

      <section className="acw-oc-authority" aria-labelledby="owner-authority-title">
        <header>
          <div>
            <h2 id="owner-authority-title">{copy.authorityTitle}</h2>
            <p>{copy.authorityLead}</p>
          </div>
          <span><ShieldCheck size={15} weight="bold" aria-hidden /> {queue.enforcement}</span>
        </header>
        <div className="acw-oc-authority-flow">
          <div data-state="active">
            <CheckCircle size={20} weight="fill" aria-hidden />
            <span>{copy.ownerPolicyStep}</span>
            <b>PER_ACTION</b>
            <small>{copy.ownerPolicyStepNote}</small>
          </div>
          <ArrowRight size={20} weight="bold" aria-hidden />
          <div data-state="blocked">
            <LockKey size={20} weight="bold" aria-hidden />
            <span>{copy.boundedMandateStep}</span>
            <b>{copy.boundedMandateState}</b>
            <small>{copy.boundedMandateNote}</small>
          </div>
          <ArrowRight size={20} weight="bold" aria-hidden />
          <div data-state="external">
            <Wallet size={20} weight="bold" aria-hidden />
            <span>{copy.authorizationStep}</span>
            <b>{copy.authorizationState}</b>
            <small>{copy.authorizationNote}</small>
          </div>
        </div>
        <div className="acw-oc-authority-reasons">
          <p><Warning size={16} weight="bold" aria-hidden /> {copy.reasonExecution.pre}<b>OBSERVE_ONLY</b>{copy.reasonExecution.post}</p>
          <p><Warning size={16} weight="bold" aria-hidden /> {copy.reasonBypass.pre}<b>{copy.reasonBypass.state}</b>{copy.reasonBypass.post}</p>
          <p><Warning size={16} weight="bold" aria-hidden /> <code>technicalAuthority</code>{copy.reasonAuthority.mid}<b>{copy.reasonAuthority.state}</b>{copy.reasonAuthority.post}</p>
        </div>
      </section>

      <div className="acw-oc-grid">
        <section className="acw-oc-section" aria-labelledby="owner-policy-title">
          <header>
            <div>
              <h2 id="owner-policy-title">{copy.ownerPolicyTitle}</h2>
              <p>{copy.policyMeta(policy.policyId, policy.version)}</p>
            </div>
            <span><CheckCircle size={15} weight="bold" aria-hidden /> {copy.immutable}</span>
          </header>
          <dl className="acw-oc-facts">
            <div><dt>{copy.dtOwner}</dt><dd>{policy.ownerRef}</dd></div>
            <div><dt>{copy.dtAgentSubject}</dt><dd>{mandate.subjectRef}</dd></div>
            <div><dt>{copy.dtActionClass}</dt><dd>{mandate.actionClasses.join(", ")}</dd></div>
            <div><dt>{copy.dtNetwork}</dt><dd>{mandate.networks.join(", ")}</dd></div>
            <div><dt>{copy.dtPerAction}</dt><dd>{money(mandate.limits.perAction?.amount ?? "0", asset)}</dd></div>
            <div><dt>{copy.dtDaily}</dt><dd>{money(mandate.limits.daily?.amount ?? "0", asset)}</dd></div>
            <div><dt>{copy.dtCounterparty}</dt><dd>{mandate.counterparties.join(", ")}</dd></div>
            <div><dt>{copy.dtValidUntil}</dt><dd>{mandate.validUntil}</dd></div>
          </dl>
        </section>

        <section className="acw-oc-section" aria-labelledby="owner-budget-title">
          <header>
            <div>
              <h2 id="owner-budget-title">{copy.budgetTitle}</h2>
              <p>{copy.budgetLead}</p>
            </div>
            <span><Gauge size={15} weight="bold" aria-hidden /> {copy.reconciled}</span>
          </header>
          <div className="acw-oc-budget-total">
            <span>ALLOCATED</span>
            <b>{money(queue.budget.allocated, asset)}</b>
          </div>
          <div className="acw-oc-budget-track" aria-label={copy.budgetTrackLabel}>
            <span data-bucket="reserved" style={{ flexGrow: Number(queue.budget.reserved) }} />
            <span data-bucket="committed" style={{ flexGrow: Number(queue.budget.committed) }} />
            <span data-bucket="settled" style={{ flexGrow: Number(queue.budget.settled) }} />
            <span data-bucket="available" style={{ flexGrow: Number(queue.budget.available) }} />
          </div>
          <dl className="acw-oc-budget-legend">
            <div data-bucket="reserved"><dt>{copy.legendReserved}</dt><dd>{money(queue.budget.reserved, asset)}</dd></div>
            <div data-bucket="committed"><dt>{copy.legendCommitted}</dt><dd>{money(queue.budget.committed, asset)}</dd></div>
            <div data-bucket="settled"><dt>{copy.legendSettled}</dt><dd>{money(queue.budget.settled, asset)}</dd></div>
            <div data-bucket="available"><dt>AVAILABLE</dt><dd>{money(queue.budget.available, asset)}</dd></div>
          </dl>
          <p className="acw-oc-budget-rule">
            AVAILABLE = ALLOCATED − RESERVED − COMMITTED − SETTLED − RECOVERY.
            {" "}{copy.budgetRuleTail}
          </p>
        </section>
      </div>

      <section className="acw-oc-section acw-oc-evidence" aria-labelledby="owner-evidence-title">
        <header>
          <div>
            <h2 id="owner-evidence-title">{copy.evidenceTitle}</h2>
            <p>{copy.evidenceLead}</p>
          </div>
          <span>{copy.closedClasses(profiles.length)}</span>
        </header>
        <div className="acw-oc-profile-list">
          {profiles.map((profile) => (
            <details key={profile.actionClass} open={profile.actionClass === queue.actionClass}>
              <summary>
                <span>{profile.label}</span>
                <b>{profile.actionClass}</b>
                <small>{profile.canonicalClass}</small>
              </summary>
              <div>
                <p>{profile.riskNote}</p>
                <ul>
                  {profile.requiredEvidence.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </div>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
