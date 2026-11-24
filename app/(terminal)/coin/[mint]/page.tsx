import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { readCoinCard } from "@/city/lib/coin/read.server";
import { isMint } from "@/city/lib/search/mint";
import { isLinkPreview } from "@/lib/growth/link-opens";
import { creatorOpen } from "@/lib/spot/creator-scan.server";

import { CoinScreen } from "@/terminal/coin/CoinScreen";
import { SHARE_CARD_SIZE, coinCardPath } from "@/terminal/share/cards";
import { mintOf } from "@/terminal/coin/coin-view";
import { shelfOn } from "@/terminal/shell/shelves";

import { buildTerminalMetadata, SITE, SITE_NAME, TWITTER } from "../../../seo";

type Props = { params: Promise<{ mint: string }> };

/* A coin's preview in a post: its own card (`/c/<mint>/opengraph-image?v=…`, `terminal/share/coin.server.tsx` — its
   logo, its figures, read again every five minutes), its symbol and name — read only for a link preview's robot, so a
   person's screen never waits on the read. One page per mint, scams' among them: shared, never offered to the index. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { mint } = await params;
  const preview = isLinkPreview((await headers()).get("user-agent"));
  const coin = preview && isMint(mint) ? await readCoinCard(mint).catch(() => null) : null;
  const url = `${SITE}/coin/${encodeURIComponent(mint)}`;
  const card = { url: `${SITE}${coinCardPath(mint)}`, ...SHARE_CARD_SIZE };
  if (!coin) {
    /* Not read (a person, or the read was slow): the coin's card still, which reads the coin itself; home's for an address that is no mint. */
    const base = buildTerminalMetadata();
    if (!isMint(mint)) return { ...base, alternates: { canonical: url }, robots: { index: false, follow: true } };
    const image = { ...card, alt: "A Solana coin on Ryntra" };
    return { ...base, alternates: { canonical: url }, robots: { index: false, follow: true }, openGraph: { ...base.openGraph, url, images: [image] }, twitter: { ...base.twitter, images: [image.url] } };
  }
  // The ticker as the coin writes it — «$TSLAx», never «$TSLAX».
  const symbol = coin.symbol.replace(/^\$+/u, "");
  const title = `$${symbol} on Ryntra`;
  const description = `${coin.name} ($${symbol}) on Ryntra: price, chart and a one-tap trade from your own wallet — or tell your agent to trade it.`;
  const image = { ...card, alt: `$${symbol} — ${coin.name} on Ryntra` };
  return {
    title: { absolute: title },
    description,
    robots: { index: false, follow: true },
    alternates: { canonical: url },
    openGraph: { type: "website", siteName: SITE_NAME, title, description, url, images: [image] },
    twitter: { card: "summary_large_image", site: TWITTER, title, description, images: [image.url] },
  };
}

/* One coin's own screen: its price, its chart, the ticket to buy or sell it, the facts and the person's own under the
   chart. Any Solana mint opens it; an address that is not one is not a coin. */
export default async function Page({ params }: Props) {
  const { mint } = await params;
  const coin = mintOf(mint);
  if (!shelfOn("market") || !coin) notFound();
  return <CoinScreen key={coin} mint={coin} creator={creatorOpen()} />;
}
