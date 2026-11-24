import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { shelfOn } from "@/terminal/shell/shelves";
import { WalletScreen } from "@/terminal/watch/WalletScreen";

import { buildTerminalMetadata } from "../../../seo";

type Props = { params: Promise<{ address: string }> };

export const metadata: Metadata = buildTerminalMetadata({ name: "Wallet", path: "/wallet", index: false });

/* Any wallet of Solana on its own page, in the terminal instead of an explorer: what it holds, what it traded lately,
   its result, and «Watch». A text that is not an address is a state of the page with a way on, not a 404: the screen
   says so and offers the field. Never offered to the index. */
export default async function Page({ params }: Props) {
  const { address } = await params;
  if (!shelfOn("market")) notFound();
  return <WalletScreen key={address} address={address.trim()} />;
}
