import { notFound } from "next/navigation";

import { solanaServerLocale } from "@/app/solana/workspace/i18n/server";
import { TREASURY_CHAIN } from "@/lib/solana/treasury/model";
import { treasuryNetwork } from "@/lib/solana/treasury/service.server";
import { teamsServed } from "@/lib/team/runtime.server";

import { TreasurySurface } from "./treasury-surface";
import { TREASURY_WORDS } from "./treasury-words";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata() {
  if (!treasuryNetwork()) return {};
  const locale = await solanaServerLocale();
  return { title: TREASURY_WORDS.title[locale], robots: { index: false, follow: false } };
}

/**
 * «Казна» (SOL-4, decision 47) — the person's own multisig on Squads v4. Served only where the deployment names the
 * treasury's network (`NEXT_PUBLIC_RYNTRA_TREASURY_NETWORK`): devnet first, then mainnet — the operator's canary passed
 * 21.10 and of 21.10, it is open to every wallet, marked «Solana Mainnet · Beta». Elsewhere the page
 * is not found and the menu has no row for it.
 */
export default async function TreasuryPage() {
  const network = treasuryNetwork();
  if (!network) notFound();
  const locale = await solanaServerLocale();
  /* «Команда» (TEAM-1) opens from here, where teams are served — never a row of its own in the menu. */
  return <TreasurySurface locale={locale} network={TREASURY_CHAIN[network]} teams={teamsServed().served} />;
}
