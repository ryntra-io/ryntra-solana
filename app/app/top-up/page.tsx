import { returnPath } from "@/app/app/invest/funding-model";
import { INVEST_WORDS } from "@/app/app/invest/invest-words";
import { solanaServerLocale } from "@/app/solana/workspace/i18n/server";

import { TopUpSurface } from "./top-up-surface";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata() {
  const locale = await solanaServerLocale();
  return { title: INVEST_WORDS.topUp[locale] };
}

/**
 * Поповнити — the top-up, the same for everyone. Reached from Home, from the
 * purchase that found too few dollars or no SOL for the network, and from the
 * empty states; Receive, with its payment requests, stays in «Ще».
 *
 * `need=sol` says the person came for the network's SOL, so the first paint
 * already words the ways for SOL; `from` is the page to go back to once the
 * money is there — a page of the cabinet, nothing else.
 */
export default async function TopUpPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [locale, params] = await Promise.all([solanaServerLocale(), searchParams]);
  const need = params.need === "sol" ? "sol" : null;
  const from = typeof params.from === "string" ? returnPath(params.from) : null;
  return <TopUpSurface locale={locale} need={need} from={from} />;
}
