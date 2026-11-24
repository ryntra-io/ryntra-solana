'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { EARN_PRO_STOCKS_OPEN } from '@/city/lib/earn/pro';
import { useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { issuerPowersLine, type PoolFacts } from '@/lib/stocks/pool-facts';
import type { PoolsShelf, ShelfPool } from '@/lib/stocks/pools-shelf';
import { CoinLogo, Icon, Info, Quiet, QuietLink } from '@/terminal/ui';
import { DLMM_STOCKS_SCREEN } from '../dlmm/flag';
import { chipOf, guardKey, guardOf, timeText } from '../facts-view';
import { stockLineOf } from '../position-line';
import { useStockPoolFacts } from '../useStockPoolFacts';
import { STOCK_FACTS, STOCK_POSITION } from '../words';
import { actionOf, dayText, depthText, hrefOf, logoOf, logosAfter, pctText, shelfShown, shownPools, type ShelfAction, type ShelfScreen } from './shelf-view';
import { useStockPools } from './useStockPools';
import { STOCK_POOLS } from './words';
import s from './pools.module.css';

/** What this build offers: the terminal's own switches of the stock pools' deposit. */
const SCREEN: ShelfScreen = { dlmm: DLMM_STOCKS_SCREEN === 'open', pro: EARN_PRO_STOCKS_OPEN };

/** The clock the exchange's times are judged by: a minute is fine enough for its hours. */
const TICK_MS = 60_000;

/**
 * A stock's pools on Meteora on its own page: every pool of the stock on DLMM and DLMM Pro, the deepest
 * first, each row its pair, its depth, its fee now, a day's volume and — where the stock's limits rest — the limit
 * bonus, and one action: «Deposit» (the stock pools' deposit, on the pool's page) or «Limit with bonus» (the ladder, on
 * the pool's page). A row with neither still opens its pool by its pair. Over the rows, one line of the exchange's hours
 * and the issuer's rights (`facts`); the rest — how the figures are read, the bonus, the issuer's terms — behind «i».
 *
 * A coin that is no stock, a stock with no pool, or a read that failed shows nothing. The coin's page mounts it in one
 * line — `<StockPoolsShelf mint={mint} />`; a page that already shows the stock's facts right above says `facts={false}`
 * so the hours and the rights are not said twice. A stand hands in `shelf` and `stockFacts` and nothing is read.
 */
export function StockPoolsShelf({ mint, shelf: given, stockFacts, facts: line = true, screen = SCREEN }: { mint: string; shelf?: PoolsShelf | null; stockFacts?: PoolFacts | null; facts?: boolean; screen?: ShelfScreen }) {
  const shelf = useStockPools(mint, given);
  const facts = useStockPoolFacts(mint, stockFacts);
  const d = useWords(STOCK_POOLS);
  const f = useWords(STOCK_FACTS);
  const p = useWords(STOCK_POSITION);
  const lang = useLang();
  const [all, setAll] = useState(false);
  // Times are the person's own clock, so they are drawn in the browser only — never a server's zone first.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const tick = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(tick);
  }, []);
  if (!shelfShown(shelf)) return null;

  const symbol = shelf.symbol ?? shelf.pools[0]!.stock.symbol;
  const rows = shownPools(shelf.pools, all);
  const actions = shelf.pools.map((pool) => actionOf(pool, screen));
  const stock = facts?.isStock && facts.issuer ? facts : null;
  const view = stockLineOf(stock, lang);
  const chip = stock && now !== null ? chipOf(stock, now) : null;
  const guard = stock && now !== null ? guardOf(stock, now) : null;
  const when = (at: number) => (now === null ? '' : timeText(at, now, lang));
  const hours = chip ? (chip.at === null ? f[chip.key] : f[`${chip.key}Until`](when(chip.at))) : null;
  const rights = stock ? issuerPowersLine(stock.powers, lang) : null;
  const factsLine = [hours, rights].filter(Boolean).join(' · ');

  return (
    <section className={s.shelf} aria-label={d.title(symbol)} data-stock-pools="" data-session={stock?.session}>
      <div className={s.head}>
        <span className={s.title}>{d.title(symbol)}</span>
        <Info label={d.title(symbol)}>
          <span className={s.why}>
            <span className={s.whyHead}>{d.whyHead}</span>
            <span>{d.why}</span>
            {actions.includes('limit') ? <span>{d.bonusWhy}</span> : null}
            {actions.includes('deposit') ? <span>{d.depositWhy}</span> : null}
            {stock?.issuer ? (
              <>
                <span className={s.whyHead}>{f.terms}</span>
                <span>{stock.powers?.take && stock.powers.pause ? p.issuerWhy(stock.issuer.label) : f.issuedBy(stock.issuer.label)}</span>
                <span>{p.hoursWhy}</span>
                {view.excluded ? <span>{p.notOffered(view.excluded)}</span> : null}
                {view.limited ? <span>{p.limited(view.limited)}</span> : null}
                {guard ? <span>{f[guardKey(guard)](when(guard.at))}</span> : null}
                {view.termsUrl ? (
                  <a className={s.whyLink} href={view.termsUrl} target="_blank" rel="noopener noreferrer">
                    {f.read}
                    <Icon name="arrow" size="s" />
                  </a>
                ) : null}
              </>
            ) : null}
          </span>
        </Info>
      </div>
      {line && factsLine ? (
        <p className={s.line} data-tone={stock?.powers?.paused === true ? 'warn' : undefined}>
          <Icon name="shield" size="s" />
          <span>{factsLine}</span>
        </p>
      ) : null}
      <ul className={s.list}>
        {rows.map((pool) => (
          <Row key={pool.address} pool={pool} action={actionOf(pool, screen)} />
        ))}
      </ul>
      {shelf.pools.length > rows.length || all ? (
        <span className={s.more}>
          <Quiet size="s" aria-expanded={all} onClick={() => setAll(!all)}>
            {all ? d.fewer : d.more(String(shelf.pools.length))}
          </Quiet>
        </span>
      ) : null}
    </section>
  );
}

/** One pool: its pair and its one action; under them its depth, which venue, the fee, a day's volume and the limit bonus. */
function Row({ pool, action }: { pool: ShelfPool; action: ShelfAction }) {
  const d = useWords(STOCK_POOLS);
  const lang = useLang();
  const pair = d.pair(pool.stock.symbol, pool.other.symbol);
  const day = dayText(pool, lang);
  return (
    <li className={s.row} data-venue={pool.venue} data-action={action ?? undefined}>
      <span className={s.logos} aria-hidden="true">
        <CoinLogo src={logoOf(pool.stock.mint)} also={logosAfter(pool.stock.mint)} symbol={pool.stock.symbol} size="s" />
        <CoinLogo src={logoOf(pool.other.mint)} also={logosAfter(pool.other.mint)} symbol={pool.other.symbol} size="s" />
      </span>
      <span className={s.name}>
        <Link className={s.pair} href={hrefOf(pool, null)} aria-label={d.open(pair)}>
          {pair}
        </Link>
      </span>
      {action ? (
        <span className={s.act}>
          <QuietLink href={hrefOf(pool, action)} size="s">
            {action === 'limit' ? d.limit : d.deposit}
          </QuietLink>
        </span>
      ) : null}
      <span className={s.figs}>
        <span className={s.depth} title={d.liquidity}>
          {depthText(pool, lang)}
        </span>
        <span className={s.venue}>{pool.venue === 'dlmm-pro' ? d.pro : d.dlmm}</span>
        {pool.feePct !== null ? <span>{d.fee(pctText(pool.feePct, lang))}</span> : null}
        {day ? <span>{day.floor ? d.dayFloor(day.text) : d.day(day.text)}</span> : null}
        {pool.bonusPct !== null ? <span className={s.bonus}>{d.bonus(pctText(pool.bonusPct, lang))}</span> : null}
      </span>
    </li>
  );
}
