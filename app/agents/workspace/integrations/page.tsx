import type { Metadata } from "next";

import {
  AdapterProjectionSummary,
  type AdapterProjectionCopy,
} from "@/app/agents/components/adapter-projection-summary";
import { AttentionMark } from "@/app/components/mark";
import { agentWorkspaceLocale } from "@/app/agents/workspace/i18n/server";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { Panel, PanelGrid } from "@/app/shell/panel";
import type { AdapterProjectionId } from "@/lib/agent-control/adapter-projection";
import { CURRENT_ADAPTER_PROJECTIONS } from "@/lib/agent-control/adapter-projection-current";

const COPY = {
  en: {
    metaTitle: "Adapter projections",
    metaDescription:
      "Solana and Stellar as two bounded readings of one action identity, with capability facts kept independent.",
    title: "Adapter projections",
    lead:
      "One action can be read from two operating surfaces without becoming two records. Agent Control owns actor, authority, policy and authorization; each ecosystem owns chain execution, settlement and reconciliation. The identity between them is the same frozen object.",
    environment: "READ ONLY",
    gridLabel: "Agent Control adapter projections",
    contractTitle: "One identity, two responsibilities",
    agentControlSpan: "agent attribution · owner authority or mandate · policy binding · authorization state",
    sharedIdentity: "Shared identity",
    sharedIdentitySpan: "actionId · action digest · policyVersion · optional Receipt reference",
    ecosystemName: "Ecosystem workspace",
    ecosystemSpan: "chain and asset identity · execution · settlement · reconciliation",
    note:
      "A missing binding stays missing. Provider capability, Ryntra maturity, route capability and user eligibility remain four separate facts; none can promote another.",
  },
  uk: {
    metaTitle: "Проєкції адаптерів",
    metaDescription:
      "Solana і Stellar як два обмежені прочитання однієї ідентичності дії, з незалежними фактами про можливості.",
    title: "Проєкції адаптерів",
    lead:
      "Одну дію можна читати з двох операційних поверхонь, і вона не стає двома записами. Agent Control відповідає за актора, повноваження, політику й авторизацію; кожна екосистема — за виконання в ланцюгу, розрахунок і звірку. Ідентичність між ними — той самий заморожений обʼєкт.",
    environment: "ЛИШЕ ЧИТАННЯ",
    gridLabel: "Проєкції адаптерів Agent Control",
    contractTitle: "Одна ідентичність, дві зони відповідальності",
    agentControlSpan: "атрибуція агента · повноваження власника або мандат · привʼязка політики · стан авторизації",
    sharedIdentity: "Спільна ідентичність",
    sharedIdentitySpan: "actionId · дайджест дії · policyVersion · опційне посилання на квитанцію",
    ecosystemName: "Кабінет екосистеми",
    ecosystemSpan: "ідентичність мережі й активу · виконання · розрахунок · звірка",
    note:
      "Відсутня привʼязка лишається відсутньою. Можливість провайдера, зрілість Ryntra, доступність маршруту та придатність користувача — чотири окремі факти; жоден не підвищує інший.",
  },
} as const satisfies Record<
  WorkspaceLocale,
  {
    metaTitle: string;
    metaDescription: string;
    title: string;
    lead: string;
    environment: string;
    gridLabel: string;
    contractTitle: string;
    agentControlSpan: string;
    sharedIdentity: string;
    sharedIdentitySpan: string;
    ecosystemName: string;
    ecosystemSpan: string;
    note: string;
  }
>;

/* The Ukrainian twin of the summary renderer's built-in English copy. For "en"
   no override is passed, so the component's own default renders byte-identical.
   The per-adapter lines mirror `lib/agent-control/adapter-projection-current.ts`,
   which stays English by contract. */
const UK_PROJECTION_BASE = {
  sharedIdentity: "Спільна ідентичність",
  actionId: "ID дії",
  actionDigest: "Дайджест дії",
  policyVersion: "Версія політики",
  receipt: "Квитанція",
  agentControlOwns: "Agent Control відповідає за",
  ecosystemOwns: "Екосистема відповідає за",
  axes: "Чотири незалежні факти",
  axisLabels: {
    providerCapability: "Можливість провайдера",
    ryntraMaturity: "Зрілість Ryntra",
    routeCapability: "Доступність маршруту",
    userEligibility: "Придатність користувача",
  },
  limitations: "Обмеження",
  nextGate: "Наступна умова",
  notBound: "Не привʼязано",
  openCounterpart: "Відкрити іншу проєкцію",
  agentResponsibilities: [
    "атрибуція агента",
    "повноваження власника або мандат",
    "привʼязка політики",
    "стан авторизації",
  ],
  ecosystemResponsibilities: [
    "ідентичність мережі й активу",
    "виконання",
    "розрахунок",
    "звірка",
  ],
} as const;

const UK_PROJECTION_COPY: Record<AdapterProjectionId, AdapterProjectionCopy> = {
  solana: {
    ...UK_PROJECTION_BASE,
    axisBasis: {
      providerCapability: "Адаптер Token-2022 визначає для Solana контракти читання вхідних даних і спостереження.",
      ryntraMaturity:
        "Контракт адаптера та єдиний верифікатор існують; жодного життєвого циклу Agent Control у Solana чи квитанції результату не існує.",
      routeCapability: "Жодного маршруту виконання Agent Control для Solana не змонтовано.",
      userEligibility: "Рішення про придатність користувача не ухвалювалося.",
    },
    limitationLines: [
      "Жодної дії в Solana, авторизації гаманця, транзакції чи квитанції результату не існує.",
      "Контракт адаптера лише для читання — це не здатність виконувати.",
      "Доступність верифікатора не доводить, що існує артефакт для перевірки.",
    ],
    nextGateText:
      "Проведіть одну підписану власником дію в основній мережі, незалежно поспостерігайте за нею і привʼяжіть квитанцію до тієї ж ідентичності дії Agent Control.",
  },
  stellar: {
    ...UK_PROJECTION_BASE,
    axisBasis: {
      providerCapability:
        "RPC/Horizon Stellar Testnet і життєвий цикл гаманця власника дали незалежно перевірювані докази.",
      ryntraMaturity:
        "Один підписаний власником платіж XLM доведено в Stellar Testnet; основна мережа лишається в режимі лише читання.",
      routeCapability: "Оцінювання політики та докази маршруту для Stellar зареєстровані, але не збудовані.",
      userEligibility: "Підпис гаманця доводить авторизацію байтів, а не право користуватися активом чи маршрутом.",
    },
    limitationLines: [
      "Наявна квитанція Stellar не має привʼязки до actionId чи policyVersion Agent Control.",
      "Авторизація власника — не делеговані повноваження агента, і її не можна перейменувати на мандат.",
      "Зафіксований життєвий цикл існує лише в тестовій мережі й не підтверджує маршрут виконання в основній.",
    ],
    nextGateText:
      "Перш ніж проєктувати її квитанцію як спільну ідентичність, проведіть майбутню дію Stellar через спільний конверт Agent Control з ненульовою policyVersion.",
  },
};

export async function generateMetadata(): Promise<Metadata> {
  const copy = COPY[await agentWorkspaceLocale()];
  return { title: copy.metaTitle, description: copy.metaDescription };
}

/**
 * The canonical adapter map.
 *
 * This is not an integration marketplace and it enables no route. It shows
 * exactly how one immutable identity is read by Agent Control and by a chain
 * workspace, then shows where current evidence stops for each ecosystem.
 */
export default async function AgentWorkspaceIntegrationsPage() {
  const locale = await agentWorkspaceLocale();
  const copy = COPY[locale];

  return (
    <div className="acw-page">
      <header className="acw-head">
        <div>
          <h1>{copy.title}</h1>
          <p>{copy.lead}</p>
        </div>
        <span className="acw-environment">{copy.environment}</span>
      </header>

      <PanelGrid label={copy.gridLabel}>
        <Panel
          id="agent-control-projection-contract"
          title={copy.contractTitle}
          w={12}
          h={4}
          essential
        >
          <div className="acw-projection-contract">
            <section>
              <b>Agent Control</b>
              <span>{copy.agentControlSpan}</span>
            </section>
            <div>
              <AttentionMark size={16} />
              <b>{copy.sharedIdentity}</b>
              <span>{copy.sharedIdentitySpan}</span>
            </div>
            <section>
              <b>{copy.ecosystemName}</b>
              <span>{copy.ecosystemSpan}</span>
            </section>
          </div>
          <p className="rw-note">{copy.note}</p>
        </Panel>

        {CURRENT_ADAPTER_PROJECTIONS.map((projection) => (
          <Panel
            key={projection.adapter.id}
            id={`agent-control-projection-${projection.adapter.id}`}
            title={projection.adapter.label}
            w={12}
            h={8}
            essential
            scroll
          >
            <AdapterProjectionSummary
              projection={projection}
              counterpartHref={projection.adapter.ecosystemPath}
              copy={locale === "uk" ? UK_PROJECTION_COPY[projection.adapter.id] : undefined}
            />
          </Panel>
        ))}
      </PanelGrid>
    </div>
  );
}
