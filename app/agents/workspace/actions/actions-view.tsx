"use client";

import {
  CheckCircle,
  Gauge,
  ListChecks,
  ShieldWarning,
} from "@phosphor-icons/react";

import { EmptyState, Panel, PanelGrid } from "@/app/shell/panel";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { actionCaseVerdict } from "@/lib/agent-control/action-case";
import {
  buildGoldenRwaOwnerControl,
  OwnerControlError,
  type AgentOwnerQueueItem,
} from "@/lib/agent-control/owner-control";

import { useActionCases } from "../action-case-store";
import { ActionCaseFacts, ActionCaseLifecycle, ActionCaseList } from "../action-case-views";
import { useAgentI18n } from "../i18n/provider";

type ActionsCopy = {
  gridLabel: string;
  listTitle: string;
  listBadge: string;
  selectedTitle: string;
  ownerTitle: string;
  ownerNoContextBadge: string;
  ownerNoContext: string;
  ownerDecision: string;
  pendingReview: string;
  authorizationMode: string;
  budgetImpact: string;
  stillAvailable: (available: string) => string;
  requiredEvidence: string;
  evidenceFields: (count: number) => string;
  inspectSummary: string;
  decisionReasons: string;
  knownBypass: string;
  lifecycleTitle: string;
  stopsAt: (stage: string) => string;
  blockerTitle: string;
  notAvailableBadge: string;
  emptyTitle: string;
  emptyBody: string;
};

const COPY = {
  en: {
    gridLabel: "Agent Control actions",
    listTitle: "Actions in this browser tab",
    listBadge: "TAB LOCAL",
    selectedTitle: "Selected action",
    ownerTitle: "Owner policy and budget exposure",
    ownerNoContextBadge: "NO CONTEXT",
    ownerNoContext:
      "This Action Case has no owner-policy or budget-ledger context attached. Exact per-action authorization remains the default; the workspace does not derive a policy from the proposal it is meant to judge.",
    ownerDecision: "Owner decision",
    pendingReview: "PENDING_REVIEW · exact person required",
    authorizationMode: "Authorization mode",
    budgetImpact: "Budget impact",
    stillAvailable: (available: string) => `${available} still available`,
    requiredEvidence: "Required evidence",
    evidenceFields: (count: number) => `${count} fields`,
    inspectSummary: "Inspect owner-control reasons and evidence contract",
    decisionReasons: "Decision reasons",
    knownBypass: "Known bypass",
    lifecycleTitle: "One action through eight stages",
    stopsAt: (stage: string) => `STOPS AT ${stage}`,
    blockerTitle: "Why this list is tab-local",
    notAvailableBadge: "NOT AVAILABLE",
    emptyTitle: "No persistent Action Case ledger is connected",
    emptyBody:
      "Phase 2C made server-side authorization replay use the configured durable Guard store and fail loudly in production if only memory is available. That security record is not this UI list: Action Cases remain a bounded browser-tab projection, and no server history is implied.",
  },
  uk: {
    gridLabel: "Дії Agent Control",
    listTitle: "Дії в цій вкладці браузера",
    listBadge: "ЛОКАЛЬНО У ВКЛАДЦІ",
    selectedTitle: "Вибрана дія",
    ownerTitle: "Політика власника та бюджетна експозиція",
    ownerNoContextBadge: "БЕЗ КОНТЕКСТУ",
    ownerNoContext:
      "До цього Action Case не прикріплено контексту політики власника чи бюджетного реєстру. Точна авторизація кожної дії лишається типовою; кабінет не виводить політику з пропозиції, яку сам має оцінювати.",
    ownerDecision: "Рішення власника",
    pendingReview: "PENDING_REVIEW · потрібна конкретна особа",
    authorizationMode: "Режим авторизації",
    budgetImpact: "Вплив на бюджет",
    stillAvailable: (available: string) => `ще доступно ${available}`,
    requiredEvidence: "Потрібні докази",
    evidenceFields: (count: number) => {
      const mod10 = count % 10;
      const mod100 = count % 100;
      if (mod10 === 1 && mod100 !== 11) return `${count} поле`;
      if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} поля`;
      return `${count} полів`;
    },
    inspectSummary: "Переглянути причини рішення власника і контракт доказів",
    decisionReasons: "Причини рішення",
    knownBypass: "Відомі обходи",
    lifecycleTitle: "Одна дія крізь вісім етапів",
    stopsAt: (stage: string) => `ЗУПИНЯЄТЬСЯ НА ${stage}`,
    blockerTitle: "Чому цей список локальний для вкладки",
    notAvailableBadge: "НЕДОСТУПНО",
    emptyTitle: "Постійний реєстр Action Case не підключено",
    emptyBody:
      "У Фазі 2C серверний повтор авторизації використовує налаштоване стійке сховище Guard і в продакшні явно відмовляє, якщо доступна лише памʼять. Той безпековий запис — не цей список в інтерфейсі: Action Cases лишаються обмеженою проєкцією вкладки браузера, і жодної серверної історії це не обіцяє.",
  },
} as const satisfies Record<WorkspaceLocale, ActionsCopy>;

/*
 * Actions, as two views of one selected case rather than a table beside a
 * detail pane that fetched its own copy.
 *
 * The list and the inspector read the same store, so selecting a row moves the
 * inspector, and the Lab producing an artifact moves both. That is the whole of
 * Phase 2B on this screen. RYN-AGENT-CONTROL-010 adds the owner-control
 * projection without creating a second Action: policy version, budget impact
 * and required evidence are computed against the selected Action Case.
 */
function ownerQueueForSelected(actionCase: NonNullable<ReturnType<typeof useActionCases>["selected"]>) {
  try {
    return buildGoldenRwaOwnerControl(actionCase).queue;
  } catch (error) {
    if (error instanceof OwnerControlError && error.reasonCode === "GOLDEN_RWA_ACTION_REQUIRED") {
      return null;
    }
    throw error;
  }
}

function OwnerDecision({ queue }: { readonly queue: AgentOwnerQueueItem }) {
  const { locale } = useAgentI18n();
  const copy = COPY[locale];

  return (
    <div className="acw-action-owner">
      <div className="acw-action-owner-summary">
        <div>
          <ShieldWarning size={17} weight="bold" aria-hidden />
          <span>{copy.ownerDecision}</span>
          <b>{queue.decision}</b>
          <small>{queue.queueState === "PENDING_REVIEW" ? copy.pendingReview : queue.queueState}</small>
        </div>
        <div>
          <CheckCircle size={17} weight="bold" aria-hidden />
          <span>{copy.authorizationMode}</span>
          <b>{queue.authorizationMode}</b>
          <small>{queue.enforcement}</small>
        </div>
        <div>
          <Gauge size={17} weight="bold" aria-hidden />
          <span>{copy.budgetImpact}</span>
          <b>{queue.budget.impact} {queue.budget.assetRef}</b>
          <small>{queue.budget.impactBucket} · {copy.stillAvailable(queue.budget.available)}</small>
        </div>
        <div>
          <ListChecks size={17} weight="bold" aria-hidden />
          <span>{copy.requiredEvidence}</span>
          <b>{copy.evidenceFields(queue.requiredEvidence.length)}</b>
          <small>{queue.actionClass} · {queue.canonicalClass}</small>
        </div>
      </div>
      <details className="acw-action-owner-detail">
        <summary>{copy.inspectSummary}</summary>
        <div>
          <section>
            <h3>{copy.decisionReasons}</h3>
            <ul>{queue.reasonCodes.map((reason) => <li key={reason}>{reason}</li>)}</ul>
          </section>
          <section>
            <h3>{copy.requiredEvidence}</h3>
            <ul>{queue.requiredEvidence.map((item) => <li key={item}>{item}</li>)}</ul>
          </section>
          <section>
            <h3>{copy.knownBypass}</h3>
            <ul>
              {queue.knownBypassRoutes.map((route) => (
                <li key={route.routeId}>{route.status} · {route.description}</li>
              ))}
            </ul>
          </section>
        </div>
      </details>
    </div>
  );
}

export function ActionsView() {
  const { selected } = useActionCases();
  const { locale } = useAgentI18n();
  const copy = COPY[locale];
  const verdict = selected ? actionCaseVerdict(selected) : null;
  const ownerQueue = selected ? ownerQueueForSelected(selected) : null;

  return (
    <PanelGrid label={copy.gridLabel}>
      <Panel
        id="agent-control-actions-list"
        title={copy.listTitle}
        w={selected ? 4 : 12}
        h={selected ? 6 : 4}
        essential
        badge={copy.listBadge}
        tone="muted"
        scroll
      >
        <ActionCaseList />
      </Panel>

      {selected ? (
        <>
          <Panel
            id="agent-control-actions-selected"
            title={copy.selectedTitle}
            w={8}
            h={6}
            essential
            badge={verdict ?? "UNKNOWN"}
            tone={verdict === "BLOCK" ? "caution" : "evidence"}
            scroll
          >
            <p className="rw-note acw-next">{selected.nextStep}</p>
            <ActionCaseFacts actionCase={selected} />
          </Panel>

          <Panel
            id="agent-control-actions-owner-control"
            title={copy.ownerTitle}
            w={12}
            /* Four rows fit the closed summary without the half-screen empty
               tail a six-row data panel produced on desktop. The disclosure
               remains inside the intentional scrollport when opened. */
            h={ownerQueue ? 4 : 2}
            essential
            badge={ownerQueue?.queueState ?? copy.ownerNoContextBadge}
            tone={ownerQueue?.decision === "BLOCK" ? "caution" : "evidence"}
            scroll
          >
            {ownerQueue ? (
              <OwnerDecision queue={ownerQueue} />
            ) : (
              <p className="rw-note">{copy.ownerNoContext}</p>
            )}
          </Panel>

          <Panel
            id="agent-control-actions-lifecycle"
            title={copy.lifecycleTitle}
            w={12}
            /* Eight cards over two rows need the room. Without a height the panel
               sizes to nothing and clips them, which is the third time `.rw-empty`
               and its siblings have taught this lesson in one packet. */
            h={8}
            badge={copy.stopsAt(selected.currentStageId.toUpperCase())}
            tone="muted"
          >
            <ActionCaseLifecycle actionCase={selected} />
          </Panel>
        </>
      ) : (
        <Panel
          id="agent-control-actions-blocker"
          title={copy.blockerTitle}
          w={12}
          /* `.rw-empty` collapses without a panel height and clips its own
             sentence — the same defect the surface pages hit in Phase 2A. */
          h={4}
          badge={copy.notAvailableBadge}
          tone="muted"
        >
          <EmptyState title={copy.emptyTitle}>{copy.emptyBody}</EmptyState>
        </Panel>
      )}
    </PanelGrid>
  );
}
