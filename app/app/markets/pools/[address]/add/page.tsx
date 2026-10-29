import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { solanaServerLocale } from "@/app/solana/workspace/i18n/server";
import { poolKindOf, readChainPool, VENUE_OF_KIND } from "@/lib/liquidity/catalog/chain.server";
import { isPoolAddress, priceBound } from "@/lib/liquidity/catalog/model";
import { readPoolRecord } from "@/lib/liquidity/catalog/service.server";
import { halfBinsOfSpan } from "@/lib/liquidity/catalog/track";

import { Page } from "../../../../launch/launch-core";
import { AddLiquidity, type AddToken } from "../../add-liquidity";
import { widthNear } from "../../liquidity-form";
import { POOL_KEY, poolsWords } from "../../pools-words";
import styles from "../../pools.module.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;

export async function generateMetadata(): Promise<Metadata> {
  const word = poolsWords(await solanaServerLocale());
  return { title: word("addTitle"), robots: { index: false } };
}

/**
 * «Додати ліквідність» to one pool — an action page: the pool as its program
 * holds it now (price, bins or range), the venue's token names and prices, and
 * the form that goes to one Review and one signature. `?rebalance=<span>` — from a position out of its range (SOL-2b):
 * the form starts at the width the old position had (upper / lower), around the price; the person still chooses.
 */
export default async function AddLiquidityPage({ params, searchParams }: { params: Promise<{ address: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ address }, locale, query] = await Promise.all([params, solanaServerLocale(), searchParams]);
  if (!isPoolAddress(address)) notFound();
  const word = poolsWords(locale);
  const owner = await poolKindOf(address);
  if (owner.ok && owner.value === null) notFound();
  const kind = owner.ok ? owner.value : null;
  const [chain, record] = kind ? await Promise.all([readChainPool(kind, address), readPoolRecord(kind, address)]) : [null, null];
  const pool = chain && chain.ok ? chain.value : null;
  const back = (
    <Link href={`/app/markets/pools/${address}`} className={styles.back}>
      ← {word("back2")}
    </Link>
  );
  if (!kind || !pool) {
    return (
      <Page kind="action" className={styles.page} title={word("addTitle")}>
        {back}
        <p className={styles.note} role="status">
          {word("chainDown")}
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
  const asked = typeof query.rebalance === "string" ? Number(query.rebalance) : NaN;
  const half = pool.shape.kind === "bins" && Number.isFinite(asked) ? halfBinsOfSpan(asked, pool.shape.binStepBps) : null;
  const range = pool.shape.kind === "range" ? (pool.shape.concentrated ? { min: priceBound(pool.shape.minPrice, "min"), max: priceBound(pool.shape.maxPrice, "max") } : { min: null, max: null }) : null;
  return (
    <Page kind="action" className={styles.page} title={`${word("addTitle")} · ${x.symbol}/${y.symbol}`} lead={kind === "dlmm" ? word("addLead") : word("addLeadRange")}>
      {back}
      <AddLiquidity
        locale={locale}
        kind={kind}
        venue={VENUE_OF_KIND[kind]}
        venueLabel={word(POOL_KEY[kind])}
        pool={address}
        x={x}
        y={y}
        price={Number(pool.price)}
        activeBin={pool.shape.kind === "bins" ? pool.shape.activeBin : null}
        binStepBps={pool.shape.kind === "bins" ? pool.shape.binStepBps : null}
        range={range}
        enabled={pool.enabled && !record?.pool?.blacklisted}
        {...(half !== null ? { startWidth: widthNear(half) } : {})}
        rebalance={typeof query.rebalance === "string"}
      />
    </Page>
  );
}
