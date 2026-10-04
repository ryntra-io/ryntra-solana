import { INVEST_WORDS } from "@/app/app/invest/invest-words";
import { solanaServerLocale } from "@/app/solana/workspace/i18n/server";

import { AutoinvestPlace } from "./autoinvest-place";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata() {
  const locale = await solanaServerLocale();
  return { title: INVEST_WORDS.autoinvest[locale] };
}

/**
 * «Автоінвест» — a row of the menu under «Інвестувати»: the wallet's rules and
 * the month's budget, the same block Home and Portfolio draw.
 */
export default async function AutoinvestPage() {
  const locale = await solanaServerLocale();
  return <AutoinvestPlace locale={locale} />;
}
