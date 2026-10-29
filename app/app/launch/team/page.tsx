import { notFound } from "next/navigation";

import { solanaServerLocale } from "@/app/solana/workspace/i18n/server";
import { BUDGET_RULE, BUDGET_SOURCES } from "@/lib/core/launch/budget";
import { FEE_SHARE_MAX_RECIPIENTS, FEE_SHARE_MIN_BPS } from "@/lib/core/launch/fee-shares";
import { ALLOCATION_CATEGORIES, ALLOCATION_MAX_DAYS, ALLOCATION_TOTAL_PCT, TEAM_LAUNCH_AUTHORITY, TEAM_LAUNCH_STEPS, teamLaunchServedFor } from "@/lib/core/launch/team-launch";
import { findAuthority, resolveAuthority } from "@/lib/core/authority-matrix";
import type { TeamLaunchPlanResponse } from "@/lib/api/v1/contract";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { launchNetwork } from "@/lib/launch/config.server";
import { launchPeopleServed } from "@/lib/launch/runtime.server";
import { PEOPLE_PRESET_IDS } from "@/lib/core/venues/meteora-dbc/presets";

import { TEAM_LAUNCH_WORDS } from "./team-words";
import { TeamLaunchWizard } from "./team-wizard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata() {
  if (!launchNetwork()) return {};
  const locale = await solanaServerLocale();
  return { title: TEAM_LAUNCH_WORDS.title[locale], robots: { index: false, follow: false } };
}

/**
 * «Запуск командою» (MOS-2) — the Team Launch wizard: eight steps in one column, the rules of the market written
 * before the signature. The page itself needs no wallet to be read; the rights of each step, and the record each step
 * writes, need one.
 *
 * `open` is false until the deployment's own switch is set, so a visitor reads what the wizard is and what the owner
 * has still to turn on, rather than a page that pretends to launch.
 */
export default async function TeamLaunchPage() {
  const network = launchNetwork();
  if (!network) notFound();
  const locale = await solanaServerLocale();
  const row = findAuthority(TEAM_LAUNCH_AUTHORITY);
  if (!row) notFound();
  const resolved = resolveAuthority(row);
  /* Without a proven wallet the page cannot be told whether a canary names it: the plan says «not open», which is what
     a canary is for a wallet it cannot name. The steps still fill and count. */
  const plan: TeamLaunchPlanResponse = {
    open: teamLaunchServedFor(null, process.env).served,
    network: network.cluster,
    /* Unread is «not now»: the wizard never promises a ladder on a guess (SOL-L6). */
    peopleServed: await launchPeopleServed(network, getGuardRuntime().store).catch(() => false),
    steps: TEAM_LAUNCH_STEPS.map((step) => ({ n: step.n, key: step.key, permissions: [...step.permissions], name: { ...step.name } })),
    bounds: {
      allocationTotalPct: ALLOCATION_TOTAL_PCT,
      allocationCategories: [...ALLOCATION_CATEGORIES],
      allocationMaxDays: ALLOCATION_MAX_DAYS,
      budgetSources: [...BUDGET_SOURCES],
      deployedBpsMax: BUDGET_RULE.deployMaxBps,
      pauseOnDropBps: BUDGET_RULE.dropStopBps,
      feeShareMaxRecipients: FEE_SHARE_MAX_RECIPIENTS,
      feeShareMinBps: FEE_SHARE_MIN_BPS,
    },
    authority: { id: row.id, state: resolved.state, enforcement: row.enforcement, signer: row.signer },
  };
  /* Only the presets this deployment actually serves: one with no pair here has no config to launch against, and the
     wizard would walk to its last step over a preset the server refuses. */
  const presets = PEOPLE_PRESET_IDS.filter((id) => network.pairs[id] !== undefined && (id !== "community" || network.communities.length > 0));
  return <TeamLaunchWizard locale={locale} plan={plan} cluster={network.cluster} presets={presets} />;
}
