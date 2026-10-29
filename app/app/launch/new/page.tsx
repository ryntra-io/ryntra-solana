import { notFound } from "next/navigation";

import { solanaServerLocale } from "@/app/solana/workspace/i18n/server";
import { launchNetwork } from "@/lib/launch/config.server";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { launchAccepting, launchPeopleServed, launchPresetsView, launchTrading } from "@/lib/launch/runtime.server";

import { LAUNCH_WORDS } from "../launch-words";
import { LaunchFlow } from "./launch-flow";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata() {
  /* A stand without its origin is not found, and its title says nothing either. */
  if (!launchNetwork()) return {};
  const locale = await solanaServerLocale();
  return { title: LAUNCH_WORDS.title[locale], robots: { index: false, follow: false } };
}

/**
 * «Запустити токен» — Ryntra Launch's form, on mainnet (or the devnet stand a
 * local server runs). With the Launch lane paused the whole of Launch waits;
 * with no pool payer or no shared store here only new launches do, while
 * trades and claims go on — the form says which.
 */
export default async function LaunchNewPage({ searchParams }: { searchParams: Promise<{ preset?: string | string[] }> }) {
  const network = launchNetwork();
  if (!network) notFound();
  const locale = await solanaServerLocale();
  const paused = launchAccepting(network) ? null : launchTrading() ? "launching" : "all";
  /* The demo market is never offered: Ryntra's own wallet opens it by its address, and the build refuses every other wallet. */
  const internal = (await searchParams).preset === "demo";
  /* Whether Ryntra's executor claims the budget on people's Micro markets here now — the form says what is (SOL-L6). */
  const peopleServed = await launchPeopleServed(network, getGuardRuntime().store).catch(() => false);
  return <LaunchFlow locale={locale} presets={launchPresetsView(network, { internal })} paused={paused} initialPreset={internal ? "demo" : null} peopleServed={peopleServed} />;
}
