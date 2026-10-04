import type { Metadata } from "next";
import { ChartBar, Info, Prohibit, Pulse, Warning } from "@phosphor-icons/react/dist/ssr";

import { Panel, PanelGrid } from "@/app/shell/panel";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { buildOperationsSurface } from "@/lib/agent-control/operations-current";

import { agentWorkspaceLocale } from "../i18n/server";
import styles from "../finish-surface.module.css";

/**
 * Statistics and operations analytics.
 *
 * Four questions and a stop. **What has this instance answered?** — requests
 * and refusals, with the counting boundary printed beside them rather than in a
 * footnote. **What is being refused, and under which code?** — the real outcome
 * counters, broken out. **What does this build actually ship?** — the catalogue
 * sizes, in their own panel because they are a different kind of number.
 * **What is not measured?** — five things, each with the reason.
 *
 * The last panel is the one that keeps the first three honest. An analytics
 * page that shows real numbers and says nothing about its own limits invites
 * the reader to supply the missing certainty, and per-instance counters read as
 * fleet traffic the moment nobody says otherwise.
 */

/** Ukrainian cardinal agreement: 1 код, 2 коди, 5 кодів. */
function ukPlural(n: number, one: string, few: string, many: string): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 14) return many;
  const ones = n % 10;
  if (ones === 1) return one;
  if (ones >= 2 && ones <= 4) return few;
  return many;
}

type OperationsCopy = {
  meta: { title: string; description: string };
  eyebrow: string;
  heading: string;
  lead: string;
  chip: string;
  gridLabel: string;
  kindMeasured: string;
  kindDeclared: string;
  traffic: {
    title: string;
    badgeObserved: string;
    badgeNoTraffic: string;
    rateNone: string;
    rateSome: string;
    dashLabel: string;
    dashBody: React.ReactNode;
  };
  refusals: {
    title: string;
    badge: (n: number) => string;
    calm: string;
    whatCountsLabel: string;
    whatCountsBody: React.ReactNode;
  };
  routes: {
    title: string;
    badge: (n: number) => string;
    empty: string;
    thRoute: string;
    thRequests: string;
    thRefused: string;
    thMean: string;
    msUnit: string;
    truncated: string;
    missingLabel: string;
    missingBody: React.ReactNode;
  };
  catalogue: {
    title: string;
    badge: string;
    lede: string;
    neverAddedLabel: string;
    neverAddedBody: React.ReactNode;
  };
  perimeter: {
    title: string;
    badge: (n: number) => string;
    lede: string;
    thCapability: string;
    thMainnet: string;
    thState: string;
    noCanaryLabel: string;
    noCanaryBody: string;
  };
  notMeasured: { title: string; badge: string; tagNotCounted: string };
  quotas: {
    title: string;
    badge: string;
    thPrincipal: string;
    thLimit: string;
    thWindow: string;
    secondsUnit: string;
    footer: string;
  };
};

const COPY = {
  en: {
    meta: {
      title: "Operations",
      description:
        "What Agent Control is doing, counted per warm instance — and the list of things it deliberately does not count.",
    },
    eyebrow: "Agent Control / Operations",
    heading: "Operations",
    lead: "What this instance has answered since it woke, what it refused and under which code — and, beside every figure, the boundary the count stops at. Nothing here is a fleet total, because none is computed.",
    chip: "PER WARM INSTANCE",
    gridLabel: "Operations",
    kindMeasured: "MEASURED",
    kindDeclared: "DECLARED",
    traffic: {
      title: "What this instance answered",
      badgeObserved: "observed",
      badgeNoTraffic: "no traffic yet",
      rateNone: "no rate: nothing has been observed yet",
      rateSome: "of observed requests were refused",
      dashLabel: "Why a silent instance shows a dash and not 0%",
      dashBody: (
        <>
          Zero over zero is not zero percent. An instance that has answered nothing has no
          rate, and printing <code>0%</code> would read as &ldquo;nothing is being
          refused&rdquo; &mdash; a claim about traffic that never arrived.
        </>
      ),
    },
    refusals: {
      title: "What is being refused",
      badge: (n: number) => `${n} codes`,
      calm: "No refusal has been counted on this instance. That is a statement about this process since it woke, not about the service.",
      whatCountsLabel: "What counts as a refusal here",
      whatCountsBody: (
        <>
          Any request whose outcome was not <code>OK</code>. The observer records route,
          method, status, outcome and duration &mdash; nothing else &mdash; and a credential
          never reaches a log line: the emitted bytes are scanned before they are written.
        </>
      ),
    },
    routes: {
      title: "By route",
      badge: (n: number) => `${n} routes`,
      empty:
        "No route has been called on this instance yet. A route appears here the first time it answers.",
      thRoute: "Route",
      thRequests: "Requests",
      thRefused: "Refused",
      thMean: "Mean",
      msUnit: "ms",
      truncated:
        "The counter maps hit their cap and this snapshot is truncated. Some routes or outcomes were dropped rather than growing without bound.",
      missingLabel: "Why a route can be missing from this list",
      missingBody: (
        <>
          A route appears the first time it answers on <em>this</em> instance. An absent row
          means this process has not served it &mdash; not that nobody has called it. The map
          is also capped at 64 routes and 24 outcomes each, so a hostile caller cannot grow it
          without bound; when a cap is hit the snapshot says it was truncated rather than
          reading as complete.
        </>
      ),
    },
    catalogue: {
      title: "What this build ships",
      badge: "declared",
      lede: "A different kind of number: nothing happened to produce these. They are the sizes of catalogues this build carries, read from the modules that own them.",
      neverAddedLabel: "Why these are never added to the numbers above",
      neverAddedBody: (
        <>
          A measured count and a catalogue size are both integers and mean nothing alike.{" "}
          <code>sumCounts</code> throws when the two kinds are mixed, so a future headline
          figure is refused at the point of use rather than after it is published.
        </>
      ),
    },
    perimeter: {
      title: "Mainnet promotion",
      badge: (n: number) => `${n} blocked`,
      lede: "Every capability is judged on its own canary. Nothing is promoted because another capability ran, and nothing is promoted because a chain opened.",
      thCapability: "Capability",
      thMainnet: "Mainnet",
      thState: "State",
      noCanaryLabel: "Why every row says NO_CANARY",
      noCanaryBody:
        "Since 2026-08-21, Base Sepolia is the default execution rail for this phase: testnet only, no mainnet execution. There is no mainnet run to record, so the canary set is empty and every capability is refused by the same computation that would promote it.",
    },
    notMeasured: {
      title: "What is not measured",
      badge: "boundary",
      tagNotCounted: "not counted",
    },
    quotas: {
      title: "Quota policy",
      badge: "durable",
      thPrincipal: "Principal",
      thLimit: "Limit",
      thWindow: "Window",
      secondsUnit: "s",
      footer:
        "Counted in the configured durable store, so two instances share one window and a cold start does not hand it back.",
    },
  },
  uk: {
    meta: {
      title: "Операції",
      description:
        "Що робить Agent Control, пораховано на кожен теплий інстанс — і перелік того, чого він свідомо не рахує.",
    },
    eyebrow: "Agent Control / Операції",
    heading: "Операції",
    lead: "Що цей інстанс відповів, відколи прокинувся, що відхилив і під яким кодом — і поруч із кожною цифрою межа, на якій зупиняється підрахунок. Ніщо тут не є підсумком по всіх інстансах, бо такий підсумок не обчислюється.",
    chip: "НА ОДИН ТЕПЛИЙ ІНСТАНС",
    gridLabel: "Операції",
    kindMeasured: "ВИМІРЯНО",
    kindDeclared: "ЗАДЕКЛАРОВАНО",
    traffic: {
      title: "Що відповів цей інстанс",
      badgeObserved: "спостережено",
      badgeNoTraffic: "трафіку ще немає",
      rateNone: "без частки: ще нічого не спостережено",
      rateSome: "спостережених запитів відхилено",
      dashLabel: "Чому мовчазний інстанс показує риску, а не 0%",
      dashBody: (
        <>
          Нуль, поділений на нуль, — це не нуль відсотків. Інстанс, який ще нічого не відповів,
          не має частки, а надрукований <code>0%</code> читався б як «ніщо не відхиляється» —
          твердження про трафік, який так і не надійшов.
        </>
      ),
    },
    refusals: {
      title: "Що відхиляється",
      badge: (n: number) => `${n} ${ukPlural(n, "код", "коди", "кодів")}`,
      calm: "На цьому інстансі не зафіксовано жодної відмови. Це твердження про цей процес, відколи він прокинувся, а не про сервіс.",
      whatCountsLabel: "Що тут вважається відмовою",
      whatCountsBody: (
        <>
          Будь-який запит, чий результат не був <code>OK</code>. Спостерігач записує маршрут,
          метод, статус, результат і тривалість — нічого більше, — а облікові дані ніколи не
          потрапляють у рядок логу: емітовані байти скануються перед записом.
        </>
      ),
    },
    routes: {
      title: "За маршрутами",
      badge: (n: number) => `${n} ${ukPlural(n, "маршрут", "маршрути", "маршрутів")}`,
      empty:
        "На цьому інстансі ще не викликано жодного маршруту. Маршрут зʼявляється тут після першої відповіді.",
      thRoute: "Маршрут",
      thRequests: "Запити",
      thRefused: "Відхилено",
      thMean: "Середня",
      msUnit: "мс",
      truncated:
        "Мапи лічильників досягли свого ліміту, і цей знімок обрізано. Частину маршрутів чи результатів відкинуто, замість того щоб рости без межі.",
      missingLabel: "Чому маршруту може не бути в цьому списку",
      missingBody: (
        <>
          Маршрут зʼявляється після першої відповіді на <em>цьому</em> інстансі. Відсутній рядок
          означає, що цей процес його не обслуговував — а не що його ніхто не викликав. Мапа
          також обмежена 64 маршрутами і 24 результатами кожна, тож ворожий викликач не може
          розростити її без межі; коли ліміт досягнуто, знімок каже, що його обрізано, замість
          читатися як повний.
        </>
      ),
    },
    catalogue: {
      title: "Що постачає цей білд",
      badge: "задекларовано",
      lede: "Інший тип числа: щоб отримати ці, нічого не мало статися. Це розміри каталогів, які несе цей білд, прочитані з модулів, що ними володіють.",
      neverAddedLabel: "Чому їх ніколи не додають до чисел вище",
      neverAddedBody: (
        <>
          Виміряний лічильник і розмір каталогу — обидва цілі числа, які не означають нічого
          спільного. <code>sumCounts</code> кидає виняток, коли ці два типи змішують, тож
          майбутня заголовна цифра відхиляється в місці використання, а не після публікації.
        </>
      ),
    },
    perimeter: {
      title: "Просування в mainnet",
      badge: (n: number) => `${n} заблоковано`,
      lede: "Кожна можливість оцінюється за власною канаркою. Ніщо не просувається тому, що запрацювала інша можливість, і ніщо не просувається тому, що відкрився ланцюг.",
      thCapability: "Можливість",
      thMainnet: "Mainnet",
      thState: "Стан",
      noCanaryLabel: "Чому в кожному рядку NO_CANARY",
      noCanaryBody:
        "З 2026-08-21 Base Sepolia — типова рейка виконання на цю фазу: лише testnet, без виконання в mainnet. Немає запуску в mainnet, який можна було б записати, тож набір канарок порожній і кожна можливість відхиляється тим самим обчисленням, яке її й просувало б.",
    },
    notMeasured: {
      title: "Що не вимірюється",
      badge: "межа",
      tagNotCounted: "не рахується",
    },
    quotas: {
      title: "Політика квот",
      badge: "стійка",
      thPrincipal: "Принципал",
      thLimit: "Ліміт",
      thWindow: "Вікно",
      secondsUnit: "с",
      footer:
        "Рахується в налаштованому стійкому сховищі, тож два інстанси ділять одне вікно, а холодний старт не повертає його назад.",
    },
  },
} as const satisfies Record<WorkspaceLocale, OperationsCopy>;

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

export default async function AgentWorkspaceOperationsPage() {
  const copy = COPY[await agentWorkspaceLocale()];
  const surface = buildOperationsSurface(new Date().toISOString());
  const { analytics } = surface;
  const declared = Object.values(analytics.declared.counts);

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
          id="ops-traffic"
          title={copy.traffic.title}
          w={6}
          h={4}
          tone="evidence"
          badge={analytics.measured.hasTraffic ? copy.traffic.badgeObserved : copy.traffic.badgeNoTraffic}
          scroll
        >
          <div className={styles.stack}>
            <div className={styles.figures}>
              <div className={styles.figure}>
                <div className={analytics.measured.hasTraffic ? styles.value : `${styles.value} ${styles.valueQuiet}`}>
                  {analytics.measured.requests.value}
                </div>
                <div className={styles.caption}>{analytics.measured.requests.what}</div>
                <span className={styles.kind}>{copy.kindMeasured}</span>
              </div>
              <div className={styles.figure}>
                <div className={analytics.measured.refused.value > 0 ? `${styles.value} ${styles.refused}` : `${styles.value} ${styles.valueQuiet}`}>
                  {analytics.measured.refused.value}
                </div>
                <div className={styles.caption}>{analytics.measured.refused.what}</div>
                <span className={styles.kind}>{copy.kindMeasured}</span>
              </div>
              <div className={styles.figure}>
                <div className={analytics.measured.refusalRate === null ? `${styles.value} ${styles.valueQuiet}` : styles.value}>
                  {analytics.measured.refusalRate ?? "—"}
                </div>
                <div className={styles.caption}>
                  {analytics.measured.refusalRate === null ? copy.traffic.rateNone : copy.traffic.rateSome}
                </div>
                <span className={styles.kind}>{copy.kindMeasured}</span>
              </div>
            </div>
            <Explain label={copy.traffic.dashLabel}>{copy.traffic.dashBody}</Explain>
            <p className={styles.lede}>{analytics.measured.caveat}</p>
          </div>
        </Panel>

        <Panel
          id="ops-refusals"
          title={copy.refusals.title}
          w={6}
          h={4}
          tone={analytics.refusals.length > 0 ? "caution" : "muted"}
          badge={copy.refusals.badge(analytics.refusals.length)}
          scroll
        >
          <div className={styles.stack}>
            {analytics.refusals.length === 0 ? (
              <div className={styles.calm}>
                <Pulse size={20} weight="bold" aria-hidden />
                <span className={styles.calmText}>{copy.refusals.calm}</span>
              </div>
            ) : (
              <div className={styles.rows}>
                {analytics.refusals.map((row) => (
                  <div key={row.code} className={`${styles.row} ${styles.rowAttention}`}>
                    <Warning size={16} weight="bold" aria-hidden />
                    <div>
                      <div className={styles.name}>{row.code}</div>
                      <div className={styles.what}>{row.count.what}</div>
                    </div>
                    <span className={`${styles.tag} ${styles.num}`}>{row.count.value}</span>
                  </div>
                ))}
              </div>
            )}
            <Explain label={copy.refusals.whatCountsLabel}>{copy.refusals.whatCountsBody}</Explain>
          </div>
        </Panel>

        <Panel id="ops-routes" title={copy.routes.title} w={6} h={4} tone="muted" badge={copy.routes.badge(analytics.routes.length)} scroll>
          <div className={styles.stack}>
            {analytics.routes.length === 0 ? (
              <p className={styles.lede}>{copy.routes.empty}</p>
            ) : (
              <div className={styles.table}>
                <table>
                  <thead>
                    <tr>
                      <th scope="col">{copy.routes.thRoute}</th>
                      <th scope="col">{copy.routes.thRequests}</th>
                      <th scope="col">{copy.routes.thRefused}</th>
                      <th scope="col">{copy.routes.thMean}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.routes.map((row) => (
                      <tr key={row.route}>
                        <td>{row.route}</td>
                        <td className={styles.num}>{row.requests.value}</td>
                        <td className={row.refused.value > 0 ? `${styles.num} ${styles.refused}` : styles.num}>
                          {row.refused.value}
                        </td>
                        <td className={styles.num}>{row.meanDurationMs} {copy.routes.msUnit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {analytics.measured.truncated ? (
              <p className={styles.lede}>{copy.routes.truncated}</p>
            ) : null}
            <Explain label={copy.routes.missingLabel}>{copy.routes.missingBody}</Explain>
          </div>
        </Panel>

        <Panel
          id="ops-catalogue"
          title={copy.catalogue.title}
          w={6}
          h={4}
          tone="evidence"
          badge={copy.catalogue.badge}
          scroll
        >
          <div className={styles.stack}>
            <p className={styles.lede}>{copy.catalogue.lede}</p>
            <div className={styles.figures}>
              {declared.map((count) => (
                <div key={count.what} className={styles.figure}>
                  <div className={styles.value}>{count.value}</div>
                  <div className={styles.caption}>{count.what}</div>
                  <span className={styles.kind}>{copy.kindDeclared}</span>
                </div>
              ))}
            </div>
            <Explain label={copy.catalogue.neverAddedLabel}>{copy.catalogue.neverAddedBody}</Explain>
          </div>
        </Panel>

        <Panel
          id="ops-perimeter"
          title={copy.perimeter.title}
          w={6}
          h={4}
          tone="muted"
          badge={copy.perimeter.badge(surface.perimeter.blocked)}
          scroll
        >
          <div className={styles.stack}>
            <p className={styles.lede}>{copy.perimeter.lede}</p>
            <div className={styles.table}>
              <table>
                <thead>
                  <tr>
                    <th scope="col">{copy.perimeter.thCapability}</th>
                    <th scope="col">{copy.perimeter.thMainnet}</th>
                    <th scope="col">{copy.perimeter.thState}</th>
                  </tr>
                </thead>
                <tbody>
                  {surface.perimeter.capabilities.map((verdict) => (
                    <tr key={verdict.capability}>
                      <td>{verdict.label}</td>
                      <td>{verdict.mainnetChainRef}</td>
                      <td className={styles.blocked}>{verdict.refusals.join(", ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Explain label={copy.perimeter.noCanaryLabel}>{copy.perimeter.noCanaryBody}</Explain>
          </div>
        </Panel>

        <Panel id="ops-not-measured" title={copy.notMeasured.title} w={6} h={4} tone="caution" badge={copy.notMeasured.badge} scroll>
          <div className={styles.stack}>
            <div className={styles.rows}>
              {surface.notMeasured.map((entry) => (
                <div key={entry.what} className={`${styles.row} ${styles.rowInert}`}>
                  <Prohibit size={16} weight="bold" aria-hidden />
                  <div>
                    <div className={styles.name}>{entry.what}</div>
                    <div className={styles.what}>{entry.why}</div>
                  </div>
                  <span className={`${styles.tag} ${styles.tagNobody}`}>{copy.notMeasured.tagNotCounted}</span>
                </div>
              ))}
            </div>
          </div>
        </Panel>

        <Panel id="ops-quotas" title={copy.quotas.title} w={6} h={4} tone="muted" badge={copy.quotas.badge} scroll>
          <div className={styles.stack}>
            <div className={styles.table}>
              <table>
                <thead>
                  <tr>
                    <th scope="col">{copy.quotas.thPrincipal}</th>
                    <th scope="col">{copy.quotas.thLimit}</th>
                    <th scope="col">{copy.quotas.thWindow}</th>
                  </tr>
                </thead>
                <tbody>
                  {analytics.declared.quotas.map((quota) => (
                    <tr key={quota.principal}>
                      <td>{quota.principal}</td>
                      <td className={styles.num}>{quota.limit}</td>
                      <td className={styles.num}>{quota.windowSeconds}{copy.quotas.secondsUnit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className={styles.lede}>
              <ChartBar size={14} weight="bold" aria-hidden /> {copy.quotas.footer}
            </p>
          </div>
        </Panel>
      </PanelGrid>
    </div>
  );
}
