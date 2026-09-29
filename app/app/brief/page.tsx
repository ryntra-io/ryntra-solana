import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, Newspaper, WarningCircle } from "@phosphor-icons/react/dist/ssr";

import { cabinetUiCopy } from "@/app/app/ui-lang";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { getSession } from "@/lib/session";
import { homeLocalOwnerRef } from "@/lib/home/local-scope";
import { BRIEF_SECTION_PRIORITY } from "@/lib/home/brief/daily-brief";
import { Section, StateChip } from "@/app/app/portfolio/tiles";
import { loadHomeReads } from "@/app/app/home-reads";
import { BriefCounts, BriefLines, SECTION_ICON, WindowChip, briefTone, sectionInfo } from "./tiles";
import { projectBriefSurface } from "./read";
import { BriefWindowMarker } from "./window-marker";
import styles from "@/app/app/home-surface.module.css";

export const metadata: Metadata = {
  title: "Daily Brief · Ryntra Home",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Every reader-facing literal on this route, per locale, in this file — the
 * release checks regex this source for the exact English sentences, so the
 * copy stays beside the markup it feeds. English is byte-identical to what
 * shipped; `uk` is its twin. Section titles, empty reasons and recovery lines
 * arriving from `lib/` are evidence, not chrome, and are rendered as received.
 */
type BriefPageCopy = Readonly<{
  title: string;
  noAccount: string;
  emptyTitle: string;
  emptyInfo: ReactNode;
  emptyNote: string;
  confirmAccess: string;
  connections: string;
  today: string;
  recoveryTitle: string;
  recoveryInfo: ReactNode;
  shapeTitle: string;
  shapeInfo: ReactNode;
}>;

const COPY = {
  en: {
    title: "Daily Brief",
    noAccount: "No account",
    emptyTitle: "A brief is about one account",
    emptyInfo: (
      <p>
        Every line here is a fact another surface holds for a confirmed account — a case
        waiting on you, a change your own rule called material, a position that moved past a
        limit you declared. With no account there is nothing to summarize.
      </p>
    ),
    emptyNote:
      "Confirm your account and connect a source. The five sections below are fixed and appear whether or not they have anything in them.",
    confirmAccess: "Confirm access",
    connections: "Connections",
    today: "Today",
    recoveryTitle: "This brief is not complete",
    recoveryInfo: <p>What follows is still shown. Hiding a partial read is how a reader concludes nothing happened.</p>,
    shapeTitle: "The shape of this window",
    shapeInfo: (
      <p>
        Counts, not a score. There is deliberately no single importance number on this page:
        one axis for &ldquo;a person must decide&rdquo; and &ldquo;a source is late&rdquo;
        would put the wrong thing at the top the first time its weights were tuned.
      </p>
    ),
  },
  uk: {
    title: "Щоденний бриф",
    noAccount: "Без акаунта",
    emptyTitle: "Бриф — про один акаунт",
    emptyInfo: (
      <p>
        Кожен рядок тут — факт, який інша поверхня тримає для підтвердженого акаунта:
        справа, що чекає на вас, зміна, яку ваше власне правило назвало суттєвою, позиція,
        що вийшла за задекларовану вами межу. Без акаунта підсумовувати нема чого.
      </p>
    ),
    emptyNote:
      "Підтвердьте акаунт і підключіть джерело. Пʼять розділів нижче фіксовані та зʼявляються незалежно від того, чи є в них щось.",
    confirmAccess: "Підтвердити доступ",
    connections: "Підключення",
    today: "Сьогодні",
    recoveryTitle: "Цей бриф неповний",
    recoveryInfo: <p>Те, що нижче, все одно показано. Сховане часткове читання — це те, з чого читач робить висновок, що нічого не сталося.</p>,
    shapeTitle: "Форма цього вікна",
    shapeInfo: (
      <p>
        Лічильники, а не бал. На цій сторінці свідомо немає єдиного числа важливості: одна
        вісь для «людина має вирішити» та «джерело запізнюється» поставила б нагору не те —
        з першого ж підлаштування ваг.
      </p>
    ),
  },
} as const satisfies Record<WorkspaceLocale, BriefPageCopy>;

/**
 * The Daily Brief — what happened while nobody was looking.
 *
 * Five sections, always all five, in a priority that is a table rather than a
 * score: a decision outranks a change outranks a portfolio move outranks an
 * operational state. A critical source failure never displaces a low-severity
 * decision, because those are not the same kind of thing and one number cannot
 * order them honestly.
 *
 * **The window is the honest part.** *Since you last looked* lives in the
 * reader's own browser, so this server render binds `NOT_SERVER_READABLE` and
 * a client island fills it in — the same shape the InvestorContext binding
 * takes on the decision surface, and for the same reason.
 */
export default async function BriefPage() {
  const session = await getSession();
  const { lang } = await cabinetUiCopy();
  const c = COPY[lang] ?? COPY.en;
  const info = sectionInfo(lang);

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
          icon={<Newspaper size={17} weight="bold" aria-hidden />}
          info={c.emptyInfo}
          locale={lang}
        >
          <p className={styles.empty}>{c.emptyNote}</p>
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

  const reads = await loadHomeReads({
    wallet: session.state.user.wallet_address ?? null,
    telegramId: session.telegramId,
    ownerRef,
    asOf,
  });

  const brief = projectBriefSurface({ reads, asOf, lastSeenAt: null, serverReadable: false, locale: lang });

  return (
    <div className={styles.surface} data-surface-state={brief.state}>
      <header className={styles.head}>
        <div>
          <p className={styles.eyebrow}>Ryntra Home</p>
          <h1>{c.title}</h1>
        </div>
        <div className={styles.headMeta}>
          <StateChip tone={briefTone(brief.state)} label={brief.state} />
          <WindowChip window={brief.window} locale={lang} />
          <Link className={styles.link} href="/app">{c.today} <ArrowRight size={13} weight="bold" aria-hidden /></Link>
        </div>
      </header>

      <BriefWindowMarker window={brief.window} />

      {reads.recovery.length === 0 ? null : (
        <Section
          id="recovery"
          title={c.recoveryTitle}
          icon={<WarningCircle size={17} weight="bold" aria-hidden />}
          info={c.recoveryInfo}
          locale={lang}
        >
          <ul className={styles.note}>
            {reads.recovery.map((line) => <li key={line}>{line}</li>)}
          </ul>
        </Section>
      )}

      <Section
        id="shape"
        title={c.shapeTitle}
        icon={<Newspaper size={17} weight="bold" aria-hidden />}
        info={c.shapeInfo}
        aside={<StateChip tone="quiet" label={brief.briefId.slice(0, 8)} />}
        locale={lang}
      >
        <BriefCounts brief={brief} locale={lang} />
      </Section>

      {BRIEF_SECTION_PRIORITY.map((id) => {
        const section = brief.sections.find((entry) => entry.section === id);
        if (section === undefined) return null;
        return (
          <Section
            key={id}
            id={id.toLowerCase()}
            title={section.title}
            icon={SECTION_ICON[id]}
            info={<p>{info[id]}</p>}
            aside={<StateChip tone={section.lines.length === 0 ? "quiet" : "caution"} label={`${section.lines.length}`} />}
            locale={lang}
          >
            <BriefLines section={section} />
          </Section>
        );
      })}
    </div>
  );
}
