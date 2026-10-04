import { AskRynLens } from "@/app/app/lens/ask-ryn-lens";
import { LensPanel } from "@/app/app/lens/lens-panel";
import { PortfolioTabs } from "@/app/app/portfolio/portfolio-tabs";
import { solanaServerLocale } from "@/app/solana/workspace/i18n/server";

import { planWordsFor } from "../strategies/plans/plan-words";
import styles from "../strategies/my-strategies.module.css";
import { ResultsPanel } from "./results-panel";
import { RESULT_WORDS } from "./results-words";

export const dynamic = "force-dynamic";
export const metadata = { title: "Results" };

/**
 * Results — plan against outcome.
 *
 * Results owns **Plan vs Actual, the execution outcome, costs, no-trade
 * outcomes and Strategy Memory**, and all five are real: every operation
 * made under a plan as an entry or an exit, what the plan's own executions
 * add up to, an exit judged only against rules that existed before it, the
 * plans that made no trade with the rule that refused them, and a memory of
 * facts that each cite the record they stand on. The *Being built* chip is
 * gone with them — the page no longer promises anything it does not draw.
 */
export default async function ResultsPage() {
  const locale = await solanaServerLocale();
  const word = planWordsFor(locale);
  return (
    <section className={styles.page} aria-labelledby="results-title">
      {/* Results is Portfolio's: its tabs, this one current. */}
      <PortfolioTabs locale={locale} />
      <header className={styles.head}>
        <div className={styles.title}>
          <div className={styles.titleRow}>
            <h1 id="results-title">{word("results")}</h1>
          </div>
          <p className={styles.lead}>{RESULT_WORDS.lead[locale]}</p>
        </div>
        <div className={styles.actions}>
          <AskRynLens subject={{ kind: "page", page: "results" }} locale={locale} />
        </div>
      </header>
      {/* The Brief over the wallet's own record, and the Critic on request — the memory of what was decided is what it argues from; closed until *Ask Ryn* is pressed. */}
      <LensPanel subject={{ kind: "page", page: "results" }} locale={locale} trigger="page" />
      <ResultsPanel locale={locale} />
    </section>
  );
}
