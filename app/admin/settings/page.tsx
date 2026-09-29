import type { Metadata } from "next";

import { getAdminSession } from "@/lib/session";

import { AdminUnauthorized } from "../gate";
import { AdminShellV2 } from "../shell/admin-shell";
import { SettingsPanel } from "./settings-panel";

export const metadata: Metadata = { title: "Налаштування — Admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  const admin = await getAdminSession();
  if (!admin) return <AdminUnauthorized surface="Налаштування" />;
  return (
    <AdminShellV2 active="settings">
      <SettingsPanel />
    </AdminShellV2>
  );
}
