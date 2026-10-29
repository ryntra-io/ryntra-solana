import { notFound } from "next/navigation";

import { MoneyTabs } from "../money/money-tabs.tsx";
import { solanaServerText } from "../i18n/server.ts";
import { leagueCopy } from "./league-copy.ts";
import { LeaderboardView } from "./leaderboard-view.tsx";
import { RewardsTabs } from "./rewards-tabs.tsx";
import { SeasonView } from "./season-view.tsx";
import styles from "./rewards.module.css";

/**
 * The two pages beside Rewards — the week's boards and the season — thin on
 * the server like Rewards itself: the title, the Money tabs, the section's
 * own tabs, and a client view that reads its own data. The routes under
 * `app/app/rewards/` re-export these.
 */

export async function leaderboardMetadata() {
  const { locale } = await solanaServerText();
  return { title: leagueCopy(locale).boardsTitle };
}

export async function LeaderboardPage() {
  const { locale } = await solanaServerText();
  return (
    /* The title, the tabs and the page in one column in the middle (Ріст 19). */
    <div className={styles.frameWide}>
      <header className="so-head">
        <h1 className="so-title">{leagueCopy(locale).boardsTitle}</h1>
      </header>
      <MoneyTabs current="rewards" />
      <RewardsTabs current="boards" />
      <LeaderboardView />
    </div>
  );
}

/** `season` from the address: a positive whole number, or the season now. */
function seasonFrom(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  if (!/^[1-9][0-9]{0,3}$/.test(raw)) notFound();
  return Number(raw);
}

export async function seasonMetadata({ params }: { params?: Promise<{ season?: string }> } = {}) {
  const { locale } = await solanaServerText();
  const raw = (await params)?.season;
  const words = leagueCopy(locale);
  return { title: raw && /^[1-9][0-9]{0,3}$/.test(raw) ? words.seasonTitle(Number(raw)) : words.tabs.season };
}

export async function SeasonPage({ params }: { params?: Promise<{ season?: string }> } = {}) {
  const { locale } = await solanaServerText();
  const season = seasonFrom((await params)?.season);
  const words = leagueCopy(locale);
  return (
    /* The title, the tabs and the page in one column in the middle (Ріст 19). */
    <div className={styles.frameWide}>
      <header className="so-head">
        <h1 className="so-title">{season ? words.seasonTitle(season) : words.tabs.season}</h1>
      </header>
      <MoneyTabs current="rewards" />
      <RewardsTabs current="season" />
      <SeasonView season={season} />
    </div>
  );
}
