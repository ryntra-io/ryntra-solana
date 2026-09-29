import type { Metadata } from "next";
import { Info } from "@phosphor-icons/react/dist/ssr";

import { Panel, PanelGrid } from "@/app/shell/panel";
import type { WorkspaceLocale } from "@/app/shell/locale";
import {
  COMMERCE_BLOCKERS,
  buildCommerceSurface,
  networkLabel,
} from "@/lib/agent-control/payments/current";
import {
  PAYMENT_STATUSES,
  PAYMENT_TRUST_CLASSES,
  SERVICE_DELIVERY_STATUSES,
} from "@/lib/agent-control/payments/vocabulary";

import { agentWorkspaceLocale } from "../i18n/server";
import { RouteMatrix, type ImplementationOption } from "./route-matrix";
import styles from "./commerce.module.css";

/**
 * Jobs and payments.
 *
 * The page answers three questions and stops. **Which route would this payment
 * take, and who is each party?** — four separate axes, never one provider chip.
 * **What is true about the payment and what is true about the service?** — two
 * columns that never merge. **What stops this being real?** — the exact missing
 * thing, in the surface's own words.
 *
 * Every verdict is produced by the engine at render time. Nothing on this page
 * is a hand-written status, and nothing here can pay for anything.
 */

type CommerceCopy = Readonly<{
  metaTitle: string;
  metaDescription: string;
  eyebrow: string;
  heading: string;
  lead: string;
  environment: string;
  gridLabel: string;
  shortStatus: Readonly<Record<string, string>>;
  ofBadge: (count: number, total: number) => string;
  routesTitle: string;
  collision: Readonly<{
    title: string;
    receiptLabels: readonly [string, string, string, string, string, string, string];
    explainLabel: string;
    explainBody: React.ReactNode;
  }>;
  pairing: Readonly<{
    title: string;
    badge: string;
    caption: string;
    corner: string;
    cellInconsistent: (code: string) => string;
    cellConsistent: string;
    cellUndetermined: string;
    explainLabel: string;
    explainBody: React.ReactNode;
  }>;
  custody: Readonly<{
    title: string;
    badge: (differing: number, total: number) => string;
    axisLabels: readonly [string, string, string, string];
    explainLabel: string;
    explainBody: React.ReactNode;
  }>;
  standards: Readonly<{
    title: string;
    badge: string;
    read: (observedAt: string) => string;
    sampleJob: (jobRef: string) => string;
    explainLabel: string;
    explainBody: (reputationState: string, sourceLabel: string) => React.ReactNode;
  }>;
  blockers: Readonly<{ title: string; badge: string }>;
}>;

const COPY = {
  en: {
    metaTitle: "Jobs and payments",
    metaDescription:
      "One 402 engine, four independent adapter axes, and a payment outcome kept separate from a service outcome.",
    eyebrow: "Agent Control / Jobs and payments",
    heading: "Jobs and payments",
    lead: "One engine speaks x402. Which implementation, which method, which facilitator and which chain are four separate facts, because two unrelated systems already ship under one name.",
    environment: "READ ONLY",
    gridLabel: "Agent Control jobs and payments",
    shortStatus: {
      NOT_ATTEMPTED: "not attempted",
      REQUIREMENTS_RECEIVED: "requirements",
      AUTHORIZATION_SIGNED: "signed",
      SUBMITTED: "submitted",
      SETTLED: "settled",
      FAILED: "failed",
      UNKNOWN: "unknown",
      NOT_REQUESTED: "not requested",
      REQUESTED: "requested",
      DELIVERED: "delivered",
      PARTIALLY_DELIVERED: "partial",
      NOT_DELIVERED: "not delivered",
    },
    ofBadge: (count, total) => `${count} of ${total}`,
    routesTitle: "Which routes resolve",
    collision: {
      title: "One name, two systems",
      receiptLabels: ["Network", "Implementation", "Method", "Facilitator", "Operator", "Asset", "Amount"],
      explainLabel: "Why the trust classes differ",
      explainBody: (
        <>
          <p>
            Same chain, same token, same amount, same evidence — one facilitator report each. Binance
            issues credentials and signs its requests, so a report from it can be attributed. Vistara
            documents its facilitator as an open API with no authentication, so a report from it cannot
            be attributed to anyone, and an unattributable assertion is not a facilitator&rsquo;s.
          </p>
          <ul>
            <li>The class is derived from the evidence on the receipt. No caller supplies it.</li>
            <li>
              The ceiling stops applying the moment Ryntra has an observation of its own: a chain read is
              Ryntra&rsquo;s, not the operator&rsquo;s.
            </li>
            <li>Neither system is affiliated with the other. They share a name and nothing else.</li>
          </ul>
        </>
      ),
    },
    pairing: {
      title: "Paying is not delivering",
      badge: "4 of 42",
      caption: "Payment status against service delivery status, with the pairs that name a problem",
      corner: "Payment / service",
      cellInconsistent: (code) => `${code} — the pair is inconsistent, and neither status names it alone.`,
      cellConsistent: "Both halves are known and they agree.",
      cellUndetermined: "One half is unknown, so the pair is undetermined rather than resolved.",
      explainLabel: "Why two axes and not one status",
      explainBody: (
        <>
          <p>
            A facilitator&rsquo;s settle report establishes that value moved. It cannot establish that a
            resource was served, because the facilitator never saw one. The two admissible-source lists do
            not overlap, and the refusal fires before freshness or amounts are read.
          </p>
          <ul>
            <li>
              <b>!</b> — the pair is inconsistent: <code>PAID_BUT_UNSERVED</code> or{" "}
              <code>SERVICE_DELIVERED_UNPAID</code>. Neither status produces the code on its own.
            </li>
            <li>
              <b>?</b> — one half is unknown. Undetermined is the honest answer; resolving it in either
              direction would invent the fact.
            </li>
            <li>
              <b>·</b> — both halves are known and agree.
            </li>
          </ul>
        </>
      ),
    },
    custody: {
      title: "Custody is a fact about a surface",
      badge: (differing, total) => `${differing} of ${total} axes differ`,
      axisLabels: ["Custody", "Authorization", "Boundary", "Withdrawal"],
      explainLabel: "Why one provider needs two records",
      explainBody: (
        <p>
          Binance runs both of these. On the payment facilitator the buyer signs from their own wallet
          and Binance never holds the funds; on the Agentic sub-account Binance holds them and the agent
          cannot withdraw. All four axes disagree, so a single &ldquo;Binance is custodial&rdquo; flag
          would be false about one surface and a single &ldquo;non-custodial&rdquo; false about the
          other.
        </p>
      ),
    },
    standards: {
      title: "Two Draft standards, mirrored",
      badge: "Pinned",
      read: (observedAt) => `Read ${observedAt}. Vocabulary mirrored; no contract, no address, no client.`,
      sampleJob: (jobRef) => `Sample job ${jobRef}`,
      explainLabel: "What the mirror does and does not do",
      explainBody: (reputationState, sourceLabel) => (
        <>
          <p>
            A pinned digest is the revision, not a branch: a Draft consumed as &ldquo;latest&rdquo; is a
            specification that changes underneath the code. ERC-8004 evidence carries a state and never a
            score, and <code>PROVEN</code> is absent from the mirrored list, so a registry entry cannot
            become a safety verdict.
          </p>
          <ul>
            <li>
              ERC-8183&rsquo;s abstract writes the lifecycle as a straight line; its state machine has
              direct terminal exits from Open and Funded. The mirror follows the table.
            </li>
            <li>
              <code>Completed</code> is reachable only from <code>Submitted</code>, so escrow cannot be
              released to a provider that never submitted work.
            </li>
            <li>
              Reputation signal on the sample agent: <b>{reputationState}</b>, from {sourceLabel}.
            </li>
          </ul>
        </>
      ),
    },
    blockers: { title: "What stops this being real", badge: "No money path" },
  },
  uk: {
    metaTitle: "Завдання й платежі",
    metaDescription:
      "Один рушій 402, чотири незалежні осі адаптерів і результат платежу, який тримається окремо від результату послуги.",
    eyebrow: "Agent Control / Завдання й платежі",
    heading: "Завдання й платежі",
    lead: "Один рушій говорить x402. Яка реалізація, який метод, який фасилітатор і який ланцюг — чотири окремі факти, бо дві неповʼязані системи вже виходять під однією назвою.",
    environment: "ЛИШЕ ЧИТАННЯ",
    gridLabel: "Завдання й платежі Agent Control",
    shortStatus: {
      NOT_ATTEMPTED: "не розпочато",
      REQUIREMENTS_RECEIVED: "вимоги",
      AUTHORIZATION_SIGNED: "підписано",
      SUBMITTED: "подано",
      SETTLED: "розраховано",
      FAILED: "невдало",
      UNKNOWN: "невідомо",
      NOT_REQUESTED: "не запитано",
      REQUESTED: "запитано",
      DELIVERED: "надано",
      PARTIALLY_DELIVERED: "частково",
      NOT_DELIVERED: "не надано",
    },
    ofBadge: (count, total) => `${count} з ${total}`,
    routesTitle: "Які маршрути розвʼязуються",
    collision: {
      title: "Одна назва, дві системи",
      receiptLabels: ["Мережа", "Реалізація", "Метод", "Фасилітатор", "Оператор", "Актив", "Сума"],
      explainLabel: "Чому класи довіри різняться",
      explainBody: (
        <>
          <p>
            Той самий ланцюг, той самий токен, та сама сума, ті самі докази — по одному звіту
            фасилітатора. Binance видає облікові дані й підписує свої запити, тож звіт від нього можна
            атрибутувати. Vistara документує свій фасилітатор як відкритий API без автентифікації, тож
            звіт від нього неможливо атрибутувати нікому, а неатрибутовне твердження — не твердження
            фасилітатора.
          </p>
          <ul>
            <li>Клас виводиться з доказів на квитанції. Жоден викликач його не передає.</li>
            <li>
              Стеля перестає діяти тієї миті, коли Ryntra має власне спостереження: читання ланцюга
              належить Ryntra, а не оператору.
            </li>
            <li>Жодна із систем не повʼязана з іншою. Спільна в них лише назва.</li>
          </ul>
        </>
      ),
    },
    pairing: {
      title: "Оплатити — не означає надати",
      badge: "4 з 42",
      caption: "Статус платежу проти статусу надання послуги, з парами, які називають проблему",
      corner: "Платіж / послуга",
      cellInconsistent: (code) => `${code} — пара неузгоджена, і жоден статус окремо цього не називає.`,
      cellConsistent: "Обидві половини відомі, і вони узгоджені.",
      cellUndetermined: "Одна половина невідома, тож пара невизначена, а не розвʼязана.",
      explainLabel: "Чому дві осі, а не один статус",
      explainBody: (
        <>
          <p>
            Звіт фасилітатора про розрахунок установлює, що вартість перемістилася. Він не може
            встановити, що ресурс було надано, бо фасилітатор його не бачив. Два списки допустимих
            джерел не перетинаються, і відмова спрацьовує ще до перевірки свіжості чи сум.
          </p>
          <ul>
            <li>
              <b>!</b> — пара неузгоджена: <code>PAID_BUT_UNSERVED</code> або{" "}
              <code>SERVICE_DELIVERED_UNPAID</code>. Жоден статус сам по собі не породжує цей код.
            </li>
            <li>
              <b>?</b> — одна половина невідома. Невизначено — чесна відповідь; розвʼязання в будь-який
              бік вигадало б факт.
            </li>
            <li>
              <b>·</b> — обидві половини відомі й узгоджені.
            </li>
          </ul>
        </>
      ),
    },
    custody: {
      title: "Кастоді — це факт про поверхню",
      badge: (differing, total) => `${differing} з ${total} осей різняться`,
      axisLabels: ["Кастоді", "Авторизація", "Межа", "Виведення"],
      explainLabel: "Чому одному провайдеру потрібні два записи",
      explainBody: (
        <p>
          Binance керує обома. На платіжному фасилітаторі покупець підписує з власного гаманця, і
          Binance ніколи не тримає кошти; на агентському субрахунку Binance їх тримає, а агент не може
          вивести. Усі чотири осі різняться, тож один прапорець «Binance кастодіальний» був би хибним
          про одну поверхню, а один «некастодіальний» — про іншу.
        </p>
      ),
    },
    standards: {
      title: "Два стандарти в статусі Draft, віддзеркалені",
      badge: "Закріплено",
      read: (observedAt) => `Прочитано ${observedAt}. Словник віддзеркалено; без контракту, без адреси, без клієнта.`,
      sampleJob: (jobRef) => `Зразок завдання ${jobRef}`,
      explainLabel: "Що дзеркало робить, а чого — ні",
      explainBody: (reputationState, sourceLabel) => (
        <>
          <p>
            Закріплений дайджест — це ревізія, а не гілка: Draft, який споживають як «latest», — це
            специфікація, що змінюється під кодом. Докази ERC-8004 несуть стан і ніколи — бал, а{" "}
            <code>PROVEN</code> відсутній у віддзеркаленому списку, тож запис реєстру не може стати
            вердиктом безпеки.
          </p>
          <ul>
            <li>
              Анотація ERC-8183 описує життєвий цикл прямою лінією; його автомат станів має прямі
              термінальні виходи з Open і Funded. Дзеркало йде за таблицею.
            </li>
            <li>
              <code>Completed</code> досяжний лише зі <code>Submitted</code>, тож ескроу не можна
              звільнити провайдеру, який не подав роботу.
            </li>
            <li>
              Сигнал репутації зразкового агента: <b>{reputationState}</b>, з {sourceLabel}.
            </li>
          </ul>
        </>
      ),
    },
    blockers: { title: "Що заважає цьому бути справжнім", badge: "Немає грошового шляху" },
  },
} as const satisfies Record<WorkspaceLocale, CommerceCopy>;

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

function TrustChip({ value }: { value: string }) {
  const rung = PAYMENT_TRUST_CLASSES.indexOf(value as (typeof PAYMENT_TRUST_CLASSES)[number]);
  return (
    <span className={styles.trust} data-rung={rung < 0 ? 0 : rung}>
      {value.replace(/_/g, " ").toLowerCase()}
    </span>
  );
}

export default async function AgentWorkspaceCommercePage() {
  const locale = await agentWorkspaceLocale();
  const copy = COPY[locale];
  const surface = buildCommerceSurface();

  const options: readonly ImplementationOption[] = surface.implementations.map((projection) => ({
    id: projection.declaration.id,
    label: projection.declaration.label,
    operator: projection.declaration.operator,
    slices: projection.slices,
    limitations: projection.declaration.limitations,
    trustCeiling: projection.declaration.facilitatorTrustCeiling,
    sourceUrl: projection.declaration.source.url,
    observedAt: projection.declaration.source.observedAt,
  }));

  const { binance, vistara } = surface.collision;
  const [networkL, implementationL, methodL, facilitatorL, operatorL, assetL, amountL] =
    copy.collision.receiptLabels;
  const receiptRows = [
    [networkL, `${networkLabel(binance.network)} · ${binance.network}`, `${networkLabel(vistara.network)} · ${vistara.network}`],
    [implementationL, binance.providerImplementation, vistara.providerImplementation],
    [methodL, binance.paymentMethod, vistara.paymentMethod],
    [facilitatorL, binance.facilitator, vistara.facilitator],
    [operatorL, binance.operator, vistara.operator],
    [assetL, binance.asset.symbol, vistara.asset.symbol],
    [amountL, binance.amount, vistara.amount],
  ] as const;

  const pairByKey = new Map(
    surface.pairing.map((cell) => [`${cell.paymentStatus}::${cell.serviceDeliveryStatus}`, cell]),
  );

  /* Counted rather than asserted. The panel's whole point is that two surfaces
     of one provider disagree, and a reader should not have to compare four rows
     by eye to find that out. */
  const CUSTODY_AXES = [
    "custodyModel",
    "authorizationSurface",
    "providerBoundary",
    "withdrawalCapability",
  ] as const;
  const [firstCustody, secondCustody] = surface.custody;
  const differingAxes = CUSTODY_AXES.filter(
    (axis) => firstCustody[axis] !== secondCustody[axis],
  ).length;

  return (
    <div className="acw-page">
      <header className="acw-head">
        <div>
          <span className="acw-eyebrow">{copy.eyebrow}</span>
          {/* The EN heading stays a literal: `commerce-surface.test.mjs` pins
              `<h1>Jobs and payments</h1>` in this source file. */}
          {locale === "uk" ? <h1>{copy.heading}</h1> : <h1>Jobs and payments</h1>}
          <p>{copy.lead}</p>
        </div>
        <span className="acw-environment">{copy.environment}</span>
      </header>

      <PanelGrid label={copy.gridLabel}>
        <Panel
          id="agent-control-commerce-routes"
          title={copy.routesTitle}
          w={12}
          h={6}
          essential
          scroll
          badge={copy.ofBadge(surface.totals.allowed, surface.totals.total)}
          tone={surface.totals.allowed > 0 ? "caution" : "muted"}
        >
          <RouteMatrix options={options} />
        </Panel>

        <Panel
          id="agent-control-commerce-collision"
          title={copy.collision.title}
          w={6}
          h={6}
          essential
          scroll
          badge="B402"
          tone="caution"
        >
          <div className={styles.collision}>
            {[
              { receipt: binance, side: 0 },
              { receipt: vistara, side: 1 },
            ].map(({ receipt, side }) => (
              <article className={styles.receipt} key={receipt.id}>
                <header>
                  <b>{receipt.operator}</b>
                  <span>{receipt.id}</span>
                </header>
                <div className={styles.receiptRows}>
                  {receiptRows.map(([label, left, right]) => {
                    const value = side === 0 ? left : right;
                    return (
                      <div className={styles.receiptRow} key={label} data-differs={left !== right}>
                        <span>{label}</span>
                        <b>{value}</b>
                      </div>
                    );
                  })}
                </div>
                <TrustChip value={receipt.trustClass} />
              </article>
            ))}
          </div>
          <Explain label={copy.collision.explainLabel}>{copy.collision.explainBody}</Explain>
        </Panel>

        <Panel
          id="agent-control-commerce-pairing"
          title={copy.pairing.title}
          w={6}
          h={6}
          essential
          scroll
          badge={copy.pairing.badge}
          tone="evidence"
        >
          <div className={styles.pairScroll}>
            <table className={styles.pair}>
              <caption className="sr-only">{copy.pairing.caption}</caption>
              <thead>
                <tr>
                  <th scope="col">{copy.pairing.corner}</th>
                  {SERVICE_DELIVERY_STATUSES.map((status) => (
                    <th key={status} scope="col">
                      {copy.shortStatus[status] ?? status}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PAYMENT_STATUSES.map((paymentStatus) => (
                  <tr key={paymentStatus}>
                    <th scope="row">{copy.shortStatus[paymentStatus] ?? paymentStatus}</th>
                    {SERVICE_DELIVERY_STATUSES.map((serviceStatus) => {
                      const cell = pairByKey.get(`${paymentStatus}::${serviceStatus}`);
                      if (!cell) return <td key={serviceStatus} />;
                      return (
                        <td
                          key={serviceStatus}
                          data-consistency={cell.consistency}
                          title={
                            cell.code
                              ? copy.pairing.cellInconsistent(cell.code)
                              : cell.consistency === "CONSISTENT"
                                ? copy.pairing.cellConsistent
                                : copy.pairing.cellUndetermined
                          }
                        >
                          {cell.code ? "!" : cell.consistency === "CONSISTENT" ? "·" : "?"}
                          <span className="sr-only">{cell.code ?? cell.consistency}</span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Explain label={copy.pairing.explainLabel}>{copy.pairing.explainBody}</Explain>
        </Panel>

        <Panel
          id="agent-control-commerce-custody"
          title={copy.custody.title}
          w={6}
          h={4}
          scroll
          badge={copy.custody.badge(differingAxes, CUSTODY_AXES.length)}
          tone="caution"
        >
          <div className={styles.axes}>
            {surface.custody.map((record) => (
              <article className={styles.axisCard} key={record.id}>
                <b>{record.label}</b>
                <div className={styles.axisRows}>
                  {[
                    [copy.custody.axisLabels[0], record.custodyModel],
                    [copy.custody.axisLabels[1], record.authorizationSurface],
                    [copy.custody.axisLabels[2], record.providerBoundary],
                    [copy.custody.axisLabels[3], record.withdrawalCapability],
                  ].map(([label, value]) => (
                    <div className={styles.axisRow} key={label}>
                      <span>{label}</span>
                      <b>{value.replace(/_/g, " ").toLowerCase()}</b>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
          <Explain label={copy.custody.explainLabel}>{copy.custody.explainBody}</Explain>
        </Panel>

        <Panel
          id="agent-control-commerce-standards"
          title={copy.standards.title}
          w={6}
          h={6}
          scroll
          badge={copy.standards.badge}
          tone="caution"
        >
          <div className={styles.standards}>
            {surface.standards.map((pin) => (
              <div className={styles.standard} key={pin.standard}>
                <div className={styles.standardHead}>
                  <b>{pin.standard}</b>
                  <span className={styles.draftChip}>DRAFT</span>
                </div>
                <code>{pin.revision}</code>
                <p>{copy.standards.read(pin.observedAt)}</p>
              </div>
            ))}
            <div className={styles.standard}>
              <div className={styles.standardHead}>
                <b>{copy.standards.sampleJob(surface.job.jobRef)}</b>
                <span className={styles.draftChip}>{surface.job.terminalKind}</span>
              </div>
              <p>{surface.job.reconciliationSupportReason}</p>
            </div>
          </div>
          <Explain label={copy.standards.explainLabel}>
            {copy.standards.explainBody(surface.reputation.state, surface.reputation.sourceLabel)}
          </Explain>
        </Panel>

        <Panel
          id="agent-control-commerce-blockers"
          title={copy.blockers.title}
          w={12}
          h={4}
          essential
          badge={copy.blockers.badge}
          tone="muted"
        >
          <ul className={styles.blockers}>
            {COMMERCE_BLOCKERS.map((blocker) => (
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
