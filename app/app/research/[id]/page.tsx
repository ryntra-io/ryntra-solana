import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ArrowRight, WarningCircle } from "@phosphor-icons/react/dist/ssr";

import { cabinetUiCopy } from "@/app/app/ui-lang";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { getSession } from "@/lib/session";
import { homeLocalOwnerRef } from "@/lib/home/local-scope";
import { findChange, type ResearchProjection } from "@/lib/home/research/read-model";
import { Section, StateChip } from "@/app/app/portfolio/tiles";
import { ChangeDetail } from "../detail";
import { loadResearchReads, projectResearchSurface } from "../read";
import styles from "../research.module.css";

export const metadata: Metadata = {
  title: "Change · Ryntra Home",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Every reader-facing literal on this route, per locale, in this file — the
 * release checks regex this source for the exact English sentences. English is
 * byte-identical to what shipped; `uk` is its twin.
 */
type PageCopy = Readonly<{
  eyebrow: string;
  title: string;
  notInRead: string;
  radar: string;
  goneTitle: string;
  goneInfo: ReactNode;
  goneBody: string;
  openRadar: string;
}>;

const COPY = {
  en: {
    eyebrow: "Ryntra Home · Research",
    title: "Change",
    notInRead: "Not in this read",
    radar: "Radar",
    goneTitle: "This change is not in the current read",
    goneInfo: (
      <p>
        A change is identified by its own content, so this link resolves only while the
        same change is still true. Nothing is stored and replayed: showing a preserved
        copy as if it were current is the defect this state exists to prevent.
      </p>
    ),
    goneBody:
      "Either the sources now agree, the value moved again, or this read did not complete. The Radar shows what is true right now.",
    openRadar: "Open the Radar",
  },
  uk: {
    eyebrow: "Ryntra Home · Дослідження",
    title: "Зміна",
    notInRead: "Немає в цьому читанні",
    radar: "Радар",
    goneTitle: "Цієї зміни немає в поточному читанні",
    goneInfo: (
      <p>
        Зміна ідентифікується власним вмістом, тож це посилання розвʼязується лише
        доти, доки та сама зміна ще істинна. Ніщо не зберігається й не відтворюється:
        показ збереженої копії як поточної — саме той дефект, якому запобігає цей стан.
      </p>
    ),
    goneBody:
      "Або джерела тепер згодні, або значення знову зрушило, або це читання не завершилося. Радар показує те, що істинно просто зараз.",
    openRadar: "Відкрити Радар",
  },
} as const satisfies Record<WorkspaceLocale, PageCopy>;

/**
 * One change, in full.
 *
 * The Radar row answers *what changed*; this answers *against which threshold,
 * on whose evidence, under which rule, and what is still unknown*. It resolves
 * a change by re-reading the world and re-detecting: change ids are content
 * addressed, so an unchanged world resolves the same id and a world that moved
 * on says so rather than showing a fact that is no longer true.
 *
 * That is the honest behaviour for a product with no change store. A reader who
 * follows a link to a change that has since resolved gets *this change is no
 * longer in the current read* — not a preserved copy presented as current.
 */
export default async function ChangePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { lang } = await cabinetUiCopy();
  const c = COPY[lang];
  const session = await getSession();
  if (!session?.verified) notFound();

  const ownerRef = homeLocalOwnerRef({
    proofCode: session.state.user.proof_code,
    createdAt: session.state.user.created_at,
  });
  const asOf = new Date().toISOString();

  let projection: ResearchProjection | null = null;
  try {
    const reads = await loadResearchReads({
      wallet: session.state.user.wallet_address ?? null,
      telegramId: session.telegramId,
    });
    projection = projectResearchSurface({ reads, ownerRef, asOf });
  } catch {
    projection = null;
  }

  const change = projection === null ? null : findChange(projection, id);

  if (change === null) {
    return (
      <div className={styles.surface}>
        <header className={styles.head}>
          <div>
            <p className={styles.eyebrow}>{c.eyebrow}</p>
            <h1>{c.title}</h1>
          </div>
          <div className={styles.headMeta}>
            <StateChip tone="unknown" label={c.notInRead} />
            <Link className={styles.link} href="/app/research">{c.radar} <ArrowRight size={13} weight="bold" aria-hidden /></Link>
          </div>
        </header>
        <Section
          id="gone"
          title={c.goneTitle}
          icon={<WarningCircle size={17} weight="bold" aria-hidden />}
          locale={lang}
          info={c.goneInfo}
        >
          <p className={styles.empty}>
            {c.goneBody}
          </p>
          <div className={styles.actions}>
            <Link className={styles.link} href="/app/research">{c.openRadar} <ArrowRight size={13} weight="bold" aria-hidden /></Link>
          </div>
        </Section>
      </div>
    );
  }

  return (
    <ChangeDetail
      change={change}
      rule={projection?.rules.find((entry) => entry.ruleId === change.ruleId) ?? null}
      projection={projection}
      locale={lang}
    />
  );
}
