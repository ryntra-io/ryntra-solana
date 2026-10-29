import type { Metadata, Viewport } from "next";
import { Hubot_Sans, Mona_Sans } from "next/font/google";

import { CityApp } from "@/city/components/CityApp";
import { CoinOpener } from "@/city/components/coin/CoinOpener";
import { factsOf, readCoinCard } from "@/city/lib/coin/read.server";
import { BUNDLED_CITY } from "@/city/lib/market/bundled";
import { PALETTE } from "@/city/lib/palette";
import { isMint } from "@/city/lib/search/mint";
import { coinLink } from "@/city/lib/share/coin-link";
import s from "@/city/styles/city.module.css";

import { buildCityMetadata, CITY_WORDS, SITE_NAME, TWITTER } from "../../seo";

/* `/c/<mint>` — the link to one coin. The same
   city as `/`, opened on the coin: its tower when it stands in the city, its trade card when it does not. An address
   that is not a mint is just the city. Its preview is the coin's own card (`opengraph-image.tsx`), read again every
   five minutes. `?coin=` on `/` keeps working as it did. */
const display = Hubot_Sans({ subsets: ["latin"], axes: ["wdth"], variable: "--font-display", display: "swap" });
const ui = Mona_Sans({ subsets: ["latin"], axes: ["wdth"], variable: "--font-ui", display: "swap" });

export const revalidate = 300;

export const viewport: Viewport = { themeColor: PALETTE.inkDeep, viewportFit: "cover", maximumScale: 1 };

type Props = { params: Promise<{ mint: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { mint } = await params;
  const coin = isMint(mint) ? await readCoinCard(mint) : null;
  if (!coin) return { ...buildCityMetadata(), robots: { index: false, follow: true } };
  const url = coinLink(mint);
  const title = `$${coin.symbol.toUpperCase()} on Ryntra`;
  const description = `${coin.name} ($${coin.symbol.toUpperCase()}) in Ryntra City — the Solana market as a living night city. Open the coin, see its move, trade it from your own wallet.`;
  const image = `${url}/opengraph-image`;
  return {
    title: { absolute: title },
    description,
    /* One page per mint, scams' among them: shared, not offered to the index. */
    robots: { index: false, follow: true },
    alternates: { canonical: url },
    openGraph: { type: "website", siteName: SITE_NAME, title, description, url },
    twitter: { card: "summary_large_image", site: TWITTER, title, description, images: [image] },
  };
}

export default async function Page({ params }: Props) {
  const { mint } = await params;
  const coin = isMint(mint) ? await readCoinCard(mint) : null;
  return (
    <main className={`${s.root} ${display.variable} ${ui.variable}`}>
      <script dangerouslySetInnerHTML={{ __html: `document.documentElement.lang="en";document.documentElement.dir="ltr";` }} />
      <h1 className={s.hidden}>{coin ? `$${coin.symbol.toUpperCase()} in Ryntra City` : CITY_WORDS.title}</h1>
      <CityApp initial={BUNDLED_CITY} />
      {isMint(mint) ? <CoinOpener mint={mint} coin={coin ? factsOf(coin) : null} /> : null}
    </main>
  );
}
