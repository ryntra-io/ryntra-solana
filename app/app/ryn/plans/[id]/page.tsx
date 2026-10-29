import { solanaServerLocale } from "@/app/solana/workspace/i18n/server";

import { TradePlanPage } from "../../trade-plan";

export const dynamic = "force-dynamic";
export const metadata = { title: "Trade plan" };

/**
 * One trade plan Ryntra composed with the person (AI-11): its thesis and
 * levels, the fees, the critic, the person's word and «План проти
 * реальності». The proof of the wallet is asked for by the reads, as on the
 * assistant's own page; nothing here buys. AI-20: the core's action page in
 * the middle of the canvas, drawn by `TradePlanPage`.
 */
export default async function TradePlanRoute({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const locale = await solanaServerLocale();
  const { id } = await params;
  const query = await searchParams;
  const credits = typeof query.spent === "string" && /^\d{1,6}$/.test(query.spent) ? Number(query.spent) : null;
  return <TradePlanPage id={/^apl_[0-9a-f]{24}$/.test(id) ? id : "apl_000000000000000000000000"} locale={locale} spent={credits !== null ? { credits, part: query.part === "1" } : null} />;
}
