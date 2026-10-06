import { ArrowRight, NotePencil, Repeat } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";

import { solanaServerLocale } from "@/app/solana/workspace/i18n/server";

import { botsWords } from "../bots-words";
import styles from "../bots.module.css";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const locale = await solanaServerLocale();
  return { title: botsWords(locale)("catalog") };
}

/**
 * «Боти → Каталог»: what can be set up today. Since «Меню 1»
 * — «Регулярна купівля» on a company's page (for any token with liquidity once
 * «Регулярна купівля для всього» is live) and the trade plan. Every other bot
 * arrives here when it is on production — never before (rule 10).
 */
export default async function BotsCatalogPage() {
  const locale = await solanaServerLocale();
  const word = botsWords(locale);
  return (
    <section className={styles.page} aria-labelledby="catalog-title">
      <header className={styles.head}>
        <div className={styles.title}>
          <h1 id="catalog-title">{word("catalog")}</h1>
          <p className={styles.lead}>{word("catalogLead")}</p>
        </div>
      </header>
      <ul className={styles.catalog}>
        <li className={styles.bot} data-bot="recurring">
          <span className={styles.botIcon} aria-hidden="true">
            <Repeat size={20} weight="bold" />
          </span>
          <div className={styles.botBody}>
            <h2 className={styles.botName}>{word("recurring")}</h2>
            <p className={styles.botLine}>{word("recurringWhat")}</p>
            <p className={styles.botNote}>{word("recurringHow")}</p>
            <p className={styles.botScope}>{word("recurringFor")}</p>
          </div>
          <div className={styles.botActions}>
            <Link className="rw-btn rw-btn--primary" href="/app/markets?tab=stocks" prefetch={false}>
              <span>{word("pickCompany")}</span>
              <ArrowRight size={16} weight="bold" aria-hidden="true" />
            </Link>
            <Link className="rw-btn" href="/app/bots" prefetch={false}>
              {word("myRules")}
            </Link>
          </div>
        </li>
        <li className={styles.bot} data-bot="plan">
          <span className={styles.botIcon} aria-hidden="true">
            <NotePencil size={20} weight="bold" />
          </span>
          <div className={styles.botBody}>
            <h2 className={styles.botName}>{word("planName")}</h2>
            <p className={styles.botLine}>{word("planWhat")}</p>
          </div>
          <div className={styles.botActions}>
            <Link className="rw-btn" href="/app/strategies/new" prefetch={false}>
              <span>{word("createPlan")}</span>
              <ArrowRight size={16} weight="bold" aria-hidden="true" />
            </Link>
          </div>
        </li>
      </ul>
    </section>
  );
}
