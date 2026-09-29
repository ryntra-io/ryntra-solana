import { getAdminSession } from "@/lib/session";

import { AdminUnauthorized } from "../../admin/gate";
import { LabLoader } from "./lab-loader";

export const dynamic = "force-dynamic";

/*
 * The public App ID of the Owner's AGG app *Ryntra* (testing mode). It is not
 * a secret — the browser sends it as `x-app-id` on every request the
 * aggregator's own SDK makes — and the deployed site reads it from
 * `AGG_APP_ID` (set in the Vercel project on 2026-09-17). The constant is the
 * fallback for a local stand, where the Owner keeps no AGG values in
 * `.env.local`. `AGG_API_KEY`, the server-side key, is never read here and
 * never reaches the browser: the lab runs entirely on the App ID plus the
 * signed-in AGG user's own session, which is what the aggregator documents for
 * a browser integration.
 */
const AGG_LAB_DEFAULT_APP_ID = "cmu33lsiu01v809l9kh7ifw4p";

export default async function AggLabPage() {
  const admin = await getAdminSession();
  if (!admin) return <AdminUnauthorized surface="AGG Lab — внутрішня лабораторія" />;
  const appId = process.env.AGG_APP_ID?.trim() || AGG_LAB_DEFAULT_APP_ID;
  return <LabLoader appId={appId} />;
}
