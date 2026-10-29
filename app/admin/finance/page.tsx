import type { Metadata } from "next";
import { cookies } from "next/headers";

import { WORKSPACE_LOCALE_COOKIE, isWorkspaceLocale } from "@/app/shell/locale";
import { getAdminSession } from "@/lib/session";

import { AdminUnauthorized } from "../gate";
import { AdminShellV2 } from "../shell/admin-shell";
import { FinancePanel } from "./finance-panel";

export const metadata: Metadata = { title: "Фінансова панель — Admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AdminFinancePage() {
  const admin = await getAdminSession();
  if (!admin) return <AdminUnauthorized surface="Фінансова панель" />;
  /* The admin speaks Ukrainian unless the operator chose English anywhere in Ryntra. */
  const saved = (await cookies()).get(WORKSPACE_LOCALE_COOKIE)?.value;
  return (
    <AdminShellV2 active="finance">
      <FinancePanel initialLocale={isWorkspaceLocale(saved) ? saved : "uk"} />
    </AdminShellV2>
  );
}
