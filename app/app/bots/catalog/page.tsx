import { ArrowRight, GridFour, NotePencil, Repeat } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";

import { PageTitle } from "@/app/app/page-title";
import { HonestStateChip } from "@/app/shell/honest-state-chip";
import { solanaServerLocale } from "@/app/solana/workspace/i18n/server";
import { BOTS_AUTHORITY_IDS, authorityViews, type BotsAuthorityId } from "@/lib/core/authority-matrix";
import { STRATEGY_TYPES, type StrategyTypeId } from "@/lib/product/strategy-types";

import { botsWords, type BOTS_WORDS } from "../bots-words";
import styles from "../bots.module.css";
import { RecurringStart } from "../recurring-start";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const locale = await solanaServerLocale();
  return { title: botsWords(locale)("catalog") };
}

type BotsWord = keyof typeof BOTS_WORDS;

/**
 * What a live type shows beside the library's words: its mark, its button, where it has one the second path, and its
 * row of the authority matrix — its honest state as a word (EXE-1); what it does by itself is the library's `runs` line,
 * and in full on «Боти».
 */
const CARD: Readonly<Partial<Record<StrategyTypeId, Readonly<{ icon: typeof Repeat; action: BotsWord; scope?: BotsWord; mine?: BotsWord; authority: BotsAuthorityId }>>>> = {
  grid: { icon: GridFour, action: "gridPick", authority: "meteora-dlmm.grid" },
  dca: { icon: Repeat, action: "pickToken", scope: "recurringFor", mine: "myRules", authority: "ryntra.recurring-buy" },
  "trading-plan": { icon: NotePencil, action: "createPlan", authority: "ryntra.trade-plan" },
};

/**
 * «Боти → Каталог» (Menu 3, NAV-1; B10): the strategy library (`lib/product/strategy-types.ts`) as it stands on
 * Solana — every type that is live, with what it is, how it runs and where it is set up: the grid on DLMM, the
 * recurring buy and the trade plan. A type that is not live is drawn nowhere — never before it is on production
 * (rule 10). The recurring buy's «Обрати токен» is the same picker «Боти» opens, straight to the rule's sheet
 * (SOL-C15, UX-701); no card glows at rest — three equal choices, none of them the page's one orange action (UX-715).
 * Each card says its honest state, from the authority matrix (EXE-1).
 */
export default async function BotsCatalogPage() {
  const locale = await solanaServerLocale();
  const word = botsWords(locale);
  const live = STRATEGY_TYPES.filter((type) => type.readiness === "available" && type.setup && CARD[type.id]);
  const authority = authorityViews(BOTS_AUTHORITY_IDS);
  return (
    <section className={styles.page} aria-labelledby="catalog-title">
      <header className={styles.head}>
        <div className={styles.title}>
          <PageTitle id="catalog-title" title={word("catalog")} help={word("catalogLead")} lang={locale} />
        </div>
      </header>
      <ul className={styles.catalog}>
        {live.map((type) => {
          const card = CARD[type.id]!;
          const Icon = card.icon;
          return (
            <li key={type.id} className={styles.bot} data-bot={type.id} data-authority={card.authority}>
              <div className={styles.botInner}>
                <span className={styles.botIcon} aria-hidden="true">
                  <Icon size={20} weight="bold" />
                </span>
                <div className={styles.botBody}>
                  <div className={styles.botNameRow}>
                    <h2 className={styles.botName}>{type.name[locale]}</h2>
                    <HonestStateChip state={authority[card.authority].state} locale={locale} />
                  </div>
                  <p className={styles.botLine}>{type.blurb[locale]}</p>
                  {type.runs ? <p className={styles.botNote}>{type.runs[locale]}</p> : null}
                  {card.scope ? <p className={styles.botScope}>{word(card.scope)}</p> : null}
                </div>
                <div className={styles.botActions}>
                  {type.id === "dca" ? (
                    <RecurringStart locale={locale} className="rw-btn" />
                  ) : (
                    <Link className="rw-btn" href={type.setup!} prefetch={false}>
                      <span>{word(card.action)}</span>
                      <ArrowRight size={16} weight="bold" aria-hidden="true" />
                    </Link>
                  )}
                  {card.mine ? (
                    <Link className="rw-btn" href="/app/bots" prefetch={false}>
                      {word(card.mine)}
                    </Link>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
