import type { ReactNode } from "react";

import { AdminShellFrame } from "./admin-shell-frame";
import type { AdminNavId } from "./nav";

/**
 * AdminShellV2 — the internal control center chrome.
 *
 * The server half only decides the environment label; the frame is a client
 * component because on a phone the navigation is a drawer the operator opens,
 * not a list stacked above the page. The operator opens the bot's admin link on
 * a phone, and the first screen has to be the Overview, not the menu.
 */
export function AdminShellV2({
  active,
  children,
}: {
  active: AdminNavId;
  children: ReactNode;
}) {
  const env = process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production"
    ? "PRODUCTION"
    : "LOCAL";
  return (
    <AdminShellFrame active={active} env={env}>
      {children}
    </AdminShellFrame>
  );
}
