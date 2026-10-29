"use client";

import { ArrowRight, Plus } from "@phosphor-icons/react";
import Link from "next/link";

import { NAV_WORDS } from "@ryntra/core/nav";

import { PageTitle } from "@/app/app/page-title";
import { RyntraPlansInBots } from "@/app/app/ryn/ryntra-plans";
import { PlansPanel } from "@/app/app/strategies/plans/plans-panel";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { useSolanaConnection } from "@/app/solana/workspace/connection";
import { WalletGate } from "@/app/solana/workspace/wallet-gate";
import { useWalletProof } from "@/app/solana/workspace/wallet-proof";

import { BotsTruth, type BotsAuthority } from "./bots-truth";
import { botsWords } from "./bots-words";
import styles from "./bots.module.css";
import { MyGrids } from "./my-grids";
import { MyRecurring } from "./my-recurring";
import { MyResults } from "./my-results";
import { RecurringStartButton, useRecurringStart } from "./recurring-start";

/**
 * «Автоматика → Боти» — the terminal's «Правила» (B16): everything that runs on a person's rule, and the one home of a
 * trade plan (SOL-C15, UX-704: the assistant, a token's page and the builder all lead back here). With a wallet: the
 * grids on DLMM (B10) with each grid's result and «Зупинити», the recurring-buy rules, the trade plans with each
 * plan's result, the results across them. A wallet not yet confirmed reads one sentence and one «Підтвердити
 * гаманець» for the rules and the plans together (UX-709). A guest meets the three paths it offers, each with an
 * example, and one button: the wallet, as everywhere. «Обрати токен» opens the token picker and then the rule's own
 * sheet — the same one press from «Каталог» (UX-701). Every page says what a recurring buy is: Ryntra reminds, the
 * person signs each buy, and where the reminder arrives (UX-700). Under the head, «Що бот робить сам» (EXE-1): each
 * bot's honest state from the authority matrix, what it does alone and what waits for a signature.
 */
export function BotsView({ locale, authority }: { locale: WorkspaceLocale; authority: BotsAuthority }) {
  const word = botsWords(locale);
  const { connection } = useSolanaConnection();
  const proof = useWalletProof();
  const address = connection?.address ?? null;
  const proven = proof.state.status === "proven" && proof.state.address === address;
  /* Until the wallet answers whether it is confirmed, the page draws the blocks as before — their own skeletons wait. */
  /* The rule's sheet outlives the guest's cards: a guest who connects for it finds it again over the wallet's blocks. */
  const recurring = useRecurringStart(locale);
  const unconfirmed = address !== null && proof.state.status !== "idle" && proof.state.status !== "checking" && proof.state.status !== "proven";
  return (
    <section className={styles.page} aria-labelledby="bots-title">
      <header className={styles.head}>
        <div className={styles.title}>
          <PageTitle id="bots-title" title={NAV_WORDS[locale].items.bots} help={word("mineLead")} lang={locale} />
        </div>
        <div className={styles.actions}>
          {/* The catalogue stands under «Боти»: no tab above the page leads there any more (Menu 3, NAV-1). */}
          <Link className="rw-btn" href="/app/bots/catalog" prefetch={false}>
            <span>{word("catalog")}</span>
          </Link>
          {connection ? (
            <>
              <Link className="rw-btn" href="/app/alerts" prefetch={false}>
                <span>{word("reminders")}</span>
              </Link>
              <Link className={`rw-btn${proven ? " rw-btn--primary" : ""}`} href="/app/strategies/new" prefetch={false}>
                <Plus size={16} weight="bold" aria-hidden="true" />
                <span>{word("createPlan")}</span>
              </Link>
            </>
          ) : null}
        </div>
      </header>

      <BotsTruth locale={locale} authority={authority} />

      {connection ? (
        <>
          <MyGrids locale={locale} />

          {unconfirmed ? (
            /* UX-709: the rules and the plans read behind the same proof — one sentence, one button, not two gates. */
            <section className={styles.block} aria-labelledby="bots-confirm">
              <div className={styles.guest} data-bots-confirm>
                <p id="bots-confirm" className={styles.guestLine}>{word("confirmAll")}</p>
                <button type="button" className="rw-btn rw-btn--primary" onClick={() => void proof.prove()} disabled={proof.state.status === "signing"}>
                  {proof.state.status === "signing" ? word("confirming") : word("confirmWallet")}
                </button>
                {"reason" in proof.state && proof.state.reason ? <p className={styles.guestError}>{proof.state.reason}</p> : null}
              </div>
              <RemindersWhere locale={locale} />
            </section>
          ) : (
            <>
              <section className={styles.block} aria-labelledby="bots-recurring">
                <h2 id="bots-recurring" className={styles.blockTitle}>{word("recurring")}</h2>
                <MyRecurring locale={locale} />
                <RemindersWhere locale={locale} />
              </section>

              <section className={styles.block} aria-labelledby="bots-plans">
                <div className={styles.blockHead}>
                  <h2 id="bots-plans" className={styles.blockTitle}>{word("plans")}</h2>
                </div>
                {/* AI-20: the plans composed with Ryntra beside the person's own (UX-704); a new wallet reads its own. */}
                <RyntraPlansInBots key={address ?? "none"} locale={locale} active={proven} />
                <PlansPanel locale={locale} />
              </section>

              <MyResults locale={locale} />
            </>
          )}
        </>
      ) : (
        <>
          <div className={styles.paths} data-bots-guest>
            <article className={styles.path} aria-labelledby="bots-path-grid">
              <h2 id="bots-path-grid" className={styles.pathLabel}>{word("grid")}</h2>
              <p className={styles.pathExample}>{word("gridExample")}</p>
              <p className={styles.pathLine}>{word("gridHow")}</p>
              <Link className={styles.pathLink} href="/app/bots/grid" prefetch={false}>
                {word("gridPick")}
                <ArrowRight size={14} weight="bold" aria-hidden="true" />
              </Link>
            </article>
            <article className={styles.path} aria-labelledby="bots-path-recurring">
              <h2 id="bots-path-recurring" className={styles.pathLabel}>{word("recurring")}</h2>
              <p className={styles.pathExample}>{word("recurringExample")}</p>
              <p className={styles.pathLine}>{word("recurringHow")}</p>
              <RecurringStartButton locale={locale} className={styles.pathLink} onOpen={recurring.open} />
            </article>
            <article className={styles.path} aria-labelledby="bots-path-plan">
              <h2 id="bots-path-plan" className={styles.pathLabel}>{word("planName")}</h2>
              <p className={styles.pathExample}>{word("planExample")}</p>
              <p className={styles.pathLine}>{word("planWhat")}</p>
              <Link className={styles.pathLink} href="/app/strategies/new" prefetch={false}>
                {word("createPlan")}
                <ArrowRight size={14} weight="bold" aria-hidden="true" />
              </Link>
            </article>
          </div>
          <WalletGate title={word("guestGate")} />
          <RemindersWhere locale={locale} />
        </>
      )}
      {recurring.sheets}
    </section>
  );
}

/** UX-700: where a rule's reminder arrives — «Сповіщення», and Telegram once it is connected on «Акаунт». */
function RemindersWhere({ locale }: { locale: WorkspaceLocale }) {
  const word = botsWords(locale);
  return (
    <p className={styles.where} data-reminders-where>
      {word("remindersWhere")}{" "}
      <Link href="/app/settings#account" prefetch={false}>
        {word("connectTelegram")}
      </Link>
    </p>
  );
}
