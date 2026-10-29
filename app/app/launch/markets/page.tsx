import { notFound } from "next/navigation";
import { after } from "next/server";

import { NAV_WORDS } from "@ryntra/core/nav";

import { solanaServerLocale } from "@/app/solana/workspace/i18n/server";
import { withinMetadataBudget } from "@/app/app/metadata-budget";
import { launchNetwork } from "@/lib/launch/config.server";
import { readLaunchMarkets, readMarketsBehind } from "@/lib/launch/markets.server";
import { launchHealthDeps } from "@/lib/launch/runtime.server";

import { LAUNCH_WORDS } from "../launch-words";
import { MarketsBoard } from "./markets-board";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** How long the page's HTML waits for the list (SOL-P1): within it the board is drawn by the server, past it the browser reads it. */
const PAGE_LIST_MS = 1_500;

export async function generateMetadata() {
  /* A stand without its origin is not found, and its title says nothing either. */
  if (!launchNetwork()) return {};
  const locale = await solanaServerLocale();
  return { title: NAV_WORDS[locale].items.launch, description: LAUNCH_WORDS.marketsLede[locale] };
}

/**
 * «Лаунчі на Ryntra» — every market launched on Ryntra on this network, for
 * anyone, no wallet: its state of the cycle, the curve's way to the DEX, the
 * pool's liquidity, the market's budget, depth at −5 %, days on the DEX,
 * holders and the creator. The server's list comes with the page when it is
 * read within `PAGE_LIST_MS` (SOL-P1: the first screen without waiting for the
 * scripts); the browser reads it again on its own clock.
 */
export default async function LaunchMarketsPage() {
  const network = launchNetwork();
  if (!network) notFound();
  const deps = launchHealthDeps();
  const [locale, initial] = await Promise.all([solanaServerLocale(), deps ? withinMetadataBudget(readLaunchMarkets(deps), null, PAGE_LIST_MS) : Promise.resolve(null)]);
  if (initial) after(() => readMarketsBehind());
  return <MarketsBoard locale={locale} network={network.chain} initial={initial} renderedAt={Date.now()} />;
}
