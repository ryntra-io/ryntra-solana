import { Plus } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";

import { PortfolioTabs } from "@/app/app/portfolio/portfolio-tabs";
import { AskRyn } from "@/app/app/ryn/ask-ryn";
import { solanaServerLocale } from "@/app/solana/workspace/i18n/server";

import styles from "./my-strategies.module.css";
import { planWordsFor } from "./plans/plan-words";
import { PlansPanel } from "./plans/plans-panel";

export const dynamic = "force-dynamic";
export const metadata = { title: "My strategies" };

/**
 * My strategies.
 *
 * One page for the plans a wallet has written: each on the version it stands
 * on, with the size those rules make and where it is in its life. A plan is
 * private to the wallet that wrote it — the same proof Spot and Rewards ask
 * for — so the list is drawn only behind that proof. The head carries the
 * one primary action, *Create plan*, which opens the builder on a stock
 * picker: the plan starts here, the person is not sent to the catalogue and
 * back (the UX audit of 2026-09-16).
 *
 * **What stood here before.** Until the Trading Plan, the page read the
 * Strategy Lab's records back as a list of titles and versions (`read.ts`,
 * `tiles.tsx`, `[id]/` are the lab's read model and stay where they are for
 * the lab's own pages). The Trading Plan is the product's plan; the list
 * below is the plan store's, not the lab's.
 *
 * **This page owns the strategy types (since 2026-09-11).** The six types
 * that are not built yet — DCA, Grid, Free Capital / Treasury, Rebalancing,
 * Liquidity, Spend & Invest — stay registered in `STRATEGY_TYPES`, the one
 * source, and are drawn nowhere: since 2026-09-23 what is not built stays off
 * every customer screen, so the folded *Other strategy types · planned · 6*
 * line left this page. The person's own plans are the page.
 */
export default async function MyStrategiesPage() {
  const locale = await solanaServerLocale();
  const word = planWordsFor(locale);

  return (
    <section className={styles.page} aria-labelledby="my-strategies-title">
      {/* The plans are Portfolio's, a tap deeper: its tabs, this one current. */}
      <PortfolioTabs locale={locale} />
      <header className={styles.head}>
        <div className={styles.title}>
          <h1 id="my-strategies-title">{word("myStrategies")}</h1>
          <p className={styles.lead}>{word("summaryLead")}</p>
        </div>
        <div className={styles.actions}>
          <AskRyn context={{ kind: "page", page: "strategies" }} locale={locale} />
          <Link className="rw-btn" href="/app/alerts" prefetch={false}>
            <span>{word("monitoring")}</span>
          </Link>
          <Link className="rw-btn rw-btn--primary" href="/app/strategies/new" prefetch={false}>
            <Plus size={16} weight="bold" aria-hidden="true" />
            <span>{word("createPlan")}</span>
          </Link>
        </div>
      </header>

      <PlansPanel locale={locale} />

      {/* The prediction plans left with the demo: their panel stays in `app/app/predictions/prediction-plans-panel`. */}
    </section>
  );
}
