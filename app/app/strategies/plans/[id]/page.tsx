import { notFound } from "next/navigation";

import { solanaServerLocale } from "@/app/solana/workspace/i18n/server";
import { PLAN_ID } from "@/lib/api/v1/contract";

import { PlanDetail } from "../plan-detail";

export const dynamic = "force-dynamic";
export const metadata = { title: "Trading plan" };

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
