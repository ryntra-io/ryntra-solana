"use client";

import { ArrowRight, Check, Coins, Copy, ShareNetwork, UserPlus, UsersThree, Wallet } from "@phosphor-icons/react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { dollars } from "@/lib/rewards/format";
import { useSolanaConnection } from "../connection.tsx";
import { useSolanaI18n } from "../i18n/provider.tsx";
import { WalletGate } from "../wallet-gate.tsx";
import { useWalletProof } from "../wallet-proof.tsx";
import { rankCopy } from "./rank-copy.ts";
import { BadgesCard, type AchievementsSummary } from "./badges-card.tsx";
import { RankCard, type RankSummary } from "./rank-card.tsx";
import { ReferralCard } from "./referral-card.tsx";
import { SeasonCard } from "./season-card.tsx";
import styles from "./rewards.module.css";

/**
 * Rewards, for the wallet that is connected and has proved itself.
 *
 * ## Drawn the way the Portfolio is drawn
 *
 * The Owner's instruction of 2026-09-12, with the Portfolio held up as the
 * standard: not one wide column of stacked blocks, but a composition. The
 * earnings on the left — the figure that is theirs to claim, the claim, and
 * where every dollar came from as one bar — and on the right the two
 * programmes side by side, the rank and the invitation, over the statement of
 * every reward. Everything is a computed figure, a share, a distance, a
 * date; nothing is a paragraph.
 *
 * ## Nothing here explains the machinery
 *
 * No mechanism names, no operation references, no treasury address, no
 * valuation basis, no internal state words. The rules live behind one
 * disclosure per programme, which is where technical text belongs on a
 * customer surface. What a person cannot do, they are told in one sentence
 * beside the control that is disabled — never by hiding the control.
 *
 * ## The gates draw their own frame
 *
 * A wallet that is not connected, or not yet proven, gets a framed card in
 * ordinary flow whose height is its content's: the invitation a new arrival
 * followed a link for sits above the gate, and three wallet tiles fit. The
 * signed-in surface is the two-column canvas.
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
}>;

const KIND_LABEL: Readonly<Record<string, string>> = {
  CASHBACK: "Cashback",
  REFERRAL_L1: "Referral L1",
  REFERRAL_L2: "Referral L2",
  CLAIM: "Claimed",
};

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

export function RewardsCard() {
  const { connection } = useSolanaConnection();
  const { text, locale } = useSolanaI18n();
  const words = rankCopy(locale);
  const proof = useWalletProof();
  const address = connection?.address ?? null;
  const intl = locale === "uk" ? "uk-UA" : "en-US";

  const key = `${address ?? ""}:${locale}`;
  const currentKey = useRef(key);
  currentKey.current = key;
  const [snapshot, setSnapshot] = useState<{ key: string; data: Summary } | null>(null);
  const [rejectedProof, setRejectedProof] = useState<string | null>(null);
  const proven = proof.state.status === "proven" && proof.state.address === address && rejectedProof !== key;
  const summary = snapshot?.key === key && snapshot.data.address === address && proven ? snapshot.data : null;
  const [error, setError] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<{ key: string; message: string } | null>(null);
  const [pendingWallets, setPendingWallets] = useState<ReadonlySet<string>>(new Set());
  const pending = useRef(new Set<string>());
  const busy = address !== null && pendingWallets.has(address);
  const [loading, setLoading] = useState(false);
  const inFlight = useRef<AbortController | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async (force = false) => {
    if (!address || !proven || currentKey.current !== key) return;
    if (!force && inFlight.current && !inFlight.current.signal.aborted) return;
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setLoading(true);
    try {
      const response = await fetch(`/api/rewards?address=${encodeURIComponent(address)}&locale=${locale}`, { signal: controller.signal });
      if (controller.signal.aborted || currentKey.current !== key) return;
      if (response.status === 401) {
        setSnapshot(null);
        setRejectedProof(key);
        return;
      }
      if (!response.ok) throw new Error(text("Rewards could not be read right now."));
      const data = await response.json() as Summary;
      if (controller.signal.aborted || currentKey.current !== key) return;
      if (data.address !== address) throw new Error(text("Rewards could not be read right now."));
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
  }, [address, locale, text, proven, key]);

  useEffect(() => {
    setError(null);
    if (proven) void load();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible" && proven) void load(); }, 20_000);
    return () => { window.clearInterval(timer); inFlight.current?.abort(); };
  }, [proven, load]);

  const prove = async () => { const ok = await proof.prove(); if (ok && currentKey.current === key) setRejectedProof(null); return ok; };
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

  if (!address) {
    return (
      <div className={styles.gateFrame}>
        {/* The state somebody who has just followed a link is actually in: no
            wallet at all. The invitation belongs here more than anywhere. */}
        <ReferralCard key={address} wallet={address} invitedBy={null} proven={false} onProve={prove} onBound={() => void load()} />
        <WalletGate title={text("Connect a wallet to see what you have earned.")} />
      </div>
    );
  }
  if (!proven) {
    return (
      <div className={styles.gateFrame}>
        {/* Before a wallet is proven: somebody who has just followed a link
            should see who invited them without being asked to sign first. */}
        <ReferralCard key={address} wallet={address} invitedBy={null} proven={false} onProve={prove} onBound={() => void load()} />
        <div className={styles.confirm}>
          <p className={styles.confirmLead}>{text("Confirm this wallet to see your rewards.")}</p>
          <button type="button" className={styles.claim} onClick={() => void prove()} disabled={proof.state.status === "signing"}>
            {text(proof.state.status === "signing" ? "Confirming…" : "Confirm wallet")}
          </button>
          {proof.state.status === "refused" || proof.state.status === "failed" ? (
            <p className={styles.error}>{proof.state.reason}</p>
          ) : null}
          {error ? <p className={styles.error}>{error}</p> : null}
        </div>
      </div>
    );
  }
  if (!summary) return <section className={styles.gateFrame} aria-live="polite">
    <p>{loading ? text("Loading your rewards…") : error ?? text("Rewards could not be read right now.")}</p>
    {!loading ? <button className={styles.claim} type="button" onClick={() => void load()}>{text("Try again")}</button> : null}
  </section>;
  const tone = summary.claim?.state === "PAID" ? "done" : summary.claim?.state === "FAILED" ? "warn" : running ? "live" : undefined;
  const pendingMoney = usdNumber(summary.pending) > 0;
  const reasons = summary.pendingReasons ?? [];
  const pendingWhy = [
    ...(reasons.includes("AWAITING_VALUATION") ? [text("Some rewards are still being priced.")] : []),
    ...(reasons.includes("AWAITING_RESERVE") && pendingMoney && !summary.claimBlockedReason ? [text("Pending rewards become claimable as the reward reserve covers them.")] : []),
  ];
  const share_ = (value: number): string | null => (sources.total > 0 ? `${Math.round((value / sources.total) * 100)}%` : null);
  const sourceLabel = (kind: "cashback" | "l1" | "l2"): string =>
    kind === "cashback" ? text("Cashback") : kind === "l1" ? text("Referral L1") : text("Referral L2");
  /* The level-1 share follows the rank; without a rank only the range is
     true, so the range is what is shown rather than a guessed figure. */
  const friendShare = summary.rank ? `${summary.rank.friendShare}%` : "10–30%";
  const sourceRate = (kind: "cashback" | "l1" | "l2"): string =>
    kind === "cashback" ? words.cashbackRate : kind === "l1" ? words.friendRate : text("5% from the people they invited");
  const sourceFigure = (kind: "cashback" | "l1" | "l2"): string =>
    dollars(kind === "cashback" ? summary.cashback : kind === "l1" ? summary.referralL1 : summary.referralL2);

  return (
    <div className={styles.workspace}>
      {/* What is theirs, what it is waiting on, and where it came from. */}
      <section className={`${styles.panel} ${styles.earn}`} id="rewards-earnings" aria-label={text("Available to claim")}>
        {/* Before the owner sets the moment accrual begins, this page would
            otherwise imply that trading today earns cashback. It does not,
            and saying so is cheaper and more honest than hiding the page. */}
        {summary.started ? null : (
          <p className={styles.notice}>{text("Rewards have not started yet. Trades made before they do earn nothing.")}</p>
        )}
        <span className={styles.eyebrow}>{text("Available to claim")}</span>
        <strong className={styles.amount} translate="no">
          {dollars(summary.available)}
          <span className={styles.unit}>USDC</span>
        </strong>
        <dl className={styles.facts}>
          <div className={styles.fact} data-tone={pendingMoney ? "pending" : undefined}>
            <dt>{text("Pending")}</dt>
            <dd translate="no">{dollars(summary.pending)}</dd>
          </div>
          <div className={styles.fact}>
            <dt>{text("Lifetime earned")}</dt>
            <dd translate="no">{dollars(summary.lifetime)}</dd>
          </div>
        </dl>
        {/* Why money is pending — the reserve sentence only when the claim
            note is not already saying it. */}
        {pendingWhy.length > 0 ? <p className={styles.pendingWhy}>{pendingWhy.join(" ")}</p> : null}

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

        <div className={styles.sources} aria-label={text("Where your rewards came from")}>
          <span className={styles.eyebrow}>{text("Where it came from")}</span>
          <div className={styles.bar} role="img" aria-label={text("Where your rewards came from")}>
            {sources.total > 0
              ? sources.parts.filter((part) => part.value > 0).map((part) => (
                  /* Grow factors in whole thousandths: a lone `<$0.01` source with
                     `flex-grow: 0.01` fills a hundredth of the track, not all of it —
                     factors that sum below one leave the rest empty. Seen on
                     production with the Owner's own first cashback. */
                  <span key={part.kind} className={styles.slice} data-kind={part.kind} style={{ flexGrow: Math.max(1, Math.round((part.value / sources.total) * 1000)) }} title={`${sourceLabel(part.kind)} ${share_(part.value)}`} />
                ))
              : null}
          </div>
          <ul className={styles.sourceList}>
            {sources.parts.map((part) => (
              <li key={part.kind} className={styles.sourceRow}>
                <span className={styles.dot} data-kind={part.kind} aria-hidden="true" />
                <span className={styles.sourceText}>
                  <span className={styles.sourceLabel}>{sourceLabel(part.kind)}</span>
                  <span className={styles.sourceRate}>{sourceRate(part.kind)}</span>
                </span>
                <span className={styles.sourceFigure} translate="no">
                  {sourceFigure(part.kind)}
                  {share_(part.value) ? <span>{share_(part.value)}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {error ? <p className={styles.error}>{error}</p> : null}
      </section>

      <div className={styles.main}>
        <div className={styles.programmes}>
          {/* The rank beside the money: it sets what a friend's trade pays, so
              it sits next to the invitation — the Owner's placement for
              Points, kept for what replaced them. */}
          <RankCard rank={summary.rank ?? null} />

          <section className={`${styles.panel} ${styles.invite}`} id="rewards-invite" aria-label={words.inviteTitle}>
            <div className={styles.panelHead}>
              <h2 className={styles.title}>{words.inviteTitle}</h2>
              <div className={styles.chips}>
                <span className={styles.chip}>{words.levelOneChip(friendShare)}</span>
                <span className={styles.chip}>{words.levelTwoChip(`${summary.rank?.secondLevelShare ?? 5}%`)}</span>
              </div>
            </div>

            {summary.referral ? (
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
            ) : null}

            <dl className={styles.tiles}>
              <div className={styles.tile}>
                <dt>{text("Direct referrals")}</dt>
                <dd translate="no">{summary.referrals.level1}</dd>
              </div>
              <div className={styles.tile}>
                <dt>{text("Level 2 referrals")}</dt>
                <dd translate="no">{summary.referrals.level2}</dd>
              </div>
              <div className={styles.tile} data-tone={usdNumber(summary.referralL1) > 0 ? "money" : undefined}>
                <dt>{text("L1 earned")}</dt>
                <dd translate="no">{dollars(summary.referralL1)}</dd>
              </div>
              <div className={styles.tile} data-tone={usdNumber(summary.referralL2) > 0 ? "money" : undefined}>
                <dt>{text("L2 earned")}</dt>
                <dd translate="no">{dollars(summary.referralL2)}</dd>
              </div>
            </dl>

            {/* Who invited this wallet — pending, offered or settled. */}
            <ReferralCard
              key={address}
              wallet={address}
              invitedBy={summary.invitedBy}
              proven={proven}
              onProve={prove}
              onBound={() => void load()}
            />
          </section>
        </div>

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
            <ul className={styles.rows}>
              {summary.rows.map((row, index) => (
                <li className={styles.row} key={`${row.at}:${row.kind}:${index}`}>
                  <Glyph kind={row.kind} />
                  <span className={styles.rowText}>
                    <span className={styles.rowKind}>{text(KIND_LABEL[row.kind] ?? row.kind)}</span>
                    <span className={styles.rowDetail}>
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
          )}
        </section>
      </div>

      {/* The rules of both programmes, one disclosure each, under the
          earnings and never inside a panel whose neighbour would move. */}
      <div className={styles.rulesStack}>
        <details className={`${styles.panel} ${styles.rules}`}>
          <summary>{text("How rewards work")}</summary>
          <ul className={styles.rulesBody}>
            {words.rewardsRules.map((rule) => <li key={rule}>{rule}</li>)}
            <li>{text("Claim from $1.00 USDC, to the wallet you are signed in with.")}</li>
            <li>{text("Only fees actually collected after Rewards launched are eligible. Routes with no Ryntra fee earn nothing.")}</li>
          </ul>
        </details>
        <details className={`${styles.panel} ${styles.rules}`}>
          <summary>{words.ranksTitle}</summary>
          <ul className={styles.rulesBody}>
            {words.ranksRules.map((rule) => <li key={rule}>{rule}</li>)}
          </ul>
        </details>
      </div>
    </div>
  );
}
