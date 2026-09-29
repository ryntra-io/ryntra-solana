"use client";

import { AutoinvestBlock } from "@/app/app/invest/autoinvest-block";
import { investWords } from "@/app/app/invest/invest-words";
import styles from "@/app/app/invest/invest.module.css";
import { useWalletReach } from "@/app/app/invest/use-wallet-reach";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { useSolanaConnection } from "@/app/solana/workspace/connection";

/**
 * «Автоінвест» — its own row of the menu, under «Інвестувати» (canon v5.4
 * В30), and the same block Home and Portfolio draw (§4.1, В29): the month's
 * budget as its own line, the rules with their switches, «Додати правило».
 * One block in three places, one truth: nothing here is a second store.
 *
 * A guest reads what «Автоінвест» is in one line and has one way in — the
 * wallet — which is the page's one orange action.
 */
export function AutoinvestPlace({ locale }: { locale: WorkspaceLocale }) {
  const word = investWords(locale);
  const { connection } = useSolanaConnection();
  const { openInWallet, reach } = useWalletReach();
  return (
    <div className={styles.page}>
      <header className={styles.placeHead}>
        <h1 className={styles.heroTitle}>{word("autoinvest")}</h1>
        <p className={styles.heroLine}>{word("autoinvestPromise")}</p>
      </header>
      {connection ? (
        <AutoinvestBlock locale={locale} heading={false} />
      ) : (
        <section className={styles.hero} aria-label={word("autoinvest")}>
          <p className={styles.heroLead}>{word("noRulesYet")}</p>
          <div className={styles.actions}>
            <button type="button" className="rw-btn rw-btn--primary" onClick={reach}>
              {openInWallet ? word("openInPhantom") : word("connectWallet")}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
