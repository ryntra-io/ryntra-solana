import { Plus } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";

import { PlansPanel } from "@/app/app/strategies/plans/plans-panel";
import { solanaServerLocale } from "@/app/solana/workspace/i18n/server";

import { botsWords } from "./bots-words";
import styles from "./bots.module.css";
import { MyRecurring } from "./my-recurring";
import { MyResults } from "./my-results";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const locale = await solanaServerLocale();
  return { title: botsWords(locale)("mine") };
}

/**
 * «Боти → Мої боти»: one place for everything that runs on
 * a person's rule — the recurring-buy rules (Ryntra reminds, the person signs
 * each buy) and the trade plans, each plan's result on its own card, then
 * the results across the plans and the memory they leave. The old
 * addresses of «Автоінвест», «Мої стратегії» and «Результати» lead here; a
 * plan is still written in the builder and read on its own page, as before.
 */
export default async function MyBotsPage() {
  const locale = await solanaServerLocale();
  const word = botsWords(locale);
  return (
    <section className={styles.page} aria-labelledby="bots-title">
      <header className={styles.head}>
        <div className={styles.title}>
          <h1 id="bots-title">{word("mine")}</h1>
          <p className={styles.lead}>{word("mineLead")}</p>
        </div>
        <div className={styles.actions}>
          <Link className="rw-btn" href="/app/alerts" prefetch={false}>
            <span>{word("reminders")}</span>
          </Link>
          <Link className="rw-btn rw-btn--primary" href="/app/strategies/new" prefetch={false}>
            <Plus size={16} weight="bold" aria-hidden="true" />
            <span>{word("createPlan")}</span>
          </Link>
        </div>
      </header>

      <section className={styles.block} aria-labelledby="bots-recurring">
        <h2 id="bots-recurring" className={styles.blockTitle}>{word("recurring")}</h2>
        <MyRecurring locale={locale} />
      </section>

      <section className={styles.block} aria-labelledby="bots-plans">
        <div className={styles.blockHead}>
          <h2 id="bots-plans" className={styles.blockTitle}>{word("plans")}</h2>
          <p className={styles.blockNote}>{word("plansLead")}</p>
        </div>
        <PlansPanel locale={locale} />
      </section>

      <MyResults locale={locale} />
    </section>
  );
}
