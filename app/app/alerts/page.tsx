import type { Metadata } from "next";

import { words } from "@/lib/monitoring/copy";
import { solanaServerLocale } from "@/app/solana/workspace/i18n/server";

import { MonitoringPanel } from "./monitoring-view";

/** The page's one name, in the reader's language, the bell's word (B18: «Сповіщення», not «Нагляд» nor «Monitoring»). */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await solanaServerLocale();
  return { title: words(locale).title, robots: { index: false, follow: false } };
}

export const dynamic = "force-dynamic";

/**
 * Monitoring — the shared service under My strategies.
 * The address stays `/app/alerts`. The page is the inbox of what the server
 * watched, never a second alert terminal.
 */
export default async function MonitoringPage() {
  const locale = await solanaServerLocale();
  return <MonitoringPanel locale={locale} />;
}
