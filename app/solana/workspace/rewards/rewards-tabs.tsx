"use client";

import Link from "next/link";

import { useSolanaI18n } from "../i18n/provider.tsx";
import { leagueCopy } from "./league-copy.ts";
import styles from "./leagues.module.css";

/**
 * The Rewards section's own three places: what you earned, the week's
 * boards, the season. Links, not a state: each has its own address a person
 * can share or come back to.
 */
export type RewardsPlace = "overview" | "boards" | "season";

const PLACES: readonly { id: RewardsPlace; href: string }[] = [
  { id: "overview", href: "/app/rewards" },
  { id: "boards", href: "/app/rewards/leaderboard" },
  { id: "season", href: "/app/rewards/season" },
];

export function RewardsTabs({ current }: { current: RewardsPlace }) {
  const { locale } = useSolanaI18n();
  const words = leagueCopy(locale).tabs;
  return (
    <nav className={styles.tabs} aria-label={words.label}>
      {PLACES.map((place) => (
        <Link key={place.id} className={styles.tab} href={place.href} aria-current={place.id === current ? "page" : undefined}>
          {place.id === "overview" ? words.overview : place.id === "boards" ? words.boards : words.season}
        </Link>
      ))}
    </nav>
  );
}
