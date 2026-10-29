import { notFound } from "next/navigation";

import { solanaServerLocale } from "@/app/solana/workspace/i18n/server";
import { ALLOWANCE_CHAIN } from "@/lib/solana/allowances/model";
import { allowanceNetwork } from "@/lib/solana/allowances/service.server";

import { AllowancesSurface } from "./allowances-surface";
import { ALLOWANCE_WORDS } from "./allowances-words";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata() {
  if (!allowanceNetwork()) return {};
  const locale = await solanaServerLocale();
  return { title: ALLOWANCE_WORDS.title[locale], robots: { index: false, follow: false } };
}

/**
 * «Ліміти витрат» (SOL-7, decision 58) — spending limits on the Subscriptions program. Served only where the deployment
 * names their network (`NEXT_PUBLIC_RYNTRA_ALLOWANCES_NETWORK`): devnet first; mainnet is the operator's canary — the first
 * live limit. Elsewhere the page is not found and the menu has no row for it.
 */
export default async function AllowancesPage() {
  const network = allowanceNetwork();
  if (!network) notFound();
  const locale = await solanaServerLocale();
  return <AllowancesSurface locale={locale} network={ALLOWANCE_CHAIN[network]} />;
}
