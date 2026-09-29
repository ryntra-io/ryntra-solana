import type { Metadata } from "next";

import { getAdminSession } from "@/lib/session";

import { AdminUnauthorized } from "../gate";
import { AdminShellV2 } from "../shell/admin-shell";
import { OperationsPanel } from "./operations-panel";

export const metadata: Metadata = { title: "Операції — Admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AdminOperationsPage() {
  const admin = await getAdminSession();
  if (!admin) return <AdminUnauthorized surface="Операції" />;
  return (
    <AdminShellV2 active="operations">
      <OperationsPanel />
    </AdminShellV2>
  );
}
