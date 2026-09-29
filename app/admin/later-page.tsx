import type { Metadata } from "next";

import { getAdminSession } from "@/lib/session";

import { AdminLater, AdminUnauthorized } from "./gate";
import { AdminShellV2 } from "./shell/admin-shell";
import type { AdminNavId } from "./shell/nav";

export const laterMetadata = (title: string): Metadata => ({
  title: `${title} — Admin`,
  robots: { index: false, follow: false },
});

export async function AdminLaterPage({
  active,
  title,
}: {
  active: AdminNavId;
  title: string;
}) {
  const admin = await getAdminSession();
  if (!admin) return <AdminUnauthorized surface={title} />;
  return (
    <AdminShellV2 active={active}>
      <AdminLater title={title} />
    </AdminShellV2>
  );
}
