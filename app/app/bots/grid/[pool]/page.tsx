import { Page } from "@/app/app/launch/launch-core";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import pair from "@/app/app/form-pair.module.css";
import { solanaServerLocale } from "@/app/solana/workspace/i18n/server";
import { poolKindOf, readChainPool } from "@/lib/liquidity/catalog/chain.server";
import { isPoolAddress } from "@/lib/liquidity/catalog/model";
import { readPoolRecord } from "@/lib/liquidity/catalog/service.server";

import type { AddToken } from "@/app/app/markets/pools/add-liquidity";
import { botsWords } from "../../bots-words";
import styles from "../../bots.module.css";
import { GridForm } from "../grid-form";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;

export async function generateMetadata(): Promise<Metadata> {
  const word = botsWords(await solanaServerLocale());
  return { title: word("gridTitle"), robots: { index: false } };
}

/**
 * «Боти → Грід» in one pool (B10): the pool as its program holds it now — the price, the active bin and the step — and
 * the grid's form, which goes to the pools' own Review, one signature and a receipt. Only a DLMM pool: anything else
 * is not a grid's pool and is not found here. The form and its levels are a centred pair in the core's action page
 * (SOL-C19); a pool that could not be read is one line in its column.
 */
export default async function GridPoolPage({ params }: { params: Promise<{ pool: string }> }) {
  const [{ pool: address }, locale] = await Promise.all([params, solanaServerLocale()]);
  if (!isPoolAddress(address)) notFound();
  const word = botsWords(locale);
  const owner = await poolKindOf(address);
  if (owner.ok && owner.value !== "dlmm") notFound();
  const [chain, record] = owner.ok ? await Promise.all([readChainPool("dlmm", address), readPoolRecord("dlmm", address)]) : [null, null];
  const pool = chain && chain.ok ? chain.value : null;
  const back = (
    <Link href="/app/bots/grid" className={styles.back} prefetch={false}>
      ← {word("gridPick")}
    </Link>
  );
  const lang = locale === "uk" ? "uk" : "en";
  if (!pool || pool.shape.kind !== "bins") {
    return (
      <Page kind="action" className={pair.column} title={word("gridTitle")} lang={lang}>
        {back}
        <p className={styles.gridNote} role="status">
          {word("gridPoolsDown")}
        </p>
      </Page>
    );
  }
  const token = (side: "x" | "y"): AddToken => {
    const chainToken = side === "x" ? pool.tokenX : pool.tokenY;
    const named = record?.pool ? (side === "x" ? record.pool.x : record.pool.y) : null;
    return { mint: chainToken.mint, decimals: chainToken.decimals, symbol: named?.mint === chainToken.mint ? named.symbol : `${chainToken.mint.slice(0, 4)}…`, priceUsd: named?.mint === chainToken.mint ? named.priceUsd : null };
  };
  const x = token("x");
  const y = token("y");
  return (
    <Page kind="action" className={pair.page} title={`${word("gridTitle")} · ${x.symbol}/${y.symbol}`} help={word("whatGrid")} lang={lang}>
      {back}
      <GridForm
        locale={locale}
        pool={address}
        x={x}
        y={y}
        price={Number(pool.price)}
        activeBin={pool.shape.activeBin}
        binStepBps={pool.shape.binStepBps}
        enabled={pool.enabled && !record?.pool?.blacklisted}
      />
    </Page>
  );
}
