/**
 * The lines of a receipt's execution truth (SOL-X1), in order: what arrived, the same route without Ryntra's fee,
 * the quote against the fill, Ryntra's fee, the protocol's part, the network, the priority, a tip, the cashback.
 * Pure — every figure from the receipt's own facts (`lib/solana/receipt-truth.ts`) and the ledger's cashback row;
 * a figure the facts do not carry says so instead of showing a number.
 */

import { cashbackOf, type CashbackByTrade } from "../../../../lib/core/execution-truth.ts";
import type { ReceiptTruth } from "../../../../lib/solana/receipt-truth.ts";
import { amountText, rateText, solText, usdMicrosText } from "./truth-format.ts";
import { truthWords, type TruthWord } from "./truth-words.ts";

export type TruthLine = Readonly<{ key: string; label: string; value: string; tone?: "good" | "bad" }>;

/** `PENDING` — the trade just settled and its cashback is being written: the swap card says where it will be. */
export type TruthCashbackInput = readonly CashbackByTrade[] | null | "PENDING";

export function truthHero(read: ReceiptTruth, locale: "en" | "uk"): Readonly<{ label: string; value: string }> {
  const word = truthWords(locale);
  const { truth, assets } = read;
  return { label: word("received"), value: amountText(truth.received.raw, truth.received.mint, assets, locale) ?? word("noScale") };
}

export function truthLines(read: ReceiptTruth, cashbackRows: TruthCashbackInput, locale: "en" | "uk"): readonly TruthLine[] {
  const word = truthWords(locale);
  const { truth, assets } = read;
  const amount = (raw: string | null, mint: string | null) => (raw === null ? null : amountText(raw, mint, assets, locale));
  const lines: TruthLine[] = [];

  /* The same route without Ryntra's fee. */
  const direct = truth.direct;
  const directValue = (() => {
    if (!direct) {
      switch (truth.directNotSized) {
        case "FEE_IN_THIRD_TOKEN":
          return word("directUnknown");
        case "FEE_MINT_UNSTATED":
          return word("directNoMint");
        case "FEE_NOT_BELOW_SPENT":
          return word("directNotBelow");
        default:
          return word("directUnread");
      }
    }
    /* A launch's pool fee carries Ryntra's part: «took no fee» would be false there. */
    if (direct.basis === "SAME") return word(truth.kind === "launch" ? "directSameLaunch" : "directSame");
    const figure = amount(direct.raw, truth.received.mint) ?? word("noScale");
    const gap = direct.gapBps === null ? word("noScale") : rateText(direct.gapBps, locale);
    const value = word(direct.basis === "EXACT" ? "directExact" : "directEstimate", { amount: figure, gap });
    return direct.orderDefaultFee ? `${value} · ${word("directOrderDefault")}` : value;
  })();
  lines.push({ key: "direct", label: word("direct"), value: directValue });

  /* The quote against what the chain shows arrived. */
  const quoted = amount(truth.quotedRaw, truth.received.mint) ?? word("noScale");
  const filled = amount(truth.received.raw, truth.received.mint) ?? word("noScale");
  const gap = truth.quoteGapBps === null ? word("noScale") : rateText(truth.quoteGapBps, locale, true);
  lines.push({
    key: "quote",
    label: word("quote"),
    value: `${word("quoteLine", { quoted, filled, gap })} · ${word(truth.minimumMet ? "minimumMet" : "minimumMissed")}`,
    ...(truth.minimumMet ? {} : { tone: "bad" as const }),
  });

  /* Ryntra's fee, as the chain settled it. */
  const fee = truth.ryntra;
  const rate = rateText(fee.bps, locale);
  const ryntraValue = (() => {
    switch (fee.state) {
      case "CHARGED": {
        const paid = amount(fee.paidRaw, fee.mint);
        const head = paid ? word("ryntraCharged", { rate, amount: paid }) : rate;
        return fee.providerPercent && fee.providerPercent > 0 ? `${head} · ${word("providerShare", { pct: `${fee.providerPercent} %` })}` : head;
      }
      case "NOT_CHARGED":
        return word("ryntraNotCharged", { rate });
      case "UNREAD":
        return word("ryntraUnread", { rate });
      default: {
        /* A launch: nothing on top, and Ryntra's part of the pool fee named — never «None». */
        if (truth.kind === "launch") {
          const part = amount(truth.protocol.poolRyntraRaw, truth.protocol.poolMint);
          return part ? word("ryntraLaunch", { part }) : word("ryntraLaunchUnsized");
        }
        return word("ryntraNone");
      }
    }
  })();
  lines.push({ key: "ryntra", label: word("ryntra"), value: ryntraValue });

  /* The protocol's part: Jupiter's own beyond Ryntra's, or a launch pool's fee with Ryntra's part inside it. */
  const protocol = truth.protocol;
  const protocolValue = (() => {
    if (protocol.poolFeeRaw !== null) {
      const total = amount(protocol.poolFeeRaw, protocol.poolMint) ?? word("noScale");
      const part = amount(protocol.poolRyntraRaw, protocol.poolMint) ?? word("noScale");
      return word("poolFee", { amount: total, part });
    }
    if (protocol.jupiterBps === null) return word("jupiterUnknown");
    return protocol.jupiterBps === 0 ? word("jupiterNone") : word("jupiterOwn", { rate: rateText(protocol.jupiterBps, locale) });
  })();
  lines.push({ key: "protocol", label: word("protocol"), value: protocolValue });

  /* The network, the priority, a tip. */
  const lamports = (value: string | null) => (value === null ? word("notInReceipt") : solText(value, locale));
  lines.push({ key: "network", label: word("network"), value: lamports(truth.network.baseLamports) });
  lines.push({ key: "priority", label: word("priority"), value: lamports(truth.network.priorityLamports) });
  lines.push({ key: "tip", label: word("tip"), value: truth.network.tipLamports === "0" ? word("tipZero") : word("tipUnknown") });

  /* The cashback the ledger holds for this trade's signature. */
  lines.push({ key: "cashback", label: word("cashback"), ...cashbackLine(read, cashbackRows, word, locale) });
  return lines;
}

function cashbackLine(
  read: ReceiptTruth,
  rows: TruthCashbackInput,
  word: (key: TruthWord, vars?: Readonly<Record<string, string | number>>) => string,
  locale: "en" | "uk",
): Readonly<{ value: string; tone?: "good" }> {
  /* No cashback without a fee only where the chain shows none taken; an unread fee leaves the ledger the only word. */
  const noFee = read.truth.ryntra.state === "NONE" || read.truth.ryntra.state === "NOT_CHARGED";
  const cashback = rows === "PENDING" ? null : cashbackOf(read.truth.signature, rows);
  if (cashback?.state === "CREDITED") {
    if (cashback.usdMicros === null) return { value: word("cashbackUnvalued"), tone: "good" };
    const usd = usdMicrosText(cashback.usdMicros, locale);
    return { value: cashback.held ? word("cashbackHeld", { usd: `+${usd}` }) : `+${usd}`, tone: "good" };
  }
  /* A trade with no Ryntra fee on it earns none, a launch trade's pool fee aside: there the ledger is the only word. */
  if (noFee && read.truth.kind === "swap") return { value: word("cashbackNoFee") };
  if (rows === "PENDING") return { value: word("cashbackPending") };
  if (cashback?.state === "NOT_SHOWN") return { value: word("cashbackNotShown") };
  return { value: word("cashbackNone") };
}
