import { notFound } from "next/navigation";

import { solanaServerLocale } from "@/app/solana/workspace/i18n/server";
import { launchNetwork } from "@/lib/launch/config.server";
import { isCrewId } from "@/lib/launch/crew.server";

import { LAUNCH_WORDS } from "../../launch-words";
import { CrewInvite } from "./crew-invite";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata() {
  if (!launchNetwork()) return {};
  const locale = await solanaServerLocale();
  return { title: LAUNCH_WORDS.crewTitle[locale], robots: { index: false, follow: false } };
}

/**
 * A crew's invitation (MC-2): what the creator invites to — the ticker, the part, where it waits — and the invitee's
 * own yes or no with their wallet. Nobody joins a crew without it; the creator never answers for them.
 */
export default async function CrewInvitePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const network = launchNetwork();
  const { id } = await params;
  if (!network || !isCrewId(id)) notFound();
  const handle = (await searchParams).h;
  const locale = await solanaServerLocale();
  return <CrewInvite locale={locale} id={id} initialHandle={typeof handle === "string" ? handle : null} />;
}
