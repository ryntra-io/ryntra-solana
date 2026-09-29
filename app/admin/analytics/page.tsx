import type { Metadata } from "next";

import { getAdminSession } from "@/lib/session";

import { AdminUnauthorized } from "../gate";
import { AdminShellV2 } from "../shell/admin-shell";
import { AnalyticsPanel } from "./analytics-panel";

export const metadata: Metadata = { title: "Аналітика — Admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AdminAnalyticsPage() {
  const admin = await getAdminSession();
  if (!admin) return <AdminUnauthorized surface="Аналітика" />;
  return (
    <AdminShellV2 active="analytics">
      <AnalyticsPanel />
    </AdminShellV2>
  );
}
