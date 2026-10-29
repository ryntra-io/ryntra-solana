import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { withinMetadataBudget } from "@/app/app/metadata-budget";
import { solanaServerLocale } from "@/app/solana/workspace/i18n/server";
import { formatUsdCompact } from "@/app/solana/workspace/spot/spot-format";
import { poolKindOf, readChainPool, readDlmmBins, type BinsRead, type ChainRead } from "@/lib/liquidity/catalog/chain.server";
import { isPoolAddress, LIQUIDITY_POOL_KINDS, priceBound, type CatalogPool, type LiquidityPoolKind } from "@/lib/liquidity/catalog/model";
import { readPoolRecord } from "@/lib/liquidity/catalog/service.server";
import type { LiquidityPool as ChainPool } from "@/lib/liquidity/studio/contract";

import { Block, Page } from "../../../launch/launch-core";
import { MyPositions } from "../my-positions";
import { formatFeePct, formatPoolPrice, formatSlot } from "../pool-format";
import { ReadTime } from "../read-time";
import { BinsChart, RangeBar } from "../pool-distribution";
import { AddLiquidityAction } from "../pool-actions";
import { PoolSimulator } from "../pool-simulator";
import { POOL_KEY, poolsWords, type PoolsWord } from "../pools-words";
import styles from "../pools.module.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;

type Read = Readonly<{
  kind: LiquidityPoolKind;
  record: CatalogPool | null;
  recordAt: string | null;
  chain: ChainRead<ChainPool>;
  bins: ChainRead<BinsRead> | null;
}>;

/**
 * The venue from the chain (the program that owns the account, and the account's kind); when the chain is silent, the
 * venue whose Data API knows the pool. `not_pool` only when the chain said so; `unknown` when nothing answered.
 */
async function readPool(address: string): Promise<Read | "not_pool" | "unknown"> {
  const owner = await poolKindOf(address);
  let kind: LiquidityPoolKind | null = owner.ok ? owner.value : null;
  if (owner.ok && kind === null) return "not_pool";
  let record: CatalogPool | null = null;
  let recordAt: string | null = null;
  if (!kind) {
    const reads = await Promise.all(LIQUIDITY_POOL_KINDS.map((candidate) => readPoolRecord(candidate, address)));
    const index = reads.findIndex((read) => read.pool);
    if (index < 0) return "unknown";
    kind = LIQUIDITY_POOL_KINDS[index]!;
    record = reads[index]!.pool;
    recordAt = reads[index]!.at;
  }
  const [recordRead, chain, bins] = await Promise.all([
    record ? Promise.resolve({ pool: record, at: recordAt, ok: true }) : readPoolRecord(kind, address),
    readChainPool(kind, address),
    kind === "dlmm" ? readDlmmBins(address) : Promise.resolve(null),
  ]);
  return { kind, record: recordRead.pool, recordAt: recordRead.at, chain, bins };
}

export async function generateMetadata({ params }: { params: Promise<{ address: string }> }): Promise<Metadata> {
  const [{ address }, locale] = await Promise.all([params, solanaServerLocale()]);
  const word = poolsWords(locale);
  if (!isPoolAddress(address)) return { title: word("title") };
  /* Within the metadata's budget: the pool's pair names the tab when Meteora answers at once, never at the cost of the skeleton. */
  const record = await withinMetadataBudget(
    Promise.all(LIQUIDITY_POOL_KINDS.map((kind) => readPoolRecord(kind, address))).then((reads) => reads.find((read) => read.pool)?.pool ?? null),
    null,
  );
  return { title: record ? `${record.x.symbol}/${record.y.symbol} · ${word("title")}` : word("title"), robots: { index: false } };
}

/**
 * One pool's page: what it is (venue, pair, price, fee schedule, bins or
 * range), how deep and how busy (the venue's TVL, a day's volume and fees),
 * where its liquidity sits, and what a deposit would do against holding — with
 * the wallet's positions in it beside, and the way to add to it.
 */
export default async function PoolPage({ params }: { params: Promise<{ address: string }> }) {
  const [{ address }, locale] = await Promise.all([params, solanaServerLocale()]);
  if (!isPoolAddress(address)) notFound();
  const word = poolsWords(locale);
  const numberLocale = locale === "uk" ? "uk-UA" : "en-US";
  const lang = locale === "uk" ? "uk" : "en";
  const read = await readPool(address);
  if (read === "not_pool") notFound();
  if (read === "unknown") {
    return (
      <Page kind="overview" className={styles.page} title={word("title")}>
        <Link href="/app/markets/pools" className={styles.back}>
          ← {word("back")}
        </Link>
        <p className={styles.note} role="status">
          {word("unknownPool")}
        </p>
      </Page>
    );
  }
  const { kind, record, recordAt, chain, bins } = read;
  const pool = chain.ok ? chain.value : null;
  const xSymbol = record?.x.symbol ?? (pool ? `${pool.tokenX.mint.slice(0, 4)}…` : "X");
  const ySymbol = record?.y.symbol ?? (pool ? `${pool.tokenY.mint.slice(0, 4)}…` : "Y");
  const price = pool ? Number(pool.price) : record?.price ?? null;
  const fee = (bps: number | null | undefined): string => formatFeePct(bps === null || bps === undefined ? null : bps / 100, numberLocale);
  const binStep = pool?.shape.kind === "bins" ? pool.shape.binStepBps : record?.binStepBps ?? null;
  /* The chain states a full-range curve at the program's extreme prices; read through the same rule as the venue's figures. */
  const range =
    pool?.shape.kind === "range"
      ? pool.shape.concentrated
        ? { min: priceBound(pool.shape.minPrice, "min"), max: priceBound(pool.shape.maxPrice, "max") }
        : { min: null, max: null }
      : record?.range
        ? { min: record.range.minPrice, max: record.range.maxPrice }
        : { min: null, max: null };
  const compounding = pool?.shape.kind === "range" ? pool.shape.compounding : record?.compounding ?? false;

  const facts: ReadonlyArray<Readonly<{ key: string; label: PoolsWord; value: string; note?: string }>> = [
    { key: "price", label: "price", value: price === null ? "—" : `${formatPoolPrice(price, numberLocale)} ${ySymbol}` },
    { key: "tvl", label: "tvl", value: formatUsdCompact(record?.tvlUsd ?? null, numberLocale) },
    { key: "volume", label: "volume24h", value: formatUsdCompact(record?.volume24hUsd ?? null, numberLocale) },
    { key: "fees", label: "fees24h", value: formatUsdCompact(record?.fees24hUsd ?? null, numberLocale) },
    { key: "base", label: "baseFee", value: pool ? fee(pool.fees.baseBps) : formatFeePct(record?.baseFeePct ?? null, numberLocale) },
    ...(kind === "dlmm" ? [{ key: "dynamic", label: "dynamicFee" as const, value: pool ? fee(pool.fees.currentBps) : formatFeePct(record?.dynamicFeePct ?? null, numberLocale), note: word("dynamicFeeNote") }] : []),
    /* DLMM's ceiling bounds a fee that moves; DAMM v2's is the program's own limit, not this pool's, and says nothing here. */
    ...(kind === "dlmm" && ((pool?.fees.maxBps ?? null) !== null || record?.maxFeePct) ? [{ key: "max", label: "maxFee" as const, value: pool?.fees.maxBps != null ? fee(pool.fees.maxBps) : formatFeePct(record?.maxFeePct ?? null, numberLocale) }] : []),
    { key: "protocol", label: "protocolShare", value: pool ? `${pool.fees.protocolSharePct}%` : record?.protocolSharePct != null ? `${record.protocolSharePct}%` : "—", note: word("protocolShareNote") },
    kind === "dlmm"
      ? { key: "shape", label: "binStepFact", value: binStep === null ? "—" : fee(binStep) }
      : { key: "shape", label: "rangeFact", value: compounding ? word("compounding") : range.min === null && range.max === null ? word("fullRange") : `${formatPoolPrice(range.min, numberLocale)} – ${range.max === null ? "∞" : formatPoolPrice(range.max, numberLocale)}` },
    {
      key: "holds",
      label: "holds",
      value: `${record?.xAmount != null ? formatPoolPrice(record.xAmount, numberLocale) : "—"} ${xSymbol} · ${record?.yAmount != null ? formatPoolPrice(record.yAmount, numberLocale) : "—"} ${ySymbol}`,
    },
  ];


  return (
    <Page
      kind="overview"
      className={styles.page}
      title={`${xSymbol}/${ySymbol}`}
      help={`${word(POOL_KEY[kind])} · ${price === null ? "—" : `1 ${xSymbol} = ${formatPoolPrice(price, numberLocale)} ${ySymbol}`}`}
      action={chain.ok ? <AddLiquidityAction locale={locale} pool={address} enabled={pool !== null && pool.enabled && !record?.blacklisted} /> : undefined}
      aside={<MyPositions locale={locale} pool={address} />}
      data-pool-kind={kind}
    >
      <Link href="/app/markets/pools" className={styles.back}>
        ← {word("back")}
      </Link>
      {record?.blacklisted ? <p className={styles.note} role="status">{word("blacklisted")}</p> : null}
      {pool && !pool.enabled ? <p className={styles.note} role="status">{word("disabled")}</p> : null}
      {!chain.ok ? <p className={styles.note} role="status">{word("chainDown")}</p> : null}

      <Block title={word("facts")} titleAs="h2" icon="chart-column" lang={lang} data-pools="facts">
        <dl className={styles.facts}>
          {facts.map((fact) => (
            <div key={fact.key} className={styles.fact} data-fact={fact.key}>
              <dt>{word(fact.label)}</dt>
              <dd>{fact.value}</dd>
              {fact.note ? <span className={styles.factNote}>{fact.note}</span> : null}
            </div>
          ))}
        </dl>
        <p className={styles.sourcesLine}>
          {pool ? (
            <>
              {/* The chain's slot is for whoever checks it — on hover, not in the line a person reads. */}
              <span title={`${word("slot")} ${formatSlot(pool.source.slot, numberLocale)}`}>{word("sourceChain")}</span> · <ReadTime at={pool.source.at} locale={numberLocale} />
            </>
          ) : null}
          {pool && recordAt ? " · " : null}
          {recordAt ? (
            <>
              {word("sourceData")} · <ReadTime at={recordAt} locale={numberLocale} />
            </>
          ) : null}
          {!pool && !recordAt ? "—" : null}
        </p>
      </Block>

      <Block title={word("distribution")} titleAs="h2" icon="chart-column" lang={lang} data-pools="distribution">
        {kind === "dlmm" ? (
          bins && bins.ok ? (
            <BinsChart bins={bins.value} xSymbol={xSymbol} ySymbol={ySymbol} locale={locale} />
          ) : (
            <p className={styles.note}>{word("distributionDown")}</p>
          )
        ) : (
          <RangeBar
            min={range.min}
            max={range.max}
            price={price}
            compounding={compounding}
            xValue={record?.xAmount != null && record.x.priceUsd != null ? record.xAmount * record.x.priceUsd : null}
            yValue={record?.yAmount != null && record.y.priceUsd != null ? record.yAmount * record.y.priceUsd : null}
            xSymbol={xSymbol}
            ySymbol={ySymbol}
            locale={locale}
          />
        )}
      </Block>

      <Block title={word("simulator")} titleAs="h2" icon="chart-column" lang={lang} data-pools="simulator">
        <PoolSimulator
          locale={locale}
          kind={kind}
          price={price}
          binStepBps={binStep}
          min={range.min}
          max={range.max}
          xSymbol={xSymbol}
          ySymbol={ySymbol}
          yPriceUsd={record?.y.priceUsd ?? null}
          tvlUsd={record?.tvlUsd ?? null}
          volume24hUsd={record?.volume24hUsd ?? null}
          feePct={pool ? pool.fees.baseBps / 100 : record?.baseFeePct ?? null}
          protocolSharePct={pool ? pool.fees.protocolSharePct : record?.protocolSharePct ?? null}
        />
      </Block>

      <details className={styles.details}>
        <summary>{word("details")}</summary>
        <dl className={styles.detailsList}>
          <div>
            <dt>{word("poolAddress")}</dt>
            <dd>{address}</dd>
          </div>
          <div>
            <dt>{word("tokenX")}</dt>
            <dd>
              {xSymbol} · {record?.x.mint ?? pool?.tokenX.mint ?? "—"}
            </dd>
          </div>
          <div>
            <dt>{word("tokenY")}</dt>
            <dd>
              {ySymbol} · {record?.y.mint ?? pool?.tokenY.mint ?? "—"}
            </dd>
          </div>
          {record?.createdAt ? (
            <div>
              <dt>{word("created")}</dt>
              <dd>
                <ReadTime at={record.createdAt} locale={numberLocale} date />
              </dd>
            </div>
          ) : null}
        </dl>
        {record ? (
          <a href={record.source.page} target="_blank" rel="noreferrer noopener" className={styles.external}>
            {word("openOnMeteora")} ↗
          </a>
        ) : null}
      </details>
    </Page>
  );
}
