"use client";

import { ArrowSquareOut, CheckCircle, CircleNotch, Clock, Warning } from "@phosphor-icons/react";
import Link from "next/link";
import { Block, Button } from "@ryntra/core/ui";
import { useCallback, useEffect, useState } from "react";

import { useWalletReach } from "@/app/app/invest/use-wallet-reach";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { useSolanaConnection } from "@/app/solana/workspace/connection";
import type {
  LaunchDistributionClaimBuildResponse,
  LaunchDistributionClaimSubmitResponse,
  LaunchDistributionClaimView,
  LaunchDistributionList,
} from "@/lib/api/v1/contract";
import { signFreshBytes } from "@/lib/solana/sign-fresh";
import { signTransactions } from "@/lib/solana/wallet.client";

import { coreLang } from "../launch-blocks";
import { explorerUrl, formatRaw, formatWhen, shortAddress } from "../launch-format";
import styles from "../launch.module.css";
import { distributionWords, type DistributionWordKey } from "./distribution-words";

type Network = "solana:mainnet" | "solana:devnet";
type Answer<T> = { ok: true; data: T } | { ok: false; code: string; message: string };
type Phase = "idle" | "prepare" | "sign" | "send" | "done" | "pending" | "error";

const API_HEADERS = { "content-type": "application/json", "X-Ryntra-API": "1" } as const;

async function api<T>(path: string, init?: RequestInit): Promise<Answer<T>> {
  try {
    const response = await fetch(path, { cache: "no-store", ...init, headers: { ...API_HEADERS, ...(init?.headers ?? {}) } });
    const body = (await response.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
    if (!response.ok) return { ok: false, code: body?.error?.code ?? "UNAVAILABLE", message: body?.error?.message ?? "" };
    return { ok: true, data: body as T };
  } catch {
    return { ok: false, code: "UNAVAILABLE", message: "" };
  }
}

/**
 * «Твій claim» on a token's page (DROP-2): for the connected wallet, what the campaign's published list owes it, what
 * it has taken, what is left, when the next part unlocks — and the chain's own receipt for every claim it made.
 *
 * Nothing here pays anybody. The one action builds the wallet's own transaction, the wallet signs it, and the program
 * makes the escrow and pays: the campaign's owner is not in that signature, and a second claim of the same row cannot
 * exist on chain. A read that failed says so and states no figure; a wallet outside the list is told so plainly rather
 * than shown a zero.
 */
export function DistributionPanel({ mint, network, locale }: { mint: string; network: Network; locale: WorkspaceLocale }) {
  const word = distributionWords(locale);
  const { connection } = useSolanaConnection();
  const { reach } = useWalletReach();
  const wallet = connection?.address ?? null;
  const [campaigns, setCampaigns] = useState<LaunchDistributionList | null | "failed">(null);
  const [claim, setClaim] = useState<LaunchDistributionClaimView | null | "failed">(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [failure, setFailure] = useState<string | null>(null);

  const campaignId = campaigns && campaigns !== "failed" ? (campaigns.campaigns.find((row) => row.state === "FUNDED")?.campaignId ?? campaigns.campaigns[0]?.campaignId ?? null) : null;

  const readCampaigns = useCallback(async () => {
    const answer = await api<LaunchDistributionList>(`/api/v1/launch/${mint}/distribution`);
    setCampaigns(answer.ok ? answer.data : "failed");
  }, [mint]);

  const readClaim = useCallback(async () => {
    if (!campaignId || !wallet) {
      setClaim(null);
      return;
    }
    const answer = await api<LaunchDistributionClaimView>(`/api/v1/launch/${mint}/distribution/${campaignId}/claim/${wallet}`);
    setClaim(answer.ok ? answer.data : "failed");
  }, [campaignId, mint, wallet]);

  useEffect(() => {
    void readCampaigns();
  }, [readCampaigns]);
  useEffect(() => {
    void readClaim();
  }, [readClaim]);

  /* Nothing to draw: this token has no campaign, or the list could not be read. The page says neither as a figure. */
  if (campaigns === null) return null;
  if (campaigns !== "failed" && campaigns.campaigns.length === 0) return null;

  const lang = coreLang(locale);
  const campaign = campaigns === "failed" ? null : (campaigns.campaigns.find((row) => row.campaignId === campaignId) ?? null);
  const decimals = campaign?.currency.decimals ?? 6;
  const symbol = campaign?.currency.symbol ?? "";
  const money = (raw: string | null) => (raw === null ? word("unread") : `${formatRaw(raw, decimals, locale, 4)} ${symbol}`);

  const take = async () => {
    if (!connection) {
      reach();
      return;
    }
    if (!campaignId) return;
    setFailure(null);
    const base = `/api/v1/launch/${mint}/distribution/${campaignId}`;
    const failed = (code: string) => {
      setFailure(code);
      setPhase("error");
    };
    /* The bytes live as long as their blockhash: signed too late, the claim is built again before the wallet opens. */
    const fresh = await signFreshBytes({
      build: async () => {
        setPhase("prepare");
        return api<LaunchDistributionClaimBuildResponse>(`${base}/claim/build`, { method: "POST", body: JSON.stringify({ wallet: connection.address }) });
      },
      signableMsOf: (data) => data.signableMs,
      sign: async (data) => {
        setPhase("sign");
        const answer = await signTransactions({ wallet: connection.wallet, address: connection.address, unsignedWireBase64: [data.unsignedWireBase64], chain: data.network });
        return answer.ok ? { ok: true, value: answer.signedWireBase64 } : answer;
      },
    });
    if (!fresh.ok) {
      if (fresh.stage === "build") return failed(fresh.failure.code);
      if (fresh.stage === "sign") return failed("WALLET_REFUSED");
      return failed("LAUNCH_BUILD_EXPIRED");
    }
    setPhase("send");
    const sent = await api<LaunchDistributionClaimSubmitResponse>(`${base}/claim/submit`, {
      method: "POST",
      body: JSON.stringify({ buildId: fresh.built.buildId, wallet: connection.address, signedWireBase64: fresh.signed[0] }),
    });
    if (!sent.ok) return failed(sent.code);
    /* PENDING is not a failure and not a success: the chain has not answered, and signing again is the one wrong move. */
    setPhase(sent.data.state === "CLAIMED" ? "done" : sent.data.state === "PENDING" ? "pending" : "error");
    if (sent.data.state === "FAILED") setFailure(sent.data.reason ? "generic" : "generic");
    void readClaim();
  };

  const panel = claim && claim !== "failed" ? claim.panel : null;
  const reasons = claim && claim !== "failed" ? claim.reviewReasons : [];
  const stateWord = panel ? (`state_${panel.state}` as DistributionWordKey) : null;

  return (
    <Block title={word("title")} titleAs="h2" lang={lang} id="launch-distribution" className={styles.boostCard}>
      <p className={styles.boostLead}>{word("lede")}</p>
      {campaign ? (
        <ul className={styles.boostLines}>
          {campaign.report[locale].map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}

      {!wallet ? (
        <p className={styles.cellSub}>{word("connect")}</p>
      ) : claim === null ? (
        <p className={styles.unread} aria-busy>
          {word("reading")}
        </p>
      ) : claim === "failed" ? (
        <>
          <p className={styles.unread}>{word("unread")}</p>
          <div>
            <Button variant="ghost" onClick={() => void readClaim()}>
              {word("readAgain")}
            </Button>
          </div>
        </>
      ) : (
        <>
          {stateWord ? <p className={styles.cellSub}>{word(stateWord)}</p> : null}
          {panel && panel.owedRaw !== null ? (
            <dl className={styles.rows}>
              <div className={styles.row}>
                <dt>{word("owed")}</dt>
                <dd>{money(panel.owedRaw)}</dd>
              </div>
              <div className={styles.row}>
                <dt>{word("taken")}</dt>
                <dd>{money(panel.takenRaw)}</dd>
              </div>
              <div className={styles.row}>
                <dt>{word("left")}</dt>
                <dd>{money(panel.leftRaw)}</dd>
              </div>
              <div className={styles.row}>
                <dt>{word("claimable")}</dt>
                <dd>{money(panel.claimableRaw)}</dd>
              </div>
              {panel.nextUnlockAt === null ? null : (
                <div className={styles.row}>
                  <dt>{word("nextUnlock")}</dt>
                  <dd>
                    <Clock size={12} aria-hidden /> {formatWhen(panel.nextUnlockAt, locale)}
                  </dd>
                </div>
              )}
              {panel.endsAt === null ? null : (
                <div className={styles.row}>
                  <dt>{word("endsAt")}</dt>
                  <dd>{formatWhen(panel.endsAt, locale)}</dd>
                </div>
              )}
              {panel.escrow === null ? null : (
                <div className={styles.row}>
                  <dt>{word("escrow")}</dt>
                  <dd>
                    <Link className={styles.addr} href={explorerUrl(network, "account", panel.escrow)} target="_blank" rel="noreferrer noopener" translate="no">
                      {shortAddress(panel.escrow)} <ArrowSquareOut size={12} aria-hidden />
                    </Link>
                  </dd>
                </div>
              )}
            </dl>
          ) : null}

          {reasons.length ? (
            <ul className={styles.boostLines}>
              {reasons.map((reason) => (
                <li key={reason}>
                  <Warning size={12} aria-hidden /> {word(`reason_${reason}` as DistributionWordKey)}
                </li>
              ))}
            </ul>
          ) : null}

          {panel && (panel.state === "CLAIMABLE" || panel.state === "PARTLY_CLAIMED") && BigInt(panel.claimableRaw ?? "0") > 0n ? (
            <div>
              <Button onClick={() => void take()} disabled={phase === "prepare" || phase === "sign" || phase === "send"}>
                {phase === "prepare" ? (
                  <>
                    <CircleNotch size={14} aria-hidden /> {word("claiming")}
                  </>
                ) : phase === "sign" ? (
                  word("signing")
                ) : phase === "send" ? (
                  word("sending")
                ) : (
                  word("claim", { amount: money(panel.claimableRaw) })
                )}
              </Button>
            </div>
          ) : null}

          {phase === "done" ? (
            <p className={styles.cellSub}>
              <CheckCircle size={12} aria-hidden /> {word("done")}
            </p>
          ) : null}
          {phase === "pending" ? <p className={styles.unread}>{word("pending")}</p> : null}
          {phase === "error" && failure ? <p className={styles.unread}>{word((`err_${failure}` as DistributionWordKey) in DISTRIBUTION_ERRORS ? (`err_${failure}` as DistributionWordKey) : "err_generic")}</p> : null}

          <p className={styles.cellSub}>{word("receipts")}</p>
          {panel && panel.receipts.length ? (
            <ul className={styles.boostLines}>
              {panel.receipts.map((receipt) => (
                <li key={receipt.signature}>
                  {money(receipt.amountRaw)} · {formatWhen(receipt.at, locale)} ·{" "}
                  <Link className={styles.addr} href={explorerUrl(network, "tx", receipt.signature)} target="_blank" rel="noreferrer noopener" translate="no">
                    {shortAddress(receipt.signature)} <ArrowSquareOut size={12} aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.cellSub}>{word("receiptsNone")}</p>
          )}
          {campaign ? (
            <p className={styles.cellSub}>
              {word("root")}:{" "}
              <span className={styles.addr} translate="no">
                {campaign.root.slice(0, 12)}…{campaign.root.slice(-8)}
              </span>
            </p>
          ) : null}
        </>
      )}
    </Block>
  );
}

/** The refusals this panel has its own words for; anything else reads as the generic one. */
const DISTRIBUTION_ERRORS = {
  err_WALLET_MISMATCH: true,
  err_VALIDATION_ERROR: true,
  err_LAUNCH_NOT_FOUND: true,
  err_LAUNCH_PAUSED: true,
  err_WALLET_REFUSED: true,
  err_LAUNCH_BUILD_EXPIRED: true,
} as const;
