"use client";

import { Receipt, type ReviewLine } from "@ryntra/core/ui";

import { formatAmount } from "@/app/solana/workspace/spot/spot-format";
import type { LiquidityNotice, RentCost } from "@/lib/liquidity/studio/contract";
import { explorerTxUrl } from "@/lib/solana/explorer";

import { useFollowedRelay, type LiquidityRelay, type LiquidityReview } from "./liquidity-api";
import type { PoolsWord } from "./pools-words";

type Word = (key: PoolsWord) => string;

/** A refusal in the person's words: the routes answer in English for logs, so the screen speaks by the code. */
export function failureText(code: string, word: Word): string {
  switch (code) {
    case "ACTIONS_CLOSED": return word("failClosed");
    case "CANARY_LIMIT": return word("failCanaryLimit");
    case "CANARY_UNPRICED": return word("failUnpriced");
    case "WALLET_REFUSED": return word("failWallet");
    case "SIMULATION_FAILED": return word("failSimulation");
    case "PREVIEW_EXPIRED": case "TICKET_EXPIRED": return word("failExpired");
    case "SIDE_NOT_ACCEPTED": return word("failSides");
    case "AMOUNT_ZERO": return word("failZero");
    case "NOTHING_TO_CLAIM": case "NOTHING_TO_WITHDRAW": return word("failNothing");
    case "POSITION_LOCKED": return word("failLocked");
    case "FEES_GO_ELSEWHERE": return word("failElsewhere");
    case "NOT_OWNER": case "POSITION_NOT_FOUND": return word("failNotOwner");
    case "RATE_LIMITED": return word("failBusy");
    case "NETWORK": return word("failNetwork");
    default: return word("failGeneral");
  }
}

const NOTICE: Readonly<Record<LiquidityNotice, PoolsWord>> = {
  one_sided: "noticeOneSided",
  partial_deposit: "noticePartial",
  out_of_range: "noticeOut",
  locked_part_stays: "noticeLocked",
  rewards_separate: "noticeRewards",
  transfer_fee: "noticeTransferFee",
};

export function noticeTexts(notices: readonly LiquidityNotice[], word: Word): string[] {
  return notices.map((notice) => word(NOTICE[notice]));
}

export function sol(lamports: string | bigint | number, numberLocale: string): string {
  return `${formatAmount(Number(lamports) / 1e9, numberLocale, 6)} SOL`;
}

/** The SOL line of a Review's total: what it costs, or — when a closed account's rent comes back — what returns. */
export function solTotal(review: LiquidityReview, word: Word, numberLocale: string): string {
  const spent = solSpent(review);
  return spent < 0n ? `+${sol(-spent, numberLocale)} ${word("solBack")}` : sol(spent, numberLocale);
}

/** The network fee and every rent on its own line: paid, or returned. */
export function chainCosts(review: LiquidityReview, word: Word, numberLocale: string): ReviewLine[] {
  const lines: ReviewLine[] = [{ label: word("network"), value: sol(review.networkFeeLamports, numberLocale) }];
  for (const rent of review.preview.rent) lines.push({ label: rentLabel(rent, word), value: `${rent.direction === "return" ? "+" : ""}${sol(rent.lamports, numberLocale)}` });
  return lines;
}

function rentLabel(rent: RentCost, word: Word): string {
  if (rent.direction === "return") return word("rentBack");
  return rent.what === "position" ? word("rentPosition") : rent.what === "bin_arrays" ? word("rentBins") : word("rentBitmap");
}

/** What the person pays in SOL beyond the deposit: the network and the rents paid, less the rents returned. */
export function solSpent(review: LiquidityReview): bigint {
  let total = BigInt(review.networkFeeLamports);
  for (const rent of review.preview.rent) total += rent.direction === "pay" ? BigInt(rent.lamports) : -BigInt(rent.lamports);
  return total;
}

export function short(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

/**
 * The receipt of a relay: done when every transaction landed, waiting while one is unread (the chain is asked again),
 * failed otherwise. The amount is shown only for what landed: in full when everything did, and never for a transaction
 * the chain has not confirmed.
 */
export function RelayReceipt({ relay: answered, at, title, amount, word, lang, numberLocale }: { relay: LiquidityRelay; at: number; title: string; amount: string; word: Word; lang: "en" | "uk"; numberLocale: string }) {
  const relay = useFollowedRelay(answered);
  const states = relay.results.map((result) => result.state);
  const status = relay.settled ? "completed" : states.includes("UNKNOWN") ? "pending" : "failed";
  const landed = states.filter((state) => state === "LANDED").length;
  const first = relay.results[0]?.signature ?? "";
  const last = [...relay.results].reverse().find((result) => result.state !== "NOT_SENT")?.signature ?? first;
  return (
    <Receipt
      lang={lang}
      variant="full"
      titleAs="h2"
      title={status === "completed" ? title : status === "pending" ? word("receiptPending") : word("receiptFailed")}
      status={status}
      amount={status === "completed" ? amount : "—"}
      time={new Date(at).toLocaleTimeString(numberLocale)}
      network="Solana"
      transaction={`${short(last)}${relay.results.length > 1 ? ` · ${landed}/${relay.results.length}` : ""}`}
      reason={status === "failed" ? (landed === 0 ? word("receiptNothing") : `${landed} ${word("receiptPart")} ${relay.results.length} ${word("receiptPartLanded")}`) : undefined}
      onVerify={() => window.open(explorerTxUrl("mainnet", last), "_blank", "noopener,noreferrer")}
      actionsDisabled={false}
    />
  );
}
