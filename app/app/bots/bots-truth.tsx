import { HonestStateChip } from "@/app/shell/honest-state-chip";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { BOTS_AUTHORITY_IDS, type BotsAuthorityId } from "@/lib/core/authority-ids";
import type { AuthorityView } from "@/lib/core/authority-matrix";
import { AUTHORITY_HEAD_WORDS, ENFORCEMENT_WORDS } from "@/lib/core/authority-words";

import { botsWords, type BOTS_WORDS } from "./bots-words";
import styles from "./bots.module.css";

export type BotsAuthority = Readonly<Record<BotsAuthorityId, AuthorityView>>;

type BotsWord = keyof typeof BOTS_WORDS;

/** Each bot's name and its two lines: what it does with no one present, and what waits for the person's signature. */
const LINES: Readonly<Record<BotsAuthorityId, Readonly<{ name: BotsWord; alone: BotsWord; you: BotsWord }>>> = {
  "meteora-dlmm.grid": { name: "grid", alone: "gridAlone", you: "gridYou" },
  "ryntra.recurring-buy": { name: "recurring", alone: "recurringAlone", you: "recurringYou" },
  "ryntra.trade-plan": { name: "planName", alone: "planAlone", you: "planYou" },
};

/**
 * «Що бот робить сам» (EXE-1; spec §0.3 п. 3, §6.1, §13.4): for every bot on «Боти», its honest state as a word, what
 * it does by itself, what waits for the person and who holds its bound — read from the authority matrix on the server
 * (`lib/core/authority-matrix.ts`). The lead says no bot is automatic for as long as the matrix has none.
 */
export function BotsTruth({ locale, authority }: { locale: WorkspaceLocale; authority: BotsAuthority }) {
  const word = botsWords(locale);
  const head = (key: keyof typeof AUTHORITY_HEAD_WORDS) => AUTHORITY_HEAD_WORDS[key][locale];
  const automatic = BOTS_AUTHORITY_IDS.some((id) => authority[id].automatic);
  return (
    <section className={styles.block} aria-labelledby="bots-truth" data-bots-truth>
      <h2 id="bots-truth" className={styles.blockTitle}>{word("truthTitle")}</h2>
      <p className={styles.truthLead}>{word(automatic ? "truthLeadSome" : "truthLeadNone")}</p>
      <ul className={styles.truth}>
        {BOTS_AUTHORITY_IDS.map((id) => {
          const view = authority[id];
          const line = LINES[id];
          return (
            <li key={id} className={styles.truthRow} data-authority={id} data-mode={view.mode} data-enforcement={view.enforcement}>
              <div className={styles.truthName}>
                <span>{word(line.name)}</span>
                <HonestStateChip state={view.state} locale={locale} />
              </div>
              <p className={styles.truthCell}>
                <span className={styles.truthHead}>{head("alone")}</span>
                {word(line.alone)}
              </p>
              <p className={styles.truthCell}>
                <span className={styles.truthHead}>{head("you")}</span>
                {word(line.you)}
              </p>
              <p className={styles.truthCell}>
                <span className={styles.truthHead}>{head("bound")}</span>
                {ENFORCEMENT_WORDS[view.enforcement][locale]}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
