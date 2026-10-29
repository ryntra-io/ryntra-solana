import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, MagnifyingGlass, PlugsConnected, WarningCircle } from "@phosphor-icons/react/dist/ssr";

import { getSession, subjectOf } from "@/lib/session";
import { findStrategy, type StrategiesProjection } from "@/lib/home/strategy/read-model";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { cabinetUiCopy } from "@/app/app/ui-lang";
import { Section, StateChip } from "@/app/app/portfolio/tiles";
import {
  Approval,
  Evidence,
  LabLink,
  Lifecycle,
  SectionIcons,
  Versions,
  stateTone,
} from "../tiles";
import { loadStrategyReads, projectStrategySurface } from "../read";
import styles from "@/app/app/home-surface.module.css";

export const dynamic = "force-dynamic";

type StrategyDetailCopy = {
  meta: { title: string };
  eyebrow: string;
  detailEyebrow: string;
  heading: string;
  noAccount: {
    chip: string;
    title: string;
    info: ReactNode;
    empty: string;
    confirm: string;
  };
  missing: {
    readFailedChip: string;
    notFoundChip: string;
    strategies: string;
    readFailedTitle: string;
    notFoundTitle: string;
    readFailedInfo: string;
    notFoundInfo: string;
    readFailedEmpty: string;
    notFoundEmpty: string;
    allStrategies: string;
  };
  state: {
    title: string;
    info: ReactNode;
    versions: string;
    runs: string;
    specHash: string;
    updated: string;
  };
  versions: { title: string; info: ReactNode };
  evidence: { title: string; info: ReactNode };
  approval: { title: string; info: ReactNode };
};

const COPY = {
  en: {
    meta: { title: "Strategy · Ryntra Home" },
    eyebrow: "Ryntra Home",
    detailEyebrow: "Ryntra Home · Strategy",
    heading: "Strategy",
    noAccount: {
      chip: "No account",
      title: "A strategy belongs to an account",
      info: (
        <p>
          Strategies, their versions and their evidence are stored against one confirmed
          account. With none there is nothing to read.
        </p>
      ),
      empty: "Confirm your account to open this strategy.",
      confirm: "Confirm access",
    },
    missing: {
      readFailedChip: "Read failed",
      notFoundChip: "Not found",
      strategies: "Strategies",
      readFailedTitle: "This read did not complete",
      notFoundTitle: "No strategy with this id was read",
      readFailedInfo:
        "No strategy from an earlier read is shown here. A stale version presented as current is the defect this state exists to prevent.",
      notFoundInfo:
        "The list reads the most recently updated strategies for this account. An id outside that page, or belonging to another account, resolves to nothing rather than to somebody else's record.",
      readFailedEmpty: "Nothing on this page is a current fact right now. Reload to try the read again.",
      notFoundEmpty: "Open the list to see the strategies this account actually carries.",
      allStrategies: "All strategies",
    },
    state: {
      title: "Where it is, and why",
      info: (
        <p>
          The state is derived from what is recorded, never declared. Four of the eleven states
          can be reached from evidence; the other seven need a decision this page does not
          record, and they are shown greyed on the ladder with the reason.
        </p>
      ),
      versions: "Versions",
      runs: "Runs",
      specHash: "Spec hash",
      updated: "Updated",
    },
    versions: {
      title: "What changed between versions",
      info: (
        <p>
          A <b>material</b> rule change creates a new version — the symbol, the timeframe, the
          entry or exit, the stop, the sizing, the drawdown limit, the cost model. A version
          that changed none of those recorded an edit rather than a change to what the strategy
          would do, and it says so instead of appearing in a list of rule changes.
        </p>
      ),
    },
    evidence: {
      title: "Backtest evidence",
      info: (
        <p>
          Seven requirements, each satisfied or refused by name: the data and its version,
          costs, missing data, maximum drawdown, out-of-sample and forward evidence. <b>An
          in-sample curve is never proof.</b> Out-of-sample is kept as <i>blind</i> or
          <i> self-attested</i> rather than flattened to a yes, because a strategy tuned on its
          own holdout is not the same as one that was not. No score, quality or verdict crosses
          from the lab onto this page.
        </p>
      ),
    },
    approval: {
      title: "Could this evidence carry an approval?",
      info: (
        <p>
          A permission, not an approval. It reports whether the recorded evidence satisfies
          every requirement a strategy must meet before it may be approved. The decision is
          yours, and this page does not record one.
        </p>
      ),
    },
  },
  uk: {
    meta: { title: "Стратегія · Ryntra Home" },
    eyebrow: "Ryntra Home",
    detailEyebrow: "Ryntra Home · Стратегія",
    heading: "Стратегія",
    noAccount: {
      chip: "Без акаунта",
      title: "Стратегія належить акаунту",
      info: (
        <p>
          Стратегії, їхні версії та їхні докази зберігаються за одним підтвердженим
          акаунтом. Без нього читати нічого.
        </p>
      ),
      empty: "Підтверди акаунт, щоб відкрити цю стратегію.",
      confirm: "Підтвердити доступ",
    },
    missing: {
      readFailedChip: "Збій читання",
      notFoundChip: "Не знайдено",
      strategies: "Стратегії",
      readFailedTitle: "Це читання не завершилося",
      notFoundTitle: "Стратегії з таким id не прочитано",
      readFailedInfo:
        "Тут не показано жодної стратегії з попереднього читання. Застаріла версія, видана за поточну, — саме той дефект, якому цей стан запобігає.",
      notFoundInfo:
        "Список читає нещодавно оновлені стратегії цього акаунта. Id поза цією сторінкою або з чужого акаунта веде в нікуди, а не до чужого запису.",
      readFailedEmpty: "Зараз на цій сторінці немає жодного поточного факту. Перезавантаж, щоб повторити читання.",
      notFoundEmpty: "Відкрий список, щоб побачити стратегії, які цей акаунт насправді має.",
      allStrategies: "Усі стратегії",
    },
    state: {
      title: "Де вона і чому",
      info: (
        <p>
          Стан виводиться з того, що записано, і ніколи не декларується. Чотири з одинадцяти
          станів досяжні з доказів; решті семи потрібне рішення, якого ця сторінка не
          записує, і на драбині їх показано сірими з поясненням.
        </p>
      ),
      versions: "Версії",
      runs: "Прогони",
      specHash: "Хеш специфікації",
      updated: "Оновлено",
    },
    versions: {
      title: "Що змінилося між версіями",
      info: (
        <p>
          <b>Суттєва</b> зміна правил створює нову версію: символ, таймфрейм, вхід чи вихід,
          стоп, розмір позиції, ліміт просадки, модель витрат. Версія, що не змінила нічого
          з цього, записала редагування, а не зміну того, що стратегія робила б, — і каже це
          прямо, замість зʼявлятися у списку змін правил.
        </p>
      ),
    },
    evidence: {
      title: "Докази бектесту",
      info: (
        <p>
          Сім вимог, кожна виконана або відхилена поіменно: дані та їхня версія, витрати,
          відсутні дані, максимальна просадка, out-of-sample і форвардні докази.{" "}
          <b>In-sample крива ніколи не є доказом.</b> Out-of-sample зберігається як{" "}
          <i>сліпий</i> або <i>самозасвідчений</i>, а не сплющується до «так», бо стратегія,
          підігнана під власний holdout, — не те саме, що непідігнана. Жодна оцінка, якість
          чи вердикт не переходять із лабораторії на цю сторінку.
        </p>
      ),
    },
    approval: {
      title: "Чи витримали б ці докази схвалення?",
      info: (
        <p>
          Дозвіл, а не схвалення. Блок повідомляє, чи задовольняють записані докази кожну
          вимогу, яку стратегія має виконати перед схваленням. Рішення за тобою, і ця
          сторінка його не записує.
        </p>
      ),
    },
  },
} as const satisfies Record<WorkspaceLocale, StrategyDetailCopy>;

export async function generateMetadata(): Promise<Metadata> {
  const { lang } = await cabinetUiCopy();
  return { title: COPY[lang].meta.title, robots: { index: false, follow: false } };
}

/**
 * One strategy, read as its lifecycle rather than as a record.
 *
 * The facts on this page come in this order: which state it is in and why,
 * which rule fields changed between versions, what each run's evidence covers
 * and what it does not, and whether that evidence could carry an approval
 * decision at all.
 *
 * **The approval block is a permission, not an approval.** It reports whether
 * the recorded evidence satisfies the approval requirements. The decision stays
 * the reader's, and no control here records one — that needs storage this
 * release does not add.
 */
export default async function StrategyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  const { id } = await params;
  const { lang } = await cabinetUiCopy();
  const copy = COPY[lang] ?? COPY.en;

  if (!session?.verified) {
    return (
      <div className={styles.surface}>
        <header className={styles.head}>
          <div>
            <p className={styles.eyebrow}>{copy.eyebrow}</p>
            <h1>{copy.heading}</h1>
          </div>
          <div className={styles.headMeta}>
            <StateChip tone="unknown" label={copy.noAccount.chip} />
          </div>
        </header>
        <Section
          id="empty"
          title={copy.noAccount.title}
          icon={<PlugsConnected size={17} weight="bold" aria-hidden />}
          info={copy.noAccount.info}
        >
          <p className={styles.empty}>{copy.noAccount.empty}</p>
          <div className={styles.actions}>
            <Link className={styles.link} href="/app/beta">{copy.noAccount.confirm} <ArrowRight size={13} weight="bold" aria-hidden /></Link>
          </div>
        </Section>
      </div>
    );
  }

  const asOf = new Date().toISOString();

  let projection: StrategiesProjection | null = null;
  try {
    const reads = await loadStrategyReads({ subject: subjectOf(session) });
    projection = projectStrategySurface({ reads, asOf });
  } catch {
    projection = null;
  }

  const strategy = projection === null ? null : findStrategy(projection, id);

  if (projection === null || strategy === null) {
    return (
      <div className={styles.surface}>
        <header className={styles.head}>
          <div>
            <p className={styles.eyebrow}>{copy.eyebrow}</p>
            <h1>{copy.heading}</h1>
          </div>
          <div className={styles.headMeta}>
            <StateChip tone={projection === null ? "risk" : "unknown"} label={projection === null ? copy.missing.readFailedChip : copy.missing.notFoundChip} />
            <Link className={styles.link} href="/app/strategies">{copy.missing.strategies} <ArrowRight size={13} weight="bold" aria-hidden /></Link>
          </div>
        </header>
        <Section
          id="not-found"
          title={projection === null ? copy.missing.readFailedTitle : copy.missing.notFoundTitle}
          icon={projection === null
            ? <WarningCircle size={17} weight="bold" aria-hidden />
            : <MagnifyingGlass size={17} weight="bold" aria-hidden />}
          info={
            <p>
              {projection === null
                ? copy.missing.readFailedInfo
                : copy.missing.notFoundInfo}
            </p>
          }
        >
          <p className={styles.empty}>
            {projection === null
              ? copy.missing.readFailedEmpty
              : copy.missing.notFoundEmpty}
          </p>
          <div className={styles.actions}>
            <Link className={styles.link} href="/app/strategies">{copy.missing.allStrategies} <ArrowRight size={13} weight="bold" aria-hidden /></Link>
          </div>
        </Section>
      </div>
    );
  }

  return (
    <div className={styles.surface} data-surface-state={strategy.state}>
      <header className={styles.head}>
        <div>
          <p className={styles.eyebrow}>{copy.detailEyebrow}</p>
          <h1>{strategy.title}</h1>
        </div>
        <div className={styles.headMeta}>
          <StateChip tone={stateTone(strategy.state)} label={strategy.stateLabel} />
          <StateChip tone="quiet" label={`v${strategy.latestVersion?.versionNumber ?? "—"}`} />
          <Link className={styles.link} href="/app/strategies">{copy.missing.allStrategies} <ArrowRight size={13} weight="bold" aria-hidden /></Link>
        </div>
      </header>

      <Section
        id="state"
        title={copy.state.title}
        icon={SectionIcons.lifecycle}
        info={copy.state.info}
      >
        <p className={styles.plain}>{strategy.stateReason}</p>
        <div className={styles.facts}>
          <div className={styles.fact}>
            <span className={styles.factKey}>{copy.state.versions}</span>
            <span className={styles.factValue}>{strategy.versionCount}</span>
          </div>
          <div className={styles.fact}>
            <span className={styles.factKey}>{copy.state.runs}</span>
            <span className={styles.factValue}>{strategy.evidence.length}</span>
          </div>
          <div className={styles.fact}>
            <span className={styles.factKey}>{copy.state.specHash}</span>
            <span className={styles.factValue}>{strategy.latestVersion?.specHash.slice(0, 16) ?? "—"}</span>
          </div>
          <div className={styles.fact}>
            <span className={styles.factKey}>{copy.state.updated}</span>
            <span className={styles.factValue}>{strategy.updatedAt.slice(0, 10)}</span>
          </div>
        </div>
        <Lifecycle current={strategy.state} unreachable={projection.unreachable} />
      </Section>

      <Section
        id="versions"
        title={copy.versions.title}
        icon={SectionIcons.versions}
        info={copy.versions.info}
        aside={<StateChip tone="quiet" label={`${strategy.materialChanges.length}`} />}
      >
        <Versions strategy={strategy} />
      </Section>

      <Section
        id="evidence"
        title={copy.evidence.title}
        icon={SectionIcons.evidence}
        info={copy.evidence.info}
        aside={<StateChip tone={strategy.evidence.some((entry) => entry.state !== "EVIDENCE") ? "caution" : "good"} label={`${strategy.evidence.length}`} />}
      >
        <Evidence assessments={strategy.evidence} />
      </Section>

      <Section
        id="approval"
        title={copy.approval.title}
        icon={SectionIcons.requirements}
        info={copy.approval.info}
      >
        <Approval strategy={strategy} />
        <LabLink />
      </Section>
    </div>
  );
}
