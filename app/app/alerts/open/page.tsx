import { notFound, redirect } from "next/navigation";

import { getGuardRuntime } from "@/lib/guard/runtime";
import { resolveInboxLink } from "@/lib/monitoring/service.server";
import { readWalletProof } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Monitoring", robots: { index: false, follow: false } };

/**
 * Ownership-safe deep link. A note is never permission to trade: we reread
 * the owned record and send the person to it as it stands now.
 */
export default async function OpenMonitoringNote({
  searchParams,
}: {
  searchParams: Promise<{ n?: string }>;
}) {
  const { n } = await searchParams;
  if (!n || !/^(inb_|mon_)[0-9a-f]{24}$/.test(n)) notFound();
  const read = await readWalletProof();
  const proof = read.status === "ok" ? read.proof : null;
  if (!proof || proof.chain !== "solana") redirect("/app/alerts");
  const href = await resolveInboxLink(getGuardRuntime().store, proof.address, n);
  if (!href) notFound();
  redirect(href);
}
