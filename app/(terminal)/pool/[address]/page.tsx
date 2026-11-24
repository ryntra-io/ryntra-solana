import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { isPoolAddress } from "@/lib/earn-pools/bins";
import { PoolScreen } from "@/terminal/pool/PoolScreen";
import { SHARE_CARD_SIZE, poolCardPath, shareCardAlt } from "@/terminal/share/cards";
import { shelfOn } from "@/terminal/shell/shelves";

import { buildTerminalMetadata, SITE } from "../../../seo";

type Props = { params: Promise<{ address: string }> };

/* A pool's own page is shared, never offered to the index: one page per pool, empty ones among them. Its preview is the
   pool's own card (`/og/pool/<address>`, `terminal/share/pool.server.tsx`): its pair and the engine's figures. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { address } = await params;
  const base = buildTerminalMetadata({ name: "Meteora pool", path: "/pool" });
  const url = `${SITE}/pool/${encodeURIComponent(address)}`;
  if (!isPoolAddress(address)) return { ...base, alternates: { canonical: url }, robots: { index: false, follow: true } };
  const image = { url: `${SITE}${poolCardPath(address)}`, ...SHARE_CARD_SIZE, alt: shareCardAlt("pool") };
  return { ...base, alternates: { canonical: url }, robots: { index: false, follow: true }, openGraph: { ...base.openGraph, url, images: [image] }, twitter: { ...base.twitter, images: [image.url] } };
}

/* A Meteora pool's own desk: its pair, its liquidity by price, the coin's chart with the pool over it,
   and the ticket with Meteora's three tabs — Position · Limit · Swap. Any address that is not one is not a pool. */
export default async function Page({ params }: Props) {
  const { address } = await params;
  if (!shelfOn("earn") || !isPoolAddress(address)) notFound();
  return <PoolScreen key={address} address={address} />;
}
