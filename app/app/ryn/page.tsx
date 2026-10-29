import { PageTitle } from "@/app/app/page-title";
import { solanaServerLocale } from "@/app/solana/workspace/i18n/server";
import { parseContextParam } from "@/lib/agent/context";

import { CreditsMeter } from "./credits-meter";
import { RynSurface } from "./ryn-surface";
import { rynWordsFor } from "./ryn-words";
import styles from "./ryn.module.css";

export const dynamic = "force-dynamic";
/* The assistant is Ryntra wherever a person reads; the route id stays internal. */
/* The tab says the page's own name: «Ryntra assistant · Ryntra» (the audit's pair 20, UX-976), not a second name for
   the one assistant. Found by the live-word guard on the page. */
export const metadata = { title: "Ryntra assistant" };

/**
 * The assistant Ryntra on its own page — reached from the menu, the header's
 * panel («На всю сторінку»), an asset, a plan, Portfolio and a monitoring
 * note, each carrying its context in `?context=` — `asset:<mint>[:<symbol>]`,
 * `plan:<id>`, `portfolio`, `note:<id>`, `page:<name>` — and, optionally, a
 * first question in `?q=`. The proof of the wallet is asked for on the page,
 * not at arrival.
 *
 * AI-06b: the heading with its explanation behind
 * «?», the credits as one large figure beside it with «Поповнити», then one
 * conversation in the middle of the page; the morning brief and the credits'
 * prices, history and purchases are tabs beside it, not a stack of folds.
 */
export default async function RynPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const locale = await solanaServerLocale();
  const params = await searchParams;
  const word = rynWordsFor(locale);
  const context = parseContextParam(typeof params.context === "string" ? params.context : null);
  const question = typeof params.q === "string" && params.q.trim().length > 0 ? params.q.trim().slice(0, 2000) : null;
  /* AI-10: a brief's note and its Telegram button land here with the brief's tab open. */
  const briefDay = typeof params.brief === "string" && params.brief.length > 0 ? params.brief.slice(0, 16) : null;
  /* AI-05: a watch's note and its Telegram button land here with «Стежу» open and the watch in view. */
  const watchId = typeof params.watch === "string" && /^(wch_[0-9a-f]{24}|all)$/.test(params.watch) ? params.watch : null;
  /* AI-19: a task's note lands on its conversation — every run's answer (`?task=<id>`). */
  const taskId = typeof params.task === "string" && /^t_[0-9a-f]{12}$/.test(params.task) ? params.task : null;
  return (
    <section className={styles.page} aria-labelledby="ryn-title">
      <header className={styles.head}>
        <div className={styles.title}>
          <PageTitle id="ryn-title" title={word("title")} help={<p>{word("lead")}</p>} lang={locale === "uk" ? "uk" : "en"} />
        </div>
        <CreditsMeter locale={locale} />
      </header>
      <RynSurface locale={locale} context={context} initialQuestion={question} briefDay={briefDay} watchId={watchId} taskId={taskId} />
    </section>
  );
}
