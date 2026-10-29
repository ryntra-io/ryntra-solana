"use client";

import { Coins, Plus } from "@phosphor-icons/react";
import { useEffect, useMemo } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import { useSolanaConnection } from "@/app/solana/workspace/connection";
import { ConnectWalletButton } from "@/app/solana/workspace/wallet-gate";
import { useWalletProof } from "@/app/solana/workspace/wallet-proof";

import { askTopUp, creditNumber, creditsWord, loadCredits, questionsOf, questionsWord, useCredits } from "./credits-store";
import styles from "./ryn.module.css";
import { rynWordsFor } from "./ryn-words";

const fill = (template: string, values: Readonly<Record<string, string | number>>) => template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ""));

/**
 * The balance at the top of the assistant's page: the credits as one large figure, what they come to in questions with the model, the day's free
 * questions as ten small steps, and «Поповнити», which opens the «Кредити» tab at its packages. Without a proven
 * wallet the same place says where credits come from and offers the wallet. Credits are the service's units —
 * never money and never a token, so they live here and on the header's button, not in Portfolio.
 */
export function CreditsMeter({ locale }: { locale: WorkspaceLocale }) {
  const word = useMemo(() => rynWordsFor(locale), [locale]);
  const { connection } = useSolanaConnection();
  const proof = useWalletProof();
  const address = connection?.address ?? null;
  const proven = proof.state.status === "proven" && proof.state.address === address;
  const credits = useCredits(proven ? address : null);

  /* The conversation's session brings the figures; if it did not within a few seconds (it failed), they are read here. */
  useEffect(() => {
    if (!proven || !address || credits !== undefined) return undefined;
    const timer = window.setTimeout(() => loadCredits(address), 4_000);
    return () => window.clearTimeout(timer);
  }, [proven, address, credits]);

  /* A proof read from the cookie while the wallet reconnects: not a guest — the box waits, no flash of «Підключити». */
  const reconnecting = !address && proof.state.status === "proven";
  if (!reconnecting && (!address || (!proven && proof.state.status !== "checking" && proof.state.status !== "idle"))) {
    /* A guest, or a wallet connected but not yet confirmed: where credits come from, and the one step to them. */
    return (
      <aside className={styles.meter} data-state="guest" aria-label={word("tabCredits")}>
        <span className={styles.meterIcon} aria-hidden="true">
          <Coins size={20} weight="duotone" />
        </span>
        <div className={styles.meterBody}>
          <p className={styles.meterGuestTitle}>{word("meterGuestTitle")}</p>
          <p className={styles.meterLine}>{word("meterGuestLine")}</p>
          {proof.state.status === "signing" ? <p className={styles.meterLine}>{word("confirmInWallet")}</p> : null}
          {proof.state.status === "refused" || proof.state.status === "failed" ? <p className={styles.meterLine} role="alert">{proof.state.reason}</p> : null}
        </div>
        {address ? (
          <button type="button" className={`rw-btn ${styles.meterAction}`} onClick={() => void proof.prove()} disabled={proof.state.status === "signing"}>
            {proof.state.status === "signing" ? word("confirming") : word("confirmWallet")}
          </button>
        ) : (
          /* B14 (UX-705): the header's own wallet panel, not a fold; secondary — «Спитати» is the page's orange action. */
          <ConnectWalletButton className={styles.meterAction} variant="secondary" />
        )}
      </aside>
    );
  }

  if (credits === null) return null;
  if (credits === undefined) {
    /* The figures are on their way (or credits are off on this deployment): the same box, no jump when they come. */
    return <aside className={styles.meter} data-state="loading" aria-busy="true" aria-label={word("tabCredits")} />;
  }

  const questions = questionsOf(credits);
  const daily = credits.prices.question > 0 ? Math.floor(credits.free.daily / credits.prices.question) : 0;
  const resets = new Date(credits.free.resetsAt).toLocaleTimeString(locale === "uk" ? "uk-UA" : "en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
  return (
    <aside className={styles.meter} data-state="ready" aria-label={word("tabCredits")}>
      <div className={styles.meterFigure}>
        <p className={styles.meterBalance}>
          <span className={styles.meterNumber}>{creditNumber(credits.balance, locale)}</span>
          <span className={styles.meterUnit}>{creditsWord(credits.balance, locale)}</span>
        </p>
        <p className={styles.meterLine}>
          {questions.balance > 0 ? fill(word("meterQuestions"), { n: creditNumber(questions.balance, locale), q: questionsWord(questions.balance, locale) }) : word("meterEmpty")}
        </p>
      </div>
      <div className={styles.meterFree}>
        <p className={styles.meterLine}>
          {questions.free > 0
            ? fill(word("meterFree"), { n: questions.free, q: questionsWord(questions.free, locale) })
            : credits.free.left > 0
              ? fill(word("meterFreeCredits"), { n: credits.free.left, unit: creditsWord(credits.free.left, locale) })
              : fill(word("meterFreeSpent"), { time: resets })}
        </p>
        {daily > 0 && daily <= 40 ? (
          <span className={styles.meterSteps} role="img" aria-label={fill(word("meterFreeOf"), { n: questions.free, daily })}>
            {Array.from({ length: daily }, (_, index) => (
              <span key={index} data-on={index < questions.free} />
            ))}
          </span>
        ) : null}
      </div>
      <button type="button" className={`rw-btn rw-btn--primary ${styles.meterAction}`} onClick={() => askTopUp()}>
        <Plus size={14} weight="bold" aria-hidden="true" />
        <span>{word("topUp")}</span>
      </button>
    </aside>
  );
}
