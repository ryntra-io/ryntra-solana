"use client";

import { ArrowSquareOut, Coins, Gift, Handshake, Medal, UserPlus, UsersThree } from "@phosphor-icons/react";
import { useEffect, useState, type ReactNode } from "react";

import type { PaidAs, ProgrammeFacts } from "@/lib/rewards/programme-facts";
import { isPhoneUserAgent } from "@/lib/solana/open-in-wallet";

import { useSolanaConnection } from "../connection.tsx";
import { useSolanaI18n } from "../i18n/provider.tsx";
import { programmeCopy } from "./programme-copy.ts";
import styles from "./rewards.module.css";

/**
 * Ріст 19: what Rewards pays, for somebody who has not signed in (UX-750, UX-752).
 *
 * One card in the page's column: each programme as a figure — the share, from the rules in force — a few words of
 * what it is a share of, and the mark of how it is paid: in USDC, counted until partner payouts open, or status with
 * no cash value. Under it, the page's one action: the wallet the person has (`gate`), or, on a desk with no wallet
 * in the browser, the way to get one. Nothing here is a balance; nothing is read for a wallet.
 */

/** How a programme is paid, one mark for every place it is said. */
export function PaidAsChip({ paidAs }: { paidAs: PaidAs }) {
  const { locale } = useSolanaI18n();
  return <span className={styles.paidAs} data-paid={paidAs.toLowerCase()}>{programmeCopy(locale).paidAs[paidAs]}</span>;
}

type Row = Readonly<{ id: string; icon: ReactNode; name: string; figure: string | null; what: string | null; paidAs: PaidAs }>;

function rowsOf(facts: ProgrammeFacts, words: ReturnType<typeof programmeCopy>): readonly Row[] {
  const size = 18;
  const range = facts.friends.from === facts.friends.to ? `${facts.friends.to}%` : `${facts.friends.from}–${facts.friends.to}%`;
  return [
    ...(facts.firstTen
      ? [{ id: "first-ten", icon: <Gift size={size} weight="bold" aria-hidden="true" />, name: words.firstTen(facts.firstTen.capUsd), figure: `${facts.firstTen.percent}%`, what: words.firstTenWhat, paidAs: "USDC" as const }]
      : []),
    { id: "cashback", icon: <Coins size={size} weight="bold" aria-hidden="true" />, name: words.cashback, figure: `${facts.cashbackPercent}%`, what: words.cashbackWhat, paidAs: "USDC" },
    { id: "friends", icon: <UserPlus size={size} weight="bold" aria-hidden="true" />, name: words.friends, figure: range, what: words.friendsWhat(facts.friends.from !== facts.friends.to), paidAs: "USDC" },
    { id: "their-friends", icon: <UsersThree size={size} weight="bold" aria-hidden="true" />, name: words.theirFriends, figure: `${facts.theirFriendsPercent}%`, what: words.theirFriendsWhat, paidAs: "USDC" },
    { id: "partners", icon: <Handshake size={size} weight="bold" aria-hidden="true" />, name: words.partners, figure: `${facts.partnerPercent}%`, what: words.partnersWhat, paidAs: facts.partnerPaidAs },
    { id: "status", icon: <Medal size={size} weight="bold" aria-hidden="true" />, name: words.status, figure: null, what: null, paidAs: "STATUS" },
  ];
}

/** The conditions the rows leave out — every one from the same facts — for the one disclosure under them. */
function conditionsOf(facts: ProgrammeFacts, words: ReturnType<typeof programmeCopy>): readonly string[] {
  const cap = facts.firstTen?.capUsd ?? null;
  return [
    ...(facts.firstTen ? [words.terms.firstTen(facts.firstTen.capUsd, facts.firstTen.days, facts.firstTen.walletsPerMonth)] : []),
    ...[words.terms.friends(facts.friendWindow, cap)].filter((line): line is string => line !== null),
    ...(cap !== null ? [words.terms.theirFriends(cap)] : []),
    ...(facts.partnerThen ? [words.terms.partners(facts.partnerPercent, facts.partnerThen)] : []),
  ];
}

export function ProgrammeCard({ facts, gate, children }: {
  facts: ProgrammeFacts | null;
  /** The page's one action: the wallet gate or the sign-in. */
  gate: ReactNode;
  /** Quiet, under the action: «Have a code or link?». */
  children?: ReactNode;
}) {
  const { locale } = useSolanaI18n();
  const words = programmeCopy(locale);
  const { wallets } = useSolanaConnection();
  /* A desk browser with no wallet gets the one way on; a phone is sent into the wallet app by the gate itself. */
  const [phone, setPhone] = useState(true);
  /* Wallets announce themselves after the page starts: the way to get one shows only once they had their moment. */
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    setPhone(isPhoneUserAgent(window.navigator.userAgent));
    const timer = window.setTimeout(() => setSettled(true), 1_500);
    return () => window.clearTimeout(timer);
  }, []);
  const noWallet = settled && wallets.length === 0 && !phone;

  return (
    <section className={`${styles.panel} ${styles.programme}`} id="rewards-programme" aria-labelledby="rewards-programme-title">
      {facts ? (
        <>
          <h2 className={styles.eyebrow} id="rewards-programme-title">{words.title}</h2>
          {facts.started ? null : <p className={styles.notice}>{words.notStarted}</p>}
          <ul className={styles.programmeRows}>
            {rowsOf(facts, words).map((row) => (
              <li key={row.id} className={styles.programmeRow} data-row={row.id}>
                <span className={styles.glyph}>{row.icon}</span>
                <span className={styles.programmeText}>
                  <span className={styles.programmeName}>
                    {row.name}
                    <PaidAsChip paidAs={row.paidAs} />
                  </span>
                  {row.what ? <span className={styles.programmeWhat}>{row.what}</span> : null}
                </span>
                {row.figure ? <strong className={styles.programmeFigure} translate="no">{row.figure}</strong> : null}
              </li>
            ))}
          </ul>
          {conditionsOf(facts, words).length > 0 ? (
            <details className={styles.programmeTerms}>
              <summary>{words.conditions}</summary>
              <ul>
                {conditionsOf(facts, words).map((line) => <li key={line}>{line}</li>)}
              </ul>
            </details>
          ) : null}
        </>
      ) : (
        <h2 className={styles.srOnly} id="rewards-programme-title">{words.title}</h2>
      )}
      <div className={styles.programmeAction}>
        {gate}
        {noWallet ? (
          <a className={styles.footAction} href="https://phantom.com/download" target="_blank" rel="noopener noreferrer">
            {words.getWallet}
            <ArrowSquareOut size={16} weight="bold" aria-hidden="true" />
          </a>
        ) : null}
      </div>
      {children ? <div className={styles.programmeCode}>{children}</div> : null}
    </section>
  );
}
