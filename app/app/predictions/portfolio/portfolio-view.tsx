"use client";

import Link from "next/link";

import type { WorkspaceLocale } from "@/app/shell/locale";

import { AccountCard } from "../account-card";
import { FundingCard } from "../funding-card";
import { LiveCard } from "../live-card";
import { NotificationsCard } from "../notifications-card";
import { PredictionPlansPanel } from "../prediction-plans-panel";
import styles from "../predictions.module.css";
import { SettlementCard } from "../settlement-card";
import { SimulationLine } from "../simulation-line";
import { WatchCard } from "../watch-card";
import { usePredictionsPaths } from "../surface";
import { useLive } from "../use-live";
import { usePaperAccount } from "../use-paper-account";
import { useWatch } from "../use-watch";
import { useSettlement } from "../use-settlement";
import { wordsFor } from "../words";

/** The money of the account, the real-money part where it is open, settlement and the notes, the paper account in full, and the plans under it — where the compact account card of the hub and of a market leads. */
export function PortfolioView({ locale }: { locale: WorkspaceLocale }) {
  const word = wordsFor(locale);
  const account = usePaperAccount();
  const paths = usePredictionsPaths();
  const linkedWallet = account.state.status === "ready" && account.state.account.link.state === "active" ? account.state.account.wallet : null;
  const { live, refresh: refreshLive } = useLive(linkedWallet, linkedWallet !== null);
  const { settlement, busy: collecting, collect } = useSettlement(linkedWallet, linkedWallet !== null);
  const walletHere = account.state.account?.wallet ?? null;
  const { watch, busy: watchBusy, checking, pause, remove, stopAll, markRead, checkNow } = useWatch(walletHere, walletHere !== null);
  return (
    <section className={styles.page} aria-labelledby="predict-portfolio-title">
      <p className={styles.crumbs}>
        <Link href={paths.hub} prefetch={false}>
          {word("title")}
        </Link>
      </p>
      <header className={styles.head}>
        <div className={styles.headTitle}>
          <h1 id="predict-portfolio-title">{word("portfolioTitle")}</h1>
          <p className={styles.tagline}>{word("portfolioTagline")}</p>
          <SimulationLine locale={locale} />
        </div>
      </header>
      {/* The money form stands as the core's action column in the middle; the account and the plans under it are an overview. */}
      <div id="money" className={styles.moneyColumn}>
        {/* Keyed by the account's wallet: a switch or a sign-out starts the money card over, with nothing of the wallet before. */}
        <FundingCard key={account.state.account?.wallet ?? "none"} account={account} locale={locale} />
      </div>
      <LiveCard key={linkedWallet ?? "none"} live={live} refresh={refreshLive} locale={locale} />
      {/* Settlement and the notes stand above the account: what is coming matters more than what already stands. */}
      <SettlementCard key={`settle:${linkedWallet ?? "none"}`} settlement={settlement} busy={collecting} collect={collect} locale={locale} />
      {/* What the watches found stands above the channels: the signal first, the settings for it after. */}
      <WatchCard key={`watch:${walletHere ?? "none"}`} watch={watch} busy={watchBusy} checking={checking} locale={locale} controls={{ pause, remove, stopAll, markRead, checkNow }} />
      <NotificationsCard key={`notify:${linkedWallet ?? "none"}`} wallet={linkedWallet} locale={locale} after={settlement?.readAt ?? null} />
      <AccountCard account={account} locale={locale} />
      <div id="plans">
        <PredictionPlansPanel locale={locale} account={account} />
      </div>
    </section>
  );
}
