import type { Metadata } from "next";

import { getAdminSession } from "@/lib/session";

import { AdminUnauthorized } from "./gate";
import { OverviewPanel } from "./overview-panel";
import { AdminShellV2 } from "./shell/admin-shell";

export const metadata: Metadata = { title: "Admin — Ryntra", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const admin = await getAdminSession();
  if (!admin) return <AdminUnauthorized surface="Огляд" />;
  return (
    <AdminShellV2 active="overview">
      <OverviewPanel />
    </AdminShellV2>
  );
}
