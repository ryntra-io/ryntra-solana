"use client";

import { ArrowSquareOut, Hourglass, Warning } from "@phosphor-icons/react";
import { Button } from "@ryntra/core/ui";
import { useCallback, useEffect, useId, useState } from "react";

import { useWalletReach } from "@/app/app/invest/use-wallet-reach";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { useSolanaConnection } from "@/app/solana/workspace/connection";
import type {
  LaunchEarlyAccessActionBuildResponse,
  LaunchEarlyAccessActionSubmitResponse,
  LaunchEarlyAccessDepositBuildResponse,
  LaunchEarlyAccessDepositSubmitResponse,
  LaunchEarlyAccessViewResponse,
} from "@/lib/api/v1/contract";
import { signFreshBytes } from "@/lib/solana/sign-fresh";
import { signTransactions } from "@/lib/solana/wallet.client";

import { coreLang } from "../launch-blocks";
import { Block } from "../launch-core";
import { explorerUrl, formatRaw, toRaw } from "../launch-format";
import { launchWords, type LaunchWordKey } from "../launch-words";
import styles from "../launch.module.css";

/**
 * A token launched with early access (SOL-L5) on its own page: the rules a depositor reads first, where the vault
 * stands — deposited against the limit, the phase —, the pool and the vault on the chain, and the wallet's own part:
 * a deposit while deposits are open, then its tokens to claim and its unspent USDC to take back. Every figure from the
 * chain, read again after each action; one not read is said so.
 */

const HEADERS = { "content-type": "application/json", "X-Ryntra-API": "1" } as const;

type Action = "CLAIM" | "WITHDRAW_REMAINING" | "WITHDRAW" | "FILL";

async function api<T>(path: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; code: string; message: string }> {
  try {
    const response = await fetch(path, { ...init, headers: { ...HEADERS, ...(init?.headers ?? {}) } });
    const body = (await response.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
    if (!response.ok) return { ok: false, code: body?.error?.code ?? "UNAVAILABLE", message: body?.error?.message ?? "" };
    return { ok: true, data: body as T };
  } catch {
    return { ok: false, code: "UNAVAILABLE", message: "" };
  }
}

export function EarlyAccessToken({ initial, locale, paused }: { initial: LaunchEarlyAccessViewResponse; locale: WorkspaceLocale; paused: boolean }) {
  const word = launchWords(locale);
  const lang = coreLang(locale);
  const { connection } = useSolanaConnection();
  const { reach } = useWalletReach();
  const wallet = connection?.address ?? null;
  const [view, setView] = useState(initial);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Readonly<{ ok: boolean; text: string }> | null>(null);
  const id = useId();

  const read = useCallback(async () => {
    const query = wallet ? `?wallet=${encodeURIComponent(wallet)}` : "";
    const answer = await api<LaunchEarlyAccessViewResponse>(`/api/v1/launch/${initial.mint}/early-access${query}`);
    if (answer.ok) setView(answer.data);
  }, [initial.mint, wallet]);
  useEffect(() => {
    void read();
  }, [read]);

  /* The bytes are signed while they live: built again when they aged before the wallet answered. */
  const buildAndSign = async <B extends Readonly<{ unsignedWireBase64: string; network: LaunchEarlyAccessViewResponse["network"]; signableMs: number }>>(path: string, body: unknown) => {
    if (!connection) return { ok: false as const, why: "" };
    const fresh = await signFreshBytes({
      build: () => api<B>(path, { method: "POST", body: JSON.stringify(body) }),
      signableMsOf: (data) => data.signableMs,
      sign: async (data) => {
        const signed = await signTransactions({ wallet: connection.wallet, address: connection.address, unsignedWireBase64: [data.unsignedWireBase64], chain: data.network });
        return signed.ok ? { ok: true as const, value: signed.signedWireBase64[0]! } : { ok: false as const, reason: signed.reason };
      },
    });
    if (fresh.ok) return { ok: true as const, built: fresh.built, signed: fresh.signed };
    return { ok: false as const, why: fresh.stage === "build" ? fresh.failure.message : fresh.stage === "sign" ? word("errWalletRefused") : word("errExpired") };
  };

  const deposit = async () => {
    if (!connection) return reach();
    const raw = toRaw(amount, 6);
    if (raw === null || raw <= 0n) return setOutcome({ ok: false, text: word("errAmount") });
    setBusy("DEPOSIT");
    setOutcome(null);
    const done = await buildAndSign<LaunchEarlyAccessDepositBuildResponse>(`/api/v1/launch/${view.mint}/early-access/deposit/build`, { wallet: connection.address, amountRaw: raw.toString() });
    const sent = done.ok ? await api<LaunchEarlyAccessDepositSubmitResponse>(`/api/v1/launch/${view.mint}/early-access/deposit/submit`, { method: "POST", body: JSON.stringify({ buildId: done.built.buildId, wallet: connection.address, signedWireBase64: done.signed }) }) : null;
    setBusy(null);
    setOutcome(sent?.ok ? { ok: true, text: word("earlyDone") } : { ok: false, text: word("earlyFailed", { why: (!done.ok ? done.why : sent && !sent.ok ? sent.message : "") || word("errGeneric") }) });
    void read();
  };

  const act = async (action: Action) => {
    if (!connection) return reach();
    setBusy(action);
    setOutcome(null);
    const done = await buildAndSign<LaunchEarlyAccessActionBuildResponse>(`/api/v1/launch/${view.mint}/early-access/action/build`, { wallet: connection.address, action });
    const sent = done.ok ? await api<LaunchEarlyAccessActionSubmitResponse>(`/api/v1/launch/${view.mint}/early-access/action/submit`, { method: "POST", body: JSON.stringify({ buildId: done.built.buildId, wallet: connection.address, signedWireBase64: done.signed }) }) : null;
    setBusy(null);
    setOutcome(sent?.ok ? { ok: true, text: word("earlyDone") } : { ok: false, text: word("earlyFailed", { why: (!done.ok ? done.why : sent && !sent.ok ? sent.message : "") || word("errGeneric") }) });
    void read();
  };

  const lines = locale === "uk" ? view.lines.uk : view.lines.en;
  const mine = view.mine;
  const phase = view.state;
  const usdc = (raw: string) => formatRaw(raw, 6, locale, 2);
  return (
    <div className={styles.formats}>
      <Block title={word("earlyTitle")} titleAs="h2" lang={lang} id="launch-early">
        <div className={styles.blockBar}>
          <span className={styles.chip} data-state={phase}>
            <Hourglass size={14} aria-hidden /> {word(`earlyPhase_${phase}` as LaunchWordKey)}
          </span>
          {view.network === "solana:devnet" ? <span className={styles.netChip}>{word("devnet")}</span> : null}
        </div>
        {view.read === "OK" && view.depositedRaw !== null ? <p className={styles.boostLead}>{word("earlyDeposited", { amount: usdc(view.depositedRaw), cap: usdc(view.capRaw) })}</p> : <p className={styles.unread}>{word("earlyUnread")}</p>}
        {view.creation.state === "PARTIAL" ? (
          <p className={styles.problem} role="alert">
            <Warning size={16} aria-hidden /> {word("earlySuccessPartial")}
          </p>
        ) : null}
        <ul className={styles.boostLines}>
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <div className={styles.linkList}>
          <a className={styles.markLink} href={explorerUrl(view.network, "account", view.pool)} target="_blank" rel="noreferrer noopener">
            {word("earlyPool")} <ArrowSquareOut size={14} aria-hidden />
          </a>
          <a className={styles.markLink} href={explorerUrl(view.network, "account", view.vault)} target="_blank" rel="noreferrer noopener">
            {word("earlyVault")} <ArrowSquareOut size={14} aria-hidden />
          </a>
        </div>
      </Block>

      <Block title={word(phase === "DEPOSITS" ? "earlyDeposit" : "earlyClaim")} titleAs="h2" lang={lang} id="launch-early-action">
        {mine ? <p className={styles.cellSub}>{word("earlyMine", { deposited: usdc(mine.depositedRaw), claimable: formatRaw(mine.claimableRaw, 6, locale, 0), claimed: formatRaw(mine.claimedRaw, 6, locale, 0) })}</p> : null}
        {phase === "DEPOSITS" ? (
          <>
            <div className={styles.field}>
              <label htmlFor={id} className={styles.label}>
                {word("earlyDepositAmount")}
              </label>
              <input id={id} className={`${styles.input} ${styles.mono}`} value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" autoComplete="off" placeholder="0" />
            </div>
            <Button variant="primary" block onClick={() => void deposit()} disabled={paused || busy !== null} lang={lang}>
              {wallet ? word("earlyDeposit") : word("connectToTrade")}
            </Button>
            {view.rules.mode === "PRO_RATA" && mine && BigInt(mine.depositedRaw) > 0n ? (
              <Button variant="secondary" onClick={() => void act("WITHDRAW")} disabled={paused || busy !== null} lang={lang}>
                {word("earlyWithdraw")}
              </Button>
            ) : null}
          </>
        ) : null}
        {phase === "FILLING" && view.filled === false ? (
          <Button variant="secondary" onClick={() => void act("FILL")} disabled={paused || busy !== null} lang={lang}>
            {word("earlyFill")}
          </Button>
        ) : null}
        {(phase === "VESTING" || phase === "DONE") && mine ? (
          <>
            {BigInt(mine.claimableRaw) > 0n ? (
              <Button variant="primary" block onClick={() => void act("CLAIM")} disabled={paused || busy !== null} lang={lang}>
                {word("earlyClaim")}
              </Button>
            ) : null}
            {BigInt(mine.remainingQuoteRaw) > 0n ? (
              <Button variant="secondary" onClick={() => void act("WITHDRAW_REMAINING")} disabled={paused || busy !== null} lang={lang}>
                {word("earlyWithdrawRemaining")}
              </Button>
            ) : null}
          </>
        ) : null}
        {!wallet && phase !== "DEPOSITS" ? (
          <Button variant="secondary" onClick={() => reach()} lang={lang}>
            {word("connectToTrade")}
          </Button>
        ) : null}
        {outcome ? (
          <p className={outcome.ok ? styles.hint : styles.problem} role={outcome.ok ? undefined : "alert"} aria-live="polite">
            {outcome.text}
          </p>
        ) : null}
        <p className={styles.noGuarantee}>{word("noGuarantee")}</p>
      </Block>
    </div>
  );
}
