import QRCode from "qrcode";

import { rankBadgeSvg } from "./badges.ts";
import { cardDollars, cardPercent, cardPeriod, cardPrice, cardWords, priceDecimals, type CardLocale } from "./card-copy.ts";
import { heldDays, tradeCardPath, unitPrice, type TradeCard } from "./trade-cards.ts";

/**
 * The face of a trade card: every word and figure it shows, already written,
 * in one plain object.
 *
 * The same face is drawn three ways — the still picture X shows under the
 * link (`card-art.tsx`), the live card in the app and on the invitation page,
 * and the film a person can post (`card-scene.ts` on a canvas). Writing it
 * once, here, from the stored card, keeps the three saying the same thing:
 * nothing is formatted or counted twice.
 *
 * The counting in the live card ends on `resultBps` — the receipts' figure —
 * and the still picture is that last frame.
 */

/** up / down: a sale's gain or loss — the same size, the same place, its own colour; flat: a sale at cost; buy: a price, not a result. */
export type CardTone = "up" | "down" | "flat" | "buy";

export type CardFace = Readonly<{
  locale: CardLocale;
  kind: "SELL" | "BUY";
  tone: CardTone;
  symbol: string;
  /** Drawn in the token's circle when it has no picture. */
  letter: string;
  /** The token's picture as a data address, or null. */
  icon: string | null;
  kindLabel: string;
  /** The biggest line: a sale's result, or a buy's price. */
  headline: string;
  /** Over a buy's price: «Price». */
  headlineLabel: string | null;
  /** A sale's result in hundredths of a percent — what the live card counts to. */
  resultBps: number | null;
  /** A sale's average entry and exit, and exit ÷ entry for the bars. */
  ladder: Readonly<{ entryLabel: string; entry: string; exitLabel: string; exit: string; ratio: number }> | null;
  /** Dollar figures — only when the person chose them. */
  facts: readonly Readonly<{ label: string; value: string; tone: CardTone | null }>[];
  /** The days the trade covers, and how long the position was held. */
  period: string;
  rank: Readonly<{ name: string; badge: string }> | null;
  /** The QR of the card's own link: `size` × `size` modules, row by row, «1» dark. */
  qr: Readonly<{ size: number; bits: string }>;
  join: string;
  /** The link as printed: no scheme. */
  link: string;
  offer: string;
  offerWhy: string;
  /** Where the figures come from. */
  seal: string;
  risk: string;
  alt: string;
}>;

function svgUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

export function cardTone(card: Pick<TradeCard, "trade">): CardTone {
  if (card.trade.kind !== "SELL" || card.trade.resultBps === null) return "buy";
  return card.trade.resultBps > 0 ? "up" : card.trade.resultBps < 0 ? "down" : "flat";
}

/** The card's face as `locale` reads it; the picture keeps the card's own language. */
export function cardFace(card: TradeCard, origin: string, icon: string | null): CardFace {
  const locale = card.locale;
  const word = cardWords(locale);
  const trade = card.trade;
  const sell = trade.kind === "SELL";
  const cost = BigInt(trade.costMicros);
  const proceeds = trade.proceedsMicros === null ? null : BigInt(trade.proceedsMicros);
  const quantity = BigInt(trade.quantityRaw);
  const result = sell ? trade.resultBps : null;
  const entry = unitPrice(cost, quantity, trade.decimals);
  const exit = proceeds === null ? null : unitPrice(proceeds, quantity, trade.decimals);
  const days = sell ? heldDays(trade.openedAt, trade.at) : null;
  const period = sell ? cardPeriod(trade.openedAt, trade.at, locale) : cardPeriod(null, trade.at, locale);
  /* One count of decimals for entry and exit, so the two read alike. */
  const decimals = entry !== null && exit !== null ? priceDecimals([entry, exit]) : undefined;
  const tone = cardTone(card);

  const headline = sell && result !== null ? cardPercent(result, locale) : entry !== null ? cardPrice(entry, locale, decimals) : card.token.symbol;
  const ladder =
    sell && entry !== null && exit !== null && entry > 0
      ? { entryLabel: word.entry, entry: cardPrice(entry, locale, decimals), exitLabel: word.exit, exit: cardPrice(exit, locale, decimals), ratio: exit / entry }
      : null;

  const facts: { label: string; value: string; tone: CardTone | null }[] = [];
  if (card.amounts) {
    if (sell && proceeds !== null) facts.push({ label: word.pnl, value: cardDollars(proceeds - cost, locale, true), tone });
    if (!sell) facts.push({ label: word.paid, value: cardDollars(cost, locale), tone: null });
  }

  const qr = QRCode.create(`${origin}${tradeCardPath(card)}`, { errorCorrectionLevel: "M" });
  const size = qr.modules.size;
  let bits = "";
  for (let i = 0; i < size * size; i += 1) bits += qr.modules.data[i] ? "1" : "0";

  return {
    locale,
    kind: trade.kind,
    tone,
    symbol: card.token.symbol,
    letter: (card.token.symbol.match(/[\p{L}\p{N}]/u)?.[0] ?? "?").toUpperCase(),
    icon,
    kindLabel: word.kind[trade.kind],
    headline,
    headlineLabel: sell ? null : word.price,
    resultBps: result,
    ladder,
    facts,
    period: days !== null ? `${period} · ${word.held(days)}` : period,
    rank: card.rank ? { name: word.rank(card.rank), badge: svgUri(rankBadgeSvg(card.rank, { id: "card", size: 52 })) } : null,
    qr: { size, bits },
    join: word.join,
    link: `${origin.replace(/^https?:\/\//, "")}/r/${card.code}`,
    offer: word.offer,
    offerWhy: word.offerWhy,
    seal: word.through,
    risk: card.token.stock ? word.riskStock : word.risk,
    alt: word.alt(card.token.symbol, sell && result !== null ? cardPercent(result, locale) : null),
  };
}
