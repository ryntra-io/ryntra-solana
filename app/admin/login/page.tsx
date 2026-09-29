import type { Metadata } from "next";

import { accountMethods } from "@/lib/account/config";
import { getAdminSessionDetail, getSession } from "@/lib/session";

import { AdminLoginPanel } from "./login-panel";

export const metadata: Metadata = { title: "Вхід — Admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * The admin's own door. Public to reach, private to pass: an account signed in
 * through email or Google, the operator role read live, and a second factor
 * verified with Supabase before the privileged session opens. The bot link
 * stays the transitional path and is named here rather than hidden.
 */
export default async function AdminLoginPage() {
  const [session, admin] = await Promise.all([getSession(), getAdminSessionDetail()]);
  const methods = accountMethods();
  return (
    <AdminLoginPanel
      signedIn={Boolean(session?.accountId)}
      accountName={session?.state.user.first_name ?? session?.state.user.username ?? null}
      legacyAdmin={admin !== null && admin.method === "telegram_link"}
      recordedAdmin={admin !== null && admin.method !== "telegram_link"}
      methods={methods}
    />
  );
}
