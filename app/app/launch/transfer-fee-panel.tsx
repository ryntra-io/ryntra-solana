"use client";

import { ArrowSquareOut, CheckCircle, CircleNotch, Warning } from "@phosphor-icons/react";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import type { LaunchTransferFeeResponse } from "@/lib/api/v1/contract";

import { explorerUrl, formatBps, formatDate, formatRaw, shortAddress } from "./launch-format";
import { launchWords } from "./launch-words";
import styles from "./launch.module.css";

/**
 * «Комісія за переказ» on a launch (SOL-L10) — the cycle of what the token withheld, read from the chain: in holders'
 * accounts → harvested to the mint → withdrawn by the creator, each step with its transaction; and the RevokeZeroFee
 * timeline by epoch — the rate on the curve, 0 % scheduled at the move to the DEX, 0 % with no one able to set a rate.
 * The token page draws it as it is; the creator's cabinet adds its two steps (`actions`). A token with no fee on
 * transfers draws nothing.
 */

type Read = { state: "loading" } | { state: "none" } | { state: "unread" } | { state: "ok"; view: LaunchTransferFeeResponse };

export function TransferFeePanel({
  token,
  symbol,
  locale,
  network,
  actions,
}: {
  token: string;
  symbol: string;
  locale: WorkspaceLocale;
  network: "solana:devnet" | "solana:mainnet";
  /** The creator's steps, drawn under the cycle with the read and a way to read again. */
  actions?: (view: LaunchTransferFeeResponse, reload: () => void) => ReactNode;
}) {
  const word = launchWords(locale);
  const [read, setRead] = useState<Read>({ state: "loading" });
  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/v1/launch/${token}/transfer-fee`, { headers: { "X-Ryntra-API": "1" } });
      const body = (await response.json().catch(() => null)) as (LaunchTransferFeeResponse & { error?: { code: string } }) | null;
      if (response.ok && body) setRead({ state: "ok", view: body });
      else setRead(body?.error?.code === "LAUNCH_NO_TRANSFER_FEE" ? { state: "none" } : { state: "unread" });
    } catch {
      setRead({ state: "unread" });
    }
  }, [token]);
  useEffect(() => {
    void load();
  }, [load]);

  if (read.state === "none") return null;
  if (read.state === "loading") return <p className={styles.hint}>{word("tfReading")}</p>;
  if (read.state === "unread") return <p className={styles.hint}>{word("tfUnread")}</p>;
  const view = read.view;
  const ticker = `$${symbol}`;
  const amount = (raw: string | null) => (raw === null ? word("tfNotRead") : `${formatRaw(raw, view.decimals, locale, 2)} ${ticker}`);
  const timeline = view.timeline;
  const phases = ["CURVE", "ZERO_SCHEDULED", "ZERO"] as const;
  const at = phases.indexOf(timeline.phase as (typeof phases)[number]);
  return (
    <section className={styles.formats} aria-label={word("transferFeeTitle")}>
      <p className={styles.hint}>
        {word("tfLede", { pct: formatBps(view.bps, locale), now: formatBps(timeline.bpsNow, locale) })}
        {view.withdrawAuthority ? ` · ${word("tfWithdrawBy", { wallet: shortAddress(view.withdrawAuthority) })}` : ""}
      </p>

      {timeline.phase === "OUTSIDE_RULE" ? (
        <p className={styles.problem} role="alert">
          <Warning size={16} weight="fill" aria-hidden /> {word("tfOutsideRule")}
        </p>
      ) : (
        <ol className={styles.steps} aria-label={word("tfTimeline")}>
          {phases.map((phase, index) => (
            <li key={phase} className={styles.step} data-state={index < at ? "done" : index === at ? "active" : "next"}>
              <span className={styles.stepIcon}>{index <= at ? <CheckCircle size={18} weight="fill" aria-hidden /> : <span className={styles.stepDot} />}</span>
              {word(`tfPhase_${phase}`, { pct: formatBps(view.bps, locale), epoch: timeline.zeroFromEpoch ?? "—" })}
            </li>
          ))}
          <li className={styles.mineCost}>{word("tfEpochNow", { epoch: timeline.epoch })}</li>
        </ol>
      )}

      <dl className={styles.mineStats}>
        <div className={styles.stat}>
          <dt>{word("tfInAccounts")}</dt>
          <dd>{amount(view.cycle.inAccountsRaw)}</dd>
        </div>
        <div className={styles.stat}>
          <dt>{word("tfOnMint")}</dt>
          <dd>{amount(view.cycle.onMintRaw)}</dd>
        </div>
        <div className={styles.stat}>
          <dt>{word("tfWithdrawn")}</dt>
          <dd>{amount(view.cycle.withdrawnRaw)}</dd>
        </div>
      </dl>
      <p className={styles.hint}>{word("tfNoDistribution")}</p>

      {actions ? actions(view, () => void load()) : null}

      {view.receipts.length ? (
        <ul className={styles.proofList} aria-label={word("tfReceipts")}>
          {view.receipts.map((receipt) => (
            <li key={receipt.signature} className={styles.proofRow}>
              <span className={styles.proofText}>
                {word(receipt.step === "HARVEST" ? "tfReceiptHarvest" : "tfReceiptWithdraw", { amount: amount(receipt.amountRaw), n: receipt.accounts ?? 0, date: formatDate(receipt.at, locale) })}
              </span>
              <a className={styles.markLink} href={explorerUrl(network, "tx", receipt.signature)} target="_blank" rel="noreferrer noopener" aria-label={word("tfReceiptOpen")}>
                <ArrowSquareOut size={14} aria-hidden />
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** A step's progress as the cabinet draws it. */
export function TransferFeeBusy({ label }: { label: string }) {
  return (
    <p className={styles.hint} aria-live="polite">
      <CircleNotch size={16} aria-hidden className={styles.spin} /> {label}
    </p>
  );
}
