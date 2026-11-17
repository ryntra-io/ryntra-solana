import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { readCoinCard } from "@/city/lib/coin/read.server";
import { isMint } from "@/city/lib/search/mint";
import { coinLink } from "@/city/lib/share/coin-link";
import { isLinkPreview } from "@/lib/growth/link-opens";

import { CoinScreen } from "@/terminal/coin/CoinScreen";
import { mintOf } from "@/terminal/coin/coin-view";
import { shelfOn } from "@/terminal/shell/shelves";

import { buildTerminalMetadata, SITE, SITE_NAME, TWITTER } from "../../../seo";

type Props = { params: Promise<{ mint: string }> };

/* A coin's preview in a post: its own card (`/c/<mint>/opengraph-image`, read again every five minutes), its symbol and
   name — read only for a link preview's robot, so a person's screen never waits on the read. One page per mint, scams'
   among them: shared, never offered to the index. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { mint } = await params;
  const preview = isLinkPreview((await headers()).get("user-agent"));
  const coin = preview && isMint(mint) ? await readCoinCard(mint).catch(() => null) : null;
  const url = `${SITE}/coin/${encodeURIComponent(mint)}`;
  if (!coin) return { ...buildTerminalMetadata(), alternates: { canonical: url }, robots: { index: false, follow: true } };
  const symbol = coin.symbol.toUpperCase();
  const title = `$${symbol} on Ryntra`;
  const description = `${coin.name} ($${symbol}) on Ryntra: price, chart and a one-tap trade from your own wallet — or tell your agent to trade it.`;
  const image = `${coinLink(mint)}/opengraph-image`;
  return {
    title: { absolute: title },
    description,
    robots: { index: false, follow: true },
    alternates: { canonical: url },
    openGraph: { type: "website", siteName: SITE_NAME, title, description, url, images: [image] },
    twitter: { card: "summary_large_image", site: TWITTER, title, description, images: [image] },
  };
}

/* One coin's own screen: its price, its chart, the ticket to buy or sell it, the facts and the person's own under the
   chart. Any Solana mint opens it; an address that is not one is not a coin. */
export default async function Page({ params }: Props) {
  const { mint } = await params;
  const coin = mintOf(mint);
  if (!shelfOn("market") || !coin) notFound();
  return <CoinScreen key={coin} mint={coin} />;
}
