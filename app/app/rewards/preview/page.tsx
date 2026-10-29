import type { Metadata } from "next";

import { PageHead } from "@/app/solana/workspace/hub/parts";
import { solanaServerText } from "@/app/solana/workspace/i18n/server";
import type { TaskId } from "@/app/solana/workspace/rewards/v2/fixture";
import { RewardsV2Prototype, type V2Celebrate, type V2Ledger, type V2Tab } from "@/app/solana/workspace/rewards/v2/prototype";

export const dynamic = "force-dynamic";

/**
 * Rewards v2 — the design prototype (Ріст 9). Its own address beside the live Rewards, which it does not
 * touch; noindex like the whole cabinet, said again here so a later change to
 * the layout cannot open it. Drawn from a labelled sample, never a wallet.
 */
export async function generateMetadata(): Promise<Metadata> {
  const { text } = await solanaServerText();
  return { title: text("Rewards"), robots: { index: false, follow: false, nocache: true } };
}

const TABS: readonly V2Tab[] = ["overview", "friends", "tasks", "history", "ranks"];
const TASKS: readonly TaskId[] = ["firstStep", "topUp", "firstCompany", "twoCompanies", "autoinvest", "lesson", "usefulWeek", "friend"];

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function RewardsV2PreviewPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const params = (await searchParams) ?? {};
  const tab = TABS.find((id) => id === one(params.tab)) ?? "overview";
  const task = TASKS.find((id) => id === one(params.task));
  const celebrate: V2Celebrate | undefined = one(params.celebrate) === "rank" ? "rank" : one(params.celebrate) === "friend" ? "friend" : undefined;
  const ledger: V2Ledger = one(params.ledger) === "points" ? "points" : "money";
  return (
    <>
      <PageHead title="Rewards" />
      <RewardsV2Prototype tab={tab} persona={one(params.who) === "new" ? "new" : "active"} ledger={ledger} task={task} celebrate={celebrate} row={one(params.row)?.slice(0, 8)} />
    </>
  );
}
