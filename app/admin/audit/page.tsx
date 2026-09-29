import type { Metadata } from "next";

import { getAdminSession } from "@/lib/session";

import { AdminUnauthorized } from "../gate";
import { AdminShellV2 } from "../shell/admin-shell";
import { AuditPanel } from "./audit-panel";

export const metadata: Metadata = { title: "Аудит — Admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AdminAuditPage() {
  const admin = await getAdminSession();
  if (!admin) return <AdminUnauthorized surface="Журнал аудиту" />;
  return (
    <AdminShellV2 active="audit">
      <AuditPanel />
    </AdminShellV2>
  );
}
