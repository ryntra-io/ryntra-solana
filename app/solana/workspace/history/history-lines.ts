/**
 * An operation as a person reads it — what happened, what it was against, and
 * where it stands — for History's rows and Home's «Останні операції» alike, so
 * the two never word one operation two ways. Pure: the row and the page's
 * `text` in, the words out.
 */

import { crossSwapTarget } from "../../../../lib/solana/action-lanes.ts";
import type { SolanaWalletAction } from "../../../../lib/solana/action-ledger.ts";
import { isLaunchOrigin, isSpotOrigin } from "../../../../lib/solana/action-origin.ts";
import { displayAmount, scaleRawAmount } from "../../../../lib/solana/amounts.ts";
import { historyPage } from "../../../../lib/solana/history-view.ts";

type Text = (value: string) => string;

/** A leg as a person reads it, or null when its scale or identity is unknown. */
export function leg(movement: SolanaWalletAction["out"]): string | null {
  if (movement === null) return null;
  const name = movement.symbol;
  if (movement.decimals === null) return name;
  const amount = displayAmount(movement.amountRaw, movement.decimals);
  return name === null ? amount : `${amount} ${name}`;
}

export function legNumber(movement: SolanaWalletAction["out"]): number | null {
  if (movement === null || movement.decimals === null) return null;
  const value = Number(scaleRawAmount(movement.amountRaw, movement.decimals).replace(/,/g, ""));
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * A launched token's count as a row's title says it: 47.3K, 1.7M from ten thousand up, else a few places — a new token is
 * bought in hundreds of thousands, and its whole figure would push its name off a phone's line. The row's own details
 * keep the exact figure.
 */
function tokenLeg(movement: SolanaWalletAction["out"]): string | null {
  const value = legNumber(movement);
  if (movement === null || value === null) return leg(movement);
  const amount =
    value >= 10_000
      ? new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value)
      : value.toLocaleString("en-US", { maximumFractionDigits: value >= 1 ? 2 : 6 });
  return movement.symbol === null ? amount : `${amount} ${movement.symbol}`;
}

export type ActionLines = Readonly<{ title: string; sub: string; side: "BUY" | "SELL" | null }>;

/** The row's two lines: what happened, and what it was against. */
export function describeAction(action: SolanaWalletAction, text: Text): ActionLines {
  const out = leg(action.out);
  const got = leg(action.in);
  const page = historyPage(action);
  if (page === "BRIDGE" && action.lane === "BRIDGE") {
    const amount = action.destination === "SOLANA" ? (got ?? out) : (out ?? got);
    const where =
      action.destination === "SOLANA" ? text("to Solana") : action.destination === "BASE" ? text("to Base") : action.destination === "ETHEREUM" ? text("to Ethereum") : null;
    return { title: amount ? `${text("Moved")} ${amount}` : text("Moved"), sub: where ? `${text("Between networks")} · ${where}` : text("Between networks"), side: null };
  }
  if (page === "BRIDGE" && action.lane === "CROSS_SWAP") {
    const target = crossSwapTarget(action.destination, text);
    const title = out && got ? `${text("Swapped")} ${out} → ${got}` : out ? `${text("Swapped")} ${out}` : text("Swapped");
    return { title, sub: target ? `${text("Between networks")} · ${target}` : text("Between networks"), side: null };
  }
  if (page === "SPOT" && isSpotOrigin(action.origin)) {
    const buy = action.origin.side === "BUY";
    const asset = buy ? got : out;
    const counter = buy ? out : got;
    const verb = buy ? text("Bought") : text("Sold");
    /* A purchase under an autoinvest reminder says so — the receipt's mark of the rule (1.12.0). */
    const where = action.origin.rule ? text("Recurring buy") : text("Spot");
    return {
      title: asset ? `${verb} ${asset}` : verb,
      sub: counter ? `${buy ? text("for") : text("received")} ${counter} · ${where}` : where,
      side: buy ? "BUY" : "SELL",
    };
  }
  if (page === "LAUNCH" && isLaunchOrigin(action.origin)) {
    /* A launch's trade reads like a purchase or a sale on Spot, under the place it was made. */
    const buy = action.origin.side === "BUY";
    const asset = tokenLeg(buy ? action.in : action.out);
    const counter = buy ? out : got;
    const verb = buy ? text("Bought") : text("Sold");
    return {
      title: asset ? `${verb} ${asset}` : verb,
      sub: counter ? `${buy ? text("for") : text("received")} ${counter} · ${text("Launch")}` : text("Launch"),
      side: buy ? "BUY" : "SELL",
    };
  }
  if (page === "SWAP") {
    const title = out && got ? `${text("Swapped")} ${out} → ${got}` : out ? `${text("Swapped")} ${out}` : text("Swapped");
    return { title, sub: text("Swap"), side: null };
  }
  if (page === "RECEIVE") return { title: got ? `${text("Received")} ${got}` : text("Received"), sub: text("Receive"), side: null };
  return { title: out ? `${text("Sent")} ${out}` : text("Sent"), sub: text("Send"), side: null };
}

/** Where the operation stands, in one word. */
export function actionStateWord(outcome: SolanaWalletAction["outcome"], text: Text): string {
  if (outcome === "DONE") return text("Arrived");
  if (outcome === "FAILED") return text("Did not happen");
  if (outcome === "NEEDS_YOU") return text("Needs you");
  return text("On its way");
}
