"use client";

import { Copy } from "@phosphor-icons/react";
import QRCode from "qrcode";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@ryntra/core/ui";

import type { WorkspaceLocale } from "@/app/shell/locale";
import { NetworkMark } from "@/app/solana/workspace/money/marks";
import { MoneyAction } from "@/app/solana/workspace/money/money-page";
import { readWalletHoldings } from "@/lib/solana/holdings.client";
import { SOLANA_USDC_MINT } from "@/lib/swap/catalog";
import { DEPOSIT_MIN_USD, DEPOSIT_NETWORK_LABEL, DEPOSIT_NETWORKS, DEPOSIT_REFERENCE_USD, type DepositAddress, type DepositNetwork, type DepositProgress } from "@/lib/relay/deposit-address";

import { depositArrived, depositFee, depositNote, depositWords } from "./deposit-words";
import styles from "./top-up.module.css";

/**
 * «З іншої мережі» — USDC from another network or an exchange, sent to an
 * address, with no second wallet.
 *
 * The person says where their USDC is; the page asks Relay for an open deposit
 * address on that network whose fills pay USDC to this Solana wallet, and
 * shows it the way «Отримати» shows the wallet's own: a QR code, the address
 * whole, the network named, one button to copy it. Nothing here signs or
 * sends — the person's exchange or wallet does the sending — and the page
 * that holds this block reads the Solana wallet again until the money is there.
 *
 * An address once given is kept in this browser for this wallet and network
 * for a month: an open address takes every later deposit too, and somebody who
 * saved it in an exchange's address book should find the same one here
 * tomorrow. After a month it is asked for again, with a fresh fee.
 *
 * What happened to a deposit is asked of Relay only for deposits made since
 * the address was shown (less half an hour, for the person who sent from an
 * address book before opening the page), so yesterday's «Прийшло» never reads
 * as today's. Relay answers that read only with Ryntra's key; without one —
 * and always beside it — the block reads the Solana wallet's own USDC, and a
 * balance that grows while the address is on screen is the money that came.
 */

const KEPT = "ryntra.deposit-address.v2";
const KEPT_MS = 30 * 24 * 60 * 60 * 1000;
const LOOKBACK_S = 30 * 60;

type Kept = DepositAddress & Readonly<{ keptAt: number }>;
type UsdcRow = Readonly<{ kind?: string; mint?: string | null; amountRaw?: string; spendableRaw?: string }>;

/** The wallet's USDC, raw, or null when the read was not whole. */
async function readUsdcRaw(owner: string): Promise<bigint | null> {
  const read = await readWalletHoldings<UsdcRow>(owner);
  if (!read.ok || read.tokenRead !== "COMPLETE") return null;
  const row = read.rows.find((entry) => entry.kind === "TOKEN" && entry.mint === SOLANA_USDC_MINT);
  const raw = row ? (row.amountRaw ?? row.spendableRaw ?? "0") : "0";
  return /^[0-9]+$/.test(raw) ? BigInt(raw) : null;
}

function usdcWord(raw: bigint): string {
  const whole = raw / 1_000_000n;
  const cents = ((raw % 1_000_000n) / 10_000n).toString().padStart(2, "0");
  return `${whole}.${cents}`;
}
/** How often the deposit is asked about once an address is on screen, and for how long at most — an exchange's withdrawal can take half an hour. */
const PROGRESS_MS = 15_000;
const PROGRESS_LIMIT = 240;

function keptAddress(recipient: string, network: DepositNetwork): DepositAddress | null {
  try {
    const all = JSON.parse(window.localStorage.getItem(KEPT) ?? "{}") as Record<string, Kept>;
    const kept = all[`${recipient}:${network}`];
    const fresh = kept && typeof kept.keptAt === "number" && Date.now() - kept.keptAt < KEPT_MS;
    return fresh && kept.recipient === recipient && kept.network === network && /^0x[0-9a-fA-F]{40}$/.test(kept.address) ? kept : null;
  } catch {
    return null;
  }
}

function keepAddress(value: DepositAddress) {
  try {
    window.localStorage.removeItem("ryntra.deposit-address.v1");
    const all = JSON.parse(window.localStorage.getItem(KEPT) ?? "{}") as Record<string, Kept>;
    all[`${value.recipient}:${value.network}`] = { ...value, keptAt: Date.now() };
    window.localStorage.setItem(KEPT, JSON.stringify(all));
  } catch {
    /* Storage can be refused; the address is asked for again next time, and an open address is as good as the last. */
  }
}

export function NetworkDeposit({
  recipient,
  locale,
  primary,
  pinned = false,
  initial = null,
  onNetwork,
}: {
  recipient: string;
  locale: WorkspaceLocale;
  primary: boolean;
  /** The page's one action (B18): «Копіювати адресу» pinned above a phone's bottom bar. Only where nothing else is. */
  pinned?: boolean;
  initial?: DepositNetwork | null;
  /** Told when the person picks a network, so a page around this block can name it too. */
  onNetwork?: (network: DepositNetwork) => void;
}) {
  const word = depositWords(locale);
  const [network, setNetwork] = useState<DepositNetwork | null>(initial);
  const [deposit, setDeposit] = useState<DepositAddress | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "failed">("idle");
  const [attempt, setAttempt] = useState(0);
  const [progress, setProgress] = useState<Readonly<{ progress: DepositProgress | "UNKNOWN"; amount: string | null }> | null>(null);

  useEffect(() => {
    if (network === null) return undefined;
    setProgress(null);
    const kept = keptAddress(recipient, network);
    if (kept) {
      setDeposit(kept);
      setState("idle");
      return undefined;
    }
    let live = true;
    setDeposit(null);
    setState("loading");
    void fetch("/api/swap/deposit-address", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ network, recipient }),
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { data?: DepositAddress } | null) => {
        if (!live) return;
        const value = payload?.data;
        if (!value || value.recipient !== recipient || value.network !== network) {
          setState("failed");
          return;
        }
        keepAddress(value);
        setDeposit(value);
        setState("idle");
      })
      .catch(() => {
        if (live) setState("failed");
      });
    return () => {
      live = false;
    };
  }, [network, recipient, attempt]);

  /* What happened to money sent there: asked while the page is in view, never forever. */
  useEffect(() => {
    if (!deposit) return undefined;
    let live = true;
    let count = 0;
    const since = Math.max(0, Math.floor(Date.now() / 1000) - LOOKBACK_S);
    let baseline: bigint | null = null;
    void readUsdcRaw(recipient).then((raw) => {
      if (live) baseline = raw;
    });
    const ask = () => {
      if (document.visibilityState !== "visible" || count >= PROGRESS_LIMIT) return;
      count += 1;
      /* The wallet itself: more USDC than when the address was shown is a deposit that arrived. */
      void readUsdcRaw(recipient).then((raw) => {
        if (!live || raw === null) return;
        if (baseline === null || raw < baseline) {
          /* Spent while waiting: the new, lower figure is what a deposit is measured against. */
          baseline = raw;
          return;
        }
        if (raw > baseline) setProgress({ progress: "ARRIVED", amount: usdcWord(raw - baseline) });
      });
      void fetch(`/api/swap/deposit-address?address=${encodeURIComponent(deposit.address)}&since=${since}`, { headers: { accept: "application/json" } })
        .then((response) => (response.ok ? response.json() : null))
        .then((payload: { data?: { progress?: DepositProgress | "UNKNOWN"; amount?: string | null } } | null) => {
          const value = payload?.data;
          const relayProgress = value?.progress;
          /* Relay's word, when it has one; an arrival the wallet already showed is never taken back by it. */
          if (live && relayProgress && relayProgress !== "UNKNOWN" && relayProgress !== "NONE") {
            setProgress((current) => (current?.progress === "ARRIVED" && relayProgress === "ON_THE_WAY" ? current : { progress: relayProgress, amount: value?.amount ?? null }));
          }
        })
        .catch(() => undefined);
    };
    ask();
    const timer = window.setInterval(ask, PROGRESS_MS);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [deposit, recipient]);

  const label = network ? DEPOSIT_NETWORK_LABEL[network] : null;
  /* Only an address for this network and this wallet is ever painted — never the last one under a new name. */
  const shown = deposit && deposit.network === network && deposit.recipient === recipient ? deposit : null;
  return (
    <div className={styles.deposit}>
      <span className={styles.addressLabel} id="deposit-networks">{word("pick")}</span>
      <div className={styles.networks} role="radiogroup" aria-labelledby="deposit-networks">
        {DEPOSIT_NETWORKS.map((candidate) => (
          <button
            key={candidate}
            type="button"
            role="radio"
            aria-checked={candidate === network}
            className={styles.network}
            onClick={() => {
              setNetwork(candidate);
              onNetwork?.(candidate);
            }}
          >
            <NetworkMark network={candidate} size={20} />
            <span translate="no">{DEPOSIT_NETWORK_LABEL[candidate]}</span>
          </button>
        ))}
      </div>
      {network === null ? null : state === "failed" ? (
        <p className={styles.fine} role="alert">
          {word("failed")}{" "}
          <button type="button" className={styles.inline} onClick={() => setAttempt((value) => value + 1)}>{word("retry")}</button>
        </p>
      ) : state === "loading" || !shown || !label ? (
        <p className={styles.waiting} aria-live="polite">{word("loading")}</p>
      ) : (
        <>
          <DepositAddressBlock deposit={shown} network={label} locale={locale} primary={primary} pinned={pinned} />
          <p className={styles.depositNote}>{depositNote(locale, label, DEPOSIT_MIN_USD)}</p>
          <p className={styles.fine}>{depositFee(locale, shown.feeUsd, DEPOSIT_REFERENCE_USD)}</p>
          {progress === null || progress.progress === "NONE" || progress.progress === "UNKNOWN" ? null : (
            <p className={styles.depositState} data-progress={progress.progress} aria-live="polite">
              {progress.progress === "ARRIVED"
                ? depositArrived(locale, progress.amount)
                : progress.progress === "REFUNDED"
                  ? word("refunded")
                  : progress.progress === "FAILED"
                    ? word("failedFill")
                    : word("onTheWay")}
            </p>
          )}
        </>
      )}
    </div>
  );
}

function DepositAddressBlock({ deposit, network, locale, primary, pinned }: { deposit: DepositAddress; network: string; locale: WorkspaceLocale; primary: boolean; pinned: boolean }) {
  const word = depositWords(locale);
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    setQr(null);
    /* The bare address, which every exchange and wallet scanner reads. */
    void QRCode.toDataURL(deposit.address, { errorCorrectionLevel: "M", margin: 1, width: 440 })
      .then((data) => {
        if (live) setQr(data);
      })
      .catch(() => {
        if (live) setQr(null);
      });
    return () => {
      live = false;
    };
  }, [deposit.address]);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(deposit.address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      /* The clipboard can be refused; the address is on screen in full either way. */
    }
  }, [deposit.address]);

  const copyWord = locale === "uk" ? (copied ? "Скопійовано" : "Копіювати адресу") : copied ? "Copied" : "Copy address";
  const copyButton = (
    <Button variant={primary ? "primary" : "secondary"} onClick={() => void copy()} lang={locale}>
      <Copy size={16} weight="bold" aria-hidden="true" />
      {copyWord}
    </Button>
  );
  const networkWord = locale === "uk" ? "Мережа" : "Network";
  return (
    <div className={styles.address} data-qr="true">
      <div className={styles.qrWrap}>
        {qr ? (
          /* A data URI this component just drew; there is no remote file for next/image. */
          // eslint-disable-next-line @next/next/no-img-element
          <img className={styles.qr} src={qr} alt={word("scan")} width={220} height={220} />
        ) : (
          <span className={styles.qrBone} aria-hidden="true" />
        )}
      </div>
      <div className={styles.addressFacts}>
        <span className={styles.addressLabel}>{word("addressLabel")}</span>
        <p className={styles.addressValue} translate="no">
          {deposit.address}
        </p>
        <span className={styles.chip}>
          <NetworkMark network={deposit.network} size={14} />
          {networkWord} · <b translate="no">{network}</b> · <b translate="no">USDC</b>
        </span>
      </div>
      {pinned ? <MoneyAction>{copyButton}</MoneyAction> : copyButton}
    </div>
  );
}
