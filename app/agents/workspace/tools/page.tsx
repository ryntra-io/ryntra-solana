import type { Metadata } from "next";
import { Info } from "@phosphor-icons/react/dist/ssr";

import { Panel, PanelGrid } from "@/app/shell/panel";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { buildAgentToolsSurface } from "@/lib/agent-control/mcp/current";

import { agentWorkspaceLocale } from "../i18n/server";
import { ToolInventory } from "./tool-inventory";
import styles from "./tools.module.css";

/**
 * Agent tools.
 *
 * The page answers four questions and stops. **What can a tool do?** — twelve
 * names, one effect between all the writes. **What does the gate refuse, and
 * why that reason?** — six real gate calls, with the ordering shown rather than
 * described. **What does an inbound A2A task become?** — nine states, none of
 * them authority. **What stops this being real?** — the exact missing thing.
 *
 * Every verdict is produced by the real gate and the real A2A mirror at render
 * time. Nothing here is a hand-written status.
 */

type ToolsCopy = Readonly<{
  metaTitle: string;
  metaDescription: string;
  eyebrow: string;
  heading: string;
  lead: string;
  environment: string;
  gridLabel: string;
  shortState: Readonly<Record<string, string>>;
  shortAuthentication: Readonly<Record<string, string>>;
  inventory: Readonly<{
    title: string;
    badge: (writeCount: number) => string;
    explainLabel: string;
    explainBody: React.ReactNode;
  }>;
  refusals: Readonly<{
    title: string;
    badge: (probeCount: number) => string;
    explainLabel: string;
    explainBody: React.ReactNode;
  }>;
  a2a: Readonly<{
    title: string;
    holdsTitle: string;
    proposal: string;
    promotes: (what: string) => string;
    promotesTitle: string;
    eventTitle: string;
    explainLabel: string;
    explainBody: React.ReactNode;
  }>;
  axes: Readonly<{
    title: string;
    badge: (moving: number, total: number) => string;
    caption: string;
    corner: string;
    cellTitle: (authorization: string) => string;
    asked: string;
    explainLabel: string;
    explainBody: React.ReactNode;
  }>;
  ladder: Readonly<{
    title: string;
    badge: (reachable: number, total: number) => string;
    reachable: string;
    unreachable: string;
    explainLabel: string;
    explainBody: React.ReactNode;
  }>;
  blockers: Readonly<{
    title: string;
    badge: (capacity: string | number) => string;
  }>;
}>;

const COPY = {
  en: {
    metaTitle: "Agent tools",
    metaDescription:
      "Twelve local MCP tools, five of which write. Every write produces one thing: a proposal awaiting a person.",
    eyebrow: "Agent Control / Agent tools",
    heading: "Agent tools",
    lead: "Five of the twelve local tools write. Every one of them writes the same thing — a proposal, waiting for a person — and no sequence of calls produces authority, because there is no effect value that could carry it.",
    environment: "LOCAL ONLY",
    gridLabel: "Agent Control agent tools",
    shortState: {
      TASK_STATE_UNSPECIFIED: "unspecified",
      TASK_STATE_SUBMITTED: "submitted",
      TASK_STATE_WORKING: "working",
      TASK_STATE_COMPLETED: "completed",
      TASK_STATE_FAILED: "failed",
      TASK_STATE_CANCELED: "canceled",
      TASK_STATE_INPUT_REQUIRED: "input required",
      TASK_STATE_REJECTED: "rejected",
      TASK_STATE_AUTH_REQUIRED: "auth required",
    },
    shortAuthentication: {
      UNAUTHENTICATED: "none",
      CREDENTIAL_PRESENTED: "presented",
      CREDENTIAL_VERIFIED: "verified",
    },
    inventory: {
      title: "Twelve tools, one write effect",
      badge: (writeCount) => `${writeCount} write`,
      explainLabel: "Why a write tool is safe to have here",
      explainBody: (
        <>
          <p>
            Canon <code>12 §10</code> gives this surface READ and PROPOSE, and puts EXECUTE behind a
            separate release gate and a bounded mandate contract. That gate has not opened, so a write
            writes to Ryntra&rsquo;s own decision record and to nothing else.
          </p>
          <ul>
            <li>
              The effect vocabulary has exactly one member. A signing tool would need a value to carry
              and there is none, so it is unrepresentable rather than forbidden.
            </li>
            <li>
              Every write names an allowlisted registry reference that must resolve and hash-match. The
              outcome does not vary with the reference — that is what separates it from a tool that runs
              a tool by name.
            </li>
            <li>
              The tool annotations this server publishes are honest and decide nothing. MCP itself says
              a client must treat them as untrusted.
            </li>
          </ul>
        </>
      ),
    },
    refusals: {
      title: "What the gate refuses, and in what order",
      badge: (probeCount) => `${probeCount} probes`,
      explainLabel: "Why the order is load-bearing",
      explainBody: (
        <>
          <p>
            An input shaped to grant authority is refused before the tool is even looked up. Refused
            later it would come back as an unrecognised field — and dropping the field, resending and
            succeeding reads as permission to keep going.
          </p>
          <p>
            Further down, the registry answers before the tool&rsquo;s own allowlist:{" "}
            <em>this action does not exist</em> outranks <em>this tool may not propose it</em>, because
            the second sentence implies another tool could.
          </p>
        </>
      ),
    },
    a2a: {
      title: "Nine A2A states, none of them authority",
      holdsTitle: "What Ryntra ends up holding",
      proposal: "proposal",
      promotes: (what) => `promotes ${what}`,
      promotesTitle: "What it promotes elsewhere in the product",
      eventTitle: "The canonical internal event, canon 12 §9",
      explainLabel: "Why completed promotes nothing",
      explainBody: (
        <>
          <p>
            A2A <code>completed</code> is the state of somebody else&rsquo;s task. It is not a Ryntra{" "}
            <code>MATCHED</code>, it finalizes no Receipt, and it changes no authorization. Ryntra
            decides separately whether an economic effect was observed and reconciled.
          </p>
          <p>
            And <code>unspecified</code> is refused rather than mapped: the specification calls it an
            unknown or indeterminate state, so a record built from it would assert an observation nobody
            made.
          </p>
        </>
      ),
    },
    axes: {
      title: "A credential is not a decision",
      badge: (moving, total) => `${moving} of ${total} moves`,
      caption: "What the caller proved, against what the owner decided, for three task states",
      corner: "Caller proved",
      cellTitle: (authorization) => `Owner authorization: ${authorization}`,
      asked: "asked",
      explainLabel: "Why the rows do not change the columns",
      explainBody: (
        <>
          <p>
            A2A §7.6.1 permits an agent to resume work the moment a credential arrives. That is a
            reasonable protocol rule and a dangerous product rule: it would let a credential delivered
            out of band restart an economic action with no person in the loop.
          </p>
          <p>
            So the two are separate axes with no function between them. Moving down a column changes
            nothing, and the only cell that moves is the one where the task itself asked.
          </p>
        </>
      ),
    },
    ladder: {
      title: "The rung this surface cannot reach",
      badge: (reachable, total) => `${reachable} of ${total}`,
      reachable: "reachable from an inbound task",
      unreachable: "no input to this surface produces it",
      explainLabel: "Why the rung is drawn at all",
      explainBody: (
        <p>
          A ladder that stopped at <em>requested</em> would read as a product where nobody ever
          authorizes anything. The step exists; it is closed by the owner, out of band, and this
          packet did not build that path.
        </p>
      ),
    },
    blockers: {
      title: "What stops this being real",
      badge: (capacity) => `ledger ${capacity}`,
    },
  },
  uk: {
    metaTitle: "Інструменти агента",
    metaDescription:
      "Дванадцять локальних інструментів MCP, пʼять з яких пишуть. Кожен запис породжує одне: пропозицію, що чекає на людину.",
    eyebrow: "Agent Control / Інструменти агента",
    heading: "Інструменти агента",
    lead: "Пʼять із дванадцяти локальних інструментів пишуть. Кожен із них пише те саме — пропозицію, що чекає на людину, — і жодна послідовність викликів не породжує повноважень, бо немає значення ефекту, яке могло б їх нести.",
    environment: "ЛИШЕ ЛОКАЛЬНО",
    gridLabel: "Інструменти агента Agent Control",
    shortState: {
      TASK_STATE_UNSPECIFIED: "невизначено",
      TASK_STATE_SUBMITTED: "подано",
      TASK_STATE_WORKING: "у роботі",
      TASK_STATE_COMPLETED: "завершено",
      TASK_STATE_FAILED: "невдало",
      TASK_STATE_CANCELED: "скасовано",
      TASK_STATE_INPUT_REQUIRED: "потрібен ввід",
      TASK_STATE_REJECTED: "відхилено",
      TASK_STATE_AUTH_REQUIRED: "потрібна автентифікація",
    },
    shortAuthentication: {
      UNAUTHENTICATED: "немає",
      CREDENTIAL_PRESENTED: "предʼявлено",
      CREDENTIAL_VERIFIED: "перевірено",
    },
    inventory: {
      title: "Дванадцять інструментів, один ефект запису",
      badge: (writeCount) => `${writeCount} пишуть`,
      explainLabel: "Чому інструмент запису тут безпечний",
      explainBody: (
        <>
          <p>
            Канон <code>12 §10</code> дає цій поверхні READ і PROPOSE, а EXECUTE ставить за окремий
            реліз-гейт і обмежений контракт мандата. Той гейт не відкрився, тож запис пише у власний
            журнал рішень Ryntra і більше нікуди.
          </p>
          <ul>
            <li>
              Словник ефектів має рівно один елемент. Інструменту підпису потрібне було б значення, яке
              він нестиме, а такого немає, тож він непредставний, а не заборонений.
            </li>
            <li>
              Кожен запис називає дозволене посилання реєстру, яке мусить розвʼязатися і збігтися за
              хешем. Результат не залежить від посилання — саме це відрізняє його від інструмента, що
              запускає інструмент за назвою.
            </li>
            <li>
              Анотації інструментів, які публікує цей сервер, чесні й нічого не вирішують. Сам MCP
              каже, що клієнт мусить вважати їх недовіреними.
            </li>
          </ul>
        </>
      ),
    },
    refusals: {
      title: "Що гейт відмовляє і в якому порядку",
      badge: (probeCount) => `${probeCount} проб`,
      explainLabel: "Чому порядок несе навантаження",
      explainBody: (
        <>
          <p>
            Вхід, сформований так, щоб надати повноваження, відхиляється ще до пошуку інструмента.
            Відхилений пізніше, він повернувся б як нерозпізнане поле — а прибрати поле, надіслати
            знову й досягти успіху читається як дозвіл продовжувати.
          </p>
          <p>
            Далі реєстр відповідає раніше за власний список інструмента:{" "}
            <em>цієї дії не існує</em> важить більше, ніж <em>цей інструмент не може її
            запропонувати</em>, бо друге речення натякає, що інший інструмент міг би.
          </p>
        </>
      ),
    },
    a2a: {
      title: "Девʼять станів A2A, і жоден — не повноваження",
      holdsTitle: "Що зрештою тримає Ryntra",
      proposal: "пропозиція",
      promotes: (what) => (what === "nothing" ? "нічого не просуває" : `просуває ${what}`),
      promotesTitle: "Що це просуває деінде в продукті",
      eventTitle: "Канонічна внутрішня подія, канон 12 §9",
      explainLabel: "Чому completed нічого не просуває",
      explainBody: (
        <>
          <p>
            A2A <code>completed</code> — це стан чужого завдання. Це не Ryntra <code>MATCHED</code>,
            він не фіналізує жодної Квитанції і не змінює жодної авторизації. Ryntra окремо вирішує, чи
            економічний ефект було спостережено й звірено.
          </p>
          <p>
            А <code>unspecified</code> відхиляється, а не мапиться: специфікація називає його невідомим
            чи невизначеним станом, тож запис, побудований із нього, стверджував би спостереження,
            якого ніхто не робив.
          </p>
        </>
      ),
    },
    axes: {
      title: "Облікові дані — це не рішення",
      badge: (moving, total) => `${moving} з ${total} рухається`,
      caption: "Що довів викликач, проти того, що вирішив власник, для трьох станів завдання",
      corner: "Викликач довів",
      cellTitle: (authorization) => `Авторизація власника: ${authorization}`,
      asked: "запитано",
      explainLabel: "Чому рядки не змінюють колонок",
      explainBody: (
        <>
          <p>
            A2A §7.6.1 дозволяє агенту відновити роботу, щойно надійдуть облікові дані. Це розумне
            правило протоколу і небезпечне правило продукту: воно дозволило б обліковим даним,
            доставленим поза каналом, перезапустити економічну дію без людини в контурі.
          </p>
          <p>
            Тож це дві окремі осі без функції між ними. Рух униз колонкою нічого не змінює, і єдина
            клітинка, що рухається, — та, де саме завдання попросило.
          </p>
        </>
      ),
    },
    ladder: {
      title: "Щабель, якого ця поверхня не сягає",
      badge: (reachable, total) => `${reachable} з ${total}`,
      reachable: "досяжний із вхідного завдання",
      unreachable: "жоден вхід цієї поверхні його не породжує",
      explainLabel: "Навіщо цей щабель узагалі намальовано",
      explainBody: (
        <p>
          Драбина, що спинялася б на <em>запитано</em>, читалася б як продукт, де ніхто ніколи нічого
          не авторизує. Крок існує; його закриває власник, поза каналом, і цей пакет того шляху не
          будував.
        </p>
      ),
    },
    blockers: {
      title: "Що заважає цьому бути справжнім",
      badge: (capacity) => `журнал ${capacity}`,
    },
  },
} as const satisfies Record<WorkspaceLocale, ToolsCopy>;

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

export default async function AgentWorkspaceToolsPage() {
  const locale = await agentWorkspaceLocale();
  const copy = COPY[locale];
  const surface = buildAgentToolsSurface();

  const gridStates = [...new Set(surface.grid.map((cell) => cell.state))];
  const cellByKey = new Map(
    surface.grid.map((cell) => [`${cell.authentication}::${cell.state}`, cell.authorization]),
  );
  /* How many of the three columns move at all. It is the panel's whole finding
     and a reader should not have to compare nine cells by eye to get it. */
  const movingColumns = gridStates.filter((state) =>
    surface.grid.some((cell) => cell.state === state && cell.authorization !== "NOT_REQUESTED"),
  ).length;

  return (
    <div className="acw-page">
      <header className="acw-head">
        <div>
          <span className="acw-eyebrow">{copy.eyebrow}</span>
          {/* The EN heading stays a literal: `tools-surface.test.mjs` pins
              `<h1>Agent tools</h1>` in this source file. */}
          {locale === "uk" ? <h1>{copy.heading}</h1> : <h1>Agent tools</h1>}
          <p>{copy.lead}</p>
        </div>
        <span className="acw-environment">{copy.environment}</span>
      </header>

      <PanelGrid label={copy.gridLabel}>
        <Panel
          id="agent-control-tools-inventory"
          title={copy.inventory.title}
          w={12}
          h={6}
          essential
          scroll
          badge={copy.inventory.badge(surface.writeCount)}
          tone="caution"
        >
          <ToolInventory tools={surface.tools} />
          <Explain label={copy.inventory.explainLabel}>{copy.inventory.explainBody}</Explain>
        </Panel>

        <Panel
          id="agent-control-tools-refusals"
          title={copy.refusals.title}
          w={6}
          h={8}
          essential
          scroll
          badge={copy.refusals.badge(surface.probes.length)}
          tone="evidence"
        >
          <ol className={styles.probes}>
            {surface.probes.map((probe, index) => (
              <li key={probe.id} className={styles.probe}>
                <span className={styles.probeOrder} aria-hidden>
                  {index + 1}
                </span>
                <div>
                  <b>{probe.attempt}</b>
                  <code title={probe.because}>{probe.reasonCode}</code>
                  <span>{probe.because}</span>
                </div>
              </li>
            ))}
          </ol>
          <Explain label={copy.refusals.explainLabel}>{copy.refusals.explainBody}</Explain>
        </Panel>

        <Panel
          id="agent-control-tools-a2a"
          title={copy.a2a.title}
          w={6}
          h={8}
          essential
          scroll
          badge="A2A 1.0.0"
          tone="evidence"
        >
          <ul className={styles.states}>
            {surface.outcomes.map((outcome) => (
              <li key={outcome.state} className={styles.state} data-class={outcome.class}>
                <div>
                  <b>{copy.shortState[outcome.state] ?? outcome.state}</b>
                  <span className={styles.stateClass}>{outcome.class.toLowerCase()}</span>
                </div>
                <div className={styles.stateFacts}>
                  {/* A refused state names *why*. Printing the word "refused"
                      beside a chip that already says "refused" spends a line on
                      nothing. */}
                  <span title={copy.a2a.holdsTitle}>
                    {outcome.class === "REFUSED" ? outcome.produces : copy.a2a.proposal}
                  </span>
                  <span title={copy.a2a.promotesTitle}>{copy.a2a.promotes(outcome.promotes)}</span>
                  {outcome.event ? (
                    <span className={styles.event} title={copy.a2a.eventTitle}>
                      {outcome.event}
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
          <Explain label={copy.a2a.explainLabel}>{copy.a2a.explainBody}</Explain>
        </Panel>

        <Panel
          id="agent-control-tools-axes"
          title={copy.axes.title}
          w={6}
          h={4}
          essential
          scroll
          badge={copy.axes.badge(movingColumns, gridStates.length)}
          tone="caution"
        >
          <div className={styles.axesScroll}>
            <table className={styles.axes}>
              <caption className="sr-only">{copy.axes.caption}</caption>
              <thead>
                <tr>
                  <th scope="col">{copy.axes.corner}</th>
                  {gridStates.map((state) => (
                    <th key={state} scope="col">
                      {copy.shortState[state] ?? state}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(["UNAUTHENTICATED", "CREDENTIAL_PRESENTED", "CREDENTIAL_VERIFIED"] as const).map((authentication) => (
                  <tr key={authentication}>
                    <th scope="row">{copy.shortAuthentication[authentication] ?? authentication}</th>
                    {gridStates.map((state) => {
                      const value = cellByKey.get(`${authentication}::${state}`);
                      return (
                        <td
                          key={state}
                          data-authorization={value}
                          title={copy.axes.cellTitle(value?.replace(/_/g, " ").toLowerCase() ?? "")}
                        >
                          {value === "REQUESTED" ? copy.axes.asked : "—"}
                          <span className="sr-only">{value}</span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Explain label={copy.axes.explainLabel}>{copy.axes.explainBody}</Explain>
        </Panel>

        <Panel
          id="agent-control-tools-ladder"
          title={copy.ladder.title}
          w={6}
          h={4}
          essential
          scroll
          badge={copy.ladder.badge(surface.reachableAuthorization.length, surface.authorizationLadder.length)}
          tone="muted"
        >
          <ol className={styles.ladder}>
            {surface.authorizationLadder.map((rung) => {
              const reachable = surface.reachableAuthorization.includes(rung);
              return (
                <li key={rung} className={styles.rung} data-reachable={reachable}>
                  <b>{rung.replace(/_/g, " ").toLowerCase()}</b>
                  <span>{reachable ? copy.ladder.reachable : copy.ladder.unreachable}</span>
                </li>
              );
            })}
          </ol>
          <Explain label={copy.ladder.explainLabel}>{copy.ladder.explainBody}</Explain>
        </Panel>

        <Panel
          id="agent-control-tools-blockers"
          title={copy.blockers.title}
          w={12}
          h={4}
          essential
          scroll
          badge={copy.blockers.badge(surface.ledger.capacity)}
          tone="muted"
        >
          <ul className={styles.blockers}>
            {surface.blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </Panel>
      </PanelGrid>
    </div>
  );
}
