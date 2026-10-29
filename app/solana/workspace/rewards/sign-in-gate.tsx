"use client";

import type { ReactNode } from "react";

import { useSolanaI18n } from "../i18n/provider.tsx";
import styles from "./sign-in-gate.module.css";
import type { useRewardsWallet } from "./use-rewards-wallet.tsx";
import { walletCopy, type WalletCopy } from "./wallet-copy.ts";

/**
 * What a Rewards page shows a connected wallet that has not signed in yet: one line, the sign-in, one quiet line —
 * centred in the page's column, the way SOL-C1 set the cabinet. Only a wallet that has to sign in sees the button;
 * while the sign-in is being checked, the same place says so quietly with nothing to press. Framed on its own;
 * `inside` drops the frame for a panel that has one.
 */
export function SignInGate({ wallet, lead, inside = false, children }: {
  wallet: ReturnType<typeof useRewardsWallet>;
  lead: keyof WalletCopy["lead"];
  inside?: boolean;
  /** Drawn above the line in the same frame: the invitation a new arrival followed a link for. */
  children?: ReactNode;
}) {
  const { locale } = useSolanaI18n();
  const words = walletCopy(locale);
  return (
    <section className={styles.gate} data-inside={inside ? "true" : "false"} aria-live="polite">
      {children}
      {wallet.gate !== "signin" ? (
        /* «Checking», or proven and the page's own read still on its way: nothing to press. */
        <p className={styles.quiet}>{words.checking}</p>
      ) : (
        <div className={styles.ask}>
          <p className={styles.lead}>{words.lead[lead]}</p>
          <button type="button" className={styles.button} onClick={() => void wallet.signIn()} disabled={wallet.signing}>
            {wallet.signing ? words.signing : words.signIn}
          </button>
          {wallet.failure ? <p className={styles.failure} role="alert">{wallet.failure}</p> : <p className={styles.quiet}>{words.once}</p>}
        </div>
      )}
    </section>
  );
}
