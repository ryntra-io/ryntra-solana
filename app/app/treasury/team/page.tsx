import { notFound } from "next/navigation";

import { solanaServerLocale } from "@/app/solana/workspace/i18n/server";
import { TEAM_KINDS, TEAM_ROLES, canManageRole } from "@/lib/core/team/roles";
import { teamsServed } from "@/lib/team/runtime.server";

import { TeamSurface } from "./team-surface";
import { TEAM_WORDS } from "./team-words";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata() {
  if (!teamsServed().served) return {};
  const locale = await solanaServerLocale();
  return { title: TEAM_WORDS.title[locale], robots: { index: false, follow: false } };
}

/**
 * «Команда» (TEAM-1) — beside «Казна», never a row of its own in the menu (decision 63): a team's members, their roles
 * and rights, and the treasury its high-risk rights run through. Served only where teams are (`teamsServed`: the
 * treasury's network named and `RYNTRA_TEAMS=open` after the TEAM-1 migration is applied); elsewhere not found.
 */
export default async function TeamPage() {
  const served = teamsServed();
  if (!served.served) notFound();
  const locale = await solanaServerLocale();
  /* Who may give which role, from the same rule the server checks with: the page offers nothing the server refuses. */
  const gives = Object.fromEntries(TEAM_ROLES.map((actor) => [actor, TEAM_ROLES.filter((target) => canManageRole(actor, target))]));
  return <TeamSurface locale={locale} network={served.deps.network} kinds={[...TEAM_KINDS]} gives={gives} />;
}
