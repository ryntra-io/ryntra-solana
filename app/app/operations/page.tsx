import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  ArrowRight,
  Gauge,
  Lifebuoy,
  Prohibit,
  ShieldWarning,
  Siren,
  WarningCircle,
} from "@phosphor-icons/react/dist/ssr";

import { cabinetUiCopy } from "@/app/app/ui-lang";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { getSession } from "@/lib/session";
import { homeLocalOwnerRef } from "@/lib/home/local-scope";
import { Section, StateChip } from "@/app/app/portfolio/tiles";
import { loadHomeReads } from "@/app/app/home-reads";
import { Incidents, KillSwitches, Perimeter, Providers, Recovery, surfaceTone } from "./tiles";
import { projectOperationsSurface } from "./read";
import styles from "@/app/app/home-surface.module.css";

export const metadata: Metadata = {
  title: "Operations · Ryntra Home",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Every reader-facing literal on this route, per locale, in this file — the
 * release checks regex this source for the exact English sentences, so the
 * copy stays beside the markup it feeds. English is byte-identical to what
 * shipped; `uk` is its twin. Machine state tokens, the projection's own empty
 * reason and the perimeter disclaimer arrive from `lib/` and render as
 * received.
 */
type OperationsPageCopy = Readonly<{
  title: string;
  noAccount: string;
  emptyTitle: string;
  emptyInfo: ReactNode;
  emptyNote: string;
  confirmAccess: string;
  capabilities: string;
  coverage: string;
  recoveryNoteTitle: string;
  recoveryNoteInfo: ReactNode;
  providersTitle: string;
  providersInfo: ReactNode;
  providersAside: (up: number, providers: number) => string;
  incidentsTitle: string;
  incidentsInfo: ReactNode;
  incidentsEmpty: string;
  recoveryTitle: string;
  recoveryInfo: ReactNode;
  recoveryEmpty: string;
  killSwitchesTitle: string;
  killSwitchesInfo: ReactNode;
  perimeterTitle: string;
  perimeterInfo: ReactNode;
}>;

const COPY = {
  en: {
    title: "Operations",
    noAccount: "No account",
    emptyTitle: "Provider health is about your own connections",
    emptyInfo: (
      <p>
        Health, incidents and recovery are all about the sources <em>you</em> connected.
        The perimeter below is declared rather than account-specific, and it is the same
        for everyone.
      </p>
    ),
    emptyNote:
      "Confirm your account and connect a source. The three regulated operations are refused for every account today, and the reason is the same one shown below.",
    confirmAccess: "Confirm access",
    capabilities: "Capabilities",
    coverage: "Coverage",
    recoveryNoteTitle: "This read is not complete",
    recoveryNoteInfo: <p>What follows is still shown. An operations page that hides a failed read is the one page that must never do so.</p>,
    providersTitle: "Provider health",
    providersInfo: (
      <p>
        These are the same source states the Radar and the Portfolio computed, not a second
        measurement. A separate probe would eventually disagree with them, and a reader would
        have no way to tell which page was wrong. The list under each provider is what
        depends on it.
      </p>
    ),
    providersAside: (up: number, providers: number) => `${up} of ${providers}`,
    incidentsTitle: "Incidents",
    incidentsInfo: (
      <p>
        Derived from observed failures and nothing else. There is no input on this page that
        could post one, which is what stops it saying <em>all clear</em> while a provider is
        failing — or the reverse. A provider nobody has ever connected raises nothing: not
        looking and being broken are different facts.
      </p>
    ),
    incidentsEmpty: "No provider is failing or degraded on its last observed read.",
    recoveryTitle: "What happens while a provider is down",
    recoveryInfo: (
      <p>
        Three different things, and only one of them means the number you saw earlier is
        still true. <b>Served stale</b> carries the observation time; <b>unavailable</b>
        {" "}serves nothing; <b>refused</b> means a calculation that needed this input was
        declined rather than estimated.
      </p>
    ),
    recoveryEmpty: "No capability is declared against a provider yet.",
    killSwitchesTitle: "Kill switches",
    killSwitchesInfo: (
      <p>
        Shown, never thrown. Each one names the authority that may actually throw it and
        links there. Three of them read their state from a real constant or record rather
        than from a list written here, and the fourth cannot be read from a server at all —
        it lives in the session that would prepare an execution.
      </p>
    ),
    perimeterTitle: "The regulatory perimeter",
    perimeterInfo: (
      <p>
        A record of what providers, counsel and the product perimeter actually state — for
        one context version, one instrument class and one operation. Missing, stale, expired
        or conflicting state fails closed. Interface copy and a jurisdiction label are
        refused as sources by name: what the product says about itself cannot authorize the
        product.
      </p>
    ),
  },
  uk: {
    title: "Операції",
    noAccount: "Без акаунта",
    emptyTitle: "Здоровʼя провайдерів — про твої власні підключення",
    emptyInfo: (
      <p>
        Здоровʼя, інциденти та відновлення — усе це про джерела, які підключаєш саме{" "}
        <em>ти</em>. Периметр нижче задекларований, а не привʼязаний до акаунта, і він
        однаковий для всіх.
      </p>
    ),
    emptyNote:
      "Підтверди акаунт і підключи джерело. Три регульовані операції сьогодні відхиляються для кожного акаунта, і причина — та сама, що показана нижче.",
    confirmAccess: "Підтвердити доступ",
    capabilities: "Можливості",
    coverage: "Покриття",
    recoveryNoteTitle: "Це читання неповне",
    recoveryNoteInfo: <p>Те, що нижче, все одно показано. Сторінка операцій, що ховає невдале читання, — саме та сторінка, якій це заборонено найбільше.</p>,
    providersTitle: "Здоровʼя провайдерів",
    providersInfo: (
      <p>
        Це ті самі стани джерел, які обчислили Радар і Портфель, а не друге вимірювання.
        Окремий зонд рано чи пізно розійшовся б із ними, і читач не мав би способу
        зрозуміти, яка сторінка помиляється. Список під кожним провайдером — те, що від
        нього залежить.
      </p>
    ),
    providersAside: (up: number, providers: number) => `${up} із ${providers}`,
    incidentsTitle: "Інциденти",
    incidentsInfo: (
      <p>
        Виведені зі спостережених збоїв і ні з чого більше. На цій сторінці немає поля,
        яким можна було б створити інцидент, — саме це не дає їй сказати <em>все гаразд</em>,
        поки провайдер має збій, або навпаки. Провайдер, якого ніхто не підключав, не
        породжує нічого: не дивитися і бути зламаним — різні факти.
      </p>
    ),
    incidentsEmpty: "Жоден провайдер не має збою чи деградації на останньому спостереженому читанні.",
    recoveryTitle: "Що відбувається, поки провайдер не працює",
    recoveryInfo: (
      <p>
        Три різні речі, і лише одна з них означає, що число, показане раніше, досі
        правдиве. <b>Подано застаріле</b> несе час спостереження; <b>недоступно</b> не
        подає нічого; <b>відмовлено</b> означає, що розрахунок, якому був потрібен цей
        вхід, відхилено, а не оцінено приблизно.
      </p>
    ),
    recoveryEmpty: "Жодну можливість ще не задекларовано за провайдером.",
    killSwitchesTitle: "Аварійні вимикачі",
    killSwitchesInfo: (
      <p>
        Показані, ніколи не перемикаються звідси. Кожен називає повноваження, яке справді
        може його перемкнути, і веде туди. Три з них читають свій стан зі справжньої
        константи чи запису, а не зі списку, написаного тут; четвертий узагалі не можна
        зчитати з сервера — він живе в сесії, яка готувала б виконання.
      </p>
    ),
    perimeterTitle: "Регуляторний периметр",
    perimeterInfo: (
      <p>
        Запис того, що насправді стверджують провайдери, юристи та периметр продукту — для
        однієї версії контексту, одного класу інструмента й однієї операції. Відсутній,
        застарілий, прострочений чи суперечливий стан закривається відмовою. Текст
        інтерфейсу та мітка юрисдикції відхилені як джерела поіменно: те, що продукт каже
        про себе, не може авторизувати продукт.
      </p>
    ),
  },
} as const satisfies Record<WorkspaceLocale, OperationsPageCopy>;

/**
 * Operations — is the machinery up, and what happens when it is not.
 *
 * Provider health, incidents derived from observed failures, what the product
 * actually does while a provider is down, the kill switches that exist, and the
 * regulatory perimeter that decides whether three named operations may run at
 * all.
 *
 * **This page shows and never acts.** No control here pauses, resumes, revokes,
 * authorizes or trips anything; each switch names the surface that may. And no
 * incident can be authored — they are computed from what was observed, so this
 * page cannot say *all clear* while a provider is failing.
 */
export default async function OperationsPage() {
  const session = await getSession();
  const { lang } = await cabinetUiCopy();
  const c = COPY[lang] ?? COPY.en;

  if (!session?.verified) {
    return (
      <div className={styles.surface}>
        <header className={styles.head}>
          <div>
            <p className={styles.eyebrow}>Ryntra Home</p>
            <h1>{c.title}</h1>
          </div>
          <div className={styles.headMeta}>
            <StateChip tone="unknown" label={c.noAccount} />
          </div>
        </header>
        <Section
          id="empty"
          title={c.emptyTitle}
          icon={<Gauge size={17} weight="bold" aria-hidden />}
          info={c.emptyInfo}
          locale={lang}
        >
          <p className={styles.empty}>{c.emptyNote}</p>
          <div className={styles.actions}>
            <Link className={styles.link} href="/app/beta">{c.confirmAccess} <ArrowRight size={13} weight="bold" aria-hidden /></Link>
            <Link className={styles.link} href="/docs/current-capabilities">{c.capabilities} <ArrowRight size={13} weight="bold" aria-hidden /></Link>
          </div>
        </Section>
      </div>
    );
  }

  const ownerRef = homeLocalOwnerRef({
    proofCode: session.state.user.proof_code,
    createdAt: session.state.user.created_at,
  });
  const asOf = new Date().toISOString();

  const reads = await loadHomeReads({
    wallet: session.state.user.wallet_address ?? null,
    telegramId: session.telegramId,
    ownerRef,
    asOf,
    want: { portfolio: true, research: true, decisions: false },
  });

  const projection = projectOperationsSurface({ reads, asOf, userContextVersion: ownerRef, locale: lang });

  return (
    <div className={styles.surface} data-surface-state={projection.state}>
      <header className={styles.head}>
        <div>
          <p className={styles.eyebrow}>Ryntra Home</p>
          <h1>{c.title}</h1>
        </div>
        <div className={styles.headMeta}>
          <StateChip tone={surfaceTone(projection.state)} label={projection.state} />
          <StateChip tone="quiet" label={projection.authority} />
          <Link className={styles.link} href="/app/coverage">{c.coverage} <ArrowRight size={13} weight="bold" aria-hidden /></Link>
        </div>
      </header>

      {reads.recovery.length === 0 ? null : (
        <Section
          id="recovery-note"
          title={c.recoveryNoteTitle}
          icon={<WarningCircle size={17} weight="bold" aria-hidden />}
          info={c.recoveryNoteInfo}
          locale={lang}
        >
          <ul className={styles.note}>
            {reads.recovery.map((line) => <li key={line}>{line}</li>)}
          </ul>
        </Section>
      )}

      <Section
        id="providers"
        title={c.providersTitle}
        icon={<Gauge size={17} weight="bold" aria-hidden />}
        info={c.providersInfo}
        aside={<StateChip tone="quiet" label={c.providersAside(projection.counts.up, projection.counts.providers)} />}
        locale={lang}
      >
        {projection.providers.length === 0
          ? <p className={styles.empty}>{projection.emptyReason}</p>
          : <Providers providers={projection.providers} locale={lang} />}
      </Section>

      <Section
        id="incidents"
        title={c.incidentsTitle}
        icon={<Siren size={17} weight="bold" aria-hidden />}
        info={c.incidentsInfo}
        aside={<StateChip tone={projection.incidents.length === 0 ? "good" : "risk"} label={`${projection.incidents.length}`} />}
        locale={lang}
      >
        {projection.incidents.length === 0
          ? <p className={styles.empty}>{c.incidentsEmpty}</p>
          : <Incidents incidents={projection.incidents} locale={lang} />}
      </Section>

      <Section
        id="recovery"
        title={c.recoveryTitle}
        icon={<Lifebuoy size={17} weight="bold" aria-hidden />}
        info={c.recoveryInfo}
        aside={<StateChip tone="quiet" label={`${projection.recovery.length}`} />}
        locale={lang}
      >
        {projection.recovery.length === 0
          ? <p className={styles.empty}>{c.recoveryEmpty}</p>
          : <Recovery recovery={projection.recovery} locale={lang} />}
      </Section>

      <Section
        id="kill-switches"
        title={c.killSwitchesTitle}
        icon={<Prohibit size={17} weight="bold" aria-hidden />}
        info={c.killSwitchesInfo}
        aside={<StateChip tone="quiet" label={`${projection.counts.killSwitches}`} />}
        locale={lang}
      >
        <KillSwitches switches={projection.killSwitches} locale={lang} />
      </Section>

      <Section
        id="perimeter"
        title={c.perimeterTitle}
        icon={<ShieldWarning size={17} weight="bold" aria-hidden />}
        info={c.perimeterInfo}
        aside={<StateChip tone={projection.perimeter.state === "ALLOWED" ? "good" : "quiet"} label={projection.perimeter.state} />}
        locale={lang}
      >
        <Perimeter perimeter={projection.perimeter} locale={lang} />
      </Section>
    </div>
  );
}
