import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, PlugsConnected, WarningCircle } from "@phosphor-icons/react/dist/ssr";

import { cabinetUiCopy } from "@/app/app/ui-lang";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { getSession } from "@/lib/session";
import { homeLocalOwnerRef } from "@/lib/home/local-scope";
import { controlVocabulary, type ControlProjection } from "@/lib/home/control/projection";
import { Section, StateChip } from "@/app/app/portfolio/tiles";
import { GroupIcons, Tiles, Vocabulary, groupsOf, surfaceTone } from "./tiles";
import { loadControlReads, projectControlSurface } from "./read";
import styles from "@/app/app/home-surface.module.css";

export const metadata: Metadata = {
  title: "Control · Ryntra Home",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Every reader-facing literal on this route, per locale, in this file — the
 * release checks regex this source for the exact English sentences, so the
 * copy stays beside the markup it feeds. English is byte-identical to what
 * shipped; `uk` is its twin. Tile labels, values and reasons arrive from the
 * owning projections and render as received, and the boundary stays exact in
 * both languages: the canonical owner of every control is Agent Control.
 */
type ControlPageCopy = Readonly<{
  title: string;
  noAccount: string;
  emptyTitle: string;
  emptyInfo: ReactNode;
  emptyNote: string;
  confirmAccess: string;
  agentControl: string;
  vocabularyTitle: string;
  vocabularyEmptyInfo: ReactNode;
  vocabularyInfo: ReactNode;
  readFailed: string;
  today: string;
  hardErrorTitle: string;
  hardErrorInfo: ReactNode;
  hardErrorNote: string;
  reload: string;
  portfolio: string;
  recoveryTitle: string;
  recoveryInfo: ReactNode;
  groupInfo: ReactNode;
}>;

const COPY = {
  en: {
    title: "Control",
    noAccount: "No account",
    emptyTitle: "These projections are about one account",
    emptyInfo: (
      <p>
        Every tile here is a fact another surface already holds for a confirmed account —
        a commitment, a monitor rule, a source state, a constraint, something waiting on a
        person. With no account there is nothing to project.
      </p>
    ),
    emptyNote:
      "Confirm your account and connect a source. The authority model below is declared rather than account-specific, and it is the same for everyone.",
    confirmAccess: "Confirm access",
    agentControl: "Agent Control",
    vocabularyTitle: "The authority model",
    vocabularyEmptyInfo: <p>These four lists come from Agent Control itself, imported rather than restated here. A second copy of them would be a second definition of what authority means.</p>,
    vocabularyInfo: <p>These four lists come from Agent Control itself, imported rather than restated here. A second copy of them would be a second definition of what authority means, and this repository has recorded what happens to two things that must agree.</p>,
    readFailed: "Read failed",
    today: "Today",
    hardErrorTitle: "This read did not complete",
    hardErrorInfo: <p>No tile from an earlier read is shown here. A stale control state presented as current is the defect this state exists to prevent.</p>,
    hardErrorNote:
      "Nothing on this page is a current fact right now. Reload to try the read again, or open each owning surface directly.",
    reload: "Reload",
    portfolio: "Portfolio",
    recoveryTitle: "This read is not complete",
    recoveryInfo: <p>What follows is still shown, because hiding a partial read is how a reader concludes everything is fine.</p>,
    groupInfo: (
      <p>
        Every tile in this group is a <b>projection</b>: the fact belongs to the surface
        named under it, and the link goes there. Nothing on this page recomputes a number,
        and no control here pauses, revokes, authorizes or trips a kill switch — those are
        Agent Control&rsquo;s, where the authorization record they write lives with them.
      </p>
    ),
  },
  uk: {
    title: "Контроль",
    noAccount: "Без акаунта",
    emptyTitle: "Ці проєкції — про один акаунт",
    emptyInfo: (
      <p>
        Кожна плитка тут — факт, який інша поверхня вже тримає для підтвердженого акаунта:
        зобовʼязання, правило моніторингу, стан джерела, обмеження, щось, що чекає на
        людину. Без акаунта проєктувати нема чого.
      </p>
    ),
    emptyNote:
      "Підтверди акаунт і підключи джерело. Модель повноважень нижче задекларована, а не привʼязана до акаунта, і вона однакова для всіх.",
    confirmAccess: "Підтвердити доступ",
    agentControl: "Agent Control",
    vocabularyTitle: "Модель повноважень",
    vocabularyEmptyInfo: <p>Ці чотири списки походять із самого Agent Control — імпортовані, а не переказані тут. Друга їх копія була б другим визначенням того, що означає повноваження.</p>,
    vocabularyInfo: <p>Ці чотири списки походять із самого Agent Control — імпортовані, а не переказані тут. Друга їх копія була б другим визначенням того, що означає повноваження, а цей репозиторій уже зафіксував, що стається з двома речами, які мусять збігатися.</p>,
    readFailed: "Читання не вдалося",
    today: "Сьогодні",
    hardErrorTitle: "Це читання не завершилося",
    hardErrorInfo: <p>Тут не показано жодної плитки з попереднього читання. Застарілий стан контролю, поданий як поточний, — саме той дефект, якому цей стан запобігає.</p>,
    hardErrorNote:
      "Ніщо на цій сторінці зараз не є поточним фактом. Перезавантаж, щоб повторити читання, або відкрий кожну власницьку поверхню напряму.",
    reload: "Перезавантажити",
    portfolio: "Портфель",
    recoveryTitle: "Це читання неповне",
    recoveryInfo: <p>Те, що нижче, все одно показано, бо сховане часткове читання — це те, з чого читач робить висновок, що все гаразд.</p>,
    groupInfo: (
      <p>
        Кожна плитка в цій групі — <b>проєкція</b>: факт належить поверхні, названій під
        нею, і посилання веде туди. Ніщо на цій сторінці не переобчислює число, і жоден
        елемент тут не ставить на паузу, не відкликає, не авторизує і не перемикає
        аварійний вимикач — це робить Agent Control, де разом із цими діями живе запис
        авторизації, який вони пишуть.
      </p>
    ),
  },
} as const satisfies Record<WorkspaceLocale, ControlPageCopy>;

/**
 * Ryntra Home — compact Agent Control projections.
 *
 * Frozen decision 27: *Strategy and Agent Control appear as projections, not
 * copies.* This route is that sentence as a page. Every tile carries the
 * surface that owns its fact and a link to it; `authority` is the constant
 * `PROJECTION`; and there is no control here that pauses, resumes, revokes,
 * authorizes or trips a kill switch — those live in Agent Control, with the
 * authorization record they write.
 *
 * **What no server can read says so.** Agent Control's own Action Cases live in
 * one browser tab's session storage, so this page names that and links to the
 * workspace rather than inventing a server-side list.
 */
export default async function ControlPage() {
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
          icon={<PlugsConnected size={17} weight="bold" aria-hidden />}
          info={c.emptyInfo}
          locale={lang}
        >
          <p className={styles.empty}>{c.emptyNote}</p>
          <div className={styles.actions}>
            <Link className={styles.link} href="/app/beta">{c.confirmAccess} <ArrowRight size={13} weight="bold" aria-hidden /></Link>
            <Link className={styles.link} href="/agents/workspace">{c.agentControl} <ArrowRight size={13} weight="bold" aria-hidden /></Link>
          </div>
        </Section>
        <Section
          id="vocabulary"
          title={c.vocabularyTitle}
          icon={GroupIcons.AUTHORITY}
          info={c.vocabularyEmptyInfo}
          locale={lang}
        >
          <Vocabulary vocabulary={controlVocabulary()} locale={lang} />
        </Section>
      </div>
    );
  }

  const ownerRef = homeLocalOwnerRef({
    proofCode: session.state.user.proof_code,
    createdAt: session.state.user.created_at,
  });
  const asOf = new Date().toISOString();

  let projection: ControlProjection | null = null;
  try {
    const reads = await loadControlReads({
      wallet: session.state.user.wallet_address ?? null,
      telegramId: session.telegramId,
      ownerRef,
      asOf,
      locale: lang,
    });
    projection = projectControlSurface({ reads, asOf, locale: lang });
  } catch {
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
            <StateChip tone="risk" label={c.readFailed} />
            <Link className={styles.link} href="/app">{c.today} <ArrowRight size={13} weight="bold" aria-hidden /></Link>
          </div>
        </header>
        <Section
          id="hard-error"
          title={c.hardErrorTitle}
          icon={<WarningCircle size={17} weight="bold" aria-hidden />}
          info={c.hardErrorInfo}
          locale={lang}
        >
          <p className={styles.empty}>{c.hardErrorNote}</p>
          <div className={styles.actions}>
            <Link className={styles.link} href="/app/control">{c.reload} <ArrowRight size={13} weight="bold" aria-hidden /></Link>
            <Link className={styles.link} href="/app/portfolio">{c.portfolio} <ArrowRight size={13} weight="bold" aria-hidden /></Link>
          </div>
        </Section>
      </div>
    );
  }

  const groups = groupsOf(projection, lang);

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
          <Link className={styles.link} href="/agents/workspace">{c.agentControl} <ArrowRight size={13} weight="bold" aria-hidden /></Link>
        </div>
      </header>

      {projection.recovery.length === 0 ? null : (
        <Section
          id="recovery"
          title={c.recoveryTitle}
          icon={<WarningCircle size={17} weight="bold" aria-hidden />}
          info={c.recoveryInfo}
          locale={lang}
        >
          <ul className={styles.note}>
            {projection.recovery.map((line) => <li key={line}>{line}</li>)}
          </ul>
        </Section>
      )}

      {groups.map((group) => (
        <Section
          key={group.group}
          id={group.group.toLowerCase()}
          title={group.label}
          icon={GroupIcons[group.group]}
          info={c.groupInfo}
          aside={<StateChip tone="quiet" label={`${group.tiles.length}`} />}
          locale={lang}
        >
          <Tiles tiles={group.tiles} />
        </Section>
      ))}

      <Section
        id="vocabulary"
        title={c.vocabularyTitle}
        icon={GroupIcons.AUTHORITY}
        info={c.vocabularyInfo}
        locale={lang}
      >
        <Vocabulary vocabulary={controlVocabulary()} locale={lang} />
      </Section>
    </div>
  );
}
