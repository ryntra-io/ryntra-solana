import { notFound } from "next/navigation";

import { solanaServerLocale } from "@/app/solana/workspace/i18n/server";
import { launchNetwork } from "@/lib/launch/config.server";

import { LAUNCH_WORDS } from "../launch-words";
import { PositionsBoard } from "./positions-board";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata() {
  if (!launchNetwork()) return {};
  const locale = await solanaServerLocale();
  return { title: LAUNCH_WORDS.positionsTitle[locale], robots: { index: false, follow: false } };
}

/**
 * «Мої позиції» — the connected wallet's positions in the pools of tokens
 * launched on Ryntra, each read from the chain now, and their totals. No menu
 * names it: the pool's card on a token's page leads here once the wallet holds
 * a position.
 */
export default async function LaunchPositionsPage() {
  const network = launchNetwork();
  if (!network) notFound();
  const locale = await solanaServerLocale();
  return <PositionsBoard locale={locale} network={network.chain} />;
}
