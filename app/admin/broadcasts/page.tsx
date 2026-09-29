import type { Metadata } from "next";

import { getAdminSession } from "@/lib/session";

import { AdminUnauthorized } from "../gate";
import { AdminShellV2 } from "../shell/admin-shell";
import { BroadcastsPanel } from "./broadcasts-panel";

export const metadata: Metadata = { title: "Розсилки — Admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AdminBroadcastsPage() {
  const admin = await getAdminSession();
  if (!admin) return <AdminUnauthorized surface="Розсилки" />;
  return (
    <AdminShellV2 active="broadcasts">
      <BroadcastsPanel />
    </AdminShellV2>
  );
}
