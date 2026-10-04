import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, PlugsConnected, WarningCircle } from "@phosphor-icons/react/dist/ssr";

import { getSession } from "@/lib/session";
import { homeLocalOwnerRef } from "@/lib/home/local-scope";
import type { DecisionsProjection } from "@/lib/home/advice/read-model";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { cabinetUiCopy } from "@/app/app/ui-lang";
import { Section, StateChip } from "@/app/app/portfolio/tiles";
import { ContextBinding } from "./context-binding";
import {
  ActionList,
  Activity,
  CaseList,
  Receipts,
  SectionIcons,
  Sources,
  surfaceTone,
} from "./tiles";
import { DECISIONS_CONTEXT_REASON, loadDecisionReads, projectDecisionSurface } from "./read";
import styles from "./decisions.module.css";

export const dynamic = "force-dynamic";

type DecisionsCopy = {
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
  header: { research: string; journal: string };
  recovery: { title: string; info: ReactNode };
  queue: {
    title: string;
    info: ReactNode;
    emptyNoScope: string;
    emptyAllDecided: string;
    adviceAuthority: string;
    cases: string;
  };
  actions: { title: string; info: ReactNode; open: (n: number) => string; link: string };
  receipts: { title: string; info: ReactNode };
  activity: { title: string; info: ReactNode };
  sources: { title: string; info: ReactNode };
};

const COPY = {
  en: {
    meta: { title: "Decisions · Ryntra Home" },
    heading: "Decisions",
    noAccount: {
      chip: "No account",
      title: "There is no decision record without an account",
      info: (
        <p>
          A decision record is built from what you actually decided and what actually
          happened. With no confirmed account there is nothing to read, and a sample
          case would be a record of somebody who does not exist.
        </p>
      ),
      empty:
        "Confirm your account and connect a source. Until then there is no case, no action and no receipt to state.",
      confirm: "Confirm access",
      connections: "Connections",
    },
    readFailed: {
      chip: "Read failed",
      today: "Today",
      title: "This read did not complete",
      info: (
        <p>
          No case from an earlier read is shown here. A stale decision queue presented as
          current is the defect this state exists to prevent.
        </p>
      ),
      empty:
        "Nothing on this page is a current fact right now. Reload to try the read again, or check each source.",
      reload: "Reload",
      connections: "Connections",
    },
    header: { research: "Research", journal: "Journal" },
    recovery: {
      title: "This read is not complete",
      info: (
        <p>
          What follows is still shown, because hiding a partial read is how a reader
          concludes that nothing happened.
        </p>
      ),
    },
    queue: {
      title: "Waiting on you",
      info: (
        <p>
          A case is raised when the Radar measures something material, and it stays here
          until a decision is recorded against it. <b>Ryntra does not tell you what to do
          with one.</b> Before a provider-led advice gate exists — a permitted provider of
          record, a counsel-approved perimeter, a versioned capability state — the case
          carries facts, disagreements, unknowns and alternatives including doing nothing.
          A decision is read from a record, never inferred from a trade that happens to
          touch the same instrument.
        </p>
      ),
      emptyNoScope: "Nothing is in scope for this account yet, so no case has been raised.",
      emptyAllDecided: "No case is waiting on a decision. Every case here carries one already.",
      adviceAuthority: "Advice authority",
      cases: "Cases",
    },
    actions: {
      title: "Exact actions",
      info: (
        <p>
          An exact action is one economic action in the shape every Ryntra surface reads it,
          and the eight stages come from Agent Control rather than from a second vocabulary
          invented here. <b>Ryntra never executes one.</b> A paper action transmitted no
          order at all; a real one was executed by the venue and authorized by a key this
          product does not hold. Agent Control&rsquo;s own cases live in one browser tab and
          cannot be listed by a server, so they are linked rather than copied.
        </p>
      ),
      open: (n: number) => `${n} open`,
      link: "Agent Control actions",
    },
    receipts: {
      title: "Receipts",
      info: (
        <p>
          A receipt exists only after an <b>authoritative observed outcome</b>, and by
          nothing else — not by an expectation, not by an action being open, not by a plan
          that says how it should end. Paper and live are separate books with separate
          authority and are never added together: a simulated result plus a real one is a
          number describing nothing that happened.
        </p>
      ),
    },
    activity: {
      title: "Activity",
      info: (
        <p>
          One typed index across everything Home can observe — a change detected, a case
          raised, a decision recorded, an action executed, an outcome observed, a receipt
          issued, a review written, a source degraded. Every event is derived from a record
          that already exists, so nothing here can claim something that did not happen.
        </p>
      ),
    },
    sources: {
      title: "Sources and data rights",
      info: (
        <p>
          Every source carries the entitlement it was read under, and a source that refused
          is shown with the provider&rsquo;s own words. A refusal worded as an outage tells a
          reader to retry something that will refuse again for the same reason.
        </p>
      ),
    },
  },
  uk: {
    meta: { title: "Рішення · Ryntra Home" },
    heading: "Рішення",
    noAccount: {
      chip: "Без акаунта",
      title: "Без акаунта немає запису рішень",
      info: (
        <p>
          Запис рішення складається з того, що ви насправді вирішили, і того, що насправді
          сталося. Без підтвердженого акаунта читати нічого, а зразковий кейс був би записом
          про людину, якої не існує.
        </p>
      ),
      empty:
        "Підтвердьте акаунт і підключіть джерело. До того немає кейса, дії чи квитанції, які можна показати.",
      confirm: "Підтвердити доступ",
      connections: "Підключення",
    },
    readFailed: {
      chip: "Збій читання",
      today: "Сьогодні",
      title: "Це читання не завершилося",
      info: (
        <p>
          Тут не показано жодного кейса з попереднього читання. Застаріла черга рішень,
          видана за поточну, — саме той дефект, якому цей стан запобігає.
        </p>
      ),
      empty:
        "Зараз на цій сторінці немає жодного поточного факту. Перезавантажте, щоб повторити читання, або перевірте кожне джерело.",
      reload: "Перезавантажити",
      connections: "Підключення",
    },
    header: { research: "Дослідження", journal: "Журнал" },
    recovery: {
      title: "Це читання неповне",
      info: (
        <p>
          Те, що нижче, все одно показано: приховане часткове читання змушує читача
          вирішити, що нічого не сталося.
        </p>
      ),
    },
    queue: {
      title: "Чекає на вас",
      info: (
        <p>
          Кейс відкривається, коли Радар вимірює щось суттєве, і залишається тут, доки щодо
          нього не записано рішення. <b>Ryntra не каже, що з ним робити.</b> Доки не існує
          порадницького шлюзу з уповноваженим провайдером — провайдер запису з дозволом,
          погоджений з юристами периметр, версіонований стан можливостей — кейс містить
          факти, розбіжності, невідомі та альтернативи, включно з бездіяльністю. Рішення
          читається із запису й ніколи не виводиться з угоди, яка випадково торкається того
          самого інструмента.
        </p>
      ),
      emptyNoScope: "У полі зору цього акаунта поки нічого немає, тож жодного кейса не відкрито.",
      emptyAllDecided: "Жоден кейс не чекає на рішення. Кожен кейс тут уже його має.",
      adviceAuthority: "Повноваження щодо порад",
      cases: "Кейси",
    },
    actions: {
      title: "Точні дії",
      info: (
        <p>
          Точна дія — це одна економічна дія у формі, у якій її читає кожна поверхня Ryntra,
          а вісім стадій походять з Agent Control, а не з другого словника, вигаданого тут.{" "}
          <b>Ryntra ніколи її не виконує.</b> Паперова дія не передала жодного ордера;
          реальну виконав майданчик і авторизував ключ, яким цей продукт не володіє. Власні
          кейси Agent Control живуть в одній вкладці браузера, і сервер не може їх
          перелічити, тому вони наведені посиланням, а не скопійовані.
        </p>
      ),
      open: (n: number) => `${n} відкрито`,
      link: "Дії Agent Control",
    },
    receipts: {
      title: "Квитанції",
      info: (
        <p>
          Квитанція існує лише після <b>авторитетно спостереженого результату</b> — і ні
          через що інше: не через очікування, не через відкриту дію, не через план, який
          каже, чим це має скінчитися. Паперова й жива книги — окремі, з окремими
          повноваженнями, і їх ніколи не додають: симульований результат плюс реальний — це
          число, що не описує нічого, що сталося.
        </p>
      ),
    },
    activity: {
      title: "Активність",
      info: (
        <p>
          Один типізований індекс усього, що Home може спостерігати: виявлена зміна,
          відкритий кейс, записане рішення, виконана дія, спостережений результат, видана
          квитанція, написаний перегляд, деградоване джерело. Кожна подія походить із
          запису, який уже існує, тож ніщо тут не може стверджувати те, чого не сталося.
        </p>
      ),
    },
    sources: {
      title: "Джерела та права на дані",
      info: (
        <p>
          Кожне джерело несе право доступу, під яким його читали, а джерело, що відмовило,
          показано словами самого провайдера. Відмова, сформульована як збій, спонукає
          читача повторювати те, що знову відмовить із тієї самої причини.
        </p>
      ),
    },
  },
} as const satisfies Record<WorkspaceLocale, DecisionsCopy>;

export async function generateMetadata(): Promise<Metadata> {
  const { lang } = await cabinetUiCopy();
  return { title: COPY[lang].meta.title, robots: { index: false, follow: false } };
}

/**
 * Ryntra Home — Decisions, the AdviceCase queue and the exact-action index.
 *
 * Today answers *what needs me now*; Portfolio answers *what do I hold*;
 * Research answers *what changed*. This answers **what did I decide, on what
 * evidence, and what happened next** — the half of the loop the product could
 * describe and could not show.
 *
 * `/app/action-cases` is its own path, and the planned-route register set the
 * contract before the route existed: project the ActionCases that already
 * exist rather than creating a second action source. Agent Control's own cases
 * live in one browser tab's `sessionStorage`, so they are named and linked
 * here, never restated.
 *
 * **Nothing on this page is a Ryntra recommendation.** Before a provider-led
 * advice gate exists the case carries facts, alternatives including doing
 * nothing, and the reader's own recorded decision. `adviceAuthority` is a
 * constant `NONE` in the model and a test refuses any other value.
 */
export default async function ActionCasesPage() {
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
            <Link className={styles.link} href="/app/action-cases">{copy.readFailed.reload} <ArrowRight size={13} weight="bold" aria-hidden /></Link>
            <Link className={styles.link} href="/app/connect">{copy.readFailed.connections} <ArrowRight size={13} weight="bold" aria-hidden /></Link>
          </div>
        </Section>
      </div>
    );
  }

  return (
    <div className={styles.surface} data-surface-state={projection.state}>
      <header className={styles.head}>
        <div>
          <p className={styles.eyebrow}>Ryntra Home</p>
          <h1>{copy.heading}</h1>
        </div>
        <div className={styles.headMeta}>
          <StateChip tone={surfaceTone(projection.state)} label={projection.state} />
          <Link className={styles.link} href="/app/research">{copy.header.research} <ArrowRight size={13} weight="bold" aria-hidden /></Link>
          <Link className={styles.link} href="/app/journal">{copy.header.journal} <ArrowRight size={13} weight="bold" aria-hidden /></Link>
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
        id="queue"
        title={copy.queue.title}
        icon={SectionIcons.queue}
        info={copy.queue.info}
        aside={<StateChip tone={projection.counts.queue > 0 ? "caution" : "good"} label={`${projection.counts.queue}`} />}
      >
        <CaseList
          cases={projection.queue}
          empty={
            projection.counts.cases === 0
              ? copy.queue.emptyNoScope
              : copy.queue.emptyAllDecided
          }
        />
        <div className={styles.facts}>
          <ContextBinding ownerRef={ownerRef} serverReason={DECISIONS_CONTEXT_REASON} />
          <div className={styles.fact}>
            <span className={styles.factKey}>{copy.queue.adviceAuthority}</span>
            <span className={styles.factValue}>NONE</span>
          </div>
          <div className={styles.fact}>
            <span className={styles.factKey}>{copy.queue.cases}</span>
            <span className={styles.factValue}>{projection.counts.cases}</span>
          </div>
        </div>
      </Section>

      <Section
        id="actions"
        title={copy.actions.title}
        icon={SectionIcons.actions}
        info={copy.actions.info}
        aside={<StateChip tone="quiet" label={copy.actions.open(projection.counts.openActions)} />}
      >
        <ActionList actions={projection.actions} />
        <div className={styles.actions}>
          <Link className={styles.link} href="/agents/workspace/actions">{copy.actions.link} <ArrowRight size={13} weight="bold" aria-hidden /></Link>
        </div>
      </Section>

      <Section
        id="receipts"
        title={copy.receipts.title}
        icon={SectionIcons.receipts}
        info={copy.receipts.info}
        aside={<StateChip tone="quiet" label={`${projection.counts.receipts}`} />}
      >
        <Receipts index={projection.receipts} />
      </Section>

      <Section
        id="activity"
        title={copy.activity.title}
        icon={SectionIcons.activity}
        info={copy.activity.info}
      >
        <Activity events={projection.activity.events} />
      </Section>

      <Section
        id="sources"
        title={copy.sources.title}
        icon={SectionIcons.sources}
        info={copy.sources.info}
      >
        <Sources sources={projection.sources} />
      </Section>
    </div>
  );
}
