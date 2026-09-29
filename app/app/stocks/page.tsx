import { INVEST_WORDS } from "@/app/app/invest/invest-words";
import { MarketsPlace } from "@/app/app/markets/markets-place";
import { solanaServerLocale } from "@/app/solana/workspace/i18n/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
/* A cold build of the universe on an instance that has never seen it can
   take seconds; the platform must let it finish rather than cut the page. */
export const maxDuration = 60;
export async function generateMetadata() {
  const locale = await solanaServerLocale();
  return { title: INVEST_WORDS.marketsTitle[locale] };
}

/**
 * `/app/stocks` — Markets, for everyone (canon v5.3 В28, one version).
 *
 * The address the landing's «Explore stocks» and the footer give opens the place where a person finds a company: companies first, one
 * card a company (`markets-place.tsx`). Stocks the tool — every confirmed
 * token, its filters, its sorting and the market strip — is the screener at
 * `/app/stocks/screener`, a tap deeper in Markets' «Для досвідчених»; the
 * desk's collections (the most traded, the most liquid, the day's gainers and
 * losers, pre-IPO) are the screener's filters and sortable columns.
 */
export default async function StocksPage() {
  const locale = await solanaServerLocale();
  return <MarketsPlace locale={locale} />;
}
