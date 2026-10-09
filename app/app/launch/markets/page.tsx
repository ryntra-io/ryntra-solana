import { notFound } from "next/navigation";

import { solanaServerLocale } from "@/app/solana/workspace/i18n/server";
import { launchNetwork } from "@/lib/launch/config.server";

import { LAUNCH_WORDS } from "../launch-words";
import { MarketsBoard } from "./markets-board";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata() {
  /* A stand without its origin is not found, and its title says nothing either. */
  if (!launchNetwork()) return {};
  const locale = await solanaServerLocale();
  return { title: LAUNCH_WORDS.marketsTitle[locale], description: LAUNCH_WORDS.marketsLede[locale] };
}

/**
 * «Лаунчі на Ryntra» — every market launched on Ryntra on this network, for
 * anyone, no wallet: its state of the cycle, the curve's way to the DEX, the
 * pool's liquidity, the market's budget, depth at −5 %, days on the DEX,
 * holders and the creator. The page draws at once and reads the markets from
 * the chain in the browser — its times on the reader's own clock.
 */
export default async function LaunchMarketsPage() {
  const network = launchNetwork();
  if (!network) notFound();
  const locale = await solanaServerLocale();
  return <MarketsBoard locale={locale} network={network.chain} />;
}
