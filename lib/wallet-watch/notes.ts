/**
 * The words of a followed wallet's note (SOL-R4): what the wallet did, with the token, the amount it paid or got and
 * where it was read — a fact, a number, a source and the time in UTC, never advice. Pure.
 */

import type { WalletLabel, WalletTrade } from "./trades.ts";

export type NoteLocale = "en" | "uk";
export type NoteWords = Readonly<{ title: string; reason: string }>;

export function shortAddress(address: string): string {
  return address.length > 10 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address;
}

const NUMBER_LOCALE: Record<NoteLocale, string> = { en: "en-US", uk: "uk-UA" };

/** A quote leg as a person reads it: SOL to four figures that matter, dollars to the cent. */
export function quoteText(trade: Pick<WalletTrade, "quote" | "quoteAmount">, locale: NoteLocale): string | null {
  if (trade.quote === null || trade.quoteAmount === null) return null;
  if (trade.quote === "SOL") {
    const digits = trade.quoteAmount >= 100 ? 1 : trade.quoteAmount >= 1 ? 2 : 4;
    return `${new Intl.NumberFormat(NUMBER_LOCALE[locale], { maximumFractionDigits: digits }).format(trade.quoteAmount)} SOL`;
  }
  return `${new Intl.NumberFormat(NUMBER_LOCALE[locale], { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(trade.quoteAmount)} ${trade.quote}`;
}

/** Whole tokens, compact: «12,4 млн» / «12.4M». */
export function tokenAmountText(trade: Pick<WalletTrade, "tokensRaw" | "decimals">, locale: NoteLocale): string {
  const amount = Number(trade.tokensRaw) / 10 ** trade.decimals;
  return new Intl.NumberFormat(NUMBER_LOCALE[locale], { notation: "compact", maximumFractionDigits: 1 }).format(amount);
}

function utc(at: number | null): string | null {
  return at === null ? null : new Date(at * 1000).toISOString().slice(11, 16);
}

const LABEL_WORD: Record<NoteLocale, Record<WalletLabel, string>> = {
  en: { creator: "creator", sniper: "sniper", bundle: "bundle" },
  uk: { creator: "творець", sniper: "снайпер", bundle: "бандл" },
};

function source(at: number | null, locale: NoteLocale): string {
  const time = utc(at);
  if (locale === "uk") return time ? `За даними ланцюга Solana, ${time} UTC.` : "За даними ланцюга Solana.";
  return time ? `From the Solana chain, ${time} UTC.` : "From the Solana chain.";
}

/** One trade's note. `who` — the wallet's name or its short address; `symbol` — the ticker, or the mint's short form. */
export function tradeNote(trade: WalletTrade, who: string, symbol: string, labels: readonly WalletLabel[], locale: NoteLocale): NoteWords {
  const paid = quoteText(trade, locale);
  const amount = tokenAmountText(trade, locale);
  const creatorSells = trade.side === "sell" && labels.includes("creator");
  const marks = labels.filter((label) => label !== "creator");
  const markLine = marks.length === 0 ? "" : locale === "uk" ? ` Позначка: ${marks.map((label) => LABEL_WORD.uk[label]).join(", ")}.` : ` Label: ${marks.map((label) => LABEL_WORD.en[label]).join(", ")}.`;
  if (locale === "uk") {
    if (creatorSells) return { title: `Творець ${symbol} продає`, reason: `${who} продав ${amount} ${symbol}${paid ? ` за ${paid}` : ""}. ${source(trade.at, locale)}` };
    const verb = trade.side === "buy" ? (trade.paidBy ? "отримав" : "купив") : "продав";
    const by = trade.paidBy ? ` — заплатив гаманець ${shortAddress(trade.paidBy)}` : "";
    return { title: `${who} ${verb} ${symbol}${paid ? ` за ${paid}` : ""}`, reason: `${amount} ${symbol}${by}. ${source(trade.at, locale)}${markLine}` };
  }
  if (creatorSells) return { title: `The creator of ${symbol} is selling`, reason: `${who} sold ${amount} ${symbol}${paid ? ` for ${paid}` : ""}. ${source(trade.at, locale)}` };
  const verb = trade.side === "buy" ? (trade.paidBy ? "got" : "bought") : "sold";
  const by = trade.paidBy ? ` — paid by ${shortAddress(trade.paidBy)}` : "";
  return { title: `${who} ${verb} ${symbol}${paid ? ` for ${paid}` : ""}`, reason: `${amount} ${symbol}${by}. ${source(trade.at, locale)}${markLine}` };
}

/** «4 нові угоди», «5 нових угод», «21 нова угода». */
function ukTrades(count: number): string {
  const ten = count % 10;
  const hundred = count % 100;
  if (ten === 1 && hundred !== 11) return `${count} нова угода`;
  if (ten >= 2 && ten <= 4 && (hundred < 12 || hundred > 14)) return `${count} нові угоди`;
  return `${count} нових угод`;
}

/** Several trades at once in one note: which tokens were bought and which sold, newest first. */
export function burstNote(trades: readonly WalletTrade[], who: string, symbolOf: (mint: string) => string, locale: NoteLocale): NoteWords {
  const list = (side: "buy" | "sell") => [...new Set(trades.filter((trade) => trade.side === side).map((trade) => symbolOf(trade.mint)))].slice(0, 4);
  const bought = list("buy");
  const sold = list("sell");
  const newest = trades.reduce<number | null>((at, trade) => (trade.at !== null && (at === null || trade.at > at) ? trade.at : at), null);
  if (locale === "uk") {
    const parts = [bought.length ? `Купив ${bought.join(", ")}` : null, sold.length ? `${bought.length ? "продав" : "Продав"} ${sold.join(", ")}` : null].filter(Boolean);
    return { title: `${who}: ${ukTrades(trades.length)}`, reason: `${parts.join("; ")}. ${source(newest, locale)}` };
  }
  const parts = [bought.length ? `Bought ${bought.join(", ")}` : null, sold.length ? `${bought.length ? "sold" : "Sold"} ${sold.join(", ")}` : null].filter(Boolean);
  return { title: `${who}: ${trades.length} new trades`, reason: `${parts.join("; ")}. ${source(newest, locale)}` };
}

export const NOTE_CTA: Record<NoteLocale, string> = { en: "Open the wallet", uk: "Відкрити гаманець" };
