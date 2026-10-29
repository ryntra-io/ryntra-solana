"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

import { useSolanaI18n } from "../i18n/provider.tsx";
import { leagueCopy } from "./league-copy.ts";
import styles from "./leagues.module.css";

/**
 * The Rewards section's own places: what you earned, the week's boards, the
 * season, and creator partners. Links, not a state: each has its own address
 * a person can share or come back to.
 */
export type RewardsPlace = "overview" | "boards" | "season" | "partners";

const PLACES: readonly { id: RewardsPlace; href: string }[] = [
  { id: "overview", href: "/app/rewards" },
  { id: "boards", href: "/app/rewards/leaderboard" },
  { id: "season", href: "/app/rewards/season" },
  { id: "partners", href: "/app/rewards/partners" },
];

export function RewardsTabs({ current }: { current: RewardsPlace }) {
  const { locale } = useSolanaI18n();
  const words = leagueCopy(locale).tabs;
  const nav = useRef<HTMLElement>(null);
  /* On a narrow screen the row scrolls: the place a person is on is always shown whole. */
  useEffect(() => {
    const show = () => {
      const row = nav.current;
      const here = row?.querySelector<HTMLElement>('[aria-current="page"]');
      if (!row || !here) return;
      const past = here.getBoundingClientRect().right - row.getBoundingClientRect().right;
      if (past > 0) row.scrollLeft += past + 4;
    };
    show();
    /* Widths settle once the typeface has loaded. */
    void document.fonts?.ready.then(show);
  }, [current]);
  return (
    <nav ref={nav} className={styles.tabs} aria-label={words.label}>
      {PLACES.map((place) => (
        <Link key={place.id} className={styles.tab} href={place.href} aria-current={place.id === current ? "page" : undefined}>
          {words[place.id]}
        </Link>
      ))}
    </nav>
  );
}
