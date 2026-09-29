"use client";

import Link from "next/link";
import { ArrowRight } from "@phosphor-icons/react";

import { EmptyState, Panel, PanelGrid } from "@/app/shell/panel";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { actionCaseVerdict } from "@/lib/agent-control/action-case";

import { useActionCases } from "../../action-case-store";
import { ActionCaseFacts, ActionCaseLifecycle } from "../../action-case-views";
import { useAgentI18n } from "../../i18n/provider";

type InspectorCopy = {
  loading: string;
  gridLabel: string;
  requestedTitle: string;
  requestedBadge: string;
  actionId: string;
  resolved: string;
  notResolved: string;
  whyTitle: string;
  notAvailableBadge: string;
  whyBody: string;
  insteadTitle: string;
  availableNowBadge: string;
  labTitle: string;
  labCta: string;
  labBody: string;
  overviewTitle: string;
  limitsTitle: string;
  limitationsBadge: string;
  lifecycleTitle: string;
  stopsAt: (stage: string) => string;
};

const COPY = {
  en: {
    loading: "Reading this tab’s actions…",
    gridLabel: "Agent Control action inspector",
    requestedTitle: "What was requested",
    requestedBadge: "URL PARAMETER",
    actionId: "Action id",
    resolved: "Resolved",
    notResolved:
      "Not in this browser tab. This Action Case list is deliberately tab-local, so a link shared with anyone else — or opened in a new tab — finds nothing.",
    whyTitle: "Why a link does not carry the action",
    notAvailableBadge: "NOT AVAILABLE",
    whyBody:
      "Phase 2C durably protects server-side authorization nonce and idempotency replay when a durable Guard store is configured, and production refuses a memory fallback. It does not publish browser Action Cases or make them resolvable by URL. A persistent Action Case ledger remains a separate, unbuilt capability.",
    insteadTitle: "What you can do instead",
    availableNowBadge: "AVAILABLE NOW",
    labTitle: "Compose and preflight one action in the Lab",
    labCta: "Open Action Passport Lab",
    labBody:
      "The Lab builds a strict intent, evaluates the deterministic policy and produces an Action Passport Preview. It computes; it stores nothing on a server, and it authorizes, signs and submits nothing.",
    overviewTitle: "Overview",
    limitsTitle: "What this artifact does not prove",
    limitationsBadge: "LIMITATIONS",
    lifecycleTitle: "One action through eight stages",
    stopsAt: (stage: string) => `STOPS AT ${stage}`,
  },
  uk: {
    loading: "Читаємо дії цієї вкладки…",
    gridLabel: "Інспектор дії Agent Control",
    requestedTitle: "Що було запитано",
    requestedBadge: "ПАРАМЕТР URL",
    actionId: "Ідентифікатор дії",
    resolved: "Знайдено",
    notResolved:
      "Не в цій вкладці браузера. Список Action Case навмисно локальний для вкладки, тож посилання, надіслане будь-кому іншому — або відкрите в новій вкладці — не знаходить нічого.",
    whyTitle: "Чому посилання не переносить дію",
    notAvailableBadge: "НЕДОСТУПНО",
    whyBody:
      "Фаза 2C стійко захищає серверні nonce авторизації та повтор ідемпотентності, коли налаштоване стійке сховище Guard, а продакшн відмовляється від запасного варіанта в памʼяті. Вона не публікує браузерні Action Cases і не робить їх доступними за URL. Постійний реєстр Action Case лишається окремою, ще не збудованою можливістю.",
    insteadTitle: "Що можна зробити натомість",
    availableNowBadge: "ДОСТУПНО ЗАРАЗ",
    labTitle: "Складіть і перевірте одну дію в Лабораторії",
    labCta: "Відкрити Лабораторію Action Passport",
    labBody:
      "Лабораторія будує строгий намір, оцінює детерміновану політику та створює Action Passport Preview. Вона обчислює; нічого не зберігає на сервері, нічого не авторизує, не підписує і не надсилає.",
    overviewTitle: "Огляд",
    limitsTitle: "Чого цей артефакт не доводить",
    limitationsBadge: "ОБМЕЖЕННЯ",
    lifecycleTitle: "Одна дія крізь вісім етапів",
    stopsAt: (stage: string) => `ЗУПИНЯЄТЬСЯ НА ${stage}`,
  },
} as const satisfies Record<WorkspaceLocale, InspectorCopy>;

/*
 * The Action Inspector.
 *
 * It looks the requested id up in the same tab-local store the Actions list
 * reads, so a link from that list opens the case that is already selected. When
 * the id is not there — a shared link, a new tab, a reload after the store was
 * cleared — it says so and names why, rather than rendering a skeleton that
 * reads like data still arriving.
 */
export function ActionInspector({ actionId }: { readonly actionId: string }) {
  const { cases, ready } = useActionCases();
  const { locale } = useAgentI18n();
  const copy = COPY[locale];
  const actionCase = cases.find((item) => item.id === actionId) ?? null;
  /* Displayed, never trusted: it arrived in a URL. React escapes it, and it is
     not used to fetch, resolve or route. */
  const shown = actionId.length > 96 ? `${actionId.slice(0, 96)}…` : actionId;

  if (!ready) return <p className="rw-note">{copy.loading}</p>;

  if (!actionCase) {
    return (
      <PanelGrid label={copy.gridLabel}>
        <Panel
          id="agent-control-action-requested"
          title={copy.requestedTitle}
          w={6}
          h={4}
          essential
          badge={copy.requestedBadge}
          tone="muted"
        >
          <div className="acw-fact-list">
            <p>
              <b>{copy.actionId}</b>
              <span className="acw-break">{shown}</span>
            </p>
            <p>
              <b>{copy.resolved}</b>
              <span>{copy.notResolved}</span>
            </p>
          </div>
        </Panel>

        <Panel
          id="agent-control-action-blocker"
          title={copy.whyTitle}
          w={6}
          h={4}
          essential
          badge={copy.notAvailableBadge}
          tone="caution"
        >
          <p className="rw-note">{copy.whyBody}</p>
        </Panel>

        <Panel id="agent-control-action-next" title={copy.insteadTitle} w={12} badge={copy.availableNowBadge} tone="evidence">
          <EmptyState
            title={copy.labTitle}
            action={
              <Link className="rw-btn" href="/agents/workspace/lab">
                {copy.labCta} <ArrowRight size={14} weight="bold" aria-hidden />
              </Link>
            }
          >
            {copy.labBody}
          </EmptyState>
        </Panel>
      </PanelGrid>
    );
  }

  const verdict = actionCaseVerdict(actionCase);

  return (
    <PanelGrid label={copy.gridLabel}>
      <Panel
        id="agent-control-action-overview"
        title={copy.overviewTitle}
        w={8}
        h={6}
        essential
        badge={verdict}
        tone={verdict === "BLOCK" ? "caution" : "evidence"}
        scroll
      >
        <p className="rw-note acw-next">{actionCase.nextStep}</p>
        <ActionCaseFacts actionCase={actionCase} />
      </Panel>

      <Panel
        id="agent-control-action-limits"
        title={copy.limitsTitle}
        w={4}
        h={6}
        essential
        badge={copy.limitationsBadge}
        tone="muted"
        scroll
      >
        <div className="acw-fact-list">
          {actionCase.limitations.map((line) => (
            <p key={line}>
              <span>{line}</span>
            </p>
          ))}
        </div>
      </Panel>

      <Panel
        id="agent-control-action-lifecycle"
        title={copy.lifecycleTitle}
        w={12}
        /* Eight cards over two rows need the room. Without a height the panel
           sizes to nothing and clips them, which is the third time `.rw-empty`
           and its siblings have taught this lesson in one packet. */
        h={8}
        badge={copy.stopsAt(actionCase.currentStageId.toUpperCase())}
        tone="muted"
      >
        <ActionCaseLifecycle actionCase={actionCase} />
      </Panel>
    </PanelGrid>
  );
}
