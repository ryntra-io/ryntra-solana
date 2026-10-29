import { notFound } from "next/navigation";

import { solanaServerLocale } from "@/app/solana/workspace/i18n/server";
import { buildDevPlan } from "@/lib/developer/plan.server";
import { devConsoleServed } from "@/lib/developer/runtime.server";

import { ConsoleSurface } from "./console-surface";
import { CONSOLE_WORDS } from "./console-words";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata() {
  if (!devConsoleServed().served) return {};
  const locale = await solanaServerLocale();
  return { title: CONSOLE_WORDS.title[locale], robots: { index: false, follow: false } };
}

/**
 * «Консоль розробника» (DEV-2) — projects, API keys, signed webhooks and quotas. Served only where the console is
 * (`devConsoleServed`: teams open, the DEV-2 migration applied and `RYNTRA_DEV_CONSOLE=open`); elsewhere not found,
 * because a page offering keys a deployment cannot issue is worse than no page.
 *
 * The shape the console is made of is read here, on the server, and handed down whole: the page never types a scope,
 * an event or a bound of its own.
 */
export default async function DeveloperConsolePage() {
  if (!devConsoleServed().served) notFound();
  const locale = await solanaServerLocale();
  return <ConsoleSurface locale={locale} plan={buildDevPlan()} />;
}
