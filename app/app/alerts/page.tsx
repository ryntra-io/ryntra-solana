import type { Metadata } from "next";

import { solanaServerLocale } from "@/app/solana/workspace/i18n/server";

import { MonitoringPanel } from "./monitoring-view";

export const metadata: Metadata = {
  title: "Monitoring",
  robots: { index: false, follow: false },
};

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
