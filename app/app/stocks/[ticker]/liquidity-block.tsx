import { ArrowSquareOut } from "@phosphor-icons/react/dist/ssr";

import { HelpLabel } from "@/app/shell/help";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { formatUsdMoney } from "@/app/solana/workspace/spot/spot-format";
import { usdCompactText } from "@/lib/agent/provenance";
import { isMeaningful, isMoneyLikeOrStock, LISTED_TVL_USD, MEANINGFUL_TVL_USD, POOL_KIND_LABEL, SUMMARY_POOL_LIMIT, type LiquidityPool, type StockLiquidity } from "@/lib/liquidity/model";
import { readStockLiquidity } from "@/lib/liquidity/service.server";
import { readStockUniverse } from "@/lib/stocks/universe.server";

import { clockOf } from "../stock-model";
import styles from "../stocks.module.css";

/**
 * Where the token actually trades, at rest one calm line: the primary Meteora
 * pool's value and its day of trading — "Where it trades: Meteora · $610K in
 * the pool · $4.8M a day". One press on *Details* opens everything the card
 * held before: the primary pool with the venue's own figures (in the pool,
 * 24 h volume, 24 h fees, fee rate), the strongest few beside it, the whole
 * list with the dust counted rather than paraded, a deeper pool on another
 * venue named, and where the figures come from under the product's `?`. A
 * page may open the card by itself (`defaultOpen`) where a Meteora pool is
 * the token's whole market.
 *
 * A server component behind a Suspense boundary: the page streams without it
 * and the reader's own budget bounds the wait; when Meteora does not answer,
 * the line says so and nothing else on the page changes. Every figure is the
 * venue's, in the venue's unit; fees are what the pool earned, not what a
 * person pays. Nothing here is a recommendation, no figure decides anything
 * downstream, and the card says nothing about how a purchase is routed. No
 * orange here: the page's one orange action is Buy.
 */

const WORDS = {
  whereTrades: { en: "Where it trades", uk: "Де торгується" },
  inPool: { en: "in the pool", uk: "у пулі" },
  aDay: { en: "a day", uk: "за добу" },
  alsoOnMeteora: { en: "also on Meteora", uk: "також на Meteora" },
  noMoneyPoolOver: { en: "no pool on Meteora over", uk: "на Meteora немає пулу понад" },
  pairedWithMoney: { en: "paired with a stablecoin or SOL", uk: "у парі зі стейблкоїном чи SOL" },
  noPoolNow: { en: "no pool on Meteora right now", uk: "на Meteora пулу зараз немає" },
  noAnswer: { en: "Meteora did not answer right now", uk: "Meteora зараз не відповідає" },
  mayBeOld: { en: "figures may be out of date", uk: "дані можуть бути застарілі" },
  mayBeShort: { en: "some pools may be missing", uk: "частини пулів може бракувати" },
  details: { en: "Details", uk: "Деталі" },
  elsewhere: { en: "Elsewhere", uk: "Деінде" },
  routeSees: { en: "the deepest pool GeckoTerminal lists for this token is", uk: "найглибший пул, який GeckoTerminal показує для цього токена, —" },
  onVenue: { en: "on", uk: "на" },
  withReserve: { en: "with", uk: "з" },
  routeSource: { en: "the chart above prices from it", uk: "графік угорі бере ціну з нього" },
  primary: { en: "Primary pool", uk: "Основний пул" },
  pair: { en: "Pair", uk: "Пара" },
  tvl: { en: "In the pool", uk: "У пулі" },
  tvlSub: { en: "both sides of the pool", uk: "обидві сторони пулу" },
  volume: { en: "24 h volume", uk: "Обсяг за 24 год" },
  fees: { en: "24 h fees", uk: "Комісії за 24 год" },
  feesSub: { en: "earned by the pool", uk: "зароблено пулом" },
  feeRate: { en: "Fee rate", uk: "Ставка комісії" },
  feeRateSub: { en: "the venue's base rate per trade", uk: "базова ставка майданчика за угоду" },
  dynamicNow: { en: "now", uk: "зараз" },
  holds: { en: "the pool holds", uk: "пул тримає" },
  and: { en: "and", uk: "і" },
  created: { en: "created", uk: "створено" },
  venue: { en: "Venue", uk: "Майданчик" },
  openOnVenue: { en: "Open on Meteora", uk: "Відкрити на Meteora" },
  morePools: { en: "Other pools worth noting", uk: "Інші помітні пули" },
  allPools: { en: "All pools holding", uk: "Усі пули з" },
  under: { en: "under", uk: "менше" },
  dust: { en: "not shown above", uk: "не показані вище" },
  pool: { en: "Pool", uk: "Пул" },
  side: { en: "this token is the quote side", uk: "цей токен — сторона котирування" },
  noPrimary: { en: "No pool above $1,000 quotes this token in a stablecoin, SOL or another stock; the pools below price other tokens in it.", uk: "Жоден пул понад $1 000 не котирує цей токен у стейблкоїні, SOL чи іншій акції; пули нижче оцінюють у ньому інші токени." },
  partial: { en: "did not answer — its pools may be missing", uk: "не відповів — його пулів може бракувати" },
  stale: { en: "stale, from", uk: "застаріле, з" },
  read: { en: "read", uk: "прочитано" },
  source: { en: "Source", uk: "Джерело" },
} as const;

type Word = keyof typeof WORDS;
type Lang = "en" | "uk";
type Usd = (value: number | null) => string;

function wordsFor(locale: WorkspaceLocale) {
  const lang = locale === "uk" ? "uk" : "en";
  return (word: Word): string => WORDS[word][lang];
}

/** Compact USD in the person's language — `$610K` / `$610 тис.` — and a dash where the venue stated no figure, never a zero. */
function usdOf(lang: Lang): Usd {
  return (value) => (value === null || !Number.isFinite(value) ? "—" : usdCompactText(value, lang));
}

function feeText(pool: LiquidityPool, w: (word: Word) => string, numberLocale: string): string | null {
  if (pool.baseFeePct === null) return null;
  const base = `${pctText(pool.baseFeePct, numberLocale)}%`;
  /* DLMM states the rate in force — base plus the variable part — as `dynamic_fee_pct`; it is named only when it exceeds the base, a zero there meaning no variable part rather than a free trade. */
  if (pool.dynamicFeePct !== null && pool.dynamicFeePct - pool.baseFeePct > 1e-9) return `${base} · ${w("dynamicNow")} ${pctText(pool.dynamicFeePct, numberLocale)}%`;
  return base;
}

/** A fee rate in the person's decimals, trailing zeros dropped: `0.01` / `0,01`. */
function pctText(value: number, numberLocale: string): string {
  return new Intl.NumberFormat(numberLocale, { maximumFractionDigits: value >= 1 ? 2 : 3 }).format(value);
}

function amount(value: number | null, symbol: string, locale: string): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: value >= 1000 ? 0 : value >= 1 ? 2 : 6 }).format(value)} ${symbol}`;
}

/** The venue's own name for the pair — what the person will read on Meteora's page. */
function pairName(pool: LiquidityPool): string {
  return pool.name;
}

/** `N more pools with under $1 of liquidity are not listed.` in both languages, the Ukrainian noun agreeing with the count. */
function emptyPoolsLine(n: number, locale: WorkspaceLocale): string {
  if (locale !== "uk") return `${n} more ${n === 1 ? "pool" : "pools"} with under $1 of liquidity ${n === 1 ? "is" : "are"} not listed.`;
  const tail = n % 100;
  const noun = tail % 10 === 1 && tail !== 11 ? "пул" : tail % 10 >= 2 && tail % 10 <= 4 && (tail < 12 || tail > 14) ? "пули" : "пулів";
  return `Ще ${n} ${noun} із ліквідністю менше $1 не показано.`;
}

/** The pool the page already charts — GeckoTerminal's deepest for the mint — so a deeper pool on another venue is never hidden by a Meteora-only list. */
export type RoutePool = Readonly<{ name: string; dex: string | null; reserveUsd: number | null }>;

export async function LiquidityBlock({ mint, symbol, locale, routePool, defaultOpen = false }: { mint: string; symbol: string; locale: WorkspaceLocale; routePool: RoutePool | null; defaultOpen?: boolean }) {
  /* The confirmed stock mints, so a stock–stock pool is known as one and can
     lead when no money pool does; the universe is the page's own cached read,
     so this costs nothing new. Without it the classification degrades to
     `other`, never to a wrong figure. */
  const universe = await readStockUniverse();
  const stockMints = new Set(universe.ok ? universe.universe.rows.map((row) => row.representation.mint) : []);
  const liquidity = await readStockLiquidity(mint, { stockMints });
  return <LiquidityView liquidity={liquidity} symbol={symbol} locale={locale} routePool={routePool} defaultOpen={defaultOpen} />;
}

/** The card from a read; pure, so the stand and the tests can draw any state. */
export function LiquidityView({ liquidity, symbol, locale, routePool = null, defaultOpen = false }: { liquidity: StockLiquidity; symbol: string; locale: WorkspaceLocale; routePool?: RoutePool | null; defaultOpen?: boolean }) {
  const w = wordsFor(locale);
  const lang: Lang = locale === "uk" ? "uk" : "en";
  const usd = usdOf(lang);
  const numberLocale = locale === "uk" ? "uk-UA" : "en-US";
  const primary = liquidity.primary;
  const meaningful = liquidity.pools.filter(isMeaningful);
  /* The summary names only pools a person can buy the stock in — money-like or stock-quoted; a memecoin pool priced in the stock is real liquidity for the memecoin and waits in the full list, flagged. */
  const others = meaningful.filter((pool) => pool !== primary && isMoneyLikeOrStock(pool.counterKind)).slice(0, SUMMARY_POOL_LIMIT - 1);
  const listed = liquidity.pools.filter((pool) => (pool.tvlUsd ?? 0) >= LISTED_TVL_USD);
  const empty = liquidity.pools.length - listed.length;
  const clock = clockOf(liquidity.fetchedAt, locale);
  const unavailable = liquidity.state === "unavailable";
  const hasPools = !unavailable && liquidity.pools.length > 0;
  /* Which source was late or silent, with its time — a detail; the line at rest carries only the word for it. */
  const sourceNotes = unavailable
    ? []
    : (["dlmm", "damm-v2"] as const)
        .map((kind) => {
          const source = liquidity.sources[kind];
          if (!source.ok) return `${POOL_KIND_LABEL[kind]} ${w("partial")}`;
          if (source.stale) return `${POOL_KIND_LABEL[kind]} ${w("stale")} ${clockOf(source.fetchedAt, locale) ?? "—"} UTC`;
          return null;
        })
        .filter((note): note is string => note !== null);
  const status = liquidity.state === "stale" ? w("mayBeOld") : liquidity.state === "partial" ? w("mayBeShort") : null;
  /* A deeper pool on another venue, as the page's chart source already states it — named, never hidden behind a Meteora-only list. */
  const elsewhere = routePool && routePool.dex && !/meteora/i.test(routePool.dex) && routePool.reserveUsd !== null && routePool.reserveUsd >= MEANINGFUL_TVL_USD && (primary === null || routePool.reserveUsd > (primary.tvlUsd ?? 0)) ? routePool : null;

  /* The card at rest: one line — the primary pool's value and its day, or the one fact that stands in their place. Where the page's chart already prices from a deeper pool on another venue, Meteora is named as *also* a place the token trades, never as its market. */
  const line = (
    <span className={styles.liqLine}>
      <span id="liquidity-title" className={styles.liqLineLabel}>
        {w("whereTrades")}:
      </span>{" "}
      {unavailable ? (
        w("noAnswer")
      ) : liquidity.pools.length === 0 ? (
        w("noPoolNow")
      ) : primary ? (
        <>
          {elsewhere ? w("alsoOnMeteora") : "Meteora"} · <b className={styles.liqFigure}>{usd(primary.tvlUsd)}</b> {w("inPool")}
          {primary.volume24hUsd === null ? null : (
            <>
              {" · "}
              <b className={styles.liqFigure}>{usd(primary.volume24hUsd)}</b> {w("aDay")}
            </>
          )}
        </>
      ) : (
        `${w("noMoneyPoolOver")} ${usd(MEANINGFUL_TVL_USD)} ${w("pairedWithMoney")}`
      )}
      {status ? <span className={styles.liqLineStatus}>{` · ${status}`}</span> : null}
    </span>
  );

  /* Nothing to open — the venue silent or holding no pool, and no deeper pool elsewhere: the line is the whole card. */
  if (!hasPools && !elsewhere) {
    return (
      <section className={`${styles.card} ${styles.w12}`} aria-labelledby="liquidity-title" data-testid="liquidity" data-state={liquidity.state}>
        <p className={styles.liqRest} role="status">
          {line}
        </p>
      </section>
    );
  }

  return (
    <section className={`${styles.card} ${styles.w12}`} aria-labelledby="liquidity-title" data-testid="liquidity" data-state={liquidity.state}>
      <details className={styles.liqDetails} open={defaultOpen} data-testid="liquidity-details">
        <summary className={styles.liqSummary}>
          {line}
          <span className={styles.liqMore}>{w("details")}</span>
        </summary>
        <div className={styles.liqBody}>
          {sourceNotes.length > 0 ? <p className={styles.liqCaution}>{sourceNotes.join(" · ")}</p> : null}
          {hasPools ? (
            <>
              {primary ? (
                <PrimaryPool pool={primary} w={w} usd={usd} numberLocale={numberLocale} />
              ) : (
                <p className={styles.liqEmpty}>{w("noPrimary")}</p>
              )}
              {others.length > 0 ? (
                <div className={styles.liqOthers}>
                  <h3>{w("morePools")}</h3>
                  <ul className={styles.liqList}>
                    <ListHead w={w} />
                    {others.map((pool) => (
                      <PoolRow key={pool.address} pool={pool} w={w} usd={usd} numberLocale={numberLocale} />
                    ))}
                  </ul>
                </div>
              ) : null}
              <details className={styles.liqFold} data-testid="liquidity-all">
                <summary>
                  {w("allPools")} {symbol} ({liquidity.pools.length})
                  {liquidity.dustCount > 0 ? (
                    <span className={styles.liqSub}>
                      {liquidity.dustCount} {w("under")} {usd(MEANINGFUL_TVL_USD)} · {w("dust")}
                    </span>
                  ) : null}
                </summary>
                <ul className={styles.liqList}>
                  <ListHead w={w} />
                  {listed.map((pool) => (
                    <PoolRow key={pool.address} pool={pool} w={w} usd={usd} numberLocale={numberLocale} />
                  ))}
                </ul>
                {empty > 0 ? <p className={styles.liqHolds}>{emptyPoolsLine(empty, locale)}</p> : null}
              </details>
            </>
          ) : null}
          {elsewhere ? (
            <p className={styles.liqHolds} data-testid="liquidity-elsewhere">
              <b>{w("elsewhere")}:</b> {w("routeSees")} <span translate="no">{elsewhere.name}</span> {w("onVenue")} <span translate="no">{elsewhere.dex}</span> {w("withReserve")} <span translate="no">{usd(elsewhere.reserveUsd)}</span> — {w("routeSource")}.
            </p>
          ) : null}
          {/* Where the figures come from, and what they are and are not — one press on the `?`, never a paragraph on the card. */}
          {hasPools ? (
            <p className={styles.liqSource}>
              <HelpLabel topic="meteoraPools" locale={locale}>
                {`${w("source")}: Meteora${clock ? ` · ${w("read")} ${clock} UTC` : ""}`}
              </HelpLabel>
            </p>
          ) : null}
        </div>
      </details>
    </section>
  );
}

function PrimaryPool({ pool, w, usd, numberLocale }: { pool: LiquidityPool; w: (word: Word) => string; usd: Usd; numberLocale: string }) {
  const holds = [amount(pool.stockAmount, pool.stock.symbol, numberLocale), amount(pool.counterAmount, pool.counter.symbol, numberLocale)].filter((part): part is string => part !== null);
  const created = pool.createdAt ? pool.createdAt.slice(0, 10) : null;
  const fee = feeText(pool, w, numberLocale);
  return (
    <div className={styles.liqPrimary} data-testid="liquidity-primary">
      <div className={styles.liqPrimaryHead}>
        <span className={styles.liqLabel}>{w("primary")}</span>
        <span className={styles.liqPair} translate="no">
          {pairName(pool)}
        </span>
        <span className={styles.liqVenue} translate="no">
          Meteora {POOL_KIND_LABEL[pool.kind]}
        </span>
        {/* A quiet text link to the venue's own page — never an orange action. */}
        <a className={styles.liqLink} href={pool.source.page} target="_blank" rel="noreferrer noopener">
          {w("openOnVenue")}
          <ArrowSquareOut size={14} aria-hidden="true" />
        </a>
      </div>
      <dl className={styles.liqMetrics}>
        <div>
          <dt>{w("tvl")}</dt>
          <dd translate="no">
            {usd(pool.tvlUsd)}
            <span className={styles.liqSub}>{w("tvlSub")}</span>
          </dd>
        </div>
        <div>
          <dt>{w("volume")}</dt>
          <dd translate="no">{usd(pool.volume24hUsd)}</dd>
        </div>
        <div>
          <dt>{w("fees")}</dt>
          <dd translate="no">
            {pool.fees24hUsd === null ? "—" : formatUsdMoney(pool.fees24hUsd, numberLocale)}
            <span className={styles.liqSub}>{w("feesSub")}</span>
          </dd>
        </div>
        <div>
          <dt>{w("feeRate")}</dt>
          <dd translate="no">
            {fee ?? "—"}
            <span className={styles.liqSub}>{w("feeRateSub")}</span>
          </dd>
        </div>
      </dl>
      {holds.length > 0 || created ? (
        <p className={styles.liqHolds} translate="no">
          {holds.length > 0 ? `${w("holds")} ${holds.join(` ${w("and")} `)}` : null}
          {holds.length > 0 && created ? " · " : null}
          {created ? `${w("created")} ${created}` : null}
        </p>
      ) : null}
    </div>
  );
}

function ListHead({ w }: { w: (word: Word) => string }) {
  return (
    <li className={styles.liqListHead} aria-hidden="true">
      <span>{w("pool")}</span>
      <span>{w("tvl")}</span>
      <span>{w("volume")}</span>
      <span>{w("fees")}</span>
      <span>{w("feeRate")}</span>
    </li>
  );
}

function PoolRow({ pool, w, usd, numberLocale }: { pool: LiquidityPool; w: (word: Word) => string; usd: Usd; numberLocale: string }) {
  const fee = feeText(pool, w, numberLocale);
  const quoteSide = pool.stockSide === "y" && !isMoneyLikeOrStock(pool.counterKind);
  return (
    <li className={styles.liqPool} data-meaningful={isMeaningful(pool) ? "true" : "false"}>
      <span className={styles.liqPoolPair} translate="no">
        <a href={pool.source.page} target="_blank" rel="noreferrer noopener">
          {pairName(pool)}
        </a>
        <span className={styles.liqSub}>
          {POOL_KIND_LABEL[pool.kind]}
          {quoteSide ? ` · ${w("side")}` : ""}
        </span>
      </span>
      <span className={styles.liqPoolFigure} translate="no">
        <span className={styles.liqPoolLabel}>{w("tvl")}</span>
        {usd(pool.tvlUsd)}
      </span>
      <span className={styles.liqPoolFigure} translate="no">
        <span className={styles.liqPoolLabel}>{w("volume")}</span>
        {usd(pool.volume24hUsd)}
      </span>
      <span className={styles.liqPoolFigure} translate="no">
        <span className={styles.liqPoolLabel}>{w("fees")}</span>
        {pool.fees24hUsd === null ? "—" : formatUsdMoney(pool.fees24hUsd, numberLocale)}
      </span>
      <span className={styles.liqPoolFigure} translate="no">
        <span className={styles.liqPoolLabel}>{w("feeRate")}</span>
        {fee ?? "—"}
      </span>
    </li>
  );
}

/** The line's own shape while the venue is read — one row, so the page does not jump when it lands. */
export function LiquiditySkeleton({ locale }: { locale: WorkspaceLocale }) {
  const w = wordsFor(locale);
  return (
    <section className={`${styles.card} ${styles.w12}`} aria-labelledby="liquidity-title" data-testid="liquidity" data-state="loading" aria-busy="true">
      <p className={styles.liqRest}>
        <span className={styles.liqLine}>
          <span id="liquidity-title" className={styles.liqLineLabel}>
            {w("whereTrades")}:
          </span>{" "}
          <span className={`${styles.bone} ${styles.liqBone}`} aria-hidden="true" />
        </span>
      </p>
    </section>
  );
}
