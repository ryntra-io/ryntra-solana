import { notFound } from "next/navigation";

import { solanaServerLocale } from "@/app/solana/workspace/i18n/server";
import { BASE58 } from "@/lib/api/v1/contract";
import { launchNetwork } from "@/lib/launch/config.server";

import { CABINET_WORDS } from "../../mine/cabinet-words";
import { shortAddress } from "../../launch-format";
import { CreatorProfile } from "./creator-profile";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata({ params }: { params: Promise<{ address: string }> }) {
  if (!launchNetwork()) return {};
  const { address } = await params;
  if (!BASE58.test(address)) return {};
  const locale = await solanaServerLocale();
  return { title: CABINET_WORDS.creatorTitle[locale].replace("{address}", shortAddress(address)), description: CABINET_WORDS.creatorHelp[locale] };
}

/**
 * A creator's public profile (SOL-L2): every token the wallet launched through Ryntra, read from the chain — how far
 * each went, its holders and volume, the creator's lock and sales. No ranking and no promotion; nothing private.
 */
export default async function CreatorProfilePage({ params }: { params: Promise<{ address: string }> }) {
  const network = launchNetwork();
  if (!network) notFound();
  const { address } = await params;
  if (!BASE58.test(address)) notFound();
  const locale = await solanaServerLocale();
  return <CreatorProfile address={address} locale={locale} network={network.chain} />;
}
