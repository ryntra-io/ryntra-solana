import type { Metadata } from "next";
import { Info } from "@phosphor-icons/react/dist/ssr";

import { Panel, PanelGrid } from "@/app/shell/panel";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { buildProcurementSurface, usdc } from "@/lib/agent-control/procurement/current";

import { agentWorkspaceLocale } from "../i18n/server";
import styles from "./procurement.module.css";

/**
 * The agents' hub: who may be paid, and who authorizes it.
 *
 * The page answers four questions and stops. **Who may an agent of Ryntra pay?**
 * — the provider registry, which is empty, and the reason it is. **Who
 * authorizes a payment?** — the mandate table, produced by asking the gate
 * rather than by writing it down. **What is free and what is for sale?** — one
 * paid service and seven facts that never are. **What stops this being real?**
 * — the exact missing things.
 *
 * Every verdict is computed at render time by the hub's own code. Nothing here
 * can pay for anything, and nothing on it is a hand-written status.
 */

type ProcurementCopy = Readonly<{
  metaTitle: string;
  metaDescription: string;
  eyebrow: string;
  heading: string;
  lead: string;
  environment: string;
  gridLabel: string;
  registry: Readonly<{
    title: string;
    badge: (count: number) => string;
    emptyTitle: string;
    emptyBody: string;
    envIntro: string;
    bounds: string;
    perCall: string;
    daily: string;
    agentBound: string;
    quoteAge: string;
    receipt: string;
    refund: string;
    explainLabel: string;
    explainBody: React.ReactNode;
  }>;
  mandates: Readonly<{
    title: string;
    badge: (alone: number, total: number) => string;
    holdsRecipient: string;
    holdsExpiry: string;
    who: Readonly<Record<string, string>>;
    kinds: Readonly<Record<string, string>>;
    explainLabel: string;
    explainBody: React.ReactNode;
  }>;
  free: Readonly<{ title: string; badge: string; never: string }>;
  sale: Readonly<{
    title: string;
    badge: string;
    badgeSellable: string;
    adds: string;
    excludes: string;
    blockers: string;
  }>;
  protocol: Readonly<{
    title: string;
    badge: string;
    headers: string;
    refused: string;
    networks: string;
    packages: string;
    facilitators: string;
    ownFacilitator: string;
  }>;
  pull: Readonly<{ title: string; badge: string; audit: string; tried: string }>;
  blockers: Readonly<{ title: string; badge: string }>;
}>;

const COPY = {
  en: {
    metaTitle: "Agents and payments",
    metaDescription:
      "The Solana agents' hub: a registry of who may be paid, a mandate the program enforces, and one paid service beside the facts that stay free.",
    eyebrow: "Agent Control / Agents and payments",
    heading: "Agents and payments",
    lead: "An agent of Ryntra pays a registered provider or nobody. Without a person's signature it acts only where the program itself holds both the recipient and the end date.",
    environment: "READ ONLY",
    gridLabel: "The Solana agents' procurement hub",
    registry: {
      title: "Who an agent may pay",
      badge: (count) => (count === 1 ? "1 service" : `${count} services`),
      emptyTitle: "Nobody.",
      emptyBody:
        "No provider is registered, so every payment refuses at PROVIDER_NOT_REGISTERED. A URL that arrives in a prompt, a tool result or a web page is never payable, whatever it says about itself.",
      envIntro: "Four values decide where this hub sells, who is paid, at what price and through which facilitator:",
      bounds: "The bounds this hub buys under",
      perCall: "Per call",
      daily: "Per day",
      agentBound: "Agent acts alone up to",
      quoteAge: "A quote stands for",
      receipt: "Receipt",
      refund: "Refund path",
      explainLabel: "Why an empty registry is the answer rather than a gap",
      explainBody: (
        <>
          <p>
            The specification&rsquo;s rule is one line: an agent cannot pay an arbitrary URL from a
            prompt. A registry that held an example so the page looked finished would be the first
            thing somebody pointed an agent at.
          </p>
          <ul>
            <li>A provider is matched on its whole origin and an exact path. A host that merely contains a registered name is a different host.</li>
            <li>No entry carries a credential. An API key is not a spending permission.</li>
            <li>Ryntra is the first provider, once a chain, a recipient, a price and a facilitator are set — so the first paid round trip is inside one product.</li>
          </ul>
        </>
      ),
    },
    mandates: {
      title: "Who authorizes a payment",
      badge: (alone, total) => `${alone} of ${total} act alone`,
      holdsRecipient: "recipient",
      holdsExpiry: "end date",
      who: {
        AGENT_ALONE: "agent alone",
        HUMAN_CONFIRMATION: "a person confirms",
        HUMAN_SIGNATURE: "a person signs",
      },
      kinds: {
        SQUADS_SMART_ACCOUNT_SPENDING_LIMIT: "Squads Smart Account spending limit",
        SUBSCRIPTIONS_MERCHANT_PLAN: "Subscriptions merchant plan",
        SQUADS_V4_SPENDING_LIMIT: "Squads v4 spending limit",
        SUBSCRIPTIONS_FIXED_DELEGATION: "Subscriptions fixed limit",
        SUBSCRIPTIONS_RECURRING_DELEGATION: "Subscriptions recurring limit",
        BLUESHIFT_PULL_DELEGATION: "Pull Program (Blueshift)",
      },
      explainLabel: "Why a missing field is a refusal rather than a smaller allowance",
      explainBody: (
        <>
          <p>
            A Squads v4 spending limit has no expiry in the program, so nothing on chain ends it. A
            timer on Ryntra&rsquo;s side is a timer in the party that benefits, and the authority is
            still there when the process holding it restarts.
          </p>
          <ul>
            <li>A Subscriptions fixed or recurring limit binds who may pull and not where the money goes, so an agent holding one can pay itself.</li>
            <li>Above Ryntra&rsquo;s own bound the mandate is still sound and a person confirms that one action. That is deliberately a different answer from &ldquo;a person signs&rdquo;.</li>
            <li>Every row is the gate&rsquo;s verdict on a read as favourable as its program allows, computed here rather than written down.</li>
          </ul>
        </>
      ),
    },
    free: {
      title: "What stays free",
      badge: "Never sold",
      never: "Never monetised",
    },
    sale: {
      title: "The one thing for sale",
      badge: "Not sellable yet",
      badgeSellable: "For sale",
      adds: "What it adds",
      excludes: "What it is not",
      blockers: "What is missing",
    },
    protocol: {
      title: "How a payment is spoken",
      badge: "x402 V2",
      headers: "Headers",
      refused: "Refused header",
      networks: "Chains",
      packages: "Client packages",
      facilitators: "Facilitators",
      ownFacilitator: "Ryntra runs no facilitator of its own.",
    },
    pull: {
      title: "The Pull Program",
      badge: "No audit",
      audit: "Audit",
      tried: "May be tried on",
    },
    blockers: { title: "What stops this being real", badge: "No money path" },
  },
  uk: {
    metaTitle: "Агенти й платежі",
    metaDescription:
      "Хаб агентів Solana: реєстр тих, кому можна платити, мандат, який примушує програма, і одна платна послуга поруч із фактами, що лишаються безкоштовними.",
    eyebrow: "Agent Control / Агенти й платежі",
    heading: "Агенти й платежі",
    lead: "Агент Ryntra платить зареєстрованому постачальнику або нікому. Без підпису людини він діє лише там, де програма сама тримає і отримувача, і строк.",
    environment: "ЛИШЕ ЧИТАННЯ",
    gridLabel: "Хаб закупівель агентів Solana",
    registry: {
      title: "Кому агент може платити",
      badge: (count) => (count === 1 ? "1 послуга" : `${count} послуг`),
      emptyTitle: "Нікому.",
      emptyBody:
        "Жодного постачальника не зареєстровано, тож кожен платіж відмовляє з PROVIDER_NOT_REGISTERED. URL, що прийшов у промпті, у відповіді інструмента чи на вебсторінці, оплатити не можна — що б він про себе не казав.",
      envIntro: "Чотири значення вирішують, де цей хаб продає, кому платять, за якою ціною і через який фасилітатор:",
      bounds: "Межі, у яких цей хаб купує",
      perCall: "На один виклик",
      daily: "На добу",
      agentBound: "Агент діє сам до",
      quoteAge: "Котировка стоїть",
      receipt: "Квитанція",
      refund: "Шлях повернення",
      explainLabel: "Чому порожній реєстр — це відповідь, а не прогалина",
      explainBody: (
        <>
          <p>
            Правило специфікації — один рядок: агент не може оплатити довільний URL із промпту.
            Реєстр із прикладом «щоб сторінка виглядала готовою» був би першим, на що агента
            спрямували б.
          </p>
          <ul>
            <li>Постачальник звіряється за цілим origin і точним шляхом. Хост, який лише містить зареєстровану назву, — це інший хост.</li>
            <li>Жоден запис не несе облікових даних. Ключ API — не дозвіл витрачати.</li>
            <li>Першим постачальником стає Ryntra, коли задано мережу, отримувача, ціну й фасилітатор, — щоб перший платний обіг був усередині одного продукту.</li>
          </ul>
        </>
      ),
    },
    mandates: {
      title: "Хто дозволяє платіж",
      badge: (alone, total) => `${alone} з ${total} діють самі`,
      holdsRecipient: "отримувач",
      holdsExpiry: "строк",
      who: {
        AGENT_ALONE: "агент сам",
        HUMAN_CONFIRMATION: "людина підтверджує",
        HUMAN_SIGNATURE: "людина підписує",
      },
      kinds: {
        SQUADS_SMART_ACCOUNT_SPENDING_LIMIT: "Ліміт витрат Squads Smart Account",
        SUBSCRIPTIONS_MERCHANT_PLAN: "План мерчанта Subscriptions",
        SQUADS_V4_SPENDING_LIMIT: "Ліміт витрат Squads v4",
        SUBSCRIPTIONS_FIXED_DELEGATION: "Фіксований ліміт Subscriptions",
        SUBSCRIPTIONS_RECURRING_DELEGATION: "Регулярний ліміт Subscriptions",
        BLUESHIFT_PULL_DELEGATION: "Pull Program (Blueshift)",
      },
      explainLabel: "Чому брак поля — це відмова, а не менший дозвіл",
      explainBody: (
        <>
          <p>
            Ліміт витрат Squads v4 не має строку в програмі, тож у ланцюзі його ніщо не закінчує.
            Таймер на боці Ryntra — це таймер у тієї сторони, якій це вигідно, а повноваження
            лишається на місці, коли процес перезапускається.
          </p>
          <ul>
            <li>Фіксований і регулярний ліміт Subscriptions тримають, хто може знімати, а не куди йдуть гроші, тож агент із таким лімітом може заплатити собі.</li>
            <li>Понад власну межу Ryntra мандат лишається чинним, і людина підтверджує саму цю дію. Це свідомо інша відповідь, ніж «людина підписує».</li>
            <li>Кожен рядок — вердикт гейта на читанні, настільки сприятливому, наскільки дозволяє його програма; обчислено тут, а не записано поруч.</li>
          </ul>
        </>
      ),
    },
    free: {
      title: "Що лишається безкоштовним",
      badge: "Ніколи не продається",
      never: "Ніколи не монетизуємо",
    },
    sale: {
      title: "Єдине, що продається",
      badge: "Ще не продається",
      badgeSellable: "Продається",
      adds: "Що додає",
      excludes: "Чим не є",
      blockers: "Чого бракує",
    },
    protocol: {
      title: "Якою мовою говорить платіж",
      badge: "x402 V2",
      headers: "Заголовки",
      refused: "Відхилений заголовок",
      networks: "Мережі",
      packages: "Пакети клієнта",
      facilitators: "Фасилітатори",
      ownFacilitator: "Свого фасилітатора Ryntra не тримає.",
    },
    pull: {
      title: "Pull Program",
      badge: "Без аудиту",
      audit: "Аудит",
      tried: "Можна пробувати на",
    },
    blockers: { title: "Що заважає цьому бути справжнім", badge: "Немає грошового шляху" },
  },
} as const satisfies Record<WorkspaceLocale, ProcurementCopy>;

export async function generateMetadata(): Promise<Metadata> {
  const copy = COPY[await agentWorkspaceLocale()];
  return { title: copy.metaTitle, description: copy.metaDescription };
}

function Explain({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <details className={styles.explain}>
      <summary>
        <Info size={15} weight="bold" aria-hidden />
        <span>{label}</span>
      </summary>
      <div>{children}</div>
    </details>
  );
}

export default async function AgentWorkspaceProcurementPage() {
  const locale = await agentWorkspaceLocale();
  const copy = COPY[locale];
  const surface = buildProcurementSurface({
    env: process.env,
    origin: null,
    nowMs: Date.now(),
  });

  const alone = surface.mandates.filter((row) => row.authorization === "AGENT_ALONE").length;

  return (
    <div className="acw-page">
      <header className="acw-head">
        <div>
          <span className="acw-eyebrow">{copy.eyebrow}</span>
          {/* The EN heading stays a literal: the surface test pins
              `<h1>Agents and payments</h1>` in this source file. */}
          {locale === "uk" ? <h1>{copy.heading}</h1> : <h1>Agents and payments</h1>}
          <p>{copy.lead}</p>
        </div>
        <span className="acw-environment">{copy.environment}</span>
      </header>

      <PanelGrid label={copy.gridLabel}>
        <Panel
          id="agent-control-procurement-registry"
          title={copy.registry.title}
          w={6}
          h={6}
          essential
          scroll
          badge={copy.registry.badge(surface.registry.services.length)}
          tone={surface.registry.services.length > 0 ? "caution" : "muted"}
        >
          <div className={styles.stack}>
            {surface.registry.services.length === 0 ? (
              <div className={styles.empty}>
                <b>{copy.registry.emptyTitle}</b>
                <span>{copy.registry.emptyBody}</span>
                <span>{copy.registry.envIntro}</span>
                <ul className={styles.envList}>
                  {surface.sale.envNames.map((name) => (
                    <li key={name}>
                      <code>{name}</code>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className={styles.rows}>
                {surface.registry.services.map((entry) => (
                  <article className={styles.row} key={entry.resource}>
                    <div className={styles.rowHead}>
                      <b>
                        {entry.provider} · {entry.service}
                      </b>
                      <span className={styles.verdict}>
                        {usdc(entry.priceBaseUnits)} {entry.assetSymbol}
                      </span>
                    </div>
                    <code>{entry.resource}</code>
                    <span>
                      {entry.network} · {entry.reach.replace(/_/g, " ").toLowerCase()} ·{" "}
                      {entry.refund.replace(/_/g, " ").toLowerCase()}
                    </span>
                  </article>
                ))}
              </div>
            )}

            <div className={styles.pairs}>
              <div className={styles.pair}>
                <span>{copy.registry.bounds}</span>
                <code>
                  {surface.policy.id}@{surface.policy.version}
                </code>
              </div>
              <div className={styles.pair}>
                <span>{copy.registry.perCall}</span>
                <b>{usdc(surface.policy.perCallBaseUnits)} USDC</b>
              </div>
              <div className={styles.pair}>
                <span>{copy.registry.daily}</span>
                <b>{usdc(surface.policy.dailyBaseUnits)} USDC</b>
              </div>
              <div className={styles.pair}>
                <span>{copy.registry.agentBound}</span>
                <b>{usdc(surface.policy.agentBoundBaseUnits)} USDC</b>
              </div>
              <div className={styles.pair}>
                <span>{copy.registry.quoteAge}</span>
                <b>{surface.policy.nonceMaxAgeSeconds} s</b>
              </div>
              <div className={styles.pair}>
                <span>{copy.registry.receipt}</span>
                <b>{surface.policy.receipt.toLowerCase()}</b>
              </div>
              <div className={styles.pair}>
                <span>{copy.registry.refund}</span>
                <b>{surface.policy.refund.replace(/_/g, " ").toLowerCase()}</b>
              </div>
            </div>
          </div>
          <Explain label={copy.registry.explainLabel}>{copy.registry.explainBody}</Explain>
        </Panel>

        <Panel
          id="agent-control-procurement-mandates"
          title={copy.mandates.title}
          w={6}
          h={6}
          essential
          scroll
          badge={copy.mandates.badge(alone, surface.mandates.length)}
          tone="caution"
        >
          <div className={styles.rows}>
            {surface.mandates.map((row) => (
              <article className={styles.row} key={row.kind}>
                <div className={styles.rowHead}>
                  <b>{copy.mandates.kinds[row.kind] ?? row.kind}</b>
                  <span className={styles.verdict} data-who={row.authorization}>
                    {copy.mandates.who[row.authorization] ?? row.authorization}
                  </span>
                </div>
                <div className={styles.holds}>
                  <span className={styles.hold} data-held={row.holdsRecipient}>
                    {copy.mandates.holdsRecipient}
                  </span>
                  <span className={styles.hold} data-held={row.holdsExpiry}>
                    {copy.mandates.holdsExpiry}
                  </span>
                </div>
                {row.detail ? <span>{row.detail}</span> : null}
                {row.reasonCode ? <code>{row.reasonCode}</code> : null}
              </article>
            ))}
          </div>
          <Explain label={copy.mandates.explainLabel}>{copy.mandates.explainBody}</Explain>
        </Panel>

        <Panel
          id="agent-control-procurement-free"
          title={copy.free.title}
          w={6}
          h={5}
          essential
          scroll
          badge={copy.free.badge}
          tone="verified"
        >
          <ul className={styles.facts}>
            {surface.free.facts.map((fact) => (
              <li className={styles.fact} key={fact.id}>
                <b>{fact.label}</b>
                <span>{fact.readBy}</span>
              </li>
            ))}
          </ul>
          <Explain label={copy.free.never}>
            <ul>
              {surface.free.neverMonetised.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </Explain>
        </Panel>

        <Panel
          id="agent-control-procurement-sale"
          title={copy.sale.title}
          w={6}
          h={5}
          scroll
          badge={surface.sale.sellable ? copy.sale.badgeSellable : copy.sale.badge}
          tone="muted"
        >
          <div className={styles.stack}>
            <div className={styles.pairs}>
              <div className={styles.pair}>
                <span>{surface.sale.label}</span>
                <code>{surface.sale.path}</code>
              </div>
            </div>
            <Explain label={copy.sale.adds}>
              <ul>
                {surface.sale.adds.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </Explain>
            <Explain label={copy.sale.excludes}>
              <ul>
                {surface.sale.excludes.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </Explain>
            <ul className={styles.blockers}>
              {surface.sale.blockers.map((blocker) => (
                <li className={styles.blocker} key={blocker.code}>
                  <b>{blocker.code.replace(/_/g, " ").toLowerCase()}</b>
                  <span>{blocker.detail}</span>
                </li>
              ))}
            </ul>
          </div>
        </Panel>

        <Panel
          id="agent-control-procurement-protocol"
          title={copy.protocol.title}
          w={6}
          h={6}
          scroll
          badge={copy.protocol.badge}
          tone="evidence"
        >
          <div className={styles.pairs}>
            {surface.protocol.headers.map((header) => (
              <div className={styles.pair} key={header.name}>
                <span>{header.role}</span>
                <code>{header.name}</code>
              </div>
            ))}
            <div className={styles.pair}>
              <span>{copy.protocol.refused}</span>
              <code>{surface.protocol.refusedHeader}</code>
            </div>
            {surface.protocol.networks.map((network) => (
              <div className={styles.pair} key={network.id}>
                <span>{network.label}</span>
                <code>{network.id}</code>
              </div>
            ))}
            {surface.protocol.packages.map((entry) => (
              <div className={styles.pair} key={entry.name}>
                <span>{entry.name}</span>
                <code>{entry.version}</code>
              </div>
            ))}
          </div>
          <div className={styles.rows}>
            {surface.protocol.facilitators.map((facilitator) => (
              <article className={styles.row} key={facilitator.id}>
                <div className={styles.rowHead}>
                  <b>{facilitator.label}</b>
                  <span className={styles.verdict}>{facilitator.schemes.join(" · ")}</span>
                </div>
                <span>{facilitator.limitations[0]}</span>
              </article>
            ))}
          </div>
          <Explain label={copy.protocol.facilitators}>
            <p>{copy.protocol.ownFacilitator}</p>
            <ul>
              {surface.protocol.facilitators.flatMap((facilitator) =>
                facilitator.limitations.map((line) => <li key={`${facilitator.id}:${line}`}>{line}</li>),
              )}
            </ul>
          </Explain>
        </Panel>

        <Panel
          id="agent-control-procurement-pull"
          title={copy.pull.title}
          w={6}
          h={4}
          scroll
          badge={copy.pull.badge}
          tone="danger"
        >
          <div className={styles.pairs}>
            <div className={styles.pair}>
              <span>{copy.pull.audit}</span>
              <b>{surface.pullProgram.audit.toLowerCase()}</b>
            </div>
            <div className={styles.pair}>
              <span>{copy.pull.tried}</span>
              <b>{surface.pullProgram.mayBeTriedOn.join(" · ").toLowerCase()}</b>
            </div>
          </div>
          <ul className={styles.facts}>
            {surface.pullProgram.limitations.map((line) => (
              <li className={styles.fact} key={line}>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel
          id="agent-control-procurement-blockers"
          title={copy.blockers.title}
          w={12}
          h={4}
          essential
          badge={copy.blockers.badge}
          tone="muted"
        >
          <ul className={styles.blockers}>
            {surface.blockers.map((blocker) => (
              <li className={styles.blocker} key={blocker.title}>
                <b>{blocker.title}</b>
                <span>{blocker.detail}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </PanelGrid>
    </div>
  );
}
