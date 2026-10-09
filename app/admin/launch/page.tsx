import type { Metadata } from "next";

import { getAdminSession } from "@/lib/session";

import { AdminUnauthorized } from "../gate";
import { AdminShellV2 } from "../shell/admin-shell";
import { LaunchExecutorPanel } from "./launch-executor-panel";

export const metadata: Metadata = { title: "Виконавець лаунчу — Admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AdminLaunchExecutorPage() {
  const admin = await getAdminSession();
  if (!admin) return <AdminUnauthorized surface="Виконавець лаунчу" />;
  return (
    <AdminShellV2 active="launch">
      <LaunchExecutorPanel />
    </AdminShellV2>
  );
}
