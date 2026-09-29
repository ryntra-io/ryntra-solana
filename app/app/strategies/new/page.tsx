import { solanaServerLocale } from "@/app/solana/workspace/i18n/server";
import { AGENT_DRAFT_ID, PLAN_ID } from "@/lib/api/v1/contract";
import { carriedBudget, carriedCondition } from "@/lib/plans/builder-defaults";

import { PlanBuilder } from "../plans/plan-builder";

export const dynamic = "force-dynamic";
export const metadata = { title: "Trading plan" };

const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * The builder: a new plan from a stock (`?mint=`), or a new version of an
 * existing plan (`?plan=`). With neither, the form opens on a picker over
 * the same universe the Stocks page searches — a plan with no stock starts
 * here, it is not sent away. `?budget=` carries the sum a person chose on
 * the asset page, and only that (a preset they never pressed is not a
 * choice). `?draft=` names a plan draft Ryn prepared (`RYN-AGENT-TEXT-001`):
 * the builder reads it back through the wallet's proof and opens on exactly
 * what the person saw in the conversation — every figure editable, the
 * thesis theirs to write, nothing saved until they save. The proof of the
 * wallet is asked for at save, not at arrival — the form and its live
 * estimate are open to everyone, the store is not.
 */
export default async function NewPlanPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const locale = await solanaServerLocale();
  const params = await searchParams;
  const rawMint = typeof params.mint === "string" ? params.mint : null;
  const rawPlan = typeof params.plan === "string" ? params.plan : null;
  const mint = rawMint && MINT.test(rawMint) ? rawMint : null;
  const planId = rawPlan && PLAN_ID.test(rawPlan) ? rawPlan : null;
  const budget = carriedBudget(typeof params.budget === "string" ? params.budget : null);
  const rawDraft = typeof params.draft === "string" ? params.draft : null;
  const agentDraftId = rawDraft && AGENT_DRAFT_ID.test(rawDraft) ? rawDraft : null;
  /* `?evidence=` carries the condition the analysis card offered — the metric, the window and the figure at the press (RYN-NANSEN-EVIDENCE-001). */
  const carried = carriedCondition(typeof params.evidence === "string" ? params.evidence : null);
  return <PlanBuilder mint={mint} planId={planId} budget={budget} locale={locale} carried={carried} agentDraftId={agentDraftId} />;
}
