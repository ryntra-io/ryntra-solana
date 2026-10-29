import type { Metadata } from "next";

import { getAdminSession } from "@/lib/session";

import { AdminUnauthorized } from "../gate";
import { AdminShellV2 } from "../shell/admin-shell";
import { GrowthPanel } from "./growth-panel";

export const metadata: Metadata = { title: "Панель росту — Admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AdminGrowthPage() {
  const admin = await getAdminSession();
  if (!admin) return <AdminUnauthorized surface="Панель росту" />;
  return (
    <AdminShellV2 active="growthPanel">
      <GrowthPanel />
    </AdminShellV2>
  );
}
