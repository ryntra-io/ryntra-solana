import type { Metadata } from "next";

import { getAdminSession } from "@/lib/session";

import { AdminUnauthorized } from "../../gate";
import { AdminShellV2 } from "../../shell/admin-shell";
import { ReviewPanel } from "./review-panel";

export const metadata: Metadata = { title: "Перевірка Росту — Admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AdminGrowthReviewPage() {
  const admin = await getAdminSession();
  if (!admin) return <AdminUnauthorized surface="Перевірка Росту" />;
  return (
    <AdminShellV2 active="growth">
      <ReviewPanel />
    </AdminShellV2>
  );
}
