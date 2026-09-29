import type { Metadata } from "next";
import {
  CheckCircle,
  Eye,
  Info,
  Prohibit,
  UserCircle,
  Warning,
  Wrench,
} from "@phosphor-icons/react/dist/ssr";

import { Panel, PanelGrid } from "@/app/shell/panel";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { buildAttentionSurface } from "@/lib/agent-control/attention-current";
import { ATTENTION_CATEGORIES } from "@/lib/agent-control/attention";

import { agentWorkspaceLocale } from "../i18n/server";
import styles from "../finish-surface.module.css";

/**
 * Attention and recovery.
 *
 * Three questions. **What needs a person?** — the queue, in category order.
 * **Who can fix it?** — an actor on every row, including the honest `NOBODY`
 * with the record that would change it. **What was looked at?** — the checklist,
 * so an empty queue is a statement rather than a blank.
 *
 * The rank on each row is the index of a frozen category table and there is no
 * other number on the record. A single invented magnitude would merge a person
 * waiting, a credential lapsing and a store being down onto one axis nobody can
 * audit, and the first time it ranked something wrongly the fix would be to
 * tune a constant rather than to fix a rule.
 */

const ACTOR_TAG: Readonly<Record<string, string>> = {
  OWNER: styles.tagOwner,
  RYNTRA: styles.tagRyntra,
  PROVIDER: styles.tag,
  NOBODY: styles.tagNobody,
};

/** Ukrainian cardinal agreement: 1 запис, 2 записи, 5 записів. */
function ukPlural(n: number, one: string, few: string, many: string): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 14) return many;
  const ones = n % 10;
  if (ones === 1) return one;
  if (ones >= 2 && ones <= 4) return few;
  return many;
}

type AttentionCopy = {
  meta: { title: string; description: string };
  eyebrow: string;
  heading: string;
  lead: string;
  chipCalm: string;
  chipWithOwner: (n: number) => string;
  gridLabel: string;
  actorLabel: Readonly<Record<string, string>>;
  queue: {
    title: string;
    badgeCalm: string;
    badgeItems: (n: number) => string;
    orderedLabel: string;
    orderedBody: React.ReactNode;
  };
  checked: { title: string; badge: string; lede: string; tagRead: string };
  priority: {
    title: string;
    badge: string;
    thRank: string;
    thCategory: string;
    thOutranks: string;
    outranksNothing: string;
    boundaryLabel: string;
    boundaryBody: string;
  };
  cannot: { title: string; badge: string; tagNotHere: string };
};

const COPY = {
  en: {
    meta: {
      title: "Attention and recovery",
      description:
        "What needs a person in Agent Control right now, ranked by a declared table rather than an invented score — and who can actually fix each one.",
    },
    eyebrow: "Agent Control / Attention",
    heading: "Attention and recovery",
    lead: "What is waiting on a person, in the order a declared table puts it — and beside each one, the exact step that clears it and who can take it. Nothing on this page acts; every recovery happens somewhere else.",
    chipCalm: "NOTHING WAITING",
    chipWithOwner: (n: number) => `${n} WITH AN OWNER`,
    gridLabel: "Attention and recovery",
    actorLabel: {
      OWNER: "founder",
      RYNTRA: "Ryntra",
      PROVIDER: "provider",
      NOBODY: "nobody yet",
    },
    queue: {
      title: "What needs a person",
      badgeCalm: "calm",
      badgeItems: (n: number) => `${n} items`,
      orderedLabel: "How this queue is ordered",
      orderedBody: (
        <>
          By the index of a frozen category table and nothing else:{" "}
          <code>{ATTENTION_CATEGORIES.join(" → ")}</code>. Two items in the same category are
          equally important and sit side by side. There is no importance number anywhere on a
          record, because one magnitude covering incomparable things is a number nobody can
          audit.
        </>
      ),
    },
    checked: {
      title: "What was looked at",
      badge: "4 sources",
      lede: "An empty queue means these were checked and came back quiet — not that nothing loaded.",
      tagRead: "read",
    },
    priority: {
      title: "The priority table",
      badge: "frozen",
      thRank: "Rank",
      thCategory: "Category",
      thOutranks: "Outranks",
      outranksNothing: "nothing — a chosen boundary sorts last",
      boundaryLabel: "Why a chosen boundary sorts last",
      boundaryBody:
        "A decision somebody took on purpose is not a fault. Putting one at the top of an attention queue trains a reader to ignore the queue, which is the failure a priority table exists to prevent.",
    },
    cannot: {
      title: "What this surface cannot do",
      badge: "boundary",
      tagNotHere: "not here",
    },
  },
  uk: {
    meta: {
      title: "Увага та відновлення",
      description:
        "Що просто зараз потребує людини в Agent Control, упорядковане за оголошеною таблицею, а не за вигаданою оцінкою — і хто насправді може виправити кожен пункт.",
    },
    eyebrow: "Agent Control / Увага",
    heading: "Увага та відновлення",
    lead: "Що чекає на людину — у порядку, який задає оголошена таблиця, — і поруч із кожним пунктом точний крок, що його закриває, та хто може цей крок зробити. Ніщо на цій сторінці не діє; кожне відновлення відбувається деінде.",
    chipCalm: "НІЩО НЕ ЧЕКАЄ",
    chipWithOwner: (n: number) => `${n} З ВІДПОВІДАЛЬНИМ`,
    gridLabel: "Увага та відновлення",
    actorLabel: {
      OWNER: "засновник",
      RYNTRA: "Ryntra",
      PROVIDER: "провайдер",
      NOBODY: "поки ніхто",
    },
    queue: {
      title: "Що потребує людини",
      badgeCalm: "спокійно",
      badgeItems: (n: number) => `${n} ${ukPlural(n, "запис", "записи", "записів")}`,
      orderedLabel: "Як упорядковано цю чергу",
      orderedBody: (
        <>
          За індексом замороженої таблиці категорій і нічим іншим:{" "}
          <code>{ATTENTION_CATEGORIES.join(" → ")}</code>. Два записи в одній категорії однаково
          важливі й стоять поруч. Ніде в записі немає числа важливості, бо одна величина, що
          накриває непорівнянні речі, — це число, якого ніхто не може проаудитувати.
        </>
      ),
    },
    checked: {
      title: "Що було переглянуто",
      badge: "4 джерела",
      lede: "Порожня черга означає, що ці джерела перевірено й вони повернулися тихими — а не що нічого не завантажилось.",
      tagRead: "прочитано",
    },
    priority: {
      title: "Таблиця пріоритетів",
      badge: "заморожена",
      thRank: "Ранг",
      thCategory: "Категорія",
      thOutranks: "Вище за",
      outranksNothing: "нічого — свідомо обрана межа сортується останньою",
      boundaryLabel: "Чому свідомо обрана межа сортується останньою",
      boundaryBody:
        "Рішення, яке хтось ухвалив навмисно, — не збій. Поставити його на вершину черги уваги означає привчити читача ігнорувати чергу, а це саме той провал, якому таблиця пріоритетів має запобігати.",
    },
    cannot: {
      title: "Чого ця поверхня не може",
      badge: "межа",
      tagNotHere: "не тут",
    },
  },
} as const satisfies Record<WorkspaceLocale, AttentionCopy>;

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

function CategoryIcon({ category }: { category: string }) {
  if (category === "OWNER_DECISION") return <UserCircle size={16} weight="bold" aria-hidden />;
  if (category === "DEGRADED_DEPENDENCY") return <Wrench size={16} weight="bold" aria-hidden />;
  if (category === "OPERATIONAL_NOTE") return <Eye size={16} weight="bold" aria-hidden />;
  return <Warning size={16} weight="bold" aria-hidden />;
}

export default async function AgentWorkspaceAttentionPage() {
  const copy = COPY[await agentWorkspaceLocale()];
  const surface = buildAttentionSurface(new Date().toISOString());
  const { queue } = surface;
  const needsSomeone = queue.items.filter((item) => item.recovery.actor !== "NOBODY").length;

  return (
    <div className="acw-page">
      <header className="acw-head">
        <div>
          <span className="acw-eyebrow">{copy.eyebrow}</span>
          <h1>{copy.heading}</h1>
          <p>{copy.lead}</p>
        </div>
        <span className="acw-environment">
          {queue.calm ? copy.chipCalm : copy.chipWithOwner(needsSomeone)}
        </span>
      </header>

      <PanelGrid label={copy.gridLabel}>
        <Panel
          id="attention-queue"
          title={copy.queue.title}
          w={8}
          h={6}
          tone={needsSomeone > 0 ? "caution" : "muted"}
          badge={queue.calm ? copy.queue.badgeCalm : copy.queue.badgeItems(queue.items.length)}
          scroll
        >
          <div className={styles.stack}>
            {queue.calm ? (
              <div className={styles.calm}>
                <CheckCircle size={20} weight="bold" aria-hidden />
                <span className={styles.calmText}>{queue.calmReason}</span>
              </div>
            ) : (
              <div className={styles.rows}>
                {queue.items.map((item) => (
                  <div
                    key={item.id}
                    className={
                      item.recovery.actor === "NOBODY"
                        ? `${styles.row} ${styles.rowInert}`
                        : item.category === "OPERATIONAL_NOTE"
                          ? styles.row
                          : `${styles.row} ${styles.rowAttention}`
                    }
                  >
                    <CategoryIcon category={item.category} />
                    <div>
                      <div className={styles.name}>{item.title}</div>
                      <div className={styles.what}>{item.detail}</div>
                      <div className={styles.meta}>
                        {item.recovery.step}
                        {item.recovery.opensWith ? ` — ${item.recovery.opensWith}` : ""}
                      </div>
                    </div>
                    <span className={`${styles.tag} ${ACTOR_TAG[item.recovery.actor]}`}>
                      {copy.actorLabel[item.recovery.actor]}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <Explain label={copy.queue.orderedLabel}>{copy.queue.orderedBody}</Explain>
          </div>
        </Panel>

        <Panel id="attention-checked" title={copy.checked.title} w={4} h={6} tone="evidence" badge={copy.checked.badge} scroll>
          <div className={styles.stack}>
            <p className={styles.lede}>{copy.checked.lede}</p>
            <div className={styles.rows}>
              {surface.checked.map((entry) => (
                <div key={entry.what} className={styles.row}>
                  <Eye size={16} weight="bold" aria-hidden />
                  <div>
                    <div className={styles.name}>{entry.what}</div>
                    <div className={styles.meta}>{entry.source}</div>
                  </div>
                  <span className={styles.tag}>{copy.checked.tagRead}</span>
                </div>
              ))}
            </div>
          </div>
        </Panel>

        <Panel id="attention-priority" title={copy.priority.title} w={6} h={4} tone="muted" badge={copy.priority.badge} scroll>
          <div className={styles.stack}>
            <div className={styles.table}>
              <table>
                <thead>
                  <tr>
                    <th scope="col">{copy.priority.thRank}</th>
                    <th scope="col">{copy.priority.thCategory}</th>
                    <th scope="col">{copy.priority.thOutranks}</th>
                  </tr>
                </thead>
                <tbody>
                  {ATTENTION_CATEGORIES.map((category, index) => (
                    <tr key={category}>
                      <td className={styles.num}>{index}</td>
                      <td>{category}</td>
                      <td className={styles.blocked}>
                        {index === ATTENTION_CATEGORIES.length - 1
                          ? copy.priority.outranksNothing
                          : ATTENTION_CATEGORIES[index + 1]}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Explain label={copy.priority.boundaryLabel}>{copy.priority.boundaryBody}</Explain>
          </div>
        </Panel>

        <Panel id="attention-blockers" title={copy.cannot.title} w={6} h={4} tone="caution" badge={copy.cannot.badge} scroll>
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
