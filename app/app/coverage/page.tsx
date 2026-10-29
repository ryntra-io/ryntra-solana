import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, Database, WarningCircle } from "@phosphor-icons/react/dist/ssr";

import { cabinetUiCopy } from "@/app/app/ui-lang";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { getSession } from "@/lib/session";
import { homeLocalOwnerRef } from "@/lib/home/local-scope";
import { Section, StateChip } from "@/app/app/portfolio/tiles";
import { loadHomeReads } from "@/app/app/home-reads";
import { GROUP_ICON, Sources, Tiles, coverageTone, groupInfoOf, groupsOf } from "./tiles";
import { projectCoverageSurface } from "./read";
import styles from "@/app/app/home-surface.module.css";

export const metadata: Metadata = {
  title: "Coverage · Ryntra Home",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Every reader-facing literal on this route, per locale, in this file.
 * English is byte-identical to what shipped; `uk` is its twin. Counts,
 * labels, values and reasons from `lib/home/coverage` are rendered as
 * received — including the Unrecorded-is-not-zero distinction they carry.
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
  hardErrorTitle: string;
  hardErrorInfo: ReactNode;
  hardErrorBody: string;
  reload: string;
  portfolio: string;
  operations: string;
  recoveryTitle: string;
  recoveryInfo: ReactNode;
  nothingTitle: string;
  nothingInfo: ReactNode;
  research: string;
  sourceDetailTitle: string;
  sourceDetailInfo: ReactNode;
}>;

const COPY = {
  en: {
    title: "Coverage",
    noAccount: "No account",
    emptyTitle: "Coverage is about one account's sources",
    emptyInfo: (
      <p>
        Every count here is over your own declared sources and your own holdings. With no
        account there is no scope to be complete or incomplete about.
      </p>
    ),
    emptyBody:
      "Confirm your account and connect a source. Budgets come from the research mandate you declare afterwards.",
    confirmAccess: "Confirm access",
    connections: "Connections",
    readFailed: "Read failed",
    hardErrorTitle: "These counts did not add up",
    hardErrorInfo: <p>A count whose named reasons do not account for its gap is refused rather than shown with an unexplained remainder. That refusal is why this page is empty instead of wrong.</p>,
    hardErrorBody:
      "Nothing here is a current fact right now. Reload to try the read again, or open the owning surfaces directly.",
    reload: "Reload",
    portfolio: "Portfolio",
    operations: "Operations",
    recoveryTitle: "This read is not complete",
    recoveryInfo: <p>What follows is still shown. A coverage page that hides its own gaps is the one thing this page may never be.</p>,
    nothingTitle: "Nothing is in scope yet",
    nothingInfo: <p>An empty coverage page is a real state, and it is not the same as complete coverage. Nothing has been declared to be covered.</p>,
    research: "Research",
    sourceDetailTitle: "Every declared source",
    sourceDetailInfo: (
      <p>
        The entitlement beside each one is what the source may be used for — read, stored,
        processed, alerted on. A source with entitlement <b>NONE</b> is refused before it is
        ever read, which is why it can appear here having never been observed.
      </p>
    ),
  },
  uk: {
    title: "Покриття",
    noAccount: "Без акаунта",
    emptyTitle: "Покриття — про джерела одного акаунта",
    emptyInfo: (
      <p>
        Кожен лічильник тут — над твоїми власними заявленими джерелами і твоїми
        власними активами. Без акаунта немає обсягу, щодо якого можна бути повним чи
        неповним.
      </p>
    ),
    emptyBody:
      "Підтверди акаунт і підключи джерело. Бюджети зʼявляться з дослідницького мандата, який ти заявиш після цього.",
    confirmAccess: "Підтвердити доступ",
    connections: "Підключення",
    readFailed: "Читання не вдалося",
    hardErrorTitle: "Ці лічильники не зійшлися",
    hardErrorInfo: <p>Лічильник, чиї названі причини не пояснюють його розрив, відхиляється, а не показується з непоясненим залишком. Саме через цю відмову сторінка порожня, а не хибна.</p>,
    hardErrorBody:
      "Зараз тут немає жодного поточного факту. Перезавантаж, щоб повторити читання, або відкрий відповідні розділи безпосередньо.",
    reload: "Перезавантажити",
    portfolio: "Портфель",
    operations: "Операції",
    recoveryTitle: "Це читання неповне",
    recoveryInfo: <p>Те, що нижче, все одно показано. Сторінка покриття, яка приховує власні прогалини, — єдине, чим ця сторінка не може бути ніколи.</p>,
    nothingTitle: "В обсязі поки нічого немає",
    nothingInfo: <p>Порожня сторінка покриття — реальний стан, і це не те саме, що повне покриття. Ще нічого не заявлено як покрите.</p>,
    research: "Дослідження",
    sourceDetailTitle: "Кожне заявлене джерело",
    sourceDetailInfo: (
      <p>
        Право поруч із кожним — це те, для чого джерело можна використовувати:
        читання, зберігання, обробка, сповіщення. Джерело з правом <b>NONE</b>
        відхиляється ще до читання — тому воно може зʼявитися тут, жодного разу не
        спостерігавшись.
      </p>
    ),
  },
} as const satisfies Record<WorkspaceLocale, PageCopy>;

/**
 * Coverage — how much of this reader's world the product can actually see.
 *
 * The whole surface is one refusal repeated: **no percentage, and no zero that
 * nobody measured.** A count is `counted of total` with the gap named, and a
 * budget with no recorded spend reads `Unrecorded` rather than `0`. Both are
 * the compact, confident renderings, and both would be the product claiming a
 * measurement it never took — on the one page whose entire job is to say what
 * was and was not measured.
 */
export default async function CoveragePage() {
  const { lang } = await cabinetUiCopy();
  const c = COPY[lang];
  const session = await getSession();

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
          icon={<Database size={17} weight="bold" aria-hidden />}
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

  const reads = await loadHomeReads({
    wallet: session.state.user.wallet_address ?? null,
    telegramId: session.telegramId,
    ownerRef,
    asOf,
    want: { portfolio: true, research: true, decisions: false },
  });

  let projection: ReturnType<typeof projectCoverageSurface> | null = null;
  try {
    projection = projectCoverageSurface({ reads, asOf });
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
          </div>
        </header>
        <Section
          id="hard-error"
          title={c.hardErrorTitle}
          icon={<WarningCircle size={17} weight="bold" aria-hidden />}
          locale={lang}
          info={c.hardErrorInfo}
        >
          <p className={styles.empty}>
            {c.hardErrorBody}
          </p>
          <div className={styles.actions}>
            <Link className={styles.link} href="/app/coverage">{c.reload} <ArrowRight size={13} weight="bold" aria-hidden /></Link>
            <Link className={styles.link} href="/app/portfolio">{c.portfolio} <ArrowRight size={13} weight="bold" aria-hidden /></Link>
          </div>
        </Section>
      </div>
    );
  }

  const groups = groupsOf(projection, lang);
  const groupInfo = groupInfoOf(lang);

  return (
    <div className={styles.surface} data-surface-state={projection.state}>
      <header className={styles.head}>
        <div>
          <p className={styles.eyebrow}>Ryntra Home</p>
          <h1>{c.title}</h1>
        </div>
        <div className={styles.headMeta}>
          <StateChip tone={coverageTone(projection.state)} label={projection.state} />
          <Link className={styles.link} href="/app/operations">{c.operations} <ArrowRight size={13} weight="bold" aria-hidden /></Link>
        </div>
      </header>

      {reads.recovery.length === 0 ? null : (
        <Section
          id="recovery"
          title={c.recoveryTitle}
          icon={<WarningCircle size={17} weight="bold" aria-hidden />}
          locale={lang}
          info={c.recoveryInfo}
        >
          <ul className={styles.note}>
            {reads.recovery.map((line) => <li key={line}>{line}</li>)}
          </ul>
        </Section>
      )}

      {projection.state === "EMPTY" ? (
        <Section
          id="nothing"
          title={c.nothingTitle}
          icon={<Database size={17} weight="bold" aria-hidden />}
          locale={lang}
          info={c.nothingInfo}
        >
          <p className={styles.empty}>{projection.emptyReason}</p>
          <div className={styles.actions}>
            <Link className={styles.link} href="/app/connect">{c.connections} <ArrowRight size={13} weight="bold" aria-hidden /></Link>
            <Link className={styles.link} href="/app/research">{c.research} <ArrowRight size={13} weight="bold" aria-hidden /></Link>
          </div>
        </Section>
      ) : null}

      {groups.map((group) => (
        <Section
          key={group.group}
          id={group.group.toLowerCase()}
          title={group.label}
          icon={GROUP_ICON[group.group]}
          locale={lang}
          info={<p>{groupInfo[group.group]}</p>}
          aside={<StateChip tone="quiet" label={`${group.tiles.length}`} />}
        >
          <Tiles tiles={group.tiles} locale={lang} />
        </Section>
      ))}

      {projection.sources.length === 0 ? null : (
        <Section
          id="source-detail"
          title={c.sourceDetailTitle}
          icon={GROUP_ICON.SOURCES}
          locale={lang}
          info={c.sourceDetailInfo}
          aside={<StateChip tone="quiet" label={projection.sourceCoverage.label} />}
        >
          <Sources sources={projection.sources} locale={lang} />
        </Section>
      )}
    </div>
  );
}
