import type { Metadata } from "next";
import {
  Eye,
  Info,
  Key,
  PencilSimpleLine,
  Prohibit,
  Pulse,
} from "@phosphor-icons/react/dist/ssr";

import { Panel, PanelGrid } from "@/app/shell/panel";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { buildTeamSurface } from "@/lib/agent-control/team-current";

import { agentWorkspaceLocale } from "../i18n/server";
import styles from "../finish-surface.module.css";

/**
 * The Pro/Team surface.
 *
 * A retail Consumer Pro tier is out of scope: Ryntra
 * Home is the surface for a person and Agent Control is the surface for a team.
 * So this page is about *shared access* and never about a plan or a price —
 * No price appears here.
 *
 * It reads and issues nothing. There is no key button, and there is no disabled
 * key button either: a disabled control is a promise with a tooltip attached.
 * What the page shows instead is the access model that genuinely exists — the
 * scope vocabulary, the record shape, the eight refusals, the six lifecycle
 * steps and which of them are self-service — and then says plainly which of
 * them no screen performs.
 */

/** Ukrainian cardinal agreement: 1 скоуп, 2 скоупи, 5 скоупів. */
function ukPlural(n: number, one: string, few: string, many: string): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 14) return many;
  const ones = n % 10;
  if (ones === 1) return one;
  if (ones >= 2 && ones <= 4) return few;
  return many;
}

type TeamCopy = {
  meta: { title: string; description: string };
  eyebrow: string;
  heading: string;
  lead: string;
  chip: string;
  gridLabel: string;
  scopes: {
    title: string;
    badge: (n: number) => string;
    lede: string;
    tagNoTool: string;
    tagTools: (n: number) => string;
    unlocksLabel: string;
    unlocksBody: React.ReactNode;
  };
  lifecycle: {
    title: string;
    badge: string;
    tagSelfService: string;
    tagByHand: string;
    notSelfServiceLabel: string;
    notSelfServiceBody: string;
  };
  records: {
    title: string;
    badge: string;
    lede: string;
    tenantHeading: string;
    keyHeading: string;
    neverRendered: string;
  };
  refusals: {
    title: string;
    badge: (n: number) => string;
    lede: string;
    tagRefused: string;
    revocationLabel: string;
    revocationBody: string;
  };
  quotas: {
    title: string;
    badge: string;
    thPrincipal: string;
    thLimit: string;
    thWindow: string;
    thDurable: string;
    yes: string;
    no: string;
    secondsUnit: string;
    durabilityLabel: string;
    durabilityBody: string;
  };
  cannot: { title: string; badge: string; tagNotHere: string };
};

const COPY = {
  en: {
    meta: {
      title: "Team",
      description:
        "Who can reach this tenant, holding which scopes, under which quota — read from the tenancy the product actually keeps. Nothing is issued here.",
    },
    eyebrow: "Agent Control / Team",
    heading: "Team",
    lead: "A key names a tenant, a tenant gets a window that survives a cold start, and a token can never carry more than the key that approved it. All of it is read here and none of it is issued here.",
    chip: "READ ONLY · NOTHING ISSUED",
    gridLabel: "Team",
    scopes: {
      title: "What shared access can hold",
      badge: (n: number) => `${n} scopes`,
      lede: "The complete vocabulary. None of these names an authority, so a key carrying one cannot grant it — the type has nothing to put there.",
      tagNoTool: "no tool",
      tagTools: (n: number) => `${n} tools`,
      unlocksLabel: "Why one scope deliberately unlocks nothing",
      unlocksBody: (
        <>
          <code>metrics:read</code> grants no tool. Someone who needs to watch refusal counters
          should not have to hold a scope that can also write, and a scope that has to be
          bundled with another to be useful is a scope that will be over-granted.
        </>
      ),
    },
    lifecycle: {
      title: "How access begins and ends",
      badge: "6 steps",
      tagSelfService: "self-service",
      tagByHand: "by hand",
      notSelfServiceLabel: "Why issuing a key is deliberately not self-service",
      notSelfServiceBody:
        "A key is the ceiling on everything a token minted from it can later do. Handing one out from a screen turns granting authority into a form field, and there is no billing, plan or approval behind it that would make that safe.",
    },
    records: {
      title: "What a record holds",
      badge: "from the schema",
      lede: "Field names read straight off the real schemas, so a new field cannot appear on a record without appearing here. A secret is never persisted — only its SHA-256.",
      tenantHeading: "Tenant record",
      keyHeading: "Key record",
      neverRendered: " · never rendered",
    },
    refusals: {
      title: "How access is refused",
      badge: (n: number) => `${n} reasons`,
      lede: "Eight reasons, each with exactly one meaning. A caller is told which one, so a revoked key and an unknown key are never the same answer.",
      tagRefused: "refused",
      revocationLabel: "Why revocation is read before expiry",
      revocationBody:
        "An expiry check that runs first lets a revoked key keep working until its token would have lapsed anyway. Revocation is read first, so the very next call is refused.",
    },
    quotas: {
      title: "What a tenant may spend",
      badge: "durable",
      thPrincipal: "Principal",
      thLimit: "Limit",
      thWindow: "Window",
      thDurable: "Durable",
      yes: "yes",
      no: "no",
      secondsUnit: "s",
      durabilityLabel: "Why durability is the whole point",
      durabilityBody:
        "A quota counted per process is not a quota: two instances keep two windows and a cold start hands the budget back. The meter fails closed when the store is unreachable, which is a refusal rather than a free pass.",
    },
    cannot: {
      title: "What a team cannot do here",
      badge: "boundary",
      tagNotHere: "not here",
    },
  },
  uk: {
    meta: {
      title: "Команда",
      description:
        "Хто може дістатися цього тенанта, з якими скоупами й під якою квотою — прочитано з реальних записів тенантів, які веде продукт. Тут нічого не видається.",
    },
    eyebrow: "Agent Control / Команда",
    heading: "Команда",
    lead: "Ключ називає тенанта, тенант отримує вікно, що переживає холодний старт, а токен ніколи не може нести більше, ніж ключ, який його схвалив. Усе це тут читається — і ніщо з цього тут не видається.",
    chip: "ЛИШЕ ЧИТАННЯ · НІЧОГО НЕ ВИДАЄТЬСЯ",
    gridLabel: "Команда",
    scopes: {
      title: "Що може тримати спільний доступ",
      badge: (n: number) => `${n} ${ukPlural(n, "скоуп", "скоупи", "скоупів")}`,
      lede: "Повний словник. Жоден із цих скоупів не називає повноваження, тож ключ, який його несе, не може це повноваження надати — типу нема що туди покласти.",
      tagNoTool: "без інструмента",
      tagTools: (n: number) => `${n} ${ukPlural(n, "інструмент", "інструменти", "інструментів")}`,
      unlocksLabel: "Чому один скоуп свідомо нічого не відкриває",
      unlocksBody: (
        <>
          <code>metrics:read</code> не надає жодного інструмента. Той, кому треба стежити за
          лічильниками відмов, не повинен тримати скоуп, який може ще й писати, а скоуп, що
          мусить іти в парі з іншим, щоб бути корисним, — це скоуп, який видаватимуть із
          запасом.
        </>
      ),
    },
    lifecycle: {
      title: "Як доступ починається і закінчується",
      badge: "6 кроків",
      tagSelfService: "самообслуговування",
      tagByHand: "вручну",
      notSelfServiceLabel: "Чому видача ключа свідомо не є самообслуговуванням",
      notSelfServiceBody:
        "Ключ — це стеля всього, що згодом зможе зробити випущений з нього токен. Видавати його з екрана означає перетворити надання повноважень на поле форми, а за ним немає білінгу, плану чи погодження, які зробили б це безпечним.",
    },
    records: {
      title: "Що містить запис",
      badge: "зі схеми",
      lede: "Назви полів читаються просто з реальних схем, тож нове поле не може зʼявитися в записі, не зʼявившись тут. Секрет ніколи не зберігається — лише його SHA-256.",
      tenantHeading: "Запис тенанта",
      keyHeading: "Запис ключа",
      neverRendered: " · ніколи не показується",
    },
    refusals: {
      title: "Як відмовляють у доступі",
      badge: (n: number) => `${n} ${ukPlural(n, "причина", "причини", "причин")}`,
      lede: "Вісім причин, кожна рівно з одним значенням. Викликачеві кажуть, котра саме, тож відкликаний ключ і невідомий ключ ніколи не отримують однакову відповідь.",
      tagRefused: "відхилено",
      revocationLabel: "Чому відкликання читається раніше за строк дії",
      revocationBody:
        "Якби першою виконувалася перевірка строку дії, відкликаний ключ працював би, доки його токен і так не сплив би. Відкликання читається першим, тож уже наступний виклик відхиляється.",
    },
    quotas: {
      title: "Що може витратити тенант",
      badge: "стійка",
      thPrincipal: "Принципал",
      thLimit: "Ліміт",
      thWindow: "Вікно",
      thDurable: "Стійке",
      yes: "так",
      no: "ні",
      secondsUnit: "с",
      durabilityLabel: "Чому стійкість — це і є суть",
      durabilityBody:
        "Квота, рахована на процес, — не квота: два інстанси тримають два вікна, а холодний старт повертає бюджет назад. Коли сховище недоступне, лічильник спрацьовує в бік відмови — це відмова, а не безкоштовний прохід.",
    },
    cannot: {
      title: "Чого команда не може зробити тут",
      badge: "межа",
      tagNotHere: "не тут",
    },
  },
} as const satisfies Record<WorkspaceLocale, TeamCopy>;

export async function generateMetadata(): Promise<Metadata> {
  const copy = COPY[await agentWorkspaceLocale()];
  return { title: copy.meta.title, description: copy.meta.description };
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

export default async function AgentWorkspaceTeamPage() {
  const copy = COPY[await agentWorkspaceLocale()];
  const surface = buildTeamSurface(new Date().toISOString());

  return (
    <div className="acw-page">
      <header className="acw-head">
        <div>
          <span className="acw-eyebrow">{copy.eyebrow}</span>
          <h1>{copy.heading}</h1>
          <p>{copy.lead}</p>
        </div>
        <span className="acw-environment">{copy.chip}</span>
      </header>

      <PanelGrid label={copy.gridLabel}>
        <Panel
          id="team-scopes"
          title={copy.scopes.title}
          w={6}
          h={4}
          tone="evidence"
          badge={copy.scopes.badge(surface.scopes.length)}
          scroll
        >
          <div className={styles.stack}>
            <p className={styles.lede}>{copy.scopes.lede}</p>
            <div className={styles.rows}>
              {surface.scopes.map((entry) => (
                <div
                  key={entry.scope}
                  className={entry.kind === "WRITE" ? `${styles.row} ${styles.rowAttention}` : styles.row}
                >
                  {entry.kind === "WRITE" ? (
                    <PencilSimpleLine size={16} weight="bold" aria-hidden />
                  ) : entry.kind === "OBSERVE" ? (
                    <Pulse size={16} weight="bold" aria-hidden />
                  ) : (
                    <Eye size={16} weight="bold" aria-hidden />
                  )}
                  <div>
                    <div className={styles.name}>{entry.scope}</div>
                    <div className={styles.what}>{entry.what}</div>
                  </div>
                  <span className={styles.tag}>
                    {entry.tools === 0 ? copy.scopes.tagNoTool : copy.scopes.tagTools(entry.tools)}
                  </span>
                </div>
              ))}
            </div>
            <Explain label={copy.scopes.unlocksLabel}>{copy.scopes.unlocksBody}</Explain>
          </div>
        </Panel>

        <Panel id="team-lifecycle" title={copy.lifecycle.title} w={6} h={4} tone="muted" badge={copy.lifecycle.badge} scroll>
          <div className={styles.stack}>
            <div className={styles.rows}>
              {surface.lifecycle.map((step) => (
                <div
                  key={step.step}
                  className={step.selfService ? styles.row : `${styles.row} ${styles.rowInert}`}
                >
                  <Key size={16} weight="bold" aria-hidden />
                  <div>
                    <div className={styles.name}>{step.step}</div>
                    <div className={styles.what}>{step.what}</div>
                  </div>
                  <span className={`${styles.tag} ${step.selfService ? "" : styles.tagNobody}`}>
                    {step.selfService ? copy.lifecycle.tagSelfService : copy.lifecycle.tagByHand}
                  </span>
                </div>
              ))}
            </div>
            <Explain label={copy.lifecycle.notSelfServiceLabel}>{copy.lifecycle.notSelfServiceBody}</Explain>
          </div>
        </Panel>

        <Panel id="team-records" title={copy.records.title} w={6} h={4} tone="evidence" badge={copy.records.badge} scroll>
          <div className={styles.stack}>
            <p className={styles.lede}>{copy.records.lede}</p>
            {/* Two independent lists, drawn as two lists.
                The first version put them in a two-column table, and the rows
                lined `displayName` up beside `tenantId` — unrelated fields
                reading as a mapping because they happened to be third in each
                list. A table promises correspondence between its columns. */}
            {[
              { heading: copy.records.tenantHeading, fields: surface.tenantFields },
              { heading: copy.records.keyHeading, fields: surface.keyFields },
            ].map((group) => (
              <div key={group.heading} className={styles.fieldGroup}>
                <div className={styles.fieldHeading}>{group.heading}</div>
                <div className={styles.fieldList}>
                  {group.fields.map((field) => (
                    <span
                      key={field.name}
                      className={field.secretDerived ? `${styles.field} ${styles.fieldSecret}` : styles.field}
                    >
                      {field.name}
                      {field.secretDerived ? copy.records.neverRendered : ""}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel
          id="team-refusals"
          title={copy.refusals.title}
          w={6}
          h={4}
          tone="caution"
          badge={copy.refusals.badge(surface.refusals.length)}
          scroll
        >
          <div className={styles.stack}>
            <p className={styles.lede}>{copy.refusals.lede}</p>
            <div className={styles.rows}>
              {surface.refusals.map((refusal) => (
                <div key={refusal} className={`${styles.row} ${styles.rowAttention}`}>
                  <Prohibit size={16} weight="bold" aria-hidden />
                  <div>
                    <div className={styles.name}>{refusal}</div>
                  </div>
                  <span className={styles.tag}>{copy.refusals.tagRefused}</span>
                </div>
              ))}
            </div>
            <Explain label={copy.refusals.revocationLabel}>{copy.refusals.revocationBody}</Explain>
          </div>
        </Panel>

        <Panel id="team-quota" title={copy.quotas.title} w={6} h={4} tone="muted" badge={copy.quotas.badge} scroll>
          <div className={styles.stack}>
            <div className={styles.table}>
              <table>
                <thead>
                  <tr>
                    <th scope="col">{copy.quotas.thPrincipal}</th>
                    <th scope="col">{copy.quotas.thLimit}</th>
                    <th scope="col">{copy.quotas.thWindow}</th>
                    <th scope="col">{copy.quotas.thDurable}</th>
                  </tr>
                </thead>
                <tbody>
                  {surface.quotas.map((quota) => (
                    <tr key={quota.principal}>
                      <td>{quota.principal}</td>
                      <td className={styles.num}>{quota.limit}</td>
                      <td className={styles.num}>{quota.windowSeconds}{copy.quotas.secondsUnit}</td>
                      <td>{quota.durable ? copy.quotas.yes : copy.quotas.no}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Explain label={copy.quotas.durabilityLabel}>{copy.quotas.durabilityBody}</Explain>
          </div>
        </Panel>

        <Panel
          id="team-blockers"
          title={copy.cannot.title}
          w={6}
          h={4}
          tone="caution"
          badge={copy.cannot.badge}
          scroll
        >
          <div className={styles.stack}>
            <div className={styles.rows}>
              {surface.blockers.map((blocker) => (
                <div key={blocker} className={`${styles.row} ${styles.rowInert}`}>
                  <Prohibit size={16} weight="bold" aria-hidden />
                  <div>
                    <div className={styles.what}>{blocker}</div>
                  </div>
                  <span className={`${styles.tag} ${styles.tagNobody}`}>{copy.cannot.tagNotHere}</span>
                </div>
              ))}
            </div>
          </div>
        </Panel>
      </PanelGrid>
    </div>
  );
}
