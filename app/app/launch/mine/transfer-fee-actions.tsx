"use client";

import { Warning } from "@phosphor-icons/react";
import { Button } from "@ryntra/core/ui";
import { useState } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import { useSolanaConnection } from "@/app/solana/workspace/connection";
import type { LaunchTransferFeeBuildResponse, LaunchTransferFeeResponse, LaunchTransferFeeStep, LaunchTransferFeeSubmitResponse } from "@/lib/api/v1/contract";
import { signFreshBytes } from "@/lib/solana/sign-fresh";
import { signTransactions } from "@/lib/solana/wallet.client";

import { coreLang } from "../launch-blocks";
import { formatRaw } from "../launch-format";
import { launchWords } from "../launch-words";
import styles from "../launch.module.css";
import { TransferFeeBusy, TransferFeePanel } from "../transfer-fee-panel";

/**
 * «Комісія за переказ» in «Мої лаунчі» (SOL-L10): the cycle and its timeline, and the creator's two steps — «Зібрати»
 * (holders' accounts to the mint) and «Вивести» (the mint to the creator's wallet). Each is built, signed by the wallet
 * alone and sent once; a step with nothing to move is not offered, so the same step never acts twice.
 */

type Answer<T> = { ok: true; data: T } | { ok: false; code: string; message: string };
const API_HEADERS = { "content-type": "application/json", "X-Ryntra-API": "1" } as const;

async function api<T>(path: string, body: unknown): Promise<Answer<T>> {
  try {
    const response = await fetch(path, { method: "POST", headers: API_HEADERS, body: JSON.stringify(body) });
    const json = (await response.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
    if (!response.ok) return { ok: false, code: json?.error?.code ?? "UNAVAILABLE", message: json?.error?.message ?? "" };
    return { ok: true, data: json as T };
  } catch {
    return { ok: false, code: "UNAVAILABLE", message: "" };
  }
}

export function TransferFeeCabinet({ token, symbol, wallet, locale, network, paused }: { token: string; symbol: string; wallet: string; locale: WorkspaceLocale; network: "solana:devnet" | "solana:mainnet"; paused: boolean }) {
  return (
    <TransferFeePanel
      token={token}
      symbol={symbol}
      locale={locale}
      network={network}
      actions={(view, reload) => <Steps view={view} wallet={wallet} locale={locale} paused={paused} onDone={reload} token={token} symbol={symbol} />}
    />
  );
}

function Steps({ view, wallet, locale, paused, onDone, token, symbol }: { view: LaunchTransferFeeResponse; wallet: string; locale: WorkspaceLocale; paused: boolean; onDone: () => void; token: string; symbol: string }) {
  const word = launchWords(locale);
  const lang = coreLang(locale);
  const { connection } = useSolanaConnection();
  const [busy, setBusy] = useState<LaunchTransferFeeStep | null>(null);
  const [said, setSaid] = useState<{ kind: "ok" | "pending" | "error" | "cancelled"; text: string } | null>(null);
  if (view.withdrawAuthority !== wallet) return <p className={styles.hint}>{word("tfNotYours")}</p>;
  if (paused) return <p className={styles.hint}>{word("tfPaused")}</p>;

  const take = async (step: LaunchTransferFeeStep) => {
    setSaid(null);
    if (!connection || connection.address !== wallet) {
      setSaid({ kind: "error", text: word("tfWalletChanged") });
      return;
    }
    setBusy(step);
    const base = `/api/v1/launch/${token}/transfer-fee`;
    const fresh = await signFreshBytes({
      build: () => api<LaunchTransferFeeBuildResponse>(`${base}/build`, { wallet, step }),
      signableMsOf: (data) => data.signableMs,
      sign: async (data) => {
        const answer = await signTransactions({ wallet: connection.wallet, address: wallet, unsignedWireBase64: [data.unsignedWireBase64], chain: data.network });
        return answer.ok ? { ok: true, value: answer.signedWireBase64[0] ?? "" } : answer;
      },
    });
    if (!fresh.ok) {
      setBusy(null);
      if (fresh.stage === "sign") setSaid({ kind: "cancelled", text: word("walletCancelled") });
      else setSaid({ kind: "error", text: fresh.stage === "build" ? word(fresh.failure.code === "LAUNCH_NOTHING_TO_CLAIM" ? "tfNothing" : "tfFailed") : word("tfFailed") });
      return;
    }
    const sent = await api<LaunchTransferFeeSubmitResponse>(`${base}/submit`, { buildId: fresh.built.buildId, wallet, signedWireBase64: fresh.signed });
    setBusy(null);
    if (!sent.ok) setSaid({ kind: "error", text: word(sent.code === "LAUNCH_BUILD_USED" ? "tfAlreadySent" : "tfFailed") });
    else if (sent.data.state === "PENDING") setSaid({ kind: "pending", text: word("tfPending") });
    else setSaid({ kind: "ok", text: word(step === "HARVEST" ? "tfHarvested" : "tfWithdrew", { amount: `${formatRaw(sent.data.receipt?.amountRaw ?? "0", view.decimals, locale, 2)} $${symbol}` }) });
    onDone();
  };

  return (
    <div className={styles.mineActions}>
      {busy ? (
        <TransferFeeBusy label={word(busy === "HARVEST" ? "tfHarvesting" : "tfWithdrawing")} />
      ) : (
        <>
          <Button variant="secondary" onClick={() => void take("HARVEST")} disabled={!view.actions.harvest} lang={lang}>
            {word("tfHarvest")}
          </Button>
          <Button variant="secondary" onClick={() => void take("WITHDRAW")} disabled={!view.actions.withdraw} lang={lang}>
            {word("tfWithdraw")}
          </Button>
        </>
      )}
      {said ? (
        <p className={said.kind === "error" ? styles.problem : styles.hint} role={said.kind === "error" ? "alert" : "status"}>
          {said.kind === "error" ? <Warning size={16} weight="fill" aria-hidden /> : null} {said.text}
        </p>
      ) : null}
    </div>
  );
}
