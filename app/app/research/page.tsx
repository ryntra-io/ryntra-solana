import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, PlugsConnected, WarningCircle } from "@phosphor-icons/react/dist/ssr";

import { cabinetUiCopy } from "@/app/app/ui-lang";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { getSession } from "@/lib/session";
import { homeLocalOwnerRef } from "@/lib/home/local-scope";
import { RESEARCH_VIEW_IDS, type ResearchProjection, type ResearchSourceState, type ResearchViewId } from "@/lib/home/research/read-model";
import { Section, StateChip } from "@/app/app/portfolio/tiles";
import {
  ChangeList,
  MandateFacts,
  RuleList,
  SectionIcons,
  Sources,
  ViewRail,
  surfaceTone,
} from "./tiles";
import { loadResearchReads, projectResearchSurface, researchSourceStates } from "./read";
import styles from "./research.module.css";

export const metadata: Metadata = {
  title: "Research · Ryntra Home",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Every reader-facing literal on this route, per locale, in this file — the
 * release checks regex this source for the exact English sentences, so the
 * copy stays beside the markup it feeds. English is byte-identical to what
 * shipped; `uk` is its twin. Evidence from `lib/home/research` (view labels,
 * reasons, source words) is rendered as received.
 */
type PageCopy = Readonly<{
  title: string;
  noAccount: string;
  emptyTitle: string;
  emptyInfo: ReactNode;
  emptyBody: string;
  confirmAccess: string;
  connections: string;
  readFailed: string;
  noScope: string;
  today: string;
  portfolio: string;
  hardErrorTitle: string;
  noScopeTitle: string;
  hardErrorInfo: ReactNode;
  noScopeInfo: ReactNode;
  hardErrorBody: string;
  noScopeBody: string;
  reload: string;
  noScopeSourcesTitle: string;
  noScopeSourcesInfo: ReactNode;
  recoveryTitle: string;
  recoveryInfo: ReactNode;
  radarTitle: string;
  radarInfo: ReactNode;
  withinOne: string;
  withinMany: (n: number) => string;
  mandateTitle: string;
  mandateInfo: ReactNode;
  sourcesTitle: string;
  sourcesInfo: ReactNode;
}>;

const COPY = {
  en: {
    title: "Research",
    noAccount: "No account",
    emptyTitle: "Nothing is being watched yet",
    emptyInfo: (
      <p>
        A research mandate is built from what you actually hold and the markets those
        touch. With no confirmed account there is no scope, so nothing is monitored and
        no change is invented to fill the page.
      </p>
    ),
    emptyBody:
      "Confirm your account and connect a source. Until then there is no mandate, no rule and no change to state.",
    confirmAccess: "Confirm access",
    connections: "Connections",
    readFailed: "Read failed",
    noScope: "No scope",
    today: "Today",
    portfolio: "Portfolio",
    hardErrorTitle: "This read did not complete",
    noScopeTitle: "There is nothing in scope to watch",
    hardErrorInfo: <p>No change from an earlier read is shown here. A stale radar presented as current is the defect this state exists to prevent.</p>,
    noScopeInfo: <p>The mandate is compiled from the positions you hold, the paper trades you opened, and the markets those touch. With none of them, there is no rule to compile and nothing to monitor.</p>,
    hardErrorBody:
      "Nothing on this page is a current fact right now. Reload to try the read again, or check each source.",
    noScopeBody:
      "Open a position or a paper trade and this page compiles a mandate from it. No sample change and no demo radar is shown in the meantime.",
    reload: "Reload",
    noScopeSourcesTitle: "What each source answered",
    noScopeSourcesInfo: (
      <p>
        A source answers whether or not a rule was compiled from it. A read that was refused is
        shown with the provider&rsquo;s own words, because a refusal worded as an outage tells a
        reader to retry something that will refuse again for the same reason.
      </p>
    ),
    recoveryTitle: "This read is not complete",
    recoveryInfo: <p>What follows is still shown, because hiding a partial read is how a reader concludes that nothing happened.</p>,
    radarTitle: "Changes Radar",
    radarInfo: (
      <p>
        The object here is a <b>change</b>, not a ranked asset and not a score. Each row
        states what changed, the threshold it was measured against and the sources that
        reported it. A disagreement between sources stays a disagreement — both values
        are shown and no average is computed — and a fact nobody supplied stays unknown
        rather than becoming a zero.
      </p>
    ),
    withinOne: "One more change was measured and stayed within its threshold.",
    withinMany: (n: number) => `${n} more changes were measured and stayed within their thresholds.`,
    mandateTitle: "Research mandate",
    mandateInfo: (
      <p>
        The mandate is what the assistant may watch, and it is versioned by its own content — the
        same configuration always compiles to the same version, and any change to what is
        watched produces a new one. It never expands what may be executed: monitoring is
        monitoring, and this mandate carries no execution authority at all. In this wave
        it is compiled from what you already hold rather than edited, because editing it
        needs storage this release deliberately does not add.
      </p>
    ),
    sourcesTitle: "Sources and data rights",
    sourcesInfo: (
      <p>
        Every source carries the entitlement it was read under, and that entitlement is
        checked before the source is read rather than after. Your own account data is one
        thing; a provider&apos;s public API describing its own product is another; open web
        and social content is untrusted data that can be read and can never carry an
        instruction or raise an alert.
      </p>
    ),
  },
  uk: {
    title: "Дослідження",
    noAccount: "Без акаунта",
    emptyTitle: "Поки ніщо не відстежується",
    emptyInfo: (
      <p>
        Дослідницький мандат будується з того, чим ви фактично володієте, і ринків,
        яких це стосується. Без підтвердженого акаунта немає обсягу, тож ніщо не
        моніториться і жодна зміна не вигадується, щоб заповнити сторінку.
      </p>
    ),
    emptyBody:
      "Підтвердьте акаунт і підключіть джерело. До того немає ані мандата, ані правила, ані зміни, про які можна звітувати.",
    confirmAccess: "Підтвердити доступ",
    connections: "Підключення",
    readFailed: "Читання не вдалося",
    noScope: "Немає обсягу",
    today: "Сьогодні",
    portfolio: "Портфель",
    hardErrorTitle: "Це читання не завершилося",
    noScopeTitle: "В обсязі немає нічого для відстеження",
    hardErrorInfo: <p>Тут не показано жодної зміни з попереднього читання. Застарілий радар, поданий як поточний, — саме той дефект, якому запобігає цей стан.</p>,
    noScopeInfo: <p>Мандат компілюється з позицій, якими ви володієте, відкритих вами paper-угод і ринків, яких це стосується. Без жодного з них немає правила для компіляції і нічого моніторити.</p>,
    hardErrorBody:
      "Зараз на цій сторінці немає жодного поточного факту. Перезавантажте, щоб повторити читання, або перевірте кожне джерело.",
    noScopeBody:
      "Відкрийте позицію або paper-угоду — і ця сторінка скомпілює з неї мандат. Тим часом не показується ані зразкова зміна, ані демо-радар.",
    reload: "Перезавантажити",
    noScopeSourcesTitle: "Що відповіло кожне джерело",
    noScopeSourcesInfo: (
      <p>
        Джерело відповідає незалежно від того, чи скомпільовано з нього правило.
        Відмовлене читання показано словами самого провайдера, бо відмова, подана як
        збій, змушує читача повторювати те, що знову відмовить із тієї ж причини.
      </p>
    ),
    recoveryTitle: "Це читання неповне",
    recoveryInfo: <p>Те, що нижче, все одно показано, бо приховування часткового читання — це те, з чого читач робить висновок, що нічого не сталося.</p>,
    radarTitle: "Радар змін",
    radarInfo: (
      <p>
        Обʼєкт тут — <b>зміна</b>, а не ранжований актив і не бал. Кожен рядок зазначає,
        що змінилося, поріг, проти якого це виміряно, і джерела, які про це звітували.
        Розбіжність між джерелами залишається розбіжністю — показано обидва значення й
        не обчислюється жодне середнє, — а факт, якого ніхто не надав, залишається
        невідомим, а не стає нулем.
      </p>
    ),
    withinOne: "Ще одну зміну виміряно — вона залишилася в межах свого порога.",
    withinMany: (n: number) => {
      const few = n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14);
      return `Виміряно ще ${n} ${few ? "зміни" : "змін"} — усі залишилися в межах своїх порогів.`;
    },
    mandateTitle: "Дослідницький мандат",
    mandateInfo: (
      <p>
        Мандат — це те, що помічник може відстежувати, і він версіонується власним вмістом:
        однакова конфігурація завжди компілюється в ту саму версію, а будь-яка зміна
        того, що відстежується, породжує нову. Він ніколи не розширює те, що може бути
        виконано: моніторинг є моніторинг, і цей мандат не несе жодних повноважень на
        виконання. У цій хвилі він компілюється з того, чим ви вже володієте, а не
        редагується, бо редагування потребує сховища, якого цей реліз свідомо не додає.
      </p>
    ),
    sourcesTitle: "Джерела та права на дані",
    sourcesInfo: (
      <p>
        Кожне джерело несе право (entitlement), під яким його читали, і це право
        перевіряється до читання, а не після. Дані вашого власного акаунта — одне;
        публічний API провайдера, що описує його продукт, — інше; відкритий веб і
        соціальний контент — недовірені дані, які можна читати і які ніколи не можуть
        нести інструкцію чи здіймати сповіщення.
      </p>
    ),
  },
} as const satisfies Record<WorkspaceLocale, PageCopy>;

/**
 * Ryntra Home — Research, the Changes Radar.
 *
 * Today answers *what needs me now*; Portfolio answers *what do I hold*; this
 * answers *what changed, and can I trust the evidence that says so*. The three
 * are separate routes and none redirects to another.
 *
 * `/app/radar` is deliberately not created. It was frozen intent from Home
 * Workspace v1.0 and this packet is where the canon said a later task would
 * decide: the Changes Radar lives here, as the views of this route, and no
 * second URL exists to redirect from. A route whose only behaviour is to send
 * a reader somewhere else is a dead route with a redirect attached.
 */
export default async function ResearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { lang } = await cabinetUiCopy();
  const c = COPY[lang];
  const session = await getSession();
  const params = await searchParams;
  const requested = Array.isArray(params.view) ? params.view[0] : params.view;
  /* An unknown view is not an error and not a 404 — it is a reader who typed a
     URL. They get the default view rather than a dead end. */
  const active: ResearchViewId = RESEARCH_VIEW_IDS.includes(requested as ResearchViewId)
    ? (requested as ResearchViewId)
    : "FOR_ME";

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
          icon={<PlugsConnected size={17} weight="bold" aria-hidden />}
          locale={lang}
          info={c.emptyInfo}
        >
          <p className={styles.empty}>
            {c.emptyBody}
          </p>
          <div className={styles.actions}>
            <Link className={styles.link} href="/app/beta">{c.confirmAccess} <ArrowRight size={13} weight="bold" aria-hidden /></Link>
            <Link className={styles.link} href="/app/connect">{c.connections} <ArrowRight size={13} weight="bold" aria-hidden /></Link>
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

  let projection: ResearchProjection | null = null;
  let failed = false;
  /* Kept beside the projection so the no-scope branch can still say what each
     source answered. A refusal is evidence, and it is evidence whether or not a
     rule was compiled from it. */
  let sources: readonly ResearchSourceState[] = [];
  try {
    const reads = await loadResearchReads({
      wallet: session.state.user.wallet_address ?? null,
      telegramId: session.telegramId,
    });
    sources = researchSourceStates(reads);
    projection = projectResearchSurface({ reads, ownerRef, asOf });
  } catch {
    failed = true;
    projection = null;
  }

  if (projection === null) {
    return (
      <div className={styles.surface}>
        <header className={styles.head}>
          <div>
            <p className={styles.eyebrow}>Ryntra Home</p>
            <h1>{c.title}</h1>
          </div>
          <div className={styles.headMeta}>
            <StateChip tone={failed ? "risk" : "unknown"} label={failed ? c.readFailed : c.noScope} />
            <Link className={styles.link} href="/app">{c.today} <ArrowRight size={13} weight="bold" aria-hidden /></Link>
          </div>
        </header>
        <Section
          id={failed ? "hard-error" : "no-scope"}
          title={failed ? c.hardErrorTitle : c.noScopeTitle}
          icon={<WarningCircle size={17} weight="bold" aria-hidden />}
          locale={lang}
          info={failed ? c.hardErrorInfo : c.noScopeInfo}
        >
          <p className={styles.empty}>
            {failed ? c.hardErrorBody : c.noScopeBody}
          </p>
          <div className={styles.actions}>
            <Link className={styles.link} href="/app/research">{c.reload} <ArrowRight size={13} weight="bold" aria-hidden /></Link>
            <Link className={styles.link} href="/app/portfolio">{c.portfolio} <ArrowRight size={13} weight="bold" aria-hidden /></Link>
            <Link className={styles.link} href="/app/connect">{c.connections} <ArrowRight size={13} weight="bold" aria-hidden /></Link>
          </div>
        </Section>
        {sources.length === 0 ? null : (
          <Section
            id="no-scope-sources"
            title={c.noScopeSourcesTitle}
            icon={SectionIcons.sources}
            locale={lang}
            info={c.noScopeSourcesInfo}
          >
            <Sources sources={sources} locale={lang} />
          </Section>
        )}
      </div>
    );
  }

  const view = projection.views.find((entry) => entry.id === active) ?? projection.views[0];

  return (
    <div className={styles.surface} data-surface-state={projection.state}>
      <header className={styles.head}>
        <div>
          <p className={styles.eyebrow}>Ryntra Home</p>
          <h1>{c.title}</h1>
        </div>
        <div className={styles.headMeta}>
          <StateChip tone={surfaceTone(projection.state)} label={projection.state} />
          <Link className={styles.link} href="/app">{c.today} <ArrowRight size={13} weight="bold" aria-hidden /></Link>
          <Link className={styles.link} href="/app/portfolio">{c.portfolio} <ArrowRight size={13} weight="bold" aria-hidden /></Link>
        </div>
      </header>

      {projection.recovery.length === 0 ? null : (
        <Section
          id="recovery"
          title={c.recoveryTitle}
          icon={<WarningCircle size={17} weight="bold" aria-hidden />}
          locale={lang}
          info={c.recoveryInfo}
        >
          <ul className={styles.note}>
            {projection.recovery.map((line) => <li key={line}>{line}</li>)}
          </ul>
        </Section>
      )}

      <Section
        id="radar"
        title={c.radarTitle}
        icon={SectionIcons.radar}
        locale={lang}
        info={c.radarInfo}
        aside={<ViewRail views={projection.views} active={view.id} locale={lang} />}
      >
        {view.id === "SCHEDULED"
          ? <RuleList rules={view.scheduled} locale={lang} />
          : <ChangeList view={view} locale={lang} />}
        {view.id === "SCHEDULED" || view.withinThresholdCount === 0 || view.items.length === 0 ? null : (
          <p className={styles.empty}>
            <ArrowRight size={13} weight="bold" aria-hidden />
            {view.withinThresholdCount === 1
              ? c.withinOne
              : c.withinMany(view.withinThresholdCount)}
          </p>
        )}
      </Section>

      <Section
        id="mandate"
        title={c.mandateTitle}
        icon={SectionIcons.mandate}
        locale={lang}
        info={c.mandateInfo}
      >
        <MandateFacts projection={projection} locale={lang} />
      </Section>

      <Section
        id="sources"
        title={c.sourcesTitle}
        icon={SectionIcons.sources}
        locale={lang}
        info={c.sourcesInfo}
      >
        <Sources sources={projection.sources} locale={lang} />
      </Section>
    </div>
  );
}
