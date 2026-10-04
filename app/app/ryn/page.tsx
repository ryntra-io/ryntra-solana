import { solanaServerLocale } from "@/app/solana/workspace/i18n/server";
import { parseContextParam } from "@/lib/agent/context";

import { RynSurface } from "./ryn-surface";
import { rynWordsFor } from "./ryn-words";
import styles from "./ryn.module.css";

export const dynamic = "force-dynamic";
/* The assistant is Ryntra wherever a person reads; the route id stays internal. */
export const metadata = { title: "AI assistant" };

/**
 * Ryn — the product's one agent, text-first. Not a menu entry (agent
 * decisions belong to My strategies): the page is reached from an asset, a plan, Portfolio,
 * My strategies and a monitoring note, each carrying its context in
 * `?context=` — `asset:<mint>[:<symbol>]`, `plan:<id>`, `portfolio`,
 * `note:<id>`, `page:<name>` — and, optionally, a first question in `?q=`.
 * The proof of the wallet is asked for on the page, not at arrival.
 */
export default async function RynPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const locale = await solanaServerLocale();
  const params = await searchParams;
  const word = rynWordsFor(locale);
  const context = parseContextParam(typeof params.context === "string" ? params.context : null);
  const question = typeof params.q === "string" && params.q.trim().length > 0 ? params.q.trim().slice(0, 2000) : null;
  const badge =
    context === null
      ? word("contextNone")
      : context.kind === "asset"
        ? `${word("contextAsset")} ${context.symbol ?? `${context.mint.slice(0, 4)}…${context.mint.slice(-4)}`}`
        : context.kind === "plan"
          ? word("contextPlan")
          : context.kind === "portfolio"
            ? word("contextPortfolio")
            : context.kind === "note"
              ? word("contextNote")
              : `${word("contextPage")} ${context.page}`;
  return (
    <section className={styles.page} aria-labelledby="ryn-title">
      <header className={styles.head}>
        <div className={styles.title}>
          <h1 id="ryn-title">{word("title")}</h1>
          <span className={styles.context}>{badge}</span>
          <p className={styles.lead}>{word("lead")}</p>
        </div>
      </header>
      <RynSurface locale={locale} context={context} initialQuestion={question} />
    </section>
  );
}
