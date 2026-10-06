import { notFound } from "next/navigation";

import { solanaServerLocale } from "@/app/solana/workspace/i18n/server";
import { launchNetwork } from "@/lib/launch/config.server";
import { launchTrading } from "@/lib/launch/runtime.server";

import { LAUNCH_WORDS } from "../launch-words";
import { CreatorCabinet } from "./creator-cabinet";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata() {
  /* A stand without its origin is not found, and its title says nothing either. */
  if (!launchNetwork()) return {};
  const locale = await solanaServerLocale();
  return { title: LAUNCH_WORDS.mineTitle[locale], robots: { index: false, follow: false } };
}

/**
 * «Мої лаунчі» — the creator's cabinet: the connected wallet's launches, their
 * way to the DEX, what they earned it and «Забрати» with a receipt — on
 * mainnet, or the devnet stand a local server runs. Reading it needs no switch;
 * «Забрати» obeys the Launch lane's.
 */
export default async function LaunchMinePage() {
  const network = launchNetwork();
  if (!network) notFound();
  const locale = await solanaServerLocale();
  return <CreatorCabinet locale={locale} network={network.chain} paused={!launchTrading()} />;
}
