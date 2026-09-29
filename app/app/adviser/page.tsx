import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, PlugsConnected, WarningCircle } from "@phosphor-icons/react/dist/ssr";

import { getSession } from "@/lib/session";
import { homeLocalOwnerRef } from "@/lib/home/local-scope";
import type { WorkbenchProjection } from "@/lib/home/workbench/read-model";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { cabinetUiCopy } from "@/app/app/ui-lang";
import { Section, StateChip } from "@/app/app/portfolio/tiles";
import {
  Disagreements,
  Facts,
  NextStep,
  NoAnswer,
  Operations,
  QuestionList,
  Relevance,
  Result,
  Scenarios,
  SectionIcons,
  Structure,
  Versions,
  surfaceTone,
} from "./tiles";
import { loadAdviserReads, projectAdviserSurface } from "./read";
import styles from "@/app/app/home-surface.module.css";

export const dynamic = "force-dynamic";

type AdviserCopy = {
  meta: { title: string };
  heading: string;
  noAccount: {
    chip: string;
    title: string;
    info: ReactNode;
    empty: string;
    confirm: string;
    connections: string;
  };
  readFailed: {
    chip: string;
    today: string;
    title: string;
    info: ReactNode;
    empty: string;
    reload: string;
    connections: string;
  };
  header: { savesNothing: string; research: string; decisions: string };
  recovery: { title: string; info: ReactNode };
  questions: { title: string; info: ReactNode; empty: string };
  answer: { title: string; noAnswerInfo: ReactNode; info: ReactNode };
  facts: { title: string; info: ReactNode };
  disagreements: { title: string; info: ReactNode };
  scenarios: { title: string; info: ReactNode };
  relevance: { title: string; info: ReactNode };
  result: { title: string; info: ReactNode };
  nextStep: { title: string; info: ReactNode };
  versions: { title: string; info: ReactNode };
  operations: { title: string; info: ReactNode; nothingSaved: string };
};

const COPY = {
  en: {
    meta: { title: "AI assistant · Ryntra Home" },
    heading: "AI assistant",
    noAccount: {
      chip: "No account",
      title: "This workbench answers questions about your own account",
      info: (
        <p>
          Every question here is raised by something that happened in one account — a
          measured change, two sources that disagree, a constraint outside its limit. With
          no confirmed account there is nothing to raise one, and a sample question would be
          about somebody who does not exist.
        </p>
      ),
      empty:
        "Confirm your account and connect a source. Until then there is no question, no fact and no answer to state.",
      confirm: "Confirm access",
      connections: "Connections",
    },
    readFailed: {
      chip: "Read failed",
      today: "Today",
      title: "This read did not complete",
      info: (
        <p>
          No answer from an earlier read is shown here. A stale answer presented as current
          is the defect this state exists to prevent.
        </p>
      ),
      empty:
        "Nothing on this page is a current fact right now. Reload to try the read again, or check each source.",
      reload: "Reload",
      connections: "Connections",
    },
    header: { savesNothing: "Saves nothing", research: "Research", decisions: "Decisions" },
    recovery: {
      title: "This read is not complete",
      info: (
        <p>
          What follows is still shown, because hiding a partial read is how a reader
          concludes that nothing happened.
        </p>
      ),
    },
    questions: {
      title: "What this account raised",
      info: (
        <p>
          Every question here exists because something in <b>your</b> account produced it — a
          change the Radar measured, two sources that disagree, a constraint outside its
          limit, value nobody could price, a case waiting on you. There is no free text field,
          because no model is called on this path and a box that accepts anything would be
          promising an answer this product cannot compile.
        </p>
      ),
      empty: "Nothing has raised a question yet.",
    },
    answer: {
      title: "Answer",
      noAnswerInfo: (
        <p>
          A question that cannot be answered stays listed rather than disappearing, because a
          missing answer is a gap in evidence and hiding it reads as nothing having happened.
        </p>
      ),
      info: (
        <p>
          Every answer carries the same eight parts, and a part with nothing in it says why
          rather than disappearing — a structure that can drop a section is a structure that
          can quietly drop the unknowns. <b>Ryntra issues no recommendation.</b> Before a
          provider-led advice gate exists — a permitted provider of record, a
          counsel-approved perimeter, a versioned capability state — this is evidence,
          arithmetic the product already performed, and what you may do next.
        </p>
      ),
    },
    facts: {
      title: "Facts and where they came from",
      info: (
        <p>
          Each fact carries the source that reported it, when it was observed and the
          entitlement it was read under. A statement with no source behind it is not a fact
          this product will make.
        </p>
      ),
    },
    disagreements: {
      title: "Disagreements and gaps",
      info: (
        <p>
          Every disagreeing reading is kept and none is preferred; the midpoint of two
          contradictory numbers is a value no source stated. A gap names the missing fact and
          what it blocks.
        </p>
      ),
    },
    scenarios: {
      title: "Scenarios",
      info: (
        <p>
          A scenario states its assumption and its effect. One whose input is missing or
          stale is dropped by name rather than silently, because arithmetic over a guess is
          still arithmetic.
        </p>
      ),
    },
    relevance: {
      title: "What it touches",
      info: (
        <p>
          Whether anything you hold, or any plan you recorded, carries this subject. Not
          relevant and not known are different answers and stay separate.
        </p>
      ),
    },
    result: {
      title: "Deterministic result",
      info: (
        <p>
          A number appears only when every input it needs is present and current. A figure
          computed over a stale or missing input is a guess with a decimal point, so it is
          refused with the missing inputs named.
        </p>
      ),
    },
    nextStep: {
      title: "Next step",
      info: (
        <p>
          A step is something you may do, and the set it comes from contains nothing that
          executes, signs or authorizes. Ryntra takes none of them.
        </p>
      ),
    },
    versions: {
      title: "Versions",
      info: (
        <p>
          What produced this answer: the version of each source, whether a model was called
          at all, and the risk formula version behind any number above.
        </p>
      ),
    },
    operations: {
      title: "What the assistant may do",
      info: (
        <p>
          Four verbs and no fifth. Explain and Compare read objects this product already
          computed, so no model is called for them. Formalize and Review do use one, and it is
          the Strategy Lab&rsquo;s existing guarded path rather than a second client built here.
          None of the four governs, authorizes, signs, executes, supplies a missing fact or
          performs material financial arithmetic.
        </p>
      ),
      nothingSaved: "Nothing was saved",
    },
  },
  uk: {
    meta: { title: "ШІ-помічник Ryntra · Ryntra Home" },
    heading: "ШІ-помічник Ryntra",
    noAccount: {
      chip: "Без акаунта",
      title: "Цей робочий простір відповідає на запитання про ваш власний акаунт",
      info: (
        <p>
          Кожне запитання тут породжене чимось, що сталося в одному акаунті: виміряною
          зміною, двома джерелами, що розходяться, обмеженням поза своїм лімітом. Без
          підтвердженого акаунта нема чому його породити, а зразкове запитання було б про
          людину, якої не існує.
        </p>
      ),
      empty:
        "Підтвердьте акаунт і підключіть джерело. До того немає запитання, факту чи відповіді, які можна показати.",
      confirm: "Підтвердити доступ",
      connections: "Підключення",
    },
    readFailed: {
      chip: "Збій читання",
      today: "Сьогодні",
      title: "Це читання не завершилося",
      info: (
        <p>
          Тут не показано жодної відповіді з попереднього читання. Застаріла відповідь,
          видана за поточну, — саме той дефект, якому цей стан запобігає.
        </p>
      ),
      empty:
        "Зараз на цій сторінці немає жодного поточного факту. Перезавантажте, щоб повторити читання, або перевірте кожне джерело.",
      reload: "Перезавантажити",
      connections: "Підключення",
    },
    header: { savesNothing: "Нічого не зберігає", research: "Дослідження", decisions: "Рішення" },
    recovery: {
      title: "Це читання неповне",
      info: (
        <p>
          Те, що нижче, все одно показано: приховане часткове читання змушує читача
          вирішити, що нічого не сталося.
        </p>
      ),
    },
    questions: {
      title: "Що порушив цей акаунт",
      info: (
        <p>
          Кожне запитання тут існує, бо його породило щось у <b>вашому</b> акаунті: зміна,
          яку виміряв Радар, два джерела, що розходяться, обмеження поза своїм лімітом,
          вартість, яку ніхто не зміг оцінити, кейс, що чекає на вас. Вільного текстового
          поля немає: на цьому шляху не викликається жодна модель, а поле, що приймає
          будь-що, обіцяло б відповідь, якої цей продукт не може скласти.
        </p>
      ),
      empty: "Поки ніщо не порушило жодного запитання.",
    },
    answer: {
      title: "Відповідь",
      noAnswerInfo: (
        <p>
          Запитання, на яке немає відповіді, залишається у списку, а не зникає: відсутня
          відповідь — це прогалина в доказах, і її приховування читається так, ніби нічого
          не сталося.
        </p>
      ),
      info: (
        <p>
          Кожна відповідь має ті самі вісім частин, і порожня частина називає причину, а не
          зникає: структура, що може викинути розділ, — це структура, що може тихо викинути
          невідомі. <b>Ryntra не видає рекомендацій.</b> Доки не існує порадницького шлюзу з
          уповноваженим провайдером — провайдер запису з дозволом, погоджений з юристами
          периметр, версіонований стан можливостей — це докази, арифметика, яку продукт уже
          виконав, і те, що ви можете зробити далі.
        </p>
      ),
    },
    facts: {
      title: "Факти та звідки вони",
      info: (
        <p>
          Кожен факт несе джерело, що його повідомило, час спостереження і право доступу,
          під яким його читали. Твердження без джерела за ним — не факт, який цей продукт
          собі дозволить.
        </p>
      ),
    },
    disagreements: {
      title: "Розбіжності та прогалини",
      info: (
        <p>
          Кожне розбіжне читання збережено, і жодному не надано переваги; середина двох
          суперечливих чисел — значення, якого не називало жодне джерело. Прогалина називає
          відсутній факт і те, що він блокує.
        </p>
      ),
    },
    scenarios: {
      title: "Сценарії",
      info: (
        <p>
          Сценарій називає своє припущення і свій ефект. Сценарій із відсутнім чи застарілим
          входом відкидається поіменно, а не мовчки, бо арифметика над здогадкою — усе одно
          арифметика.
        </p>
      ),
    },
    relevance: {
      title: "Чого це торкається",
      info: (
        <p>
          Чи фігурує цей предмет у тому, що ви тримаєте, або в записаному вами плані.
          «Не стосується» і «невідомо» — різні відповіді, і вони залишаються окремими.
        </p>
      ),
    },
    result: {
      title: "Детермінований результат",
      info: (
        <p>
          Число зʼявляється лише тоді, коли кожен потрібний йому вхід наявний і актуальний.
          Показник, обчислений над застарілим чи відсутнім входом, — це здогадка з десятковою
          комою, тому він відхиляється з переліком відсутніх входів.
        </p>
      ),
    },
    nextStep: {
      title: "Наступний крок",
      info: (
        <p>
          Крок — це те, що можете зробити ви, і в наборі, з якого він походить, немає нічого,
          що виконує, підписує чи авторизує. Ryntra не робить жодного з них.
        </p>
      ),
    },
    versions: {
      title: "Версії",
      info: (
        <p>
          Що створило цю відповідь: версія кожного джерела, чи викликалася модель узагалі та
          версія формули ризику за кожним числом вище.
        </p>
      ),
    },
    operations: {
      title: "Що може робити помічник",
      info: (
        <p>
          Чотири дієслова і жодного пʼятого. Explain і Compare читають обʼєкти, які цей
          продукт уже обчислив, тож модель для них не викликається. Formalize і Review модель
          використовують — це наявний захищений шлях Strategy Lab, а не другий клієнт,
          збудований тут. Жодне з чотирьох не керує, не авторизує, не підписує, не виконує,
          не постачає відсутній факт і не виконує суттєвої фінансової арифметики.
        </p>
      ),
      nothingSaved: "Нічого не збережено",
    },
  },
} as const satisfies Record<WorkspaceLocale, AdviserCopy>;

export async function generateMetadata(): Promise<Metadata> {
  const { lang } = await cabinetUiCopy();
  return { title: COPY[lang].meta.title, robots: { index: false, follow: false } };
}

/**
 * Ryntra Home — the Ryn workbench.
 *
 * Home canon §7 describes this surface in one clause: *a first-class contextual
 * workbench, not an empty chat box*, with a fixed output structure. Both halves
 * are load-bearing and both are visible here.
 *
 * **Contextual** means the questions come from this account. A change the Radar
 * measured, two sources that disagree, a constraint outside its limit, value
 * nobody could price, a case waiting on a decision. With none of those there is
 * no question and no text field, because there would be nothing to ask about.
 *
 * **Fixed structure** means the answer always has the same eight sections, and
 * an empty one states its reason rather than disappearing. The structure map at
 * the top of the answer is what makes that visible in one glance.
 *
 * **Nothing here is a Ryntra recommendation and nothing here saves.** The
 * answer is compiled from records that already exist; `aiAuthority` is the
 * constant `NONE`; asking a question changes nothing, and the surface says so
 * rather than leaving the reader to assume it.
 */
export default async function AdviserPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  const { lang } = await cabinetUiCopy();
  const copy = COPY[lang] ?? COPY.en;

  if (!session?.verified) {
    return (
      <div className={styles.surface}>
        <header className={styles.head}>
          <div>
            <p className={styles.eyebrow}>Ryntra Home</p>
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
            <Link className={styles.link} href="/app/connect">{copy.noAccount.connections} <ArrowRight size={13} weight="bold" aria-hidden /></Link>
          </div>
        </Section>
      </div>
    );
  }

  const params = await searchParams;
  const requested = typeof params.q === "string" ? params.q : null;

  const ownerRef = homeLocalOwnerRef({
    proofCode: session.state.user.proof_code,
    createdAt: session.state.user.created_at,
  });
  const asOf = new Date().toISOString();

  let projection: WorkbenchProjection | null = null;
  try {
    const reads = await loadAdviserReads({
      wallet: session.state.user.wallet_address ?? null,
      telegramId: session.telegramId,
      ownerRef,
      asOf,
    });
    projection = projectAdviserSurface({ reads, asOf, selectedQuestionId: requested });
  } catch {
    projection = null;
  }

  if (projection === null) {
    return (
      <div className={styles.surface}>
        <header className={styles.head}>
          <div>
            <p className={styles.eyebrow}>Ryntra Home</p>
            <h1>{copy.heading}</h1>
          </div>
          <div className={styles.headMeta}>
            <StateChip tone="risk" label={copy.readFailed.chip} />
            <Link className={styles.link} href="/app">{copy.readFailed.today} <ArrowRight size={13} weight="bold" aria-hidden /></Link>
          </div>
        </header>
        <Section
          id="hard-error"
          title={copy.readFailed.title}
          icon={<WarningCircle size={17} weight="bold" aria-hidden />}
          info={copy.readFailed.info}
        >
          <p className={styles.empty}>{copy.readFailed.empty}</p>
          <div className={styles.actions}>
            <Link className={styles.link} href="/app/adviser">{copy.readFailed.reload} <ArrowRight size={13} weight="bold" aria-hidden /></Link>
            <Link className={styles.link} href="/app/connect">{copy.readFailed.connections} <ArrowRight size={13} weight="bold" aria-hidden /></Link>
          </div>
        </Section>
      </div>
    );
  }

  const { answer } = projection;

  return (
    <div className={styles.surface} data-surface-state={projection.state}>
      <header className={styles.head}>
        <div>
          <p className={styles.eyebrow}>Ryntra Home</p>
          <h1>{copy.heading}</h1>
        </div>
        <div className={styles.headMeta}>
          <StateChip tone={surfaceTone(projection.state)} label={projection.state} />
          {lang === "en" ? (
            <StateChip tone="quiet" label="Saves nothing" />
          ) : (
            <StateChip tone="quiet" label={copy.header.savesNothing} />
          )}
          <Link className={styles.link} href="/app/research">{copy.header.research} <ArrowRight size={13} weight="bold" aria-hidden /></Link>
          <Link className={styles.link} href="/app/action-cases">{copy.header.decisions} <ArrowRight size={13} weight="bold" aria-hidden /></Link>
        </div>
      </header>

      {projection.recovery.length === 0 ? null : (
        <Section
          id="recovery"
          title={copy.recovery.title}
          icon={<WarningCircle size={17} weight="bold" aria-hidden />}
          info={copy.recovery.info}
        >
          <ul className={styles.note}>
            {projection.recovery.map((line) => <li key={line}>{line}</li>)}
          </ul>
        </Section>
      )}

      <Section
        id="questions"
        title={copy.questions.title}
        icon={SectionIcons.questions}
        info={copy.questions.info}
        aside={<StateChip tone="quiet" label={`${projection.questions.length}`} />}
      >
        <QuestionList
          questions={projection.questions}
          selectedId={projection.selectedQuestionId}
          empty={projection.emptyReason ?? copy.questions.empty}
        />
      </Section>

      {answer === null ? (
        <Section
          id="answer"
          title={copy.answer.title}
          icon={SectionIcons.answer}
          info={copy.answer.noAnswerInfo}
        >
          <NoAnswer reason={projection.answerReason} />
        </Section>
      ) : (
        <>
          <Section
            id="answer"
            title={copy.answer.title}
            icon={SectionIcons.answer}
            info={copy.answer.info}
            aside={<StateChip tone="quiet" label={answer.operation} />}
          >
            {answer.plainAnswer.state === "STATED" ? (
              <p className={styles.plain}>{answer.plainAnswer.statement}</p>
            ) : (
              <p className={styles.plainWithheld}>{answer.plainAnswer.reason}</p>
            )}
            <Structure sections={answer.sections} />
          </Section>

          <Section
            id="facts"
            title={copy.facts.title}
            icon={SectionIcons.facts}
            info={copy.facts.info}
            aside={<StateChip tone="quiet" label={`${answer.facts.length}`} />}
          >
            <Facts answer={answer} />
          </Section>

          <Section
            id="disagreements"
            title={copy.disagreements.title}
            icon={SectionIcons.conflicts}
            info={copy.disagreements.info}
            aside={<StateChip tone={answer.conflicts.length + answer.unknowns.length > 0 ? "caution" : "good"} label={`${answer.conflicts.length + answer.unknowns.length}`} />}
          >
            <Disagreements answer={answer} />
          </Section>

          <Section
            id="scenarios"
            title={copy.scenarios.title}
            icon={SectionIcons.scenarios}
            info={copy.scenarios.info}
          >
            <Scenarios answer={answer} />
          </Section>

          <Section
            id="relevance"
            title={copy.relevance.title}
            icon={SectionIcons.answer}
            info={copy.relevance.info}
          >
            <Relevance answer={answer} />
          </Section>

          <Section
            id="result"
            title={copy.result.title}
            icon={SectionIcons.result}
            info={copy.result.info}
          >
            <Result answer={answer} />
          </Section>

          <Section
            id="next-step"
            title={copy.nextStep.title}
            icon={SectionIcons.step}
            info={copy.nextStep.info}
          >
            <NextStep answer={answer} />
          </Section>

          <Section
            id="versions"
            title={copy.versions.title}
            icon={SectionIcons.versions}
            info={copy.versions.info}
          >
            <Versions answer={answer} />
          </Section>
        </>
      )}

      <Section
        id="operations"
        title={copy.operations.title}
        icon={SectionIcons.operations}
        info={copy.operations.info}
      >
        <Operations operations={projection.operations} />
        <div className={styles.actions}>
          {lang === "en" ? (
            <StateChip tone="good" label="Nothing was saved" />
          ) : (
            <StateChip tone="good" label={copy.operations.nothingSaved} />
          )}
          <Link className={styles.link} href="/app/strategy-lab">Strategy Lab <ArrowRight size={13} weight="bold" aria-hidden /></Link>
        </div>
      </Section>
    </div>
  );
}
