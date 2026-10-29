import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { solanaServerLocale } from "@/app/solana/workspace/i18n/server";
import { isPoolAddress } from "@/lib/liquidity/catalog/model";

import { Page } from "../../../../../launch/launch-core";
import { ManagePosition } from "../../../manage-position";
import { poolsWords } from "../../../pools-words";
import styles from "../../../pools.module.css";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const word = poolsWords(await solanaServerLocale());
  return { title: word("manageTitle"), robots: { index: false } };
}

/**
 * One position of the connected wallet — an action page: its result against the entry, claim its fees or withdraw a
 * share of it. `?rebalance` (SOL-2b) — opened from a position out of its range: the form starts on «withdraw all».
 */
export default async function PositionPage({ params, searchParams }: { params: Promise<{ address: string; position: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ address, position }, locale, query] = await Promise.all([params, solanaServerLocale(), searchParams]);
  if (!isPoolAddress(address) || !isPoolAddress(position)) notFound();
  const word = poolsWords(locale);
  return (
    <Page kind="action" className={styles.page} title={word("manageTitle")}>
      <Link href={`/app/markets/pools/${address}`} className={styles.back}>
        ← {word("back2")}
      </Link>
      <ManagePosition locale={locale} pool={address} position={position} rebalance={query.rebalance !== undefined} />
    </Page>
  );
}
