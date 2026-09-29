import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, WarningCircle } from "@phosphor-icons/react/dist/ssr";

import { getSession } from "@/lib/session";
import { homeLocalOwnerRef } from "@/lib/home/local-scope";
import { findDecisionCase, type DecisionsProjection } from "@/lib/home/advice/read-model";
import { issueReceipt } from "@/lib/home/advice/receipt";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { cabinetUiCopy } from "@/app/app/ui-lang";
import { Section, StateChip } from "@/app/app/portfolio/tiles";
import { AdviceCaseDetail } from "../detail";
import { loadDecisionReads, projectDecisionSurface } from "../read";
import styles from "../decisions.module.css";

export const dynamic = "force-dynamic";

type DecisionDetailCopy = {
  meta: { title: string };
  eyebrow: string;
  heading: string;
  gone: {
    chip: string;
    decisions: string;
    title: string;
    info: ReactNode;
    empty: string;
    openQueue: string;
  };
};

const COPY = {
  en: {
    meta: { title: "Decision · Ryntra Home" },
    eyebrow: "Ryntra Home · Decision",
    heading: "Decision",
    gone: {
      chip: "Not in this read",
      decisions: "Decisions",
      title: "This case is not in the current read",
      info: (
        <p>
          A case is recompiled from the records behind it rather than stored, so this link
          resolves while those records still say the same thing. Showing a preserved copy
          as if it were current is the defect this state exists to prevent.
        </p>
      ),
      empty:
        "Either the change it was raised from is no longer material, the action it points at has left the read window, or this read did not complete. The queue shows what is true right now.",
      openQueue: "Open the queue",
    },
  },
  uk: {
    meta: { title: "Рішення · Ryntra Home" },
    eyebrow: "Ryntra Home · Рішення",
    heading: "Рішення",
    gone: {
      chip: "Немає в цьому читанні",
      decisions: "Рішення",
      title: "Цього кейса немає в поточному читанні",
      info: (
        <p>
          Кейс щоразу перезбирається із записів, що стоять за ним, а не зберігається, тож це
          посилання працює, доки ті записи кажуть те саме. Показ збереженої копії як
          поточної — саме той дефект, якому цей стан запобігає.
        </p>
      ),
      empty:
        "Або зміна, з якої його відкрито, більше не є суттєвою, або дія, на яку він вказує, вийшла за вікно читання, або це читання не завершилося. Черга показує те, що є правдою зараз.",
      openQueue: "Відкрити чергу",
    },
  },
} as const satisfies Record<WorkspaceLocale, DecisionDetailCopy>;

export async function generateMetadata(): Promise<Metadata> {
  const { lang } = await cabinetUiCopy();
  return { title: COPY[lang].meta.title, robots: { index: false, follow: false } };
}

/**
 * One decision, in full.
 *
 * The queue row answers *what is waiting on me*; this answers *on what context,
 * what evidence, which risk calculation, whose decision, which action, what
 * outcome and what review*.
 *
 * **One id space, two spellings, no redirect.** A case id and the action ref it
 * points at both resolve here, because a reader who arrives with either should
 * land on the record that owns both. A second route that only forwarded would
 * be a dead route with a redirect attached, which this product decided against
 * when it closed `/app/radar`.
 *
 * Nothing is stored and replayed. A case is recompiled from the same records on
 * every read, so a link resolves while those records still say the same thing
 * and states plainly when they no longer do.
 */
export default async function DecisionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session?.verified) notFound();

  const { lang } = await cabinetUiCopy();
  const copy = COPY[lang] ?? COPY.en;

  const ownerRef = homeLocalOwnerRef({
    proofCode: session.state.user.proof_code,
    createdAt: session.state.user.created_at,
  });
  const asOf = new Date().toISOString();

  let projection: DecisionsProjection | null = null;
  try {
    const reads = await loadDecisionReads({
      wallet: session.state.user.wallet_address ?? null,
      telegramId: session.telegramId,
      ownerRef,
      asOf,
    });
    projection = projectDecisionSurface({ reads, ownerRef, asOf });
  } catch {
    projection = null;
  }

  const found = projection === null ? null : findDecisionCase(projection, id);

  if (found === null) {
    return (
      <div className={styles.surface}>
        <header className={styles.head}>
          <div>
            <p className={styles.eyebrow}>{copy.eyebrow}</p>
            <h1>{copy.heading}</h1>
          </div>
          <div className={styles.headMeta}>
            <StateChip tone="unknown" label={copy.gone.chip} />
            <Link className={styles.link} href="/app/action-cases">{copy.gone.decisions} <ArrowRight size={13} weight="bold" aria-hidden /></Link>
          </div>
        </header>
        <Section
          id="gone"
          title={copy.gone.title}
          icon={<WarningCircle size={17} weight="bold" aria-hidden />}
          info={copy.gone.info}
        >
          <p className={styles.empty}>{copy.gone.empty}</p>
          <div className={styles.actions}>
            <Link className={styles.link} href="/app/action-cases">{copy.gone.openQueue} <ArrowRight size={13} weight="bold" aria-hidden /></Link>
          </div>
        </Section>
      </div>
    );
  }

  return (
    <AdviceCaseDetail
      advice={found.case}
      action={found.action}
      /* Issued from the same function the index uses, so a case that shows a
         receipt here and none there is not a state this page can reach. */
      receipt={issueReceipt({
        caseId: found.case.caseId,
        actionRef: found.case.action?.actionRef ?? null,
        subjectLabel: found.case.trigger.subjectLabel,
        outcome: found.case.outcome,
      })}
    />
  );
}
