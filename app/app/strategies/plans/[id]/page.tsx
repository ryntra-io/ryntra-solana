import { notFound } from "next/navigation";

import { solanaServerLocale } from "@/app/solana/workspace/i18n/server";
import { PLAN_ID } from "@/lib/api/v1/contract";

import { PlanDetail } from "../plan-detail";
import { PLAN_WORDS } from "../plan-words";

export const dynamic = "force-dynamic";
/* The tab names the plan as the menu's «Боти» does — «План угоди» (SOL-C15, UX-708). */
export async function generateMetadata() {
  const locale = await solanaServerLocale();
  return { title: PLAN_WORDS.builderTitle[locale] };
}

/** One plan, read behind the wallet's proof by the client; an address that is not a plan id is not a page. */
export default async function PlanPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { id } = await params;
  if (!PLAN_ID.test(id)) notFound();
  const locale = await solanaServerLocale();
  const query = await searchParams;
  return <PlanDetail planId={id} locale={locale} fromMonitoring={query.from === "monitoring"} />;
}
