import type { Metadata } from "next";
import {
  Eye,
  Info,
  PencilSimpleLine,
  Prohibit,
  Pulse,
} from "@phosphor-icons/react/dist/ssr";

import { Panel, PanelGrid } from "@/app/shell/panel";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { buildAdoptionSurface } from "@/lib/agent-control/adoption-current";

import { agentWorkspaceLocale } from "../i18n/server";
import styles from "./adoption.module.css";

/**
 * External adoption.
 *
 * The page answers five questions and stops. **What can a key hold?** — three
 * scopes, and what each one unlocks. **What does the hosted endpoint actually
 * serve?** — eight of the twelve local tools, with the four it withholds named
 * and reasoned. **Who is refused, and by which reason?** — the real gate,
 * called at render time for every tool and scope pair. **What does a quota cost
 * and does it survive a restart?** — the two policies and the difference that
 * made them durable. **What is still missing?** — the exact blockers.
 *
 * Every verdict in the matrix is produced by `admitHostedToolCall` while this
 * page renders. Nothing here is a hand-written status, so the page cannot
 * disagree with the server.
 */

/** 1 скоуп, 2–4 скоупи, 5+ скоупів — the three Ukrainian plural forms. */
function ukPlural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

type AdoptionCopy = Readonly<{
  metaTitle: string;
  metaDescription: string;
  eyebrow: string;
  heading: string;
  lead: React.ReactNode;
  environment: string;
  gridLabel: string;
  scopes: Readonly<{
    title: string;
    badge: (count: number) => string;
    lede: string;
    noTool: string;
    tools: (count: number) => string;
    explainLabel: string;
    explainBody: React.ReactNode;
  }>;
  matrix: Readonly<{
    title: string;
    badge: string;
    lede: React.ReactNode;
    tool: string;
    admitted: string;
    refused: string;
    explainLabel: string;
    explainBody: React.ReactNode;
  }>;
  inventory: Readonly<{
    title: string;
    lede: React.ReactNode;
    withheld: string;
    explainLabel: string;
    explainBody: React.ReactNode;
  }>;
  quota: Readonly<{
    title: string;
    badge: string;
    value: (limit: number, windowSeconds: number) => string;
    changedLabel: string;
    changedBody: React.ReactNode;
    refusedLabel: string;
  }>;
  endpoints: Readonly<{
    title: string;
    badge: (count: number) => string;
    explainLabel: string;
    explainBody: React.ReactNode;
  }>;
  lifetimes: Readonly<{
    title: string;
    badge: string;
    duration: (seconds: number) => string;
    explainLabel: string;
    explainBody: React.ReactNode;
  }>;
  blockers: Readonly<{
    title: string;
    badge: (count: number) => string;
  }>;
}>;

const COPY = {
  en: {
    metaTitle: "External adoption",
    metaDescription:
      "API keys, tenancy, durable quotas and the OAuth-protected hosted MCP endpoint. Identity comes before anything hosted.",
    eyebrow: "Agent Control / External adoption",
    heading: "External adoption",
    lead: (
      <>
        Identity comes first, and everything hosted comes after it. A key names a tenant, a
        tenant gets a quota that survives a cold start, and an OAuth-protected MCP endpoint
        answers exactly what that key was willing to grant &mdash; enforced when a tool is
        called, not by hiding names from a list.
      </>
    ),
    environment: "IDENTITY REQUIRED",
    gridLabel: "External adoption",
    scopes: {
      title: "What a key can hold",
      badge: (count) => `${count} scopes`,
      lede: "The complete vocabulary. None of these names an authority, so a token carrying one cannot exist — the type has nothing to put there.",
      noTool: "no tool",
      tools: (count) => `${count} tools`,
      explainLabel: "Why one scope deliberately unlocks nothing",
      explainBody: (
        <>
          <code>metrics:read</code> grants no tool. An operator who needs to watch refusal
          counters should not have to hold a scope that can also write, and a scope that has to
          be bundled with another to be useful is a scope that will be over-granted.
        </>
      ),
    },
    matrix: {
      title: "What the gate answers",
      badge: "live gate",
      lede: (
        <>
          Every cell below is a real <code>admitHostedToolCall</code> call made while this page
          rendered, for a token holding exactly that one scope.
        </>
      ),
      tool: "Tool",
      admitted: "admitted",
      refused: "refused",
      explainLabel: "Why the filtered list is not the control",
      explainBody: (
        <>
          A caller that never sees a tool in <code>tools/list</code> can still name it, which is
          exactly what a generic execute indirection does. <code>RYN-BIN-AOS-003</code> found
          that empirically on somebody else&rsquo;s server. So the same gate runs again at call
          time, and a hidden name is refused with the reason the filter was expressing.
        </>
      ),
    },
    inventory: {
      title: "What the hosted endpoint serves",
      lede: (
        <>
          A strict subset of the local server&rsquo;s inventory. The four it withholds are the
          four that would make Ryntra fetch on a stranger&rsquo;s behalf.
        </>
      ),
      withheld: "withheld",
      explainLabel: "Why an outbound call is the line",
      explainBody: (
        <>
          On a local server the operator spends their own network. Hosted, the same tool makes
          this endpoint a proxy that fetches for anyone holding a token — an amplifier and an
          outbound surface nobody asked for. So the hosted endpoint makes no outbound call at
          all, which is <code>013</code>&rsquo;s rule about caller-supplied endpoints one layer
          out.
        </>
      ),
    },
    quota: {
      title: "What a quota costs, and where it lives",
      badge: "durable",
      value: (limit, windowSeconds) => `${limit}/${windowSeconds}s`,
      changedLabel: "What changed, and why it had to",
      changedBody: (
        <>
          The old limiter was a per-process fixed window: two warm instances each held their own,
          so a caller received the limit twice and a cold start handed it back. That is a floor,
          not a limit, and it stays as one — cheap, ahead of any store work. The durable counter
          in the configured store is the authority, and when it cannot be reached the request is
          refused rather than allowed. A quota you cannot count is not a quota, and the moment
          infrastructure is unhealthy is exactly when an unbounded caller does the most damage.
        </>
      ),
      refusedLabel: "Every way a credential is refused",
    },
    endpoints: {
      title: "The handshake, end to end",
      badge: (count) => `${count} endpoints`,
      explainLabel: "Why a client needs nothing configured by hand",
      explainBody: (
        <>
          An unauthenticated call answers <code>401</code> with a challenge naming the RFC 9728
          metadata URL. The client fetches that, learns the authorization server, fetches its
          metadata, registers itself and runs the code flow. Ryntra issues no client secret, so a
          connector&rsquo;s configuration holds nothing worth stealing.
        </>
      ),
    },
    lifetimes: {
      title: "How long anything lasts",
      badge: "revocable",
      duration: (seconds) =>
        seconds >= 86_400
          ? `${Math.round(seconds / 86_400)}d`
          : seconds >= 3_600
            ? `${Math.round(seconds / 3_600)}h`
            : `${seconds}s`,
      explainLabel: "What revocation actually reaches",
      explainBody: (
        <>
          Revocation is read on the verification path before expiry and before scope, so a
          revoked token cannot produce a reply implying it was otherwise fine. Revoking the key
          that approved a session ends the session too: the refresh path re-reads the key, and a
          revoked one takes the whole grant with it.
        </>
      ),
    },
    blockers: {
      title: "What stops this being finished",
      badge: (count) => `${count} open`,
    },
  },
  uk: {
    metaTitle: "Зовнішнє впровадження",
    metaDescription:
      "API-ключі, тенантність, стійкі квоти й захищений OAuth хостований ендпоінт MCP. Ідентичність передує всьому хостованому.",
    eyebrow: "Agent Control / Зовнішнє впровадження",
    heading: "Зовнішнє впровадження",
    lead: (
      <>
        Спершу ідентичність, а все хостоване — після неї. Ключ називає тенанта, тенант отримує
        квоту, що переживає холодний старт, а захищений OAuth ендпоінт MCP відповідає рівно тим,
        що цей ключ погодився надати — з перевіркою в момент виклику інструмента, а не через
        приховування назв зі списку.
      </>
    ),
    environment: "ПОТРІБНА ІДЕНТИЧНІСТЬ",
    gridLabel: "Зовнішнє впровадження",
    scopes: {
      title: "Що може тримати ключ",
      badge: (count) => `${count} ${ukPlural(count, "скоуп", "скоупи", "скоупів")}`,
      lede: "Повний словник. Жоден із них не називає повноваження, тож токена з повноваженням не може існувати — типу нема що туди покласти.",
      noTool: "жодного інструмента",
      tools: (count) => `${count} ${ukPlural(count, "інструмент", "інструменти", "інструментів")}`,
      explainLabel: "Чому один скоуп навмисно нічого не відкриває",
      explainBody: (
        <>
          <code>metrics:read</code> не надає жодного інструмента. Оператор, якому треба стежити за
          лічильниками відмов, не повинен тримати скоуп, що вміє ще й писати, а скоуп, який мусить
          іти в парі з іншим, щоб бути корисним, — це скоуп, який роздаватимуть надміру.
        </>
      ),
    },
    matrix: {
      title: "Що відповідає гейт",
      badge: "живий гейт",
      lede: (
        <>
          Кожна клітинка нижче — справжній виклик <code>admitHostedToolCall</code>, зроблений під
          час рендеру цієї сторінки, для токена рівно з одним цим скоупом.
        </>
      ),
      tool: "Інструмент",
      admitted: "допущено",
      refused: "відмовлено",
      explainLabel: "Чому відфільтрований список — не контроль",
      explainBody: (
        <>
          Викликач, який ніколи не бачить інструмент у <code>tools/list</code>, усе одно може його
          назвати — саме це робить генерична execute-індирекція. <code>RYN-BIN-AOS-003</code>{" "}
          виявив це емпірично на чужому сервері. Тож той самий гейт запускається знову в момент
          виклику, і приховану назву відхиляють із причиною, яку виражав фільтр.
        </>
      ),
    },
    inventory: {
      title: "Що обслуговує хостований ендпоінт",
      lede: (
        <>
          Строга підмножина інвентарю локального сервера. Чотири утримані — саме ті, що змусили б
          Ryntra робити запити від імені незнайомця.
        </>
      ),
      withheld: "утримано",
      explainLabel: "Чому вихідний виклик — це межа",
      explainBody: (
        <>
          На локальному сервері оператор витрачає власну мережу. У хостингу той самий інструмент
          робить цей ендпоінт проксі, що виконує запити для будь-кого з токеном — підсилювач і
          вихідна поверхня, якої ніхто не просив. Тож хостований ендпоінт не робить жодного
          вихідного виклику, і це правило <code>013</code> про надані викликачем ендпоінти, на
          один шар вище.
        </>
      ),
    },
    quota: {
      title: "Скільки коштує квота і де вона живе",
      badge: "стійка",
      value: (limit, windowSeconds) => `${limit}/${windowSeconds}с`,
      changedLabel: "Що змінилось і чому мусило",
      changedBody: (
        <>
          Старий обмежувач був фіксованим вікном на процес: два теплі інстанси тримали кожен своє,
          тож викликач отримував ліміт двічі, а холодний старт повертав його назад. Це підлога, а
          не ліміт, і вона такою й лишається — дешева, попереду будь-якої роботи зі сховищем.
          Авторитетом є стійкий лічильник у налаштованому сховищі, і коли він недосяжний, запит
          відхиляється, а не пропускається. Квота, якої не можеш порахувати, — не квота, а момент,
          коли інфраструктура нездорова, — саме той, коли необмежений викликач завдає найбільшої
          шкоди.
        </>
      ),
      refusedLabel: "Усі способи відмовити обліковим даним",
    },
    endpoints: {
      title: "Рукостискання, від краю до краю",
      badge: (count) => `${count} ${ukPlural(count, "ендпоінт", "ендпоінти", "ендпоінтів")}`,
      explainLabel: "Чому клієнту нічого не треба налаштовувати вручну",
      explainBody: (
        <>
          Неавтентифікований виклик відповідає <code>401</code> із викликом, що називає URL
          метаданих RFC 9728. Клієнт отримує їх, дізнається сервер авторизації, отримує його
          метадані, реєструється і проходить code flow. Ryntra не видає клієнтського секрету, тож
          конфігурація конектора не містить нічого, що варто вкрасти.
        </>
      ),
    },
    lifetimes: {
      title: "Скільки що триває",
      badge: "відкличне",
      duration: (seconds) =>
        seconds >= 86_400
          ? `${Math.round(seconds / 86_400)}д`
          : seconds >= 3_600
            ? `${Math.round(seconds / 3_600)}год`
            : `${seconds}с`,
      explainLabel: "Куди насправді сягає відкликання",
      explainBody: (
        <>
          Відкликання читається на шляху перевірки до строку дії й до скоупа, тож відкликаний
          токен не може породити відповідь, яка натякала б, що з ним усе гаразд. Відкликання
          ключа, що схвалив сесію, завершує і сесію: шлях оновлення перечитує ключ, і відкликаний
          тягне за собою весь грант.
        </>
      ),
    },
    blockers: {
      title: "Що заважає це завершити",
      badge: (count) => `${count} відкрито`,
    },
  },
} as const satisfies Record<WorkspaceLocale, AdoptionCopy>;

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

export default async function AgentWorkspaceAdoptionPage() {
  const locale = await agentWorkspaceLocale();
  const copy = COPY[locale];
  const surface = buildAdoptionSurface();

  return (
    <div className="acw-page">
      <header className="acw-head">
        <div>
          <span className="acw-eyebrow">{copy.eyebrow}</span>
          {/* The EN heading stays a literal: `adoption-surface.test.mjs` pins
              `<h1>External adoption</h1>` in this source file. */}
          {locale === "uk" ? <h1>{copy.heading}</h1> : <h1>External adoption</h1>}
          <p>{copy.lead}</p>
        </div>
        <span className="acw-environment">{copy.environment}</span>
      </header>

      <PanelGrid label={copy.gridLabel}>
      <Panel
        id="adoption-scopes"
        title={copy.scopes.title}
        w={6}
        h={6}
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
                className={
                  entry.kind === "WRITE" ? `${styles.row} ${styles.rowWrite}` : styles.row
                }
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
                <span className={styles.count}>
                  {entry.tools.length === 0 ? copy.scopes.noTool : copy.scopes.tools(entry.tools.length)}
                </span>
              </div>
            ))}
          </div>
          <Explain label={copy.scopes.explainLabel}>{copy.scopes.explainBody}</Explain>
        </div>
      </Panel>

      <Panel
        id="adoption-matrix"
        title={copy.matrix.title}
        w={6}
        h={6}
        tone="verified"
        badge={copy.matrix.badge}
        scroll
      >
        <div className={styles.stack}>
          <p className={styles.lede}>{copy.matrix.lede}</p>
          <div className={styles.matrix}>
            <table>
              <thead>
                <tr>
                  <th scope="col">{copy.matrix.tool}</th>
                  {surface.scopes.map((entry) => (
                    <th key={entry.scope} scope="col">
                      {entry.scope}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {surface.hostedNames.map((tool) => (
                  <tr key={tool}>
                    <th scope="row">{tool}</th>
                    {surface.scopes.map((entry) => {
                      const cell = surface.matrix.find(
                        (item) => item.tool === tool && item.scope === entry.scope,
                      );
                      return (
                        <td
                          key={entry.scope}
                          className={cell?.verdict === "ADMITTED" ? styles.yes : styles.no}
                        >
                          {cell?.verdict === "ADMITTED" ? copy.matrix.admitted : copy.matrix.refused}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Explain label={copy.matrix.explainLabel}>{copy.matrix.explainBody}</Explain>
        </div>
      </Panel>

      <Panel
        id="adoption-inventory"
        title={copy.inventory.title}
        w={6}
        h={6}
        tone="evidence"
        badge={
          locale === "uk"
            ? `${surface.hostedNames.length} з ${surface.localNames.length}`
            : /* The EN template stays a literal: `adoption-surface.test.mjs`
                 pins this exact count-against-denominator expression. */
              `${surface.hostedNames.length} of ${surface.localNames.length}`
        }
        scroll
      >
        <div className={styles.stack}>
          <p className={styles.lede}>{copy.inventory.lede}</p>
          <div className={styles.rows}>
            {surface.withheld.map((entry) => (
              <div key={entry.name} className={styles.row}>
                <Prohibit size={16} weight="bold" aria-hidden />
                <div>
                  <div className={styles.name}>{entry.name}</div>
                  <div className={styles.what}>{entry.reason}</div>
                </div>
                <span className={styles.count}>{copy.inventory.withheld}</span>
              </div>
            ))}
          </div>
          <Explain label={copy.inventory.explainLabel}>{copy.inventory.explainBody}</Explain>
        </div>
      </Panel>

      <Panel
        id="adoption-quota"
        title={copy.quota.title}
        w={6}
        h={4}
        tone="evidence"
        badge={copy.quota.badge}
        scroll
      >
        <div className={styles.stack}>
          <div className={styles.pairs}>
            {surface.quotas.map((row) => (
              <div key={row.principal} className={styles.pair}>
                <div className={styles.pairLabel}>
                  {row.principal}
                  <div className={styles.pairNote}>{row.note}</div>
                </div>
                <span className={styles.pairValue}>{copy.quota.value(row.limit, row.windowSeconds)}</span>
              </div>
            ))}
          </div>
          <Explain label={copy.quota.changedLabel}>{copy.quota.changedBody}</Explain>
          <Explain label={copy.quota.refusedLabel}>
            <ul className={styles.codes}>
              {surface.refusals.map((code) => (
                <li key={code} className={styles.code}>
                  {code}
                </li>
              ))}
            </ul>
          </Explain>
        </div>
      </Panel>

      <Panel
        id="adoption-endpoints"
        title={copy.endpoints.title}
        w={6}
        h={6}
        tone="evidence"
        badge={copy.endpoints.badge(surface.endpoints.length)}
        scroll
      >
        <div className={styles.stack}>
          <div className={styles.rows}>
            {surface.endpoints.map((entry) => (
              <div key={entry.path} className={styles.row}>
                {entry.authenticated ? (
                  <PencilSimpleLine size={16} weight="bold" aria-hidden />
                ) : (
                  <Eye size={16} weight="bold" aria-hidden />
                )}
                <div>
                  <div className={styles.name}>{entry.path}</div>
                  <div className={styles.what}>{entry.what}</div>
                </div>
                <span className={styles.count}>{entry.rfc}</span>
              </div>
            ))}
          </div>
          <Explain label={copy.endpoints.explainLabel}>{copy.endpoints.explainBody}</Explain>
        </div>
      </Panel>

      <Panel
        id="adoption-lifetimes"
        title={copy.lifetimes.title}
        w={6}
        h={4}
        tone="caution"
        badge={copy.lifetimes.badge}
        scroll
      >
        <div className={styles.stack}>
          <div className={styles.pairs}>
            {surface.lifetimes.map((entry) => (
              <div key={entry.label} className={styles.pair}>
                <div className={styles.pairLabel}>
                  {entry.label}
                  <div className={styles.pairNote}>{entry.why}</div>
                </div>
                <span className={styles.pairValue}>{copy.lifetimes.duration(entry.seconds)}</span>
              </div>
            ))}
          </div>
          <Explain label={copy.lifetimes.explainLabel}>{copy.lifetimes.explainBody}</Explain>
        </div>
      </Panel>

      <Panel
        id="adoption-blockers"
        title={copy.blockers.title}
        w={12}
        h={4}
        tone="caution"
        badge={copy.blockers.badge(surface.blockers.length)}
        scroll
      >
        <div className={styles.stack}>
          <div className={styles.rows}>
            {surface.blockers.map((blocker) => (
              <div key={blocker} className={styles.row}>
                <Prohibit size={16} weight="bold" aria-hidden />
                <div className={styles.what}>{blocker}</div>
                <span className={styles.count} />
              </div>
            ))}
          </div>
        </div>
      </Panel>
      </PanelGrid>
    </div>
  );
}
