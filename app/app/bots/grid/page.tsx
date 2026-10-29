import { Page } from "@/app/app/launch/launch-core";
import type { Metadata } from "next";
import Link from "next/link";

import pair from "@/app/app/form-pair.module.css";
import { HonestStateChip } from "@/app/shell/honest-state-chip";
import { solanaServerLocale } from "@/app/solana/workspace/i18n/server";
import { formatUsdCompact } from "@/app/solana/workspace/spot/spot-format";
import { formatFeePct } from "@/app/app/markets/pools/pool-format";
import { gridPools } from "@/lib/bots/grid";
import { authorityViews } from "@/lib/core/authority-matrix";
import { cleanSearch } from "@/lib/liquidity/catalog/model";
import { readPoolCatalog } from "@/lib/liquidity/catalog/service.server";

import { botsWords } from "../bots-words";
import styles from "../bots.module.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;

export async function generateMetadata(): Promise<Metadata> {
  const word = botsWords(await solanaServerLocale());
  return { title: `${word("grid")} · ${word("gridPick")}`, robots: { index: false } };
}

/**
 * «Боти → Грід», the first step (B10): which pool the grid stands in. Only Meteora DLMM — a grid's levels are the
 * pool's own bins — by the day's volume, with the step between levels each pool would give. `?q=` searches all of
 * Meteora, as «Пули» does. A step of a wizard: the core's action column in the middle of the canvas (SOL-C19).
 */
export default async function GridPoolsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [locale, params] = await Promise.all([solanaServerLocale(), searchParams]);
  const word = botsWords(locale);
  const numberLocale = locale === "uk" ? "uk-UA" : "en-US";
  const search = cleanSearch(params.q);
  const catalog = await readPoolCatalog(search);
  const pools = gridPools(catalog.pools);
  const source = catalog.sources.dlmm;
  const grid = authorityViews(["meteora-dlmm.grid"])["meteora-dlmm.grid"];
  return (
    <Page kind="action" className={pair.column} title={`${word("grid")} · ${word("gridPick")}`} help={word("gridLead")} lang={locale === "uk" ? "uk" : "en"}>
      <Link href="/app/bots" className={styles.back} prefetch={false}>
        ← {word("toBots")}
      </Link>
      {/* EXE-1: the grid's honest state and what it does by itself, from the authority matrix. */}
      <p className={styles.gridTruth} data-authority="meteora-dlmm.grid">
        <HonestStateChip state={grid.state} locale={locale} />
        <span>{word("gridAlone")}</span>
      </p>
      <form className={styles.gridSearch} action="/app/bots/grid" method="get" role="search">
        <label htmlFor="grid-q" className={styles.srOnly}>
          {word("gridSearch")}
        </label>
        <input id="grid-q" name="q" type="search" defaultValue={search ?? ""} placeholder={word("gridSearch")} autoComplete="off" maxLength={64} />
        <button type="submit" className="rw-btn">
          {word("gridFind")}
        </button>
      </form>
      {catalog.searchLimited ? <p className={styles.gridNote} role="status">{word("gridSearchLimited")}</p> : null}
      {!source.ok && pools.length === 0 ? (
        <p className={styles.gridNote} role="status">
          {word("gridPoolsDown")}
        </p>
      ) : pools.length === 0 ? (
        <p className={styles.gridNote} role="status">
          {word("gridNoPools")}
        </p>
      ) : (
        <ul className={styles.gridPools} aria-label={word("gridPick")}>
          {pools.map((pool) => (
            <li key={pool.address} data-grid-pool>
              <Link href={`/app/bots/grid/${pool.address}`} prefetch={false} className={styles.gridPool}>
                <span className={styles.gridPair} translate="no">
                  {pool.x.symbol}/{pool.y.symbol}
                </span>
                <span className={styles.gridFact}>
                  <span>{word("gridStep")}</span>
                  <strong>{formatFeePct((pool.binStepBps ?? 0) / 100, numberLocale)}</strong>
                </span>
                <span className={styles.gridFact}>
                  <span>{word("gridVolume")}</span>
                  <strong>{pool.volume24hUsd === null ? "—" : formatUsdCompact(pool.volume24hUsd, numberLocale)}</strong>
                </span>
                <span className={styles.gridFact} data-wide>
                  <span>{word("gridLiquidity")}</span>
                  <strong>{pool.tvlUsd === null ? "—" : formatUsdCompact(pool.tvlUsd, numberLocale)}</strong>
                </span>
                <span className={styles.gridFact} data-wide>
                  <span>{word("gridFee")}</span>
                  <strong>{formatFeePct(pool.baseFeePct, numberLocale)}</strong>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {source.ok && source.stale ? <p className={styles.gridNote}>{word("gridPoolsStale")}</p> : null}
    </Page>
  );
}
