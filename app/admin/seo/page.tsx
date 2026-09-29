import type { Metadata } from "next";

import { getAdminSession } from "@/lib/session";

import { AdminUnauthorized } from "../gate";
import { AdminShellV2 } from "../shell/admin-shell";
import { SeoPanel } from "./seo-panel";

export const metadata: Metadata = { title: "SEO і ріст — Admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AdminSeoPage() {
  const admin = await getAdminSession();
  if (!admin) return <AdminUnauthorized surface="SEO і ріст" />;
  return (
    <AdminShellV2 active="seo">
      <SeoPanel />
    </AdminShellV2>
  );
}
