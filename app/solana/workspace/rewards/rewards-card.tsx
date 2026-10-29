"use client";

import { ArrowRight, CaretDown, Check, Coins, Copy, ShareNetwork, UserPlus, UsersThree, Wallet } from "@phosphor-icons/react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { dollars } from "@/lib/rewards/format";
import type { ProgrammeFacts } from "@/lib/rewards/programme-facts";
import { REWARD_RANKS, REWARD_RULES_CURRENT } from "@/lib/rewards/rules";
import { useSolanaI18n } from "../i18n/provider.tsx";
import { WalletGate } from "../wallet-gate.tsx";
import { rankCopy } from "./rank-copy.ts";
import { BadgesCard, type AchievementsSummary } from "./badges-card.tsx";
import { REWARDS_CHANGED_EVENT } from "./header-rewards.tsx";
import { PaidAsChip, ProgrammeCard } from "./programme-card.tsx";
import { programmeCopy } from "./programme-copy.ts";
import { RankCard, type RankSummary } from "./rank-card.tsx";
import { ReferralCard, useReferral } from "./referral-card.tsx";
import { referralCopy } from "./referral-copy.ts";
import { SeasonCard } from "./season-card.tsx";
import { SignInGate } from "./sign-in-gate.tsx";
import { useRewardsWallet } from "./use-rewards-wallet.tsx";
import styles from "./rewards.module.css";

/**
 * Rewards, for the wallet that is connected and has proved itself.
 *
 * ## One card (Ріст 19)
 *
 * The audit of 21.10 (UX-753) counted ≈45 figures and the friend's share in four forms. Now the page is one column
 * at the core's action width: one card — what is ready to claim, what was earned, what waits and why, the claim and
 * where it came from — and «Details» under it for the invitation, the rank, badges, the season, the history and the
 * rules. A guest, or a wallet not signed in yet, sees what the programme pays instead (`ProgrammeCard`, UX-750):
 * every share from the rules in force, each marked paid in USDC, counted, or status only (UX-752).
 *
 * ## Nothing here explains the machinery
 *
 * No mechanism names, no operation references, no treasury address, no
 * valuation basis, no internal state words. The rules live behind one
 * disclosure per programme, which is where technical text belongs on a
 * customer surface. What a person cannot do, they are told in one sentence
 * beside the control that is disabled — never by hiding the control.
 *
 * ## The wallet once (Ріст 18)
 *
 * The proof is the sign-in the person already made, remembered for the
 * session (`useRewardsWallet`): a wallet signed in here opens the page at
 * once, even before the browser's wallet reconnects; a connected wallet that
 * never signed in sees the one sign-in — the header's own — under what the
 * programme pays; no page here asks the wallet to confirm itself again. The
 * invitation a new arrival followed a link for leads the column.
 */
type Row = Readonly<{ kind: string; display: string; amount: string; valued: boolean; detail: string | null; at: string }>;

type Summary = Readonly<{
  address: string;
  available: string;
  pending: string;
  lifetime: string;
  cashback: string;
  referralL1: string;
  referralL2: string;
  claimable: boolean;
  claimBlockedReason: string | null;
  /** Why money is pending: still being priced, or waiting on the reserve. */
  pendingReasons?: readonly string[];
  referrals: Readonly<{ level1: number; level2: number }>;
  rows: readonly Row[];
  referral: Readonly<{ code: string; link: string }> | null;
  claim: Readonly<{ state: string; text: string; signature: string | null }> | null;
  started: boolean;
  invitedBy: string | null;
  /** The rank over the last 30 days, or null when it could not be read. */
  rank?: RankSummary | null;
  /** The ranks reached and the achievements held, or null when they could not be read. */
  achievements?: AchievementsSummary | null;
  sourceAmounts?: Readonly<Record<"CASHBACK" | "REFERRAL_L1" | "REFERRAL_L2", string>>;
  /** Rules 2.1.0 as this wallet meets them; absent before they are in force. */
  programme?: Programme;
}>;

type Programme = Readonly<{
  claimMinimum: string;
  claimMinimumWithAccount: string;
  claimMinimumWithoutAccount: string;
  firstTenOffer: Readonly<{ cap: string; days: number; walletsPerMonth: number }>;
  firstTen: Readonly<{ state: "OPEN" | "CLOSED"; check: "PENDING" | "PASSED" | "FAILED"; returned: string; cap: string; held: string; endsAt: string }> | null;
  inviterWindow: Readonly<{ share: number; days: number }>;
}>;

/** A whole-dollar figure without its cents: «$10», not «$10.00». */
function wholeDollars(text: string): string {
  return dollars(text.replace(/\.00$/, ""));
}

/**
 * «First $10 back» for the wallet that holds it: how much of the cap came back, a bar of it, and one line under —
 * until when, what still waits for the check, or that it ended. Nothing else; the rule is in «How rewards work».
 */
function FirstTenStrip({ firstTen, intl, words }: { firstTen: NonNullable<Programme["firstTen"]>; intl: string; words: ReturnType<typeof rankCopy> }) {
  const cap = wholeDollars(firstTen.cap);
  const returned = usdNumber(firstTen.returned);
  const percent = Math.max(0, Math.min(100, Math.round((returned / Math.max(usdNumber(firstTen.cap), 0.01)) * 100)));
  const full = returned >= usdNumber(firstTen.cap);
  const held = usdNumber(firstTen.held) > 0;
  const until = new Intl.DateTimeFormat(intl, { day: "numeric", month: "short" }).format(new Date(firstTen.endsAt));
  const refused = firstTen.check === "FAILED";
  const note = refused
    ? words.firstTenFailed
    : held && firstTen.check === "PENDING"
      ? words.firstTenCheck(dollars(firstTen.held))
      : full ? words.firstTenFull(cap)
      : firstTen.state === "OPEN" ? words.firstTenUntil(until) : words.firstTenEnded;
  return (
    <div className={styles.firstTen} data-state={refused ? "refused" : firstTen.state === "OPEN" ? "open" : "closed"}>
      <div className={styles.firstTenHead}>
        <span className={styles.eyebrow}>{words.firstTenTitle(cap)}</span>
        {refused ? null : <span className={styles.firstTenFigure} translate="no">{words.firstTenProgress(wholeDollars(firstTen.returned), cap)}</span>}
      </div>
      {refused ? null : (
        <div className={styles.firstTenBar} role="img" aria-label={words.firstTenProgress(wholeDollars(firstTen.returned), cap)}>
          <span className={styles.firstTenFill} style={{ width: `${percent}%` }} />
        </div>
      )}
      <p className={styles.firstTenNote}>{note}</p>
    </div>
  );
}

/* The referral rows by the words a person uses — «From friends», never «Referral L1». */
function kindLabel(kind: string, text: (value: string) => string, words: ReturnType<typeof rankCopy>): string {
  return kind === "REFERRAL_L1" ? words.fromFriends
    : kind === "REFERRAL_L2" ? words.fromTheirFriends
    : kind === "CASHBACK" ? text("Cashback")
    : kind === "CLAIM" ? text("Claimed")
    : kind;
}

/** A page figure back to a number, for proportions only — `<0.01` counts as a cent. */
function usdNumber(figure: string): number {
  const value = Number(figure.replace(/[<,\s]/g, ""));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** The second line of a row: what the reward was for, and the fee asset when it is known. */
function rowDetail(row: Row, text: (value: string) => string): string {
  const what =
    row.kind === "CLAIM" ? text("To your wallet")
    : row.kind === "CASHBACK" ? text("Your trade")
    : row.kind === "REFERRAL_L1" ? text("A trade by someone you invited")
    : text("A trade by someone they invited");
  return row.detail ? `${what} · ${row.detail}` : what;
}

function Glyph({ kind }: { kind: string }) {
  const size = 16;
  const icon =
    kind === "CASHBACK" ? <Coins size={size} weight="bold" aria-hidden="true" />
    : kind === "REFERRAL_L1" ? <UserPlus size={size} weight="bold" aria-hidden="true" />
    : kind === "REFERRAL_L2" ? <UsersThree size={size} weight="bold" aria-hidden="true" />
    : <Wallet size={size} weight="bold" aria-hidden="true" />;
  return <span className={styles.glyph} data-kind={kind}>{icon}</span>;
}

/** The inviter's share from Bronze to Diamond under the current rules — the range said when nothing else is known. */
const RANK_SHARES = (() => {
  const shares = REWARD_RANKS.map((rank) => REWARD_RULES_CURRENT.referralL1BpsByRank[rank] / 100);
  return { from: Math.min(...shares), to: Math.max(...shares) };
})();

/** Rewards shown before «Show all»: the newest, enough to see that they come in. */
const HISTORY_FOLDED = 4;

export function RewardsCard({ programme = null }: { programme?: ProgrammeFacts | null }) {
  const { text, locale } = useSolanaI18n();
  const words = rankCopy(locale);
  const honest = programmeCopy(locale);
  const wallet = useRewardsWallet();
  const { refused, served } = wallet;
  const address = wallet.address;
  const intl = locale === "uk" ? "uk-UA" : "en-US";

  const key = `${address ?? ""}:${locale}`;
  const currentKey = useRef(key);
  currentKey.current = key;
  const [snapshot, setSnapshot] = useState<{ key: string; data: Summary } | null>(null);
  const proven = wallet.open;
  const summary = snapshot?.key === key && snapshot.data.address === address && proven ? snapshot.data : null;
  const [error, setError] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<{ key: string; message: string } | null>(null);
  const [pendingWallets, setPendingWallets] = useState<ReadonlySet<string>>(new Set());
  const pending = useRef(new Set<string>());
  const busy = address !== null && pendingWallets.has(address);
  const [loading, setLoading] = useState(false);
  const inFlight = useRef<AbortController | null>(null);
  const [copied, setCopied] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  /* Recent rewards fold to the newest few, so the page does not run on to its foot with every cent. */
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyToggle = useRef<HTMLButtonElement>(null);
  /* Everything past the one card — the invitation, the rank, badges, the season, the history and the rules. */
  const [detailsOpen, setDetailsOpen] = useState(false);
  const openDetails = useCallback((id: string) => {
    setDetailsOpen(true);
    /* The section takes the focus, so a keyboard or a reader lands where the eye does. */
    requestAnimationFrame(() => {
      const target = document.getElementById(id);
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
      target?.focus({ preventScroll: true });
    });
  }, []);
  const inviteWords = referralCopy(locale);
  /* Read once for the whole page: an open invitation goes to the top, where
     somebody who followed a link sees it before anything else. */
  const referral = useReferral(address, proven, summary?.invitedBy ?? null);
  /* A carried code that just bound: the figures follow at once, even while «Details» (and the card that says so) is closed. */
  const boundNow = Boolean(referral.state?.bound);

  const load = useCallback(async (force = false) => {
    if (!address || !proven || currentKey.current !== key) return;
    if (!force && inFlight.current && !inFlight.current.signal.aborted) return;
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setLoading(true);
    try {
      let response = await fetch(`/api/rewards?address=${encodeURIComponent(address)}&locale=${locale}`, { signal: controller.signal });
      if (controller.signal.aborted || currentKey.current !== key) return;
      if (response.status === 401) {
        /* Not taken on its own word: the sign-in is asked again first, and a proof that still stands reads once more. */
        let verdict = await refused(address);
        if (controller.signal.aborted || currentKey.current !== key) return;
        if (verdict === "retry") {
          response = await fetch(`/api/rewards?address=${encodeURIComponent(address)}&locale=${locale}`, { signal: controller.signal });
          if (controller.signal.aborted || currentKey.current !== key) return;
          if (response.status === 401) verdict = await refused(address);
        }
        if (response.status === 401) {
          /* The sign-in is gone or refused twice: the gate follows. A sign-in that cannot be checked is «unavailable». */
          if (verdict !== "gone" && verdict !== "refused") throw new Error(text("Rewards could not be read right now."));
          setSnapshot(null);
          return;
        }
      }
      if (!response.ok) throw new Error(text("Rewards could not be read right now."));
      const data = await response.json() as Summary;
      if (controller.signal.aborted || currentKey.current !== key) return;
      if (data.address !== address) throw new Error(text("Rewards could not be read right now."));
      served(address);
      setSnapshot({ key, data });
      setError(null);
    } catch {
      if (controller.signal.aborted || currentKey.current !== key) return;
      setSnapshot(null);
      setError(text("Rewards could not be read right now."));
    } finally {
      if (inFlight.current === controller) inFlight.current = null;
      if (currentKey.current === key && !controller.signal.aborted) setLoading(false);
    }
  }, [address, locale, text, proven, key, refused, served]);

  useEffect(() => {
    if (boundNow && proven) void load(true);
  }, [boundNow, proven, load]);

  useEffect(() => {
    setError(null);
    if (proven) void load();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible" && proven) void load(); }, 20_000);
    return () => { window.clearInterval(timer); inFlight.current?.abort(); };
  }, [proven, load]);

  const prove = wallet.signIn;
  const running = summary?.claim?.state === "CLAIMING" || summary?.claim?.state === "SUBMITTED_UNKNOWN";
  useEffect(() => {
    if (!address || !proven || !running) return;
    const controller = new AbortController();
    let reading = false;
    const check = async () => {
      if (reading) return;
      reading = true;
      try {
        await fetch(`/api/rewards/claim?address=${encodeURIComponent(address)}`, { signal: controller.signal });
        if (!controller.signal.aborted && currentKey.current === key) await load();
      } catch { /* The unresolved state remains visible; this never starts a claim. */ }
      finally { reading = false; }
    };
    const timer = window.setInterval(() => void check(), 4_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [address, proven, running, key, load]);

  /* The header's «Винагороди» shows what is ready to claim: tell it when that changed here (a claim, a new reward). */
  const shownAvailable = summary?.available ?? null;
  useEffect(() => {
    if (shownAvailable !== null) window.dispatchEvent(new Event(REWARDS_CHANGED_EVENT));
  }, [shownAvailable]);

  const claim = useCallback(async () => {
    if (!address || !proven || !summary?.claimable || running || pending.current.has(address)) return;
    pending.current.add(address);
    setPendingWallets(new Set(pending.current));
    setClaimError(null);
    try {
      const response = await fetch("/api/rewards/claim", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address }) });
      if (currentKey.current !== key) return;
      if (!response.ok && response.status !== 202) setClaimError({ key, message: text("The payout could not be checked right now. Refresh its status before trying again.") });
      await load(true);
    } catch {
      if (currentKey.current === key) { setClaimError({ key, message: text("The payout could not be checked right now. Refresh its status before trying again.") }); await load(true); }
    } finally {
      pending.current.delete(address);
      setPendingWallets(new Set(pending.current));
    }
  }, [address, proven, summary?.claimable, running, key, text, load]);

  const copy = useCallback(async () => {
    if (!summary?.referral) return;
    try {
      await navigator.clipboard.writeText(summary.referral.link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      /* A browser that refuses the clipboard leaves the link on screen, which
         is selectable. Nothing is lost and nothing needs saying. */
    }
  }, [summary]);

  const copyCode = useCallback(async () => {
    if (!summary?.referral) return;
    try {
      await navigator.clipboard.writeText(summary.referral.code);
      setCodeCopied(true);
      window.setTimeout(() => setCodeCopied(false), 2_000);
    } catch {
      /* The code stays on screen and is selectable. */
    }
  }, [summary]);

  const share = useCallback(async () => {
    if (!summary?.referral) return;
    const data = { title: "Ryntra", url: summary.referral.link };
    if (typeof navigator.share === "function") {
      try {
        await navigator.share(data);
        return;
      } catch {
        /* Dismissed, which is not an error. */
      }
    }
    await copy();
  }, [summary, copy]);

  /* Where the money came from, as proportions of everything earned. */
  const sources = useMemo(() => {
    if (!summary) return { total: 0, parts: [] as readonly { kind: "cashback" | "l1" | "l2"; value: number }[] };
    const parts = [
      { kind: "cashback" as const, value: Number(summary.sourceAmounts?.CASHBACK ?? "0") / 1_000_000 },
      { kind: "l1" as const, value: Number(summary.sourceAmounts?.REFERRAL_L1 ?? "0") / 1_000_000 },
      { kind: "l2" as const, value: Number(summary.sourceAmounts?.REFERRAL_L2 ?? "0") / 1_000_000 },
    ];
    return { total: parts.reduce((sum, part) => sum + part.value, 0), parts };
  }, [summary]);

  /* An invitation somebody followed a link for leads the page, above everything. */
  const invitationOpen = Boolean(referral.state?.pending) && referral.state?.binding?.open !== false;
  if (wallet.gate === "connect" || !proven || !address) {
    /* A guest — no wallet, or one that has not signed in: what the programme pays, and the one way in (Ріст 19). */
    const invitation = (
      <ReferralCard key={address} wallet={address} invitedBy={null} proven={false} referral={referral} onProve={prove} onBound={() => void load()} />
    );
    return (
      <div className={styles.column}>
        {invitationOpen ? invitation : null}
        <ProgrammeCard
          facts={programme}
          gate={wallet.gate === "connect" ? <WalletGate title={honest.connect} /> : <SignInGate wallet={wallet} lead="overview" inside />}
        >
          {invitationOpen ? null : invitation}
        </ProgrammeCard>
      </div>
    );
  }
  if (!summary) return <div className={styles.column}><section className={styles.gateFrame} aria-live="polite">
    <p>{loading ? text("Loading your rewards…") : error ?? text("Rewards could not be read right now.")}</p>
    {!loading ? <button className={styles.claim} type="button" onClick={() => void load()}>{text("Try again")}</button> : null}
  </section></div>;
  const tone = summary.claim?.state === "PAID" ? "done" : summary.claim?.state === "FAILED" ? "warn" : running ? "live" : undefined;
  const pendingMoney = usdNumber(summary.pending) > 0;
  const reasons = summary.pendingReasons ?? [];
  const terms = summary.programme ?? null;
  /* Why money waits, in two words beside the figure — the reserve only when the claim note is not already saying it. */
  const waitingWhy = [
    ...(reasons.includes("AWAITING_VALUATION") ? [honest.waitingPriced] : []),
    ...(reasons.includes("AWAITING_RESERVE") && pendingMoney && !summary.claimBlockedReason ? [honest.waitingReserve] : []),
  ];
  const share_ = (value: number): string | null => (sources.total > 0 ? `${Math.round((value / sources.total) * 100)}%` : null);
  const sourceLabel = (kind: "cashback" | "l1" | "l2"): string =>
    kind === "cashback" ? text("Cashback") : kind === "l1" ? words.fromFriends : words.fromTheirFriends;
  /* The level-1 share follows the rank; without a rank only the range is
     true, so the range is what is shown rather than a guessed figure. */
  const friendShare = summary.rank ? `${summary.rank.friendShare}%` : programme ? `${programme.friends.from}–${programme.friends.to}%` : `${RANK_SHARES.from}–${RANK_SHARES.to}%`;
  const sourceFigure = (kind: "cashback" | "l1" | "l2"): string =>
    dollars(kind === "cashback" ? summary.cashback : kind === "l1" ? summary.referralL1 : summary.referralL2);
  /* A claim can go now, or nothing says it cannot: «Ready to claim». Otherwise the figure is only «Available». */
  const claimNow = summary.claimable || !summary.claimBlockedReason;
  const inviteUpTo = terms ? `${terms.inviterWindow.share}%` : programme ? `${Math.max(programme.friends.to, programme.friendWindow?.percent ?? 0)}%` : null;

  /* A carried invitation leads the page — one that did not bind on its own,
     or another inviter's link offered as the one change (the server returns it
     only while the change is possible). Too late, or settled with nothing new,
     it lives in the invite panel: an answer, not a call to act. */
  const invitationFirst = invitationOpen;
  const referralCard = (
    <ReferralCard
      key={address}
      wallet={address}
      invitedBy={summary.invitedBy}
      proven={proven}
      referral={referral}
      onProve={prove}
      onBound={() => void load()}
    />
  );

  return (
    <div className={styles.column}>
    {invitationFirst ? referralCard : null}
    {/* The one card (Ріст 19, UX-753): what is ready to claim, what was earned, what waits and why, the claim, and
        where it came from. Everything else is one «Details» below — never a second card of money. */}
    <section className={`${styles.panel} ${styles.earn}`} id="rewards-earnings" aria-label={claimNow ? honest.ready : honest.available}>
      {/* Before the owner sets the moment accrual begins, this page would
          otherwise imply that trading today earns cashback. It does not,
          and saying so is cheaper and more honest than hiding the page. */}
      {summary.started ? null : (
        <p className={styles.notice}>{text("Rewards have not started yet. Trades made before they do earn nothing.")}</p>
      )}
      <div className={styles.earnHead}>
        <span className={styles.eyebrow}>{claimNow ? honest.ready : honest.available}</span>
        {/* How the programme pays — not beside a claim that cannot go now, whose note says why. */}
        {claimNow ? <PaidAsChip paidAs="USDC" /> : null}
      </div>
      <strong className={styles.amount} translate="no">
        {dollars(summary.available)}
        <span className={styles.unit}>USDC</span>
      </strong>
      <dl className={styles.facts}>
        <div className={styles.fact}>
          <dt>{honest.earned}</dt>
          <dd translate="no">{dollars(summary.lifetime)}</dd>
        </div>
        <div className={styles.fact} data-tone={pendingMoney ? "pending" : undefined}>
          <dt>{honest.waiting}</dt>
          <dd translate="no">{dollars(summary.pending)}</dd>
          {pendingMoney && waitingWhy.length > 0 ? <dd className={styles.factWhy}>{waitingWhy.join(" · ")}</dd> : null}
        </div>
      </dl>
      {terms?.firstTen ? <FirstTenStrip firstTen={terms.firstTen} intl={intl} words={words} /> : null}

      <div className={styles.claimBlock}>
        <button
          type="button"
          className={styles.claim}
          onClick={() => void claim()}
          disabled={!summary.claimable || busy || running}
        >
          {text(busy ? "Sending…" : "Claim to wallet")}
        </button>
        {summary.claim && running ? (
          <p className={styles.claimNote} data-tone={tone}>{summary.claim.text}</p>
        ) : summary.claimBlockedReason ? (
          <p className={styles.claimNote}>{summary.claimBlockedReason}</p>
        ) : summary.claim?.state === "PAID" || summary.claim?.state === "FAILED" ? (
          <p className={styles.claimNote} data-tone={tone}>{summary.claim.text}</p>
        ) : null}
        {claimError?.key === key ? <p className={styles.error}>{claimError.message}</p> : null}
      </div>

      {sources.total > 0 ? (
        <div className={styles.sources} aria-label={text("Where your rewards came from")}>
          <span className={styles.eyebrow}>{text("Where it came from")}</span>
          <div className={styles.bar} role="img" aria-label={text("Where your rewards came from")}>
            {sources.parts.filter((part) => part.value > 0).map((part) => (
              /* Grow factors in whole thousandths: a lone `<$0.01` source with
                 `flex-grow: 0.01` fills a hundredth of the track, not all of it —
                 factors that sum below one leave the rest empty. Seen on
                 production with the operator's own first cashback. */
              <span key={part.kind} className={styles.slice} data-kind={part.kind} style={{ flexGrow: Math.max(1, Math.round((part.value / sources.total) * 1000)) }} title={`${sourceLabel(part.kind)} ${share_(part.value)}`} />
            ))}
          </div>
          <ul className={styles.sourceList}>
            {sources.parts.map((part) => (
              <li key={part.kind} className={styles.sourceRow}>
                <span className={styles.dot} data-kind={part.kind} aria-hidden="true" />
                <span className={styles.sourceText}>
                  <span className={styles.sourceLabel}>{sourceLabel(part.kind)}</span>
                </span>
                <span className={styles.sourceFigure} translate="no">
                  {sourceFigure(part.kind)}
                  {share_(part.value) ? <span>{share_(part.value)}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {error ? <p className={styles.error}>{error}</p> : null}

      <div className={styles.earnFoot}>
        <button type="button" className={styles.footAction} aria-controls="rewards-details" onClick={() => openDetails("rewards-invite")}>
          <UserPlus size={16} weight="bold" aria-hidden="true" />
          {honest.invite(inviteUpTo)}
        </button>
        <button type="button" className={styles.footAction} aria-expanded={detailsOpen} aria-controls="rewards-details" onClick={() => setDetailsOpen(!detailsOpen)}>
          {detailsOpen ? honest.detailsHide : honest.details}
          <CaretDown size={14} weight="bold" aria-hidden="true" data-open={detailsOpen || undefined} />
        </button>
      </div>
    </section>

    {/* Always in the document, so the two buttons above control something; hidden until asked. */}
    <div className={styles.details} id="rewards-details" hidden={!detailsOpen}>
      {detailsOpen ? (
      <>
        <section className={`${styles.panel} ${styles.invite}`} id="rewards-invite" aria-label={words.inviteTitle} tabIndex={-1}>
          <div className={styles.panelHead}>
            <h2 className={styles.title}>{words.inviteTitle}</h2>
            <div className={styles.chips}>
              <span className={styles.chip} data-tone="quiet">{terms ? words.levelOneWindowChip(terms.inviterWindow.share) : words.levelOneChip(friendShare)}</span>
              <span className={styles.chip} data-tone="quiet">{words.levelTwoChip(`${summary.rank?.secondLevelShare ?? REWARD_RULES_CURRENT.referralL2Bps / 100}%`)}</span>
              <PaidAsChip paidAs="USDC" />
            </div>
          </div>

          {summary.referral ? (
            <>
            <div className={styles.linkRow}>
              <input className={styles.link} readOnly value={summary.referral.link} aria-label={text("Your referral link")} onFocus={(event) => event.currentTarget.select()} />
              <div className={styles.linkActions}>
                <button type="button" className={styles.linkAction} data-done={copied ? "true" : "false"} onClick={() => void copy()}>
                  {copied ? <Check size={14} weight="bold" aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                  {text(copied ? "Copied" : "Copy link")}
                </button>
                <button type="button" className={styles.linkAction} onClick={() => void share()}>
                  <ShareNetwork size={14} aria-hidden="true" />
                  {text("Share")}
                </button>
              </div>
            </div>
            {/* The code on its own, for a friend who would rather type it
                than open a link: the field takes either. */}
            <div className={styles.codeRow}>
              <span className={styles.codeLabel}>{inviteWords.yourCode}</span>
              <button
                type="button"
                className={styles.codeChip}
                data-done={codeCopied ? "true" : "false"}
                onClick={() => void copyCode()}
                aria-label={`${inviteWords.copyCode}: ${summary.referral.code}`}
                title={inviteWords.copyCode}
              >
                <span translate="no">{summary.referral.code}</span>
                {codeCopied ? <Check size={14} weight="bold" aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
              </button>
              <span className={styles.codeDone} role="status">{codeCopied ? inviteWords.copied : ""}</span>
            </div>
            </>
          ) : null}

          <dl className={styles.tiles}>
            <div className={styles.tile}>
              <dt>{text("Friends")}</dt>
              <dd translate="no">{summary.referrals.level1}</dd>
            </div>
            <div className={styles.tile}>
              <dt>{text("Their friends")}</dt>
              <dd translate="no">{summary.referrals.level2}</dd>
            </div>
          </dl>

          {/* Who invited this wallet — offered or settled; an open
              invitation is drawn at the top of the page instead. */}
          {invitationFirst ? null : referralCard}
        </section>

        {/* The rank sets what a friend's trade pays, so it follows the invitation. */}
        <RankCard rank={summary.rank ?? null} inviterWindow={terms?.inviterWindow ?? null} firstTen={Boolean(terms?.firstTen)} />

        <BadgesCard wallet={address} rank={summary.rank?.rank ?? null} achievements={summary.achievements} />

        {/* The season and the week's boards: tasks and status, no money. */}
        <SeasonCard />

        <section className={`${styles.panel} ${styles.history}`} id="rewards-history" aria-label={text("Recent rewards")}>
          <div className={styles.panelHead}>
            <h2 className={styles.title}>{text("Recent rewards")}</h2>
            {summary.rows.length > 0 ? <span className={styles.count} translate="no">{summary.rows.length}</span> : null}
          </div>
          {summary.rows.length === 0 ? (
            <p className={styles.empty}>
              <span>{text("Your rewards will appear here after your first trade.")}</span>
              <Link className={styles.go} href="/app/swap">
                {text("Make a trade")}
                <ArrowRight size={14} aria-hidden="true" />
              </Link>
            </p>
          ) : (
            <>
            <ul className={styles.rows} id="rewards-history-rows">
              {(historyOpen ? summary.rows : summary.rows.slice(0, HISTORY_FOLDED)).map((row, index) => (
                <li className={styles.row} key={`${row.at}:${row.kind}:${index}`}>
                  <Glyph kind={row.kind} />
                  <span className={styles.rowText}>
                    <span className={styles.rowKind}>{kindLabel(row.kind, text, words)}</span>
                    <span className={styles.rowDetail} data-note={row.detail && /after the check|після перевірки/.test(row.detail) ? "" : undefined}>
                      {rowDetail(row, text)}
                    </span>
                  </span>
                  <time className={styles.rowAt} dateTime={row.at} translate="no">
                    {new Intl.DateTimeFormat(intl, { day: "numeric", month: "short", year: "numeric" }).format(new Date(row.at))}
                  </time>
                  <span
                    className={styles.rowAmount}
                    data-negative={row.kind === "CLAIM" ? "true" : "false"}
                    data-valued={row.valued ? "true" : "false"}
                    translate="no"
                  >
                    {row.display}
                  </span>
                </li>
              ))}
            </ul>
            {summary.rows.length > HISTORY_FOLDED ? (
              <button
                type="button"
                className={styles.historyToggle}
                aria-expanded={historyOpen}
                aria-controls="rewards-history-rows"
                ref={historyToggle}
                onClick={() => {
                  const closing = historyOpen;
                  setHistoryOpen(!historyOpen);
                  /* Folding a long list from its foot would leave the reader below the section: bring the button back into view. */
                  if (closing) requestAnimationFrame(() => historyToggle.current?.scrollIntoView({ block: "nearest" }));
                }}
              >
                {historyOpen ? words.historyFold : words.historyAll(summary.rows.length - HISTORY_FOLDED)}
                <CaretDown size={14} weight="bold" aria-hidden="true" data-open={historyOpen || undefined} />
              </button>
            ) : null}
            </>
          )}
        </section>

        {/* The rules of both programmes, one disclosure each. */}
        <details className={`${styles.panel} ${styles.rules}`}>
          <summary>{text("How rewards work")}</summary>
          <ul className={styles.rulesBody}>
            {(terms
              ? [
                  words.rewardsRules[0]!,
                  words.inviterRule(terms.inviterWindow.share, terms.inviterWindow.days),
                  words.firstTenRule(wholeDollars(terms.firstTenOffer.cap), terms.firstTenOffer.days, terms.firstTenOffer.walletsPerMonth),
                  words.rulesBefore,
                  words.claimFloorRule(dollars(terms.claimMinimumWithAccount), dollars(terms.claimMinimumWithoutAccount)),
                ]
              : [...words.rewardsRules, words.claimFloorBefore]
            ).map((rule) => <li key={rule}>{rule}</li>)}
            <li>{text("Only fees actually collected after Rewards launched are eligible. Routes with no Ryntra fee earn nothing.")}</li>
          </ul>
        </details>
        <details className={`${styles.panel} ${styles.rules}`}>
          <summary>{words.ranksTitle}</summary>
          <ul className={styles.rulesBody}>
            {words.ranksRules.map((rule) => <li key={rule}>{rule}</li>)}
            {terms ? <li>{words.ladderWindow(terms.inviterWindow.share, terms.inviterWindow.days)}</li> : null}
          </ul>
        </details>
      </>
      ) : null}
    </div>
    </div>
  );
}
