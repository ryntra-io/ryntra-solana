"use client";

/**
 * Send, Receive and Rewards, side by side — on a phone, and only there.
 *
 * Two rules of the canon meet here and they pull in opposite directions.
 * §3.3 says the phone bar's **Money** opens Send *and* Receive; §3.2 says a rail
 * entry is never duplicated by an identical horizontal menu on every screen.
 * Both are satisfied by the same fact: below 900px the rail is not on the
 * screen at all — it is behind the bar's fifth item — so this switcher is the
 * only way to cross between the two, and above 900px it would be a second copy
 * of two rows a person can already see, which is exactly what §3.2 forbids.
 *
 * So it is one control with one job, hidden by width rather than by prop. What
 * it replaced was `MoneyJobs`, which drew Send, Receive **and Bridge** over
 * every money page at every width — three tabs above a form, duplicating the
 * rail on the desktop and naming a page that no longer exists.
 */

import Link from "next/link";

import { useSolanaI18n } from "../i18n/provider.tsx";
import styles from "./money.module.css";

export type MoneyJob = "send" | "receive" | "rewards";

const JOBS: readonly Readonly<{ id: MoneyJob; label: string; href: string }>[] = [
  { id: "send", label: "Send", href: "/app/send" },
  { id: "receive", label: "Receive", href: "/app/receive" },
  { id: "rewards", label: "Rewards", href: "/app/rewards" },
];

export function MoneyTabs({ current }: { current: MoneyJob }) {
  const { text } = useSolanaI18n();
  return (
    <nav className={styles.tabs} aria-label={text("Money")}>
      {JOBS.map((job) => (
        <Link
          key={job.id}
          className={styles.tab}
          href={job.href}
          data-current={job.id === current ? "true" : "false"}
          aria-current={job.id === current ? "page" : undefined}
        >
          {text(job.label)}
        </Link>
      ))}
    </nav>
  );
}
