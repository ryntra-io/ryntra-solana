import type { Metadata } from "next";

import { getAdminSession } from "@/lib/session";

import { AdminUnauthorized } from "../gate";
import { AdminShellV2 } from "../shell/admin-shell";
import { FeedbackPanel } from "./feedback-panel";

export const metadata: Metadata = { title: "Відгуки — Admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AdminFeedbackPage() {
  const admin = await getAdminSession();
  if (!admin) return <AdminUnauthorized surface="Відгуки" />;
  return (
    <AdminShellV2 active="feedback">
      <FeedbackPanel />
    </AdminShellV2>
  );
}
