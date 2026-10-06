import { notFound } from "next/navigation";

import { solanaServerLocale } from "@/app/solana/workspace/i18n/server";
import { launchNetwork } from "@/lib/launch/config.server";

import { LAUNCH_WORDS } from "../launch-words";
import { CreatorCabinet } from "./creator-cabinet";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata() {
  /* Where Launch is closed the page is not found, and its title says nothing either. */
  if (!launchNetwork()) return {};
  const locale = await solanaServerLocale();
  return { title: LAUNCH_WORDS.mineTitle[locale], robots: { index: false, follow: false } };
}

/**
 * «Мої лаунчі» — the creator's cabinet: the connected wallet's launches, their
 * way to the DEX, what they earned it and «Забрати» with a receipt. Served
 * only where Launch runs (the devnet stand until Launch opens to people with
 * its own subtask); everywhere else it is not found, and no menu points at it.
 */
export default async function LaunchMinePage() {
  const network = launchNetwork();
  if (!network) notFound();
  const locale = await solanaServerLocale();
  return <CreatorCabinet locale={locale} network={network.chain} />;
}
