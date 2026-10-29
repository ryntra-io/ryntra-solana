import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Calculator,
  CheckCircle,
  ClockCounterClockwise,
  Gauge,
  Scales,
  Timer,
  WarningCircle,
} from "@phosphor-icons/react/dist/ssr";

import { canKeepPersonalData, getSession } from "@/lib/session";
import { homeLocalOwnerRef } from "@/lib/home/local-scope";
import { MIN_COHORT } from "@/lib/journal/adherence";
import type { JournalCycle } from "@/lib/home/advice/journal";
import { Section, StateChip } from "@/app/app/portfolio/tiles";
import { CycleRow } from "@/app/app/action-cases/tiles";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { HonestPnlPanel } from "@/app/shell/honest-pnl";
import { cabinetUiCopy } from "../ui-lang";
import { VisitorNotice } from "../visitor";
import { loadJournal, type JournalRead } from "./read";
import styles from "./journal.module.css";

export const metadata: Metadata = {
  title: "Journal · Ryntra Home",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type JournalPageCopy = {
  visitor: { eyebrow: string; heading: string; body: string; reason: string };
  readFailed: string;
  hardError: { title: string; info: ReactNode; empty: string };
  reload: string;
  decisions: string;
  portfolio: string;
  recovery: { title: string; info: ReactNode };
  loop: { title: string; info: ReactNode; chip: (cycles: number) => string };
  discipline: { title: string; info: (hint: string) => ReactNode };
  metric: { noData: string; unavailable: string };
  honest: { title: string; info: ReactNode; paper: string; live: string; notRead: string; paperNote: string; liveNote: string };
  adherence: {
    title: string;
    info: (minCohort: number) => ReactNode;
    followed: string;
    broke: string;
    emptyCohort: string;
    closedInProfit: (wins: number, n: number) => string;
    noFlags: string;
    delta: (points: string) => string;
    needMore: (minCohort: number, unflagged: number) => string;
  };
  open: { title: string; info: ReactNode; empty: string };
  observed: {
    title: string;
    info: ReactNode;
    chip: (reviewed: number, unreviewed: number) => string;
    empty: string;
  };
};

/* Everything this page authors itself, in both workspace locales. The header
   copy (`eyebrow`, `title`, KPI labels) stays in the shared `CB_COPY` and is
   selected by the same cookie; machine state tokens (COMPLETE, PARTIAL, OPEN…)
   and lines produced by the read model in `lib/` are not translated here. EN
   stays byte-identical. */
const COPY = {
  en: {
    visitor: {
      eyebrow: "Review",
      heading: "Journal",
      body: "Every plan you made, what you decided, what actually happened, and what you wrote afterwards — the whole cycle, paper and real side by side.",
      reason:
        "The journal is your record, so there is nothing here to read without an account. This is not a paywall: a journal of somebody else's decisions would not be a journal.",
    },
    readFailed: "Read failed",
    hardError: {
      title: "This read did not complete",
      info: <p>No cycle from an earlier read is shown here. A stale journal presented as current is the defect this state exists to prevent.</p>,
      empty: "Nothing on this page is a current fact right now. Reload to try the read again.",
    },
    reload: "Reload",
    decisions: "Decisions",
    portfolio: "Portfolio",
    recovery: {
      title: "This read is not complete",
      info: <p>What follows is still shown, because hiding a partial read is how a reader concludes that nothing happened.</p>,
    },
    loop: {
      title: "The loop",
      info: (
        <p>
          A journal is four things in order — what you <b>planned</b>, what you{" "}
          <b>decided</b>, what was <b>observed</b>, and what you <b>concluded</b>. Each
          counter below is how many of your cycles reached that link. A gap is not a
          failing: it is the link that is missing, named, so it can be closed.
        </p>
      ),
      chip: (cycles: number) => `${cycles} cycles`,
    },
    discipline: {
      title: "Discipline",
      info: (hint: string) => (
        <p>
          {hint}. Plan adherence is how often you did what you said you
          would; it is a behaviour, and it is the one thing in this product that a reader
          controls completely. A figure the book did not report is shown as unavailable
          rather than as zero — <b>&ldquo;you followed no plan&rdquo; and &ldquo;the book
          did not answer&rdquo; are different facts</b>, and only one of them is about you.
        </p>
      ),
    },
    metric: { noData: "No data yet", unavailable: "Unavailable" },
    honest: {
      title: "Honest result",
      info: (
        <p>
          One standard for every result Ryntra shows: fees counted, realized and unrealized apart, what is held at the
          price it would leave at, how complete the data is, the drawdown, and 7 · 30 · 90 days. A result not known well
          enough is <b>not known</b> — never a zero, never a plus. Paper and real are two results, never one sum.
        </p>
      ),
      paper: "Paper",
      live: "Real trades",
      notRead: "This book was not read on this request — no figure is shown for it.",
      paperNote: "Paper: a closed trade's result is the move less its entry and exit fees; an open paper trade is not marked here, so it is a part not known.",
      liveNote: "Real: the venue's closed result before fees, less every fill's fee (opening fills too), from the last 100 fills read. Positions still open at the venue are in the Portfolio and not counted here.",
    },
    adherence: {
      title: "Does following your plan pay off, in your own data",
      info: (minCohort: number) => (
        <p>
          Two cohorts of your own closed paper trades: the ones where you followed the plan
          and the ones where you did not. Below {minCohort} trades in either cohort the
          difference is noise and this page says so rather than drawing it. Even above that
          floor it is a personal behavioural signal and never a study — and it is{" "}
          <b>paper only</b>, because one paper trade is exactly one position while a real
          close arrives as several fills, and mixing the two would read as real performance.
        </p>
      ),
      followed: "Followed the plan",
      broke: "Broke the plan",
      emptyCohort: "No trade in this cohort",
      closedInProfit: (wins: number, n: number) => `${wins} of ${n} closed in profit`,
      noFlags: "No closed paper trade carries a plan flag yet, so there is nothing to compare.",
      delta: (points: string) =>
        `So far, following the plan is worth ${points} points of win rate in your own data. It firms up over more trades.`,
      needMore: (minCohort: number, unflagged: number) =>
        `Both cohorts need ${minCohort} trades before the difference is worth reading. ${unflagged === 0 ? "" : `${unflagged} closed trade${unflagged === 1 ? "" : "s"} carry no plan flag and are excluded.`}`,
    },
    open: {
      title: "Open cycles",
      info: (
        <p>
          A cycle stays open until an outcome is observed. Nothing here is a prediction
          about how one will end, and no figure is carried forward from a plan as if it had
          already happened.
        </p>
      ),
      empty: "No cycle is open. Everything you started has been observed.",
    },
    observed: {
      title: "Observed cycles",
      info: (
        <p>
          A cycle whose outcome was observed. The conclusion is the last link, and a cycle
          without one is shown as <b>closed rather than reviewed</b> — the distinction is
          the whole point of keeping a journal instead of a trade list.
        </p>
      ),
      chip: (reviewed: number, unreviewed: number) => `${reviewed} reviewed · ${unreviewed} unreviewed`,
      empty: "Nothing has closed yet, so there is nothing to review. This page fills itself from what you actually do.",
    },
  },
  uk: {
    visitor: {
      eyebrow: "Перегляд",
      heading: "Журнал",
      body: "Кожен твій план, ухвалене рішення, те, що сталося насправді, і твій запис після, — весь цикл, paper і реальні угоди поруч.",
      reason:
        "Журнал — це твій власний запис, тож без акаунта тут нема чого читати. Це не пейвол: журнал чужих рішень не був би журналом.",
    },
    readFailed: "Читання не вдалося",
    hardError: {
      title: "Це читання не завершилося",
      info: <p>Тут не показано жодного циклу з попереднього читання. Застарілий журнал, поданий як поточний, — саме той дефект, якому цей стан запобігає.</p>,
      empty: "Ніщо на цій сторінці зараз не є поточним фактом. Перезавантаж, щоб повторити читання.",
    },
    reload: "Перезавантажити",
    decisions: "Рішення",
    portfolio: "Портфель",
    recovery: {
      title: "Це читання неповне",
      info: <p>Те, що нижче, все одно показано: сховане часткове читання — це те, з чого читач робить висновок, що нічого не сталося.</p>,
    },
    loop: {
      title: "Цикл",
      info: (
        <p>
          Журнал — це чотири речі по порядку: що <b>заплановано</b>, що{" "}
          <b>вирішено</b>, що було <b>спостережено</b> і який <b>висновок</b>
          зроблено. Кожен лічильник нижче — скільки твоїх циклів дійшло до цієї ланки.
          Прогалина — не провал: це названа відсутня ланка, і її можна закрити.
        </p>
      ),
      chip: (cycles: number) => `Циклів: ${cycles}`,
    },
    discipline: {
      title: "Дисципліна",
      info: (hint: string) => (
        <p>
          {hint}. Дотримання плану — це те, як часто ти робиш те, що кажеш; це
          поведінка, і це єдине в цьому продукті, що читач контролює повністю.
          Показник, якого книга не повідомила, показано як недоступний, а не як нуль —{" "}
          <b>«жодного плану не дотримано» і «книга не відповіла» — різні факти</b>,
          і лише один із них про тебе.
        </p>
      ),
    },
    metric: { noData: "Даних ще немає", unavailable: "Недоступно" },
    honest: {
      title: "Чесний результат",
      info: (
        <p>
          Один стандарт для кожного результату в Ryntra: комісії враховано, реалізоване й нереалізоване окремо, те, що
          тримається, — за ціною виходу, повнота даних, просадка і 7 · 30 · 90 днів. Результат, відомий недостатньо, —{" "}
          <b>невідомий</b>: ніколи не нуль і не плюс. Папір і реальні угоди — два результати, ніколи не одна сума.
        </p>
      ),
      paper: "Папір",
      live: "Реальні угоди",
      notRead: "Цю книгу на цьому читанні не прочитано — цифр для неї не показуємо.",
      paperNote: "Папір: результат закритої угоди — рух ціни мінус комісії входу й виходу; відкриту paper-угоду тут не оцінено, тож це невідома частина.",
      liveNote: "Реальні: закритий результат майданчика до комісій мінус комісія кожного філу (і відкривальних) — за останніми 100 прочитаними філами. Позиції, ще відкриті на майданчику, — у Портфелі й тут не враховані.",
    },
    adherence: {
      title: "Чи окупається дотримання плану — у твоїх власних даних",
      info: (minCohort: number) => (
        <p>
          Дві когорти твоїх власних закритих paper-угод: ті, де плану дотримано,
          і ті, де ні. Поки в будь-якій когорті менше ніж {minCohort} угод, різниця —
          шум, і сторінка каже це прямо, а не малює її. Навіть вище цього порогу це
          особистий поведінковий сигнал, а не дослідження — і це <b>лише paper</b>, бо
          одна paper-угода — рівно одна позиція, тоді як реальне закриття приходить
          кількома філами, і змішування читалося б як реальний результат.
        </p>
      ),
      followed: "План дотримано",
      broke: "План порушено",
      emptyCohort: "У цій когорті немає угод",
      closedInProfit: (wins: number, n: number) => `${wins} із ${n} закрито в плюс`,
      noFlags: "Жодна закрита paper-угода ще не має позначки плану, тож порівнювати нема чого.",
      delta: (points: string) =>
        `Наразі дотримання плану дає ${points} пунктів win rate у твоїх власних даних. З більшою кількістю угод оцінка стає стійкішою.`,
      needMore: (minCohort: number, unflagged: number) =>
        `Кожній когорті потрібно ${minCohort} угод, перш ніж різницю варто читати.${unflagged === 0 ? "" : ` Закритих угод без позначки плану: ${unflagged} — їх виключено.`}`,
    },
    open: {
      title: "Відкриті цикли",
      info: (
        <p>
          Цикл лишається відкритим, доки не спостережено результат. Тут немає прогнозів
          про те, як він завершиться, і жодна цифра з плану не переноситься так, ніби
          вже сталася.
        </p>
      ),
      empty: "Жодного відкритого циклу. Усе розпочате вже спостережено.",
    },
    observed: {
      title: "Спостережені цикли",
      info: (
        <p>
          Цикл, результат якого спостережено. Висновок — остання ланка, і цикл без нього
          показано як <b>закритий, а не розібраний</b> — ця різниця і є сенсом журналу
          замість списку угод.
        </p>
      ),
      chip: (reviewed: number, unreviewed: number) => `Розібрано: ${reviewed} · Без розбору: ${unreviewed}`,
      empty: "Ще нічого не закрилося, тож розбирати нема чого. Ця сторінка наповнюється з того, що ти реально робиш.",
    },
  },
} as const satisfies Record<WorkspaceLocale, JournalPageCopy>;

/** Dollars as the honest result prints them: «+$12.40», «−$3.05». */
function usdText(value: number, locale: string, signed: boolean): string {
  const text = new Intl.NumberFormat(locale, { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(Math.abs(value));
  return `${signed ? (value > 0 ? "+" : value < 0 ? "−" : "") : value < 0 ? "−" : ""}${text}`;
}

/**
 * Ryntra Home — the Journal, as the cycle it records.
 *
 * `plan → decision → outcome → conclusion`. The page this replaces was a KPI
 * strip over two wide tables: correct in every fact it stated and unable to
 * answer the question a journal exists for, because what a reader had *said
 * would happen* was nine columns away from what did.
 *
 * The cycle is compiled by `lib/home/advice`, from the same records and by the
 * same function the decision queue uses, so the two surfaces cannot describe
 * one trade differently. Discipline keeps its own module and its own figures.
 *
 * The shell owns the `main` landmark (`app/shell/app-shell.tsx`); a page nested
 * inside it must not declare a second one.
 */
export default async function JournalPage() {
  const session = await getSession();
  /* The workspace locale cookie, not the Telegram bot language: the chrome
     around this page already follows the cookie, and the header speaking a
     third language inside EN/UA chrome was the exact drift. */
  const { lang, c } = await cabinetUiCopy();
  const local = COPY[lang] ?? COPY.en;
  if (!session || !canKeepPersonalData(session)) {
    return (
      <VisitorNotice
        eyebrow={local.visitor.eyebrow}
        heading={local.visitor.heading}
        body={local.visitor.body}
        reason={local.visitor.reason}
        intent="journal"
      />
    );
  }

  const copy = c.journal;
  const ownerRef = homeLocalOwnerRef({
    proofCode: session.state.user.proof_code,
    createdAt: session.state.user.created_at,
  });
  const asOf = new Date().toISOString();

  let read: JournalRead | null = null;
  try {
    read = await loadJournal({
      wallet: session.state.user.wallet_address ?? null,
      telegramId: session.telegramId,
      ownerRef,
      asOf,
    });
  } catch {
    read = null;
  }

  if (read === null) {
    return (
      <div className={styles.surface}>
        <header className={styles.head}>
          <div>
            <p className={styles.eyebrow}>{copy.eyebrow}</p>
            <h1>{copy.title}</h1>
          </div>
          <div className={styles.headMeta}>
            <StateChip tone="risk" label={local.readFailed} />
          </div>
        </header>
        <Section
          id="hard-error"
          title={local.hardError.title}
          icon={<WarningCircle size={17} weight="bold" aria-hidden />}
          info={local.hardError.info}
        >
          <p className={styles.empty}>
            {local.hardError.empty}
          </p>
          <div className={styles.actions}>
            <Link className={styles.link} href="/app/journal">{local.reload} <ArrowRight size={13} weight="bold" aria-hidden /></Link>
            <Link className={styles.link} href="/app/action-cases">{local.decisions} <ArrowRight size={13} weight="bold" aria-hidden /></Link>
          </div>
        </Section>
      </div>
    );
  }

  const { cycle, adherence } = read;
  const open = cycle.cycles.filter((entry) => entry.state === "OPEN");
  const finished = cycle.cycles.filter((entry) => entry.state !== "OPEN");

  return (
    <div className={styles.surface} data-surface-state={cycle.state}>
      <header className={styles.head}>
        <div>
          <p className={styles.eyebrow}>{copy.eyebrow}</p>
          <h1>{copy.title}</h1>
        </div>
        <div className={styles.headMeta}>
          <StateChip
            tone={cycle.state === "COMPLETE" ? "good" : cycle.state === "EMPTY" ? "unknown" : "caution"}
            label={cycle.state}
          />
          <Link className={styles.link} href="/app/action-cases">{local.decisions} <ArrowRight size={13} weight="bold" aria-hidden /></Link>
          <Link className={styles.link} href="/app/portfolio">{local.portfolio} <ArrowRight size={13} weight="bold" aria-hidden /></Link>
        </div>
      </header>

      {read.recovery.length === 0 ? null : (
        <Section
          id="recovery"
          title={local.recovery.title}
          icon={<WarningCircle size={17} weight="bold" aria-hidden />}
          info={local.recovery.info}
        >
          <ul className={styles.note}>
            {read.recovery.map((line) => <li key={line}>{line}</li>)}
          </ul>
        </Section>
      )}

      <Section
        id="cycle"
        title={local.loop.title}
        icon={<Timer size={17} weight="bold" aria-hidden />}
        info={local.loop.info}
        aside={<StateChip tone="quiet" label={local.loop.chip(cycle.counts.cycles)} />}
      >
        <ul className={styles.stages}>
          {cycle.stages.map((stage) => (
            <li key={stage.id} className={styles.stage} data-state={stage.state}>
              <span className={styles.stageName}>
                {stage.label}
                <StateChip
                  tone={stage.state === "COMPLETE" ? "good" : stage.state === "PARTIAL" ? "caution" : "unknown"}
                  label={stage.state}
                />
              </span>
              <span className={styles.stageValue}>
                {stage.recorded}/{stage.recorded + stage.missing}
              </span>
              {stage.reason === null ? null : <span className={styles.stageWhy}>{stage.reason}</span>}
            </li>
          ))}
        </ul>
      </Section>

      <Section
        id="honest-result"
        title={local.honest.title}
        icon={<Calculator size={17} weight="bold" aria-hidden />}
        info={local.honest.info}
      >
        <div className={styles.honest}>
          {([["paper", read.honest.paper, local.honest.paperNote], ["live", read.honest.live, local.honest.liveNote]] as const).map(([book, pnl, note]) => (
            <div key={book} className={styles.honestBook}>
              <h3 className={styles.honestTitle}>{book === "paper" ? local.honest.paper : local.honest.live}</h3>
              {pnl === null ? (
                <p className={styles.empty}>{local.honest.notRead}</p>
              ) : (
                <HonestPnlPanel pnl={pnl} lang={lang === "uk" ? "uk" : "en"} numberLocale={lang === "uk" ? "uk-UA" : "en-US"} format={(value, signed) => usdText(value, lang === "uk" ? "uk-UA" : "en-US", signed)} notes={[note]} />
              )}
            </div>
          ))}
        </div>
      </Section>

      <Section
        id="discipline"
        title={local.discipline.title}
        icon={<Gauge size={17} weight="bold" aria-hidden />}
        info={local.discipline.info(copy.kpiDisciplineHint)}
      >
        <div className={styles.metrics}>
          <Metric label={copy.kpiAdherence} value={read.adherencePct === null ? null : `${read.adherencePct}%`} available={read.statsAvailable} copy={local.metric} />
          <Metric label={copy.kpiWin} value={read.winRatePct === null ? null : `${read.winRatePct}%`} available={read.statsAvailable} copy={local.metric} />
          <Metric label={copy.kpiAvgR} value={read.avgR === null ? null : read.avgR.toFixed(2)} available={read.statsAvailable} copy={local.metric} />
          <Metric label={copy.kpiClosed} value={read.trades === null ? null : String(read.trades)} available={read.statsAvailable} copy={local.metric} />
          <Metric label={copy.kpiJournaled} value={read.journaled === null ? null : String(read.journaled)} available={read.statsAvailable} copy={local.metric} />
        </div>
      </Section>

      <Section
        id="adherence"
        title={local.adherence.title}
        icon={<Scales size={17} weight="bold" aria-hidden />}
        info={local.adherence.info(MIN_COHORT)}
      >
        <ul className={styles.cohorts}>
          <Cohort label={local.adherence.followed} stat={adherence.followed} copy={local.adherence} />
          <Cohort label={local.adherence.broke} stat={adherence.broke} copy={local.adherence} />
        </ul>
        <p className={styles.cycleLine}>
          {adherence.flagged === 0
            ? local.adherence.noFlags
            : adherence.sufficient && adherence.deltaPts !== null
              ? local.adherence.delta(`${adherence.deltaPts > 0 ? "+" : ""}${adherence.deltaPts.toFixed(0)}`)
              : local.adherence.needMore(MIN_COHORT, adherence.unflagged)}
        </p>
      </Section>

      <Section
        id="open"
        title={local.open.title}
        icon={<ClockCounterClockwise size={17} weight="bold" aria-hidden />}
        info={local.open.info}
        aside={<StateChip tone={open.length > 0 ? "quiet" : "good"} label={`${open.length}`} />}
      >
        <Cycles cycles={open} empty={local.open.empty} />
      </Section>

      <Section
        id="closed"
        title={local.observed.title}
        icon={<CheckCircle size={17} weight="bold" aria-hidden />}
        info={local.observed.info}
        aside={<StateChip tone="quiet" label={local.observed.chip(cycle.counts.reviewed, cycle.counts.closed)} />}
      >
        <Cycles
          cycles={finished}
          empty={local.observed.empty}
        />
      </Section>
    </div>
  );
}

function Metric({
  label,
  value,
  available,
  copy,
}: {
  label: string;
  value: string | null;
  available: boolean;
  copy: { noData: string; unavailable: string };
}) {
  return (
    <div className={styles.metric}>
      <span className={styles.metricKey}>{label}</span>
      {value === null
        ? <span className={styles.metricUnknown}>{available ? copy.noData : copy.unavailable}</span>
        : <span className={styles.metricValue}>{value}</span>}
    </div>
  );
}

function Cohort({
  label,
  stat,
  copy,
}: {
  label: string;
  stat: { n: number; wins: number; winRatePct: number | null };
  copy: { emptyCohort: string; closedInProfit: (wins: number, n: number) => string };
}) {
  return (
    <li className={styles.cohort}>
      <span className={styles.stageName}>
        {label}
        <StateChip tone={stat.n >= MIN_COHORT ? "quiet" : "unknown"} label={`${stat.n}`} />
      </span>
      {stat.winRatePct === null
        ? <span className={styles.metricUnknown}>{copy.emptyCohort}</span>
        : <span className={styles.stageValue}>{stat.winRatePct.toFixed(0)}%</span>}
      <span className={styles.stageWhy}>{copy.closedInProfit(stat.wins, stat.n)}</span>
    </li>
  );
}

function Cycles({ cycles, empty }: { cycles: readonly JournalCycle[]; empty: string }) {
  if (cycles.length === 0) {
    return (
      <p className={styles.empty} data-tone="CALM">
        <CheckCircle size={15} weight="fill" aria-hidden />
        {empty}
      </p>
    );
  }
  /* One row implementation, shared with the decision surfaces. Two copies of
     the same row in two files is how two pages start describing one cycle
     differently. */
  return (
    <ul className={styles.cycles}>
      {cycles.map((entry) => <CycleRow key={entry.caseId} cycle={entry} />)}
    </ul>
  );
}
