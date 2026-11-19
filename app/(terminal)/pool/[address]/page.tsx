import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { isPoolAddress } from "@/lib/earn-pools/bins";
import { PoolScreen } from "@/terminal/pool/PoolScreen";
import { shelfOn } from "@/terminal/shell/shelves";

import { buildTerminalMetadata, SITE } from "../../../seo";

type Props = { params: Promise<{ address: string }> };

/* A pool's own page is shared, never offered to the index: one page per pool, empty ones among them. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { address } = await params;
  return { ...buildTerminalMetadata({ name: "Meteora pool", path: "/pro" }), alternates: { canonical: `${SITE}/pool/${encodeURIComponent(address)}` }, robots: { index: false, follow: true } };
}

/* A Meteora pool's own desk: its pair, its liquidity by price, the coin's chart with the pool over it,
   and the ticket with Meteora's three tabs — Position · Limit · Swap. Any address that is not one is not a pool. */
export default async function Page({ params }: Props) {
  const { address } = await params;
  if (!shelfOn("earn") || !isPoolAddress(address)) notFound();
  return <PoolScreen key={address} address={address} />;
}
