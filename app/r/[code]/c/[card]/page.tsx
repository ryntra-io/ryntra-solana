import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { FrozenFooter } from "@/app/site/frozen/chrome";
import { MarkDefs } from "@/app/site/frozen/mark";
import { PublicHeader } from "@/app/site/frozen/public-header";
import "@/app/site/frozen/primitives.css";
import "@/app/site/frozen/module.css";
import { cardOrigin } from "@/app/api/growth/cards/origin";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { cardPercent, cardWords } from "@/lib/growth/card-copy";
import { readTradeCard } from "@/lib/growth/card-store";
import { heldDays, tradeCardImagePath, tradeCardPath, type TradeCard } from "@/lib/growth/trade-cards";
import { normalizeReferralCode } from "@/lib/rewards/referral";
import { normalizePublicLocale, PUBLIC_LOCALE_COOKIE } from "@/lib/site/locale";

import styles from "./card-page.module.css";

/**
 * `/r/<code>/c/<card>` — an invitation with a trade card on it: the link a
 * card is posted as.
 *
 * The page itself asks nothing of whoever opens it and writes nothing: its
 * actions go through `/r/<code>`, which remembers the code in this browser
 * and lands the person where they chose — the token, or how cashback works.
 * It speaks the reader's language when they chose one on this site, else the
 * language the card was posted in; the picture keeps its own. Its preview on X is the card's own versioned picture. Not for search engines:
 * it is one person's post, not a page of the site.
 */

export const dynamic = "force-dynamic";

type Params = Promise<{ code: string; card: string }>;

async function origin(): Promise<string> {
  return cardOrigin(await headers());
}

async function cardOf(params: Params): Promise<{ code: string; card: TradeCard | null }> {
  const { code, card } = await params;
  const found = await readTradeCard(getGuardRuntime().store, card).catch(() => null);
  return { code, card: found };
}

function figureOf(card: TradeCard, locale: "en" | "uk" = card.locale): string | null {
  return card.trade.kind === "SELL" && card.trade.resultBps !== null ? cardPercent(card.trade.resultBps, locale) : null;
}

/** Days the closed position was held, for a sale; nothing for a buy. */
function daysOf(card: TradeCard): number | null {
  return card.trade.kind === "SELL" ? heldDays(card.trade.openedAt, card.trade.at) : null;
}

/** The reader's own choice of language on this site, else the card's. */
async function readerLocale(card: TradeCard): Promise<"en" | "uk"> {
  const chosen = (await cookies()).get(PUBLIC_LOCALE_COOKIE)?.value;
  return chosen ? normalizePublicLocale(chosen) : card.locale;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { card } = await cardOf(params);
  if (!card) return { robots: { index: false, follow: false } };
  const word = cardWords(card.locale);
  const base = await origin();
  const title = word.tradeLine(card.token.symbol, figureOf(card), daysOf(card));
  const image = { url: `${base}${tradeCardImagePath(card)}`, width: 1200, height: 630, alt: word.alt(card.token.symbol, figureOf(card)) };
  return {
    title,
    description: `${word.pageLead} ${word.offerWhy}.`,
    robots: { index: false, follow: false },
    openGraph: { type: "website", url: `${base}${tradeCardPath(card)}`, title, description: `${word.pageLead} ${word.offerWhy}.`, siteName: "Ryntra", images: [image], locale: card.locale === "uk" ? "uk_UA" : "en_US" },
    twitter: { card: "summary_large_image", title, description: `${word.pageLead} ${word.offerWhy}.`, images: [image] },
  };
}

export default async function TradeCardPage({ params }: { params: Params }) {
  const { code, card } = await cardOf(params);
  /* A card that is not there is still an invitation: the plain link does what it always did. */
  if (!card) redirect(`/r/${encodeURIComponent(normalizeReferralCode(code) ?? code)}`);

  const locale = await readerLocale(card);
  const word = cardWords(locale);
  const figure = figureOf(card, locale);
  const through = (to: string) => `/r/${encodeURIComponent(card.code)}?to=${encodeURIComponent(to)}`;

  return (
    <div className="rx" data-ry-ground="midnight">
      <MarkDefs />
      <PublicHeader locale={locale} mainId="main" ctaTone="quiet" />
      <main id="main" className={`rx-shell ${styles.page}`}>
        <figure className={styles.figure}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={styles.card} src={tradeCardImagePath(card)} width={1200} height={630} alt={cardWords(card.locale).alt(card.token.symbol, figureOf(card))} />
        </figure>
        <div className={styles.text}>
          <h1 className={styles.title}>{word.tradeLine(card.token.symbol, figure, daysOf(card))}</h1>
          <p className={styles.lead}>{word.pageLead}</p>
          <div className={styles.actions}>
            <a className="rx-btn rx-btn--primary" href={through(`/app/spot?mint=${card.token.mint}`)}>
              {word.open(card.token.symbol)}
            </a>
            <a className="rx-btn rx-btn--ghost" href={through("/app/rewards")}>
              {word.howCashback}
            </a>
          </div>
          <p className={`rx-fine ${styles.note}`}>
            {card.token.stock ? word.pageRiskStock : word.pageRisk}
          </p>
        </div>
      </main>
      <FrozenFooter locale={locale} />
    </div>
  );
}
