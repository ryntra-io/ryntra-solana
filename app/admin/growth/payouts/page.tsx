import type { Metadata } from "next";

import { getAdminSession } from "@/lib/session";

import { AdminUnauthorized } from "../../gate";
import { AdminShellV2 } from "../../shell/admin-shell";
import { PayoutsPanel } from "./payouts-panel";
import { WeeklyPanel } from "./weekly-panel";

export const metadata: Metadata = { title: "Виплати партнерам — Admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AdminGrowthPayoutsPage() {
  const admin = await getAdminSession();
  if (!admin) return <AdminUnauthorized surface="Виплати партнерам" />;
  return (
    <AdminShellV2 active="growth">
      <WeeklyPanel />
      <PayoutsPanel />
    </AdminShellV2>
  );
}
