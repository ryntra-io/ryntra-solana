import type { Metadata } from "next";

import { getAdminSession } from "@/lib/session";

import { AdminUnauthorized } from "../gate";
import { AdminShellV2 } from "../shell/admin-shell";
import { UsersPanel } from "./users-panel";

export const metadata: Metadata = { title: "Користувачі — Admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const admin = await getAdminSession();
  if (!admin) return <AdminUnauthorized surface="Користувачі та доступ" />;
  return (
    <AdminShellV2 active="users">
      <UsersPanel />
    </AdminShellV2>
  );
}
